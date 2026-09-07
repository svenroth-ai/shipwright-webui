# Iterate: Leadwright lead-setup Intent Wizard (W14, replaces withdrawn W13)

**Status:** implemented

- **Run ID:** `iterate-2026-09-07-leadwright-setup-wizard`
- **Intent:** FEATURE — Track B card. Setting up a leadwright lead today means
  hand-writing three files (`org-chart.json`, `<leadId>/charter.md`,
  `daemon-config.json`) that must agree in ways nothing checks, and every
  failure is silent (a typo'd domain string, a relative path, a missing
  charter band). This card replaces that with a guided wizard whose finish
  action is gated on a real verdict from leadwright's own preflight checker.
- **Complexity:** medium (`classify_complexity.py`: estimate `medium`,
  confidence 0.85, `prior_source: keyword`, risk flags `touches_auth` /
  `touches_migrations`, floor `small`; own read of the actual scope —
  4 new server routes, 1 new lock module, 1 new subprocess transport, 2
  vendored schemas, ~15 new client files, 1 modified client field, 1 new E2E
  spec — confirms medium rather than escalating to large: no single piece is
  itself large, and every piece mirrors an existing pattern 1:1 rather than
  inventing one).
- **Precondition:** leadwright card L19 (setup pre-flight validator) —
  landed via PR #67 (`5d11eb0`) + PR #70 (`43fcd49`, publishes the `--stdin`
  input contract this card depends on). Verified directly against
  `origin/main` source before starting (see "L19 transport contract" below).
- **Spec Impact:** ADD — new write surfaces (org-chart.json entries,
  daemon-config.json entries), new read surfaces (domain vocabulary,
  preflight verdict transport); no existing contract narrowed.
- **Mode:** `--autonomous`, no human present for the Interview / Approval
  Gate. The card's own brief is exhaustive enough to answer all 7
  interview-equivalent questions directly; remaining gaps (schema fields the
  7 wizard questions don't cover) are resolved below with explicit defaults,
  not silently invented at build time.
- **Affected FRs:** none pre-existing — minted **FR-01.73** (Leadwright
  lead-setup wizard, Area PLT). No FR-gate change to an existing contract.

## Corrections to the card's own framing (from the PO, verified against source)

The original card brief got four things about L19's transport wrong. Corrected
2026-09-07, verified against `leadwright` `origin/main` (`43fcd492`) directly:

1. **The absolute-path rule covers exactly 5 fields — not charter/learnings
   paths.** `leadsRoot`, `sdkSessionsPath`, `pluginDirs`, `leadProjectRoots`,
   `leadPluginDirs` must be absolute before submitting/writing. `charter_path`
   / `learnings_path` on a lead entry MUST stay **relative**, no `..`
   (`lib/org-chart-schema.ts:87/94`) — they resolve against `leadsRoot` via
   `resolveLeadPath`, never against a calling process's cwd. `orgChartPath` is
   excluded from the rule entirely (an inline submission's org chart comes
   from the payload's own `orgChart` field, never from
   `daemonConfig.orgChartPath`).
2. **Preflight input shape:** `{ orgChart, charters: [{leadId, content}],
   daemonConfig }` — charters are **inline content**, never paths. Source:
   `daemon/setup-preflight-input-contract.ts`, published as
   `schemas/preflight-input.schema.json`. Two schemas to vendor (input +
   result), not one.
3. **stdin must be explicitly closed** (`child.stdin.end()`) — the CLI's
   `STDIN_TIMEOUT_MS = 30_000` hangs the child otherwise.
4. **Exit code is not the fail-closed signal.** Exit 0/1 comes from
   `result.ok` even with `--json` — exit 1 is a legitimate "MUSS unsatisfied"
   verdict, not a transport failure. **stdout parses as a `PreflightResult`
   ⇒ the check ran** (render its verdict, red or green). **stdout empty or
   unparsable ⇒ it did not run** — only this is the "leadwright not
   reachable" state that blocks the wizard's finish action.

## L19 transport contract (read directly from `origin/main`, 2026-09-07)

- `scripts/check-setup.ts --stdin --json`: reads stdin (30s timeout →
  `null` on timeout/empty), JSON-parses it, validates against
  `PreflightStdinInputShape` (zod), wraps into inline `PreflightInput`, calls
  `runSetupPreflight`, prints the human report to **stderr**, prints
  `JSON.stringify(result)` as the **only** stdout line, sets
  `process.exitCode = result.ok ? 0 : 1`. A malformed/invalid stdin document
  prints a named error to stderr and exits 1 with **empty stdout** — this is
  the fail-closed signal webui must key off, not the exit code.
- `PreflightStdinInputShape` (`daemon/setup-preflight-input-contract.ts`,
  `.strict()`): `orgChart: OrgChartSchema`, `charters:
  {leadId: string.min(1), content: string}[]` (content may be **empty** — an
  empty charter is a valid submission, surfaces as its own
  `charter-bands:<leadId>` finding, never a submission error), `daemonConfig:
  RawDaemonConfigSchema`.
- `PreflightResult` (`lib/preflight-contract.ts`, unchanged since #67):
  `{ ok: boolean, findings: {key, layer: "MUSS"|"KANN"|"advisory", satisfied,
  unverifiable?, message}[] }`.
- Both are generated JSON Schemas (`schemas/preflight-input.schema.json`,
  `schemas/preflight-result.schema.json`) — vendor byte-for-byte.

## What already exists (read in source 2026-09-07)

**Webui org routes** (`server/src/external/org/routes.ts`) mount at
`/api/external/org/*` (not `/api/org/...` — corrects the card's shorthand).
Router middleware: host-allowlist, then `leadsRouteSecret` fail-closed check
(`{error:"leads_route_not_configured"}, 503` when unset — the pattern the new
`leadwrightCheckoutRoot` config pointer copies verbatim). Existing routes:
`GET/PUT .../file` (6-entry allowlist, `org-chart.json` deliberately excluded
— own typed endpoint), `GET .../org-chart` (fixed `path.join(leadsRoot,
"org-chart.json")`, inline symlink check, no `pathGuard`), `GET .../usage`,
`POST .../decisions/countersign`, `GET .../last-run`, `GET
.../beat-register/health`, `POST .../beat-register/release`.

**Lock discipline** (`decisions-lock.ts` `withDecisionsLock`) is **hardcoded**
to the decisions files — not reusable as-is. Its shape (to copy into a new
`org-chart-lock.ts`): `ensureFile` (wx-flag exclusive create) →
`assertNotSymlink` before lock → `lockfile.lock(path,
claimRecordLockOptions({retries:{retries:8,minTimeout:50,maxTimeout:500,
factor:2}}))` → `assertNotSymlink` again immediately after acquiring (closes
a TOCTOU window in the lock's own retry backoff) → run the read-modify-write
closure → `release()` in `finally`. Error convention (from
`beat-register-release-request.ts`): explicit catch mapping
`ELOCKED → 409 {error:"<resource>_locked"}`, a named domain error → its own
4xx, else rethrow to the app error handler.

`claimRecordLockOptions(extra)` strips any caller-passed `lockfilePath`,
injects `stale`/`realpath` from the vendored
`vendor/leadwright/claim-record-lock-contract.json` (fidelity proven by a
test with a hard `contractVersion` pin — the pattern this card's two new
vendored schemas copy, rather than adding a runtime JSON-Schema validator:
**no `ajv`/`zod` dependency exists in `server/package.json` today**, and
"never compute a verdict here" already rules out webui re-validating and
blocking on its own — leadwright's `--stdin` zod gate is the sole judge. So
the two vendored schemas get the same test-time fidelity-test treatment
`claim-record-lock-contract.json` gets, not a new runtime dependency).

`LEAD_ID_RE = /^[a-z0-9][a-z0-9-]*$/` (`_helpers.ts`) is the **same** pattern
leadwright's own `org-chart-schema.ts` uses for both lead-id and `domain` —
one regex, reused for kebab-case validation everywhere in the wizard.

**`RawDaemonConfigSchema`** (leadwright `daemon/config.ts`, `.strict()`):
`orgChartPath: string` (req) · `leadsRoot?/sdkSessionsPath?: string`
(optional, resolved defaults) · `webuiBaseUrl: string` (req) ·
`leadProjectRoots: Record<string,string>` default `{}` (leadId → **single**
path, confirmed not an array) · `leadActionIds: Record<string,string>`
default `{}` · `pluginDirs: string[]` default `[]` · `leadPluginDirs:
Record<string,string[]>` default `{}` · `pollIntervalMs`/`beatTimeoutMs:
number` (defaults 30000/120000).

**`LeadSchema`** (leadwright `lib/org-chart-schema.ts`) — **the 7 wizard
questions do not cover every required field.** Resolved defaults below (§
"Fields the 7 questions don't cover") for: `reports_to` (req, `null |
lead-id`), `manages` (array), `charter_path`/`learnings_path` (req, relative
no `..`), `triggers.on` (min-1 array of `"answer_received" |
"chat_session_ended"`), `max_concurrent_tasks` (1-8), `projects` (array,
min-1 — the wizard picks one project, submits `[projectId]`),
`allowed_skills` (min-1, `/skill-name` pattern), `allowed_tools` (array,
default `[]`), `model` (`"fast"|"balanced"|"deep"`), `paused` (default
`false`).

**Client:** `client/src/components/wizard/IntentWizard/` is the idiom to
mirror, not extend — its reducer/types are hardcoded to the `new|adopt|grade`
door domain, unrelated to lead setup. `FlightPlanRail.tsx`, `StepDots.tsx`,
`buttons.tsx` (`WzPrimary`/`WzOutline`) are **already fully generic** (typed
on `FlightRow[]`/`{total,current}`/plain props) — imported and reused
verbatim, not re-implemented. `useReadiness.ts`/`ReadinessGate.tsx` are
domain-specific (toolchain checks) but their **contract shape**
(`{report, ready: data?.ready===true, loading, error}`, react-query
`retry:false`, ready only true on a positive result) is the pattern a new
`useLeadwrightVerdict` hook + gate copy — not the files themselves.
`lib/lead-task-extension.ts:115` (`isClaimableByLead`) does exact `===`
string match on `domain` — the defect this card closes at the source (one
shared vocabulary, not a validation rule bolted on afterward).
`LeadwrightFields.tsx:56-63` has the free-text `<input>` to convert to a
`<select>`. `useProjects()` → `Project{id,name,path,...}` is the existing
project-list hook; `GET /api/external/projects/:projectId/actions` is the
existing action-catalog route — both reused as-is, no new server route for
either.

## What to build

### Server

1. `server/src/config.ts` — add `leadwrightCheckoutRoot: string | undefined`
   (env `SHIPWRIGHT_LEADWRIGHT_CHECKOUT`, no default), mirroring
   `leadsRouteSecret`'s fail-closed posture exactly.
2. `server/src/vendor/leadwright/preflight-input.schema.json` +
   `preflight-result.schema.json` — vendored byte-for-byte from leadwright
   `origin/main` @ `43fcd492`. A fidelity test (mirroring
   `claim-record-lock.test.ts`) asserts required-field/property-name parity
   between the vendored JSON and the hand-typed TS request/response shapes
   this card writes, with a pinned `contractVersion` (1 for both, per
   source) that must be bumped deliberately on any future re-copy.
3. `server/src/core/leadwright-preflight-transport.ts` — pure module, no Hono
   dependency: `runLeadwrightPreflight(checkoutRoot, proposal):
   Promise<TransportResult>` where `TransportResult = {ranOk:true, result:
   PreflightResult} | {ranOk:false, reason:string}`. Resolves `argv =
   [path.join(checkoutRoot,"node_modules",".bin","tsx"),
   path.join(checkoutRoot,"scripts","check-setup.ts"), "--stdin","--json"]`
   via the **existing** `resolveSpawn(argv, checkoutRoot)`
   (`core/win32-spawn.ts` — same helper `preview-session-manager.ts` already
   uses; a `null` result is its own `ranOk:false` reason, e.g. "tsx not found
   under the configured checkout"). Spawns with `stdio:"pipe"`,
   `windowsVerbatimArguments: resolved.windowsVerbatimArguments`, writes
   `JSON.stringify(proposal)` to `child.stdin`, **calls `child.stdin.end()`**
   (correction 3 above), collects stdout/stderr, and on close: stdout parses
   as `{ok:boolean, findings:array}` ⇒ `{ranOk:true, result}`; empty/unparsable
   stdout ⇒ `{ranOk:false, reason: stderr || "leadwright produced no output"}`
   (correction 4 — never keyed off exit code).
4. `server/src/external/org/leadwright-lock.ts` — new lock module, copying
   `decisions-lock.ts`'s exact shape (ensureFile → assertNotSymlink →
   `lockfile.lock` via `claimRecordLockOptions` → assertNotSymlink again →
   closure → release in `finally`) but generic over the target path (needed
   for `org-chart.json`, `daemon-config.json`, and the new
   `<leadId>/charter.md`, three independent lock acquisitions in the commit
   route's fixed order — never a single combined lock across files). The
   `daemon-config.json` existence check happens **inside** its lock
   acquisition, not before it (external-review finding, GLM: checking
   existence outside the lock is a TOCTOU race against a concurrent
   commit, and the module's own `ensureFile` — a `wx`-flag exclusive
   create — would itself create the file the "show a fragment instead"
   branch is supposed to detect as absent). Concretely: lock a
   caller-supplied target path **without** `ensureFile` when the caller
   passes `mustExist:true` (daemon-config's case), treating `ENOENT` on the
   read *inside* the lock as the "not there, hand back a fragment" branch
   rather than racing a plain existence check against another writer.
5. New routes under `/api/external/org/*` (same middleware chain — host
   allowlist + `leadsRouteSecret` — plus the new `leadwrightCheckoutRoot`
   check on the verdict/commit routes):
   - `GET /api/external/org/daemon-config` — mirrors `GET .../org-chart`'s
     existing read pattern (fixed `path.join(leadsRoot,
     "daemon-config.json")`, inline symlink check, no write). Returns
     `{found:true, config: RawDaemonConfig} | {found:false, template:
     {orgChartPath, webuiBaseUrl, ...defaults}}` — `orgChartPath` in the
     `found:false` template is server-computed (`path.join(leadsRoot,
     "org-chart.json")`), `webuiBaseUrl` is this webui server's own known
     base URL, both are never guessed by the client (external-review
     finding, both legs: the client must not construct required
     `daemonConfig` fields from scratch).
   - `POST /api/external/org/verdict` — body `{leadId, lead: <LeadSchema
     fields minus charter/learnings content>, charterContent: string,
     daemonConfigAdditions: {path, actionId, pluginDirs}}` — **not** a
     full assembled proposal. The route itself fresh-reads
     `org-chart.json` and `daemon-config.json` (or the found:false
     template) server-side, merges the new lead in exactly the way the
     commit route below will, and **only then** builds the `PreflightStdinInput`
     document and calls the transport (external-review finding, both legs:
     the verdict payload must reflect the real post-write state, not a
     client-assembled guess — merging happens once, in one place, reused by
     both preview and commit). 503 `leadwright_not_configured` if the
     checkout pointer is unset. Response: `{ranOk, result?, reason?,
     proposalDigest?}` — `proposalDigest` is a server-computed hash of the
     exact merged proposal that produced this verdict; the commit route
     below requires it and rejects a mismatch (external-review finding,
     openai: binds commit to the verdict that actually ran, so a direct API
     caller cannot skip the check by hand-posting to commit).
   - `POST /api/external/org/leads/commit` — the **single** write endpoint
     (replaces the three-separate-client-calls design the first draft had —
     external-review finding, both legs: sequential client-driven writes
     across three files are not atomic and have no defined recovery order).
     Body: the same shape `/verdict` took, plus the required
     `proposalDigest` from that call. Server-side, in order:
     1. Recomputes the merge + digest; 409 `verdict_stale` if it doesn't
        match the supplied `proposalDigest` (closes the same bypass: even a
        caller who ran `/verdict` legitimately must commit the *same*
        proposal, not an edited one).
     2. Server-side validates `leadId` against `LEAD_ID_RE` and rejects an
        absolute or `..`-containing `charter_path`/`learnings_path`
        (external-review finding, GLM: mirroring leadwright's own schema at
        the write boundary is not "inventing a stricter rule" — it is
        refusing to persist something leadwright's own schema already
        forbids, from *any* caller of this route, wizard or not).
     3. Writes `<leadsRoot>/<leadId>/charter.md` (new file — the write this
        card's first draft omitted entirely; external-review finding, both
        legs, high severity: the card's whole premise is replacing
        hand-authoring of THREE files, and a verdict that goes green while
        `charter_path` points at a file that was never created is exactly
        the silent-failure class this card exists to close). Locked +
        symlink-checked the same way as the other two writes.
     4. Writes `daemon-config.json` additively (existing narrow-add
        behavior — `leadProjectRoots[leadId]`, `leadActionIds[leadId]`,
        `leadPluginDirs[leadId]` only, never touching an existing key). If
        the file doesn't exist, returns `{committed:false, stage:
        "daemon-config", fragment: "<copy-paste JSON snippet>"}` and
        performs **no further writes** (the fragment path from the card's
        own brief, now reached from inside the ordered commit rather than
        as a separate client call).
     5. Writes `org-chart.json` **last** — the entry that makes the lead
        real/claimable. Idempotency: if `leadId` already exists in
        `org-chart.json` with **identical** content, this step is a no-op
        success rather than a 409 (external-review finding, GLM: makes a
        retry after a step-4 failure self-recoverable instead of stranding
        the operator with an orphaned charter file and no way to finish).
        A genuine collision (existing entry, different content) is still
        409 `org_chart_lead_exists`.
     This ordering is deliberate: charter.md and daemon-config.json are
     inert on their own (nothing reads them for a lead that isn't in
     org-chart.json yet), so a failure at any step before the last leaves
     only harmless residue, safely retried; only the final, idempotent
     org-chart write activates the lead. Returns `{committed:true,
     restartNotice: "<message>"}` on success. The restart notice is not
     decorative — `loadDaemonConfig` runs once at daemon boot
     (`daemon/index.ts:80`); this is what the client renders as a
     non-dismissable blocking panel, not a toast.
   - `GET /api/external/org/domains` — reads `org-chart.json` (`leads[].domain`)
     unioned with every project's task store `domain` field (loop
     `ProjectManager.getAll()`, open each project's `SdkSessionsStore` —
     no existing cross-project aggregator was found, so this is new, narrow,
     read-only iteration). Returns `{domains: string[], unclaimedCounts:
     Record<string,number>}` (count of `state==="draft" && !claimToken`
     cards per domain — mirrors `isClaimableByLead`'s own predicate so the
     count means what the wizard says it means). React-query `staleTime`
     of a few minutes on the client (external-review finding, GLM: this
     route now backs a frequently-opened modal too — `NewIssueModal` — so
     it should not re-fetch on every open). `NewIssueModal`'s domain
     `<select>` degrades to a plain free-text `<input>` (the field's prior
     behavior) when the vocabulary fetch itself fails, so a select with a
     possibly-empty option list is never the only way to fill this field.

**Correction (post-implementation, verified against the shipped code):**
the four routes above (`daemon-config`, `verdict`, `leads/commit`,
`domains`) do **not**, in fact, live under the secret-gated
`/api/external/org/*` family this section designed them under. That family
requires an `X-Shipwright-Leads-Secret` header a browser tab cannot supply
(and, per this router's own documented rationale, should not need to — it
is meant for leadwright's daemon and other external tooling, not this
webui's own UI). Building the wizard's client against `/api/external/org/*`
directly would have meant either embedding the secret in browser-shipped
code (a real credential leak) or leaving the wizard permanently broken.

The routes as actually shipped are **duplicated onto a new plain-surface
router**, `server/src/routes/org-lead-setup-wizard.ts` (host-allowlist
only, same posture as every other first-party `/api/org/*` route —
`org.ts`, `org-writes.ts`), registered under `/api/org/domains`,
`/api/org/leads/verdict`, `/api/org/leads/commit`. Both surfaces call the
exact same pure cores (`domainsCore`, `verdictCore`, `commitCore` — the
`*Core(deps, input) → {status, body}` split already used elsewhere in this
codebase), so there is no duplicated *logic*, only a second, unauthenticated
registration of the same handlers for first-party same-origin callers. This
mirrors an established convention from two prior same-week iterates
(`iterate-2026-09-06-org-lead-staleness-register`,
`-decisions-proposed-countersign`) that this document should have named and
did not. The secret-gated `/api/external/org/*` copies of these four routes
remain live and correct for leadwright's daemon / external tooling — this
is an ADDITIVE second surface, not a replacement.

One consequence: the `leadsRouteSecret` 403/503-unconfigured trigger this
section describes for `GET .../domains` cannot occur via the plain-surface
path the client actually calls (it carries no secret check at all). The
free-text degrade described above is still implemented and still correct —
it now guards against any OTHER `GET /api/org/domains` failure (network
error, 500, a genuinely down server), not specifically the secret-gate
case this section originally had in mind.

**Subprocess robustness** (external-review finding, both legs, medium
severity): the transport module handles the child's `error` event (spawn
failure itself, distinct from a resolvable-but-crashing child) and the
stdin stream's own `error` (EPIPE if the child exits before stdin is fully
written), imposes a wall-clock deadline (separate from `STDIN_TIMEOUT_MS`,
which only bounds the *webui→leadwright* stdin write) after which the child
is killed and the call resolves `ranOk:false` with a named `timeout` reason,
and caps total collected stdout/stderr bytes. `reason` text distinguishes
"could not spawn" / "timed out" / "produced no output" so a rotted
`leadwrightCheckoutRoot` (tsx missing, wrong path) doesn't read identically
to a legitimate empty-stdout failure.

### Client — `client/src/components/wizard/LeadSetupWizard/` (new, sibling
to `IntentWizard/`, same idiom, own reducer — the domains genuinely differ)

- `types.ts` — `LeadWizardAnswers`, `LeadWizardState` (step 1-8: name/id/domain,
  project, action, cadence, budget, authority, escalation, verdict).
  Re-exports/reuses `FlightRow` from `../IntentWizard/types` rather than
  redeclaring it.
- `leadWizardState.ts` — reducer + `deriveLeadRows(state): FlightRow[]`
  (one row per answered field, "Because you said X → Y" — id vs. domain
  rendered as **two separate rows**, per the card's explicit "show it's
  different" requirement, never merged into one).
- Step screens (`NameIdDomainStep.tsx`, `ProjectStep.tsx`, `ActionStep.tsx`,
  `CadenceStep.tsx`, `BudgetStep.tsx`, `AuthorityStep.tsx`,
  `EscalationStep.tsx`) — same `wz-left`/`StepDots`/`wz-q`/`wz-hint`/
  `wz-foot`/`WzOutline`+`WzPrimary` markup as `NewPathQuestions.tsx`, one
  question per screen.
  - Domain field: a `<select>` sourced from `useDomainVocabulary()` (new
    hook, `GET /api/external/org/domains`), plus an explicit "+ create a new
    domain" action that enforces `LEAD_ID_RE` kebab-case rather than
    free text. On selection, shows `unclaimedCounts[domain] ?? 0`.
  - Project step: `useProjects()` → picks one `Project`; fills BOTH the
    wizard's `projects: [project.id]` answer AND `leadProjectRoots` answer
    (`project.path`, already absolute) from the same selection — the
    coupling the card calls out as otherwise easy to get wrong by hand.
  - Action step: `GET /api/external/projects/:projectId/actions` (existing
    route) for the selected project → picks one action → fills
    `leadActionIds` (the action id) and `allowed_skills` from the action's
    own canonical `slash_command` field (FR-01.37 / #123 confirms this
    field exists on the `Action` type — read it directly rather than
    deriving a slash command from `action.id`; external-review finding,
    openai: guessing a skill name from an id can name a skill that doesn't
    exist or isn't authorized, silently undermining the verdict's meaning
    — using the field the action catalog already carries removes the
    guess entirely).
  - Domain select: a legacy task-store domain that fails `LEAD_ID_RE` (only
    possible via the union with existing card data, never via the wizard's
    own "create new domain" path, which already enforces the pattern) is
    rendered but **not selectable**, with an inline explanation, rather
    than producing a proposal the verdict will always reject
    (external-review finding, openai, low severity).
  - Cadence step: a small set of named choices (e.g. "Every 15 minutes" /
    "Hourly" / "Twice a day") mapped to `triggers.cron` cron strings, plus a
    toggle "wake on answer" — since `triggers.on` requires **at least one**
    entry, cron-only cadence still emits `on: ["chat_session_ended"]` as the
    always-present baseline trigger, and the toggle additionally includes
    `"answer_received"` when checked (never an empty array).
  - Budget step: weekly cap (usd), pause fraction, hard-stop fraction →
    `budget.window` is always the fixed literal `"rolling-7d"`,
    `usd`/`pause_at`/`hard_stop_at` from the three inputs.
  - Authority step: the four bands from the example charter, editable text
    per band; headings are structural constants (never deletable/renamable
    in the UI, matching the card's explicit requirement).
  - Escalation step: PO or another lead (from the org-chart's own lead list)
    → `escalation_target`.
  - `max_concurrent_tasks` and `model`: not separate wizard screens (not in
    the card's 7-question list) — surfaced as two small fields on the
    Authority screen (closest thematic fit — both bound what the lead is
    allowed to do), with sensible defaults (`max_concurrent_tasks: 2`,
    `model: "balanced"`) pre-filled and editable, not hidden.
- `useLeadwrightVerdict.ts` — builds the **narrow** request body
  `/verdict` actually takes (`{leadId, lead, charterContent,
  daemonConfigAdditions}` — never a client-assembled full org-chart/
  daemon-config; the server does the fresh-read-and-merge, per the
  revised route design above), POSTs to `/api/external/org/verdict`,
  react-query `retry:false`, exposes `{loading, ranOk, result, reason,
  proposalDigest}` — **not-ready-until-proven**: the finish action stays
  inert while `loading`, and when `!ranOk` renders the named "leadwright
  not reachable" state rather than a stale/blank green tick.
  `proposalDigest` is threaded through unchanged to the commit call — the
  wizard never recomputes or edits it client-side.
- `useLeadwrightCommit.ts` — POSTs to `/api/external/org/leads/commit`
  with the same body plus the `proposalDigest` from the last successful
  verdict; a change to any answer after a verdict was fetched invalidates
  the stored digest client-side (forces a fresh `/verdict` call before
  commit is enabled again — the wizard cannot submit a proposal the
  displayed verdict didn't actually cover).
- `absolutePaths.ts` — `assertAbsoluteOrFlag(fields)`: a browser-safe
  absolute-path check (Windows drive-letter `C:\...`, UNC `\\server\share`,
  and POSIX `/...` all classified as absolute; a value starting `..` or a
  bare relative fragment flagged — explicit test cases for all four forms
  plus `..`-traversal per external-review finding, openai) on exactly the
  5 rule-bound fields before both the verdict call and the final write; a
  relative value is a client-side blocking validation message, not a
  silent resolve-against-nothing (correction 1 — and per the card, "L19
  reporting a relative one as a finding is itself a bug here", i.e. this
  must never reach L19 relative in the first place). Explicitly does
  **not** touch `charter_path`/`learnings_path` — those stay the fixed
  relative `<leadId>/charter.md` / `<leadId>/learnings.md` convention,
  which the server-side commit route also enforces independently (see the
  server-side validation note on `POST .../leads/commit` above — a
  client-only check is advisory, not a security boundary).
- `VerdictStep.tsx` — renders `useLeadwrightVerdict()`'s three finding
  groups (what will be written / couplings checked / MUSS requirements,
  grouped by `finding.layer`+a "writes" pseudo-group derived client-side
  from the proposal, not from L19's findings — L19 doesn't group by "what
  gets written"), the ReadinessGate-shaped inert-while-loading /
  named-not-reachable-while-unproven finish button (disabled whenever
  `ranOk` is false OR the answers have changed since the last verdict —
  see `useLeadwrightCommit.ts`'s digest-invalidation above), and — once
  `ranOk` is true — a single "Create lead" action wired to
  `useLeadwrightCommit()` (one server round trip, not three client calls).
  A `committed:false, stage:"daemon-config"` response renders the
  copy-paste fragment inline rather than failing silently; a genuine
  `verdict_stale` 409 re-triggers the verdict call automatically and
  explains why. On success, the **restart notice renders as a
  non-dismissable panel**, not a toast.
- `LeadSetupWizard.tsx` — orchestrator: `useReducer` + step switch +
  `<FlightPlanRail rows={deriveLeadRows(state)} />`, same `<div
  className="wz">` shell as `IntentWizard.tsx`.
- Route: a new entry point (menu item / button) into the wizard — placed
  next to the existing org-chart surfaces (`OrgPage`), not a new top-level
  nav item (matches the "no new idiom" instruction at the navigation level
  too).

### Client — domain vocabulary consolidation

- `client/src/components/external/NewIssueModal/LeadwrightFields.tsx` —
  the free-text `<input type="text" data-testid="new-issue-domain-input">`
  becomes a `<select>` fed by the **same** `useDomainVocabulary()` hook the
  wizard uses (one source, per the card's explicit "two lists reintroduce
  the drift" warning), with the same "+ create new domain" kebab-case path.

## Fields the 7 questions don't cover — explicit defaults (not silently invented)

| `LeadSchema` field | Not asked because | Default / source |
|---|---|---|
| `reports_to` | no org-hierarchy question in the card | `null` (top-level lead; PO can edit `org-chart.json` by hand for a hierarchy — out of scope, creation only) |
| `manages` | " | `[]` |
| `charter_path` | fixed convention, not user input | `` `${leadId}/charter.md` `` |
| `learnings_path` | " | `` `${leadId}/learnings.md` `` |
| `triggers.on` (min 1) | card only asks cadence + "wake on answer" | always includes `"chat_session_ended"`; adds `"answer_received"` when the toggle is on |
| `max_concurrent_tasks` | not in the 7 questions | `2`, editable field on the Authority screen |
| `model` | " | `"balanced"`, editable field on the Authority screen |
| `allowed_tools` | " | `[]` (leadwright's own default; no wizard control — matches "add no validation rule of your own") |
| `paused` | " | `false` (new leads start active) |

### Server — checkout health (external-review addition, GLM architecture pass)

6. `GET /api/external/org/beat-register/health` (existing) is where an
   operator already looks for org-subsystem health — extend its response
   with a `leadwrightCheckout: "unconfigured" | "configured"` field (config
   pointer presence only, never a live spawn probe on every health poll)
   so a rotted/unset checkout is visible outside the wizard, not only as an
   in-wizard "not reachable" state discovered mid-session
   (external-review finding, GLM: the fail-closed design makes breakage
   visible inside the wizard but invisible to anyone not mid-wizard).

**Correction (post-implementation, verified against the shipped code):**
`GET /api/external/org/beat-register/health` does not exist as a
general-purpose health route — direct source inspection at implementation
time found only a per-lead-scoped `GET /api/external/org/leads/:leadId/
beat-register` (requires a `leadId` path param, so it cannot carry a
global config-presence flag; line 94 above already listed the real name,
`beat-register/health`, as an assumption that turned out not to hold).
Rather than invent a new, unplanned route to match the literal name, the
`leadwrightCheckout` field was added to the ALREADY-existing
general-purpose `GET /api/diagnostics` route (`server/src/routes/
diagnostics.ts`) — the surface an operator genuinely already checks for
server health, and the one place a config-presence flag naturally belongs
alongside the CLI-compat banner (CLAUDE.md rule 10). This satisfies the
underlying GLM finding (breakage visible outside the wizard, not only
in-wizard) on a different, more appropriate surface than the one this
section originally named. See `diagnostics.leadwright-checkout.test.ts`.

## Not in scope (and why)

- No edit or delete of an existing lead — creation only, per the card.
- No touch to the audit or decision surfaces (W12/W11 own those).
- No new validation rule beyond what `LeadSchema`/the absolute-path rule
  already require — the wizard fills gaps with defaults, it does not invent
  stricter rules leadwright itself doesn't enforce.
- No runtime JSON-Schema validator dependency (`ajv`) — the vendored
  schemas get a test-time fidelity check, matching
  `claim-record-lock-contract.json`'s existing precedent; leadwright's own
  `--stdin` zod gate remains the sole verdict source.
- No change to `daemon/index.ts`'s single-load-at-boot behavior — the
  "restart the daemon" notice is the fix for that, not a live-reload
  feature (out of scope, and leadwright's own responsibility if it changes).

## Confidence Calibration

- **Boundaries touched:** one new I/O boundary class (subprocess spawn +
  stdin/stdout, `leadwright-preflight-transport.ts`), two new filesystem
  write boundaries (`org-chart.json`, `daemon-config.json`, both under the
  new lock module), one new cross-project read (domain vocabulary
  aggregation). All four get dedicated boundary probes per
  `references/boundary-probes.md` before the Test Completeness Ledger is
  finalized.
- **Empirical probes run:** recorded in the Ledger once Build (Step 6) is
  underway — most consequential ones: (a) a real `child_process.spawn`
  against a stubbed `check-setup.ts` fixture that closes stdout with 0
  bytes on stderr-only failure, proving the ranOk:false branch keys off
  parse success and not exit code; (b) a concurrent-write probe on the new
  lock module (two overlapping "add a lead" calls, second must 409, first's
  entry must survive intact); (c) an insertion-order probe proving a second
  lead added never reorders the first.
- **Test Completeness Ledger:** built out during Step 6/7.5, before F0.
- **Confidence-pattern check:** asymptote — the transport module is
  exercised at (successful verdict / red verdict / malformed-stdin
  fail-closed / stdin-timeout / unresolvable tsx binary); the lock module
  at (fresh file / concurrent writers / existing-key collision / symlink
  target). Coverage (breadth) — every new route, the reducer, the domain
  vocabulary union (org-chart-only, cards-only, both, empty), the absolute-
  path guard (all 5 fields, and the explicit non-application to
  charter/learnings paths), and the daemon-config narrow-add invariant
  (existing keys untouched — proven by test, per the card's own "done
  means" criterion d).

## Test Completeness Ledger

Machine-readable form recorded in `shipwright_test_results.json.iterate_latest.test_completeness`
(F5). Summary (27 behaviors — 26 below plus the real-browser E2E row — 0 untested-testable):

| # | Behavior | Disposition | Evidence |
|---|---|---|---|
| 1 | Preflight transport parses a genuine green verdict (`ranOk:true, result.ok:true`) | tested | `leadwright-preflight-transport.test.ts` |
| 2 | Preflight transport parses a genuine red verdict with findings | tested | `leadwright-preflight-transport.test.ts` |
| 3 | Preflight transport fails closed (`ranOk:false`) on unparsable/empty stdout — keys off parse success, not exit code | tested | `leadwright-preflight-transport.test.ts` |
| 4 | Preflight transport handles stdin write/close and a hung/unresolvable subprocess | tested | `leadwright-preflight-transport.test.ts` (24 cases total) |
| 5 | `org-file-lock`: fresh acquire + write round-trips | tested | `org-file-lock.test.ts` |
| 6 | `org-file-lock`: concurrent writer surfaces `ELOCKED`, mapped to a named 409 | tested | `org-file-lock.test.ts` |
| 7 | `org-file-lock`: symlink-escaped target is refused (`OrgFileSymlinkEscapeError`) | tested | `org-file-lock.test.ts` (8 cases) |
| 8 | `commitCore` rejects a malformed body (leadId casing, charter/learnings path convention, `allowed_skills` shape, non-absolute daemon-config fields) | tested | `commit-validate.test.ts` (12 cases) |
| 9 | `commitCore` 409s `verdict_stale` when the resubmitted digest no longer matches a fresh merge | tested | `commit.test.ts` |
| 10 | `commitCore` 409s `verdict_not_ok` and never writes when its own server-side re-verification comes back red, even if the digest matches — closes the unsigned-digest bypass | tested | `commit.test.ts` |
| 11 | `commitCore` 502s `leadwright_transport_failed` and never writes when the re-verification subprocess itself fails | tested | `commit.test.ts` |
| 12 | `commitCore` includes every other lead's real `charter.md` (`existingCharters`) in the proposal sent to preflight, matching leadwright's real inline-charters contract (no path-mode fallback) | tested | `leadwright-proposal-merge.test.ts`, `existing-charters-read.ts` covered via `leadwright-proposal-merge.test.ts`'s `readExistingLeadCharters` describe block |
| 13 | `commitCore` 409s `org_chart_lead_exists` upfront (pre-lock) on an obvious id collision, before any write | tested | `commit.test.ts` |
| 14 | `commitCore` 409s `org_chart_lead_exists` on a true-concurrency collision only visible inside the org-chart.json lock's fresh re-read | tested | `commit.test.ts` (the "doubt-review fix" case) |
| 15 | `commitCore` performs all three ordered writes and returns the restart notice | tested | `commit.test.ts` |
| 16 | `commitCore` returns `committed:false` with a fragment (writes nothing further) when daemon-config.json is absent | tested | `commit.test.ts` |
| 17 | `commitCore` maps daemon-config.json / org-chart.json lock and symlink errors to their named responses | tested | `commit-lock.test.ts` (4 cases) |
| 18 | `verdictCore` mirrors the same `existingCharters` inclusion at preview time | tested | `verdict.test.ts` |
| 19 | `daemon-config-read` found/missing branches | tested | `daemon-config-read.test.ts` |
| 20 | `org-chart-full-read` 200/404 branches | tested | `org-chart-full-read.test.ts` |
| 21 | Domain vocabulary union (org-chart-only, cards-only, both, empty) | tested | `domains.test.ts` (4 cases) |
| 22 | `absolutePaths` guard rejects relative paths, accepts absolute, and does not treat a `..`-containing (non-traversal) segment as a traversal | tested | `absolutePaths.test.ts` (11 cases) |
| 23 | 7-question wizard state machine transitions (forward/back, validation gating per step) | tested | `leadWizardState.test.ts` (12 cases) |
| 24 | Wizard answers assemble into a valid `PreflightLead` + daemon-config additions proposal | tested | `buildLeadProposal.test.ts` (9 cases) |
| 25 | `VerdictStep` renders the server's own red re-verification (`verdict_not_ok`) and `org_chart_lead_exists`/stale messaging distinctly | tested | `VerdictStep.test.tsx` (12 cases) |
| 26 | `leadSetupWizardApi` maps a 409 `verdict_not_ok` response to `kind:"verdict_not_ok"` with its findings | tested | `leadSetupWizardApi.test.ts` (20 cases) |

**Integration / real-browser coverage** (the wizard's actual purpose — a
guided flow through a running stack): `client/e2e/flows/106-leadwright-setup-wizard.spec.ts`,
3 specs, real Chromium via `isolated-stack.mjs` — Org page's New-lead CTA
opens the wizard; all 7 questions answered end-to-end reaches the verdict
step without typing a project id/path/action id; no leadwright checkout
configured blocks Finish. Run at F0.5, `tests_run: 3`, exit 0.

No `untested` rows: every server/client boundary this card introduces
(subprocess spawn, two new filesystem write boundaries under the shared
lock, the cross-project domain-vocabulary read) has a dedicated automated
probe above — none needed a `reason_code` exemption.

## Mini-Plan

See `iterate-2026-09-07-leadwright-setup-wizard-miniplan.md` (medium — plan +
one rejected alternative).

## External / Architecture Review

Two rounds, both legs (GLM via OpenRouter, GPT/openai via Codex CLI).
Artifacts: `iterate-2026-09-07-leadwright-setup-wizard-architecture-review.json`
(2nd attempt — 1st attempt degraded on the GLM leg, `openai package not
installed`; retried with `uv run --with openai`, matching this project's
known tooling requirement), `iterate-2026-09-07-leadwright-setup-wizard-iterate-review.json`.

**Round 1** (`--mode architecture`, "should this be built at all / this
shape") — verdicts split within one step: GLM `approve`, openai `revise`.
Both raised the *same* proportionality concern: a multi-step wizard is more
standing UI machinery than the safety mechanism (verdict-gated, locked
writes) strictly requires, and a single-page form would carry the same
mechanism at less UI cost. **Reconciliation: kept the multi-step wizard.**
The card's own brief is explicit and non-negotiable on this point — "Follow
`client/src/components/wizard/IntentWizard/` exactly... Invent no second
idiom" — a PO-level style constraint the architecture brief should have
listed under "Constraints that are not negotiable" and didn't; corrected
here rather than in the brief file itself, since the brief's job is done
once reviewed. GLM's own review independently reached the same place from
first principles ("Option B... changes only client presentation and leaves
every standing mechanism identical; it costs the same to keep, so it is not
grounds for revision") — the two-legs' disagreement was over UI weight, not
over whether the underlying mechanism (transport, locks, verdict gate,
vocabulary route) is sound; both approved that part. GLM's two concrete,
adopted findings: surface `leadwrightCheckoutRoot` health outside the
wizard (added — see "Server — checkout health" above), and record a named
retreat path for `unclaimedCounts` if the cross-project read proves costly
to keep correct (recorded: `GET .../domains` could drop `unclaimedCounts`
and return domains-only without touching the wizard's core defect-closing
mechanism, since the shared-vocabulary fix does not depend on the count).

**Round 2** (`--mode iterate`, mini-plan vs spec) — both legs `revise`,
substantially overlapping. Every high-severity finding was adopted and is
reflected directly in "What to build" above, not summarized separately
here to avoid the two copies drifting: charter.md was never written in the
first draft (both legs, high — now written, ordered last-but-one in a new
single server-side commit endpoint); the verdict's `daemonConfig` was
client-assembled from scratch rather than a fresh read of the real file
(both legs — now server-side fresh-read-and-merge, exposed via a new `GET
.../daemon-config` route); the three writes were client-sequenced with no
atomicity or recovery story (both legs — collapsed into one ordered,
partially-idempotent server commit); the write routes had no server-side
validation independent of a prior client verdict call (GLM, security — now
validated server-side, and bound to a `proposalDigest` so a caller cannot
commit a proposal the verdict never covered — openai's suggestion); no
overall subprocess deadline beyond the stdin-write timeout (GLM — added);
the daemon-config existence check raced its own lock's `ensureFile` (GLM —
fixed, existence check now happens inside a non-`ensureFile` lock
acquisition); the action→`allowed_skills` mapping guessed from an id
instead of using the action catalog's own `slash_command` field (openai —
now reads that field directly); legacy non-kebab-case domains and
Windows-path-form edge cases in the absolute-path guard (openai, low — both
now explicit, tested cases). No unresolved finding from either round.

No third external round — every finding from round 2 maps to a concrete,
specific design change recorded above (not a hand-wave), and the internal
review cascade (Step 8: spec-reviewer → code-reviewer → doubt-reviewer)
checks the actual diff against this now-revised spec, which is the cheaper
and more precise place to catch anything still wrong.
No human approval gate — `--autonomous`, self-approved after both external
rounds, per this run's stated mode above.

## Self-Review

(completed at Step 7, see `reviews.json`)
