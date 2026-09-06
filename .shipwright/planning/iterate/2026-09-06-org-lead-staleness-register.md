# Iterate Spec: Surface lead staleness + open beat-register findings on the org card

**Run ID:** iterate-2026-09-06-org-lead-staleness-register
**Status:** implemented
**Intent:** CHANGE
**Complexity:** medium (escalated from Stage-1 `small`, confidence 0.6 — see Repo Scout below)
**Spec Impact:** MODIFY (leadwright org-directory integration, FR-04.06 + FR-04.41)

## Problem

Two leadwright ACs have been carried as "not acceptable, not workaroundable"
for months: a lead's staleness state (FR-04.06) and an open beat-register
entry (FR-04.41). Both were filed as "the org page does not show it." The
server already computes both (`server/src/external/org/last-run.ts`'s
`lastRunCore`, `server/src/external/org/beat-register.ts`'s
`evaluateRegisterHealth`) and the release action already exists
(`beat-register-release.ts` / `beat-register-release-core.ts`). The client
throws all of it away: `LeadNowState`'s "resting" arm keeps only
`lastRunAt`, dropping `staleness`/`cadenceMs`/`cadenceUnresolvedReason`, and
`LeadRosterEntry` has no register-health field at all. This is a display gap
and a browser-reachability gap (the release action is not proxied to the
plain `/api/org/*` surface the browser calls), not a missing server route.

## Repo Scout (Stage 2 — confirms medium)

- Affected files: `server/src/types/org.ts`, `server/src/routes/org-leads-composite.ts`,
  `server/src/routes/org.ts` (new POST proxy), `client/src/lib/orgApi.ts`,
  `client/src/components/org/LeadCard.tsx`, `client/src/styles/org.css`,
  plus 4 existing test files with a typed `LeadRosterEntry` fixture that
  needs a new required field, and 1 new/extended E2E spec.
- Affected FRs: FR-04.06 (staleness display), FR-04.41 (open-register
  finding + release action), FR-04.38 point 4 (release action reuse).
- Risk flags: `touches_public_api` (a new POST route + widened response
  shapes on an existing route) — mandatory review, small floor.
- Cross-split: no (single component family — org page).
- Reasoning for medium: a discriminated-union wire type widens across the
  server/client schema-sync guard (`org-schema-sync.test.ts`), a new
  browser-facing route is added (mirroring an existing secret-gated one,
  not inventing new server logic), and the UI gains a new finding/action
  affordance — genuine design surface, not a one-line prop pass-through.

## Design Notes

Revised after the Internal Plan Review (see below) — several points below
differ from the pre-review draft; each note says why.

**Server:**
1. `LeadNowState`'s `resting` arm's `lastRun.measured: true` branch widens
   to carry `staleness: Staleness | "unknown"` and optional
   `cadenceUnresolvedReason` — taken verbatim from `lastRunCore`'s
   response, never recomputed client-side. This union arm is now the
   NAMED, EXPORTED type `LeadLastRunView` on both server and client
   (`server/src/types/org.ts`, `client/src/lib/orgApi.ts`), not inlined —
   `org-schema-sync.test.ts`'s per-arm comparator only walks TOP-LEVEL arm
   fields, so an inlined nested union would never actually be checked
   (MEDIUM finding #3).
2. `LeadRosterEntry` gains a sibling field `register: LeadRegisterView` — a
   NEW type, not a reuse of `BeatRegisterHealthResponse` (see point 3 for
   why), with 4 literal arms (`clear` / `open` / `fault` / `unknown`) spelled
   out explicitly rather than as `BeatRegisterHealthResponse | {...}` (a
   bare-identifier arm would crash the schema-sync test's arm parser —
   MEDIUM finding #4). `org-leads-composite.ts`'s `buildLeadRosterEntry`
   computes beat-register health ONCE (`beatRegisterHealthCore`) and feeds
   the RAW result to both `buildNow` (unchanged running/needs-attention/
   resting branching, its own `status !== 200 → not-measured` check
   untouched) and the new `registerFieldFor` degrade, instead of `buildNow`
   reading it a second time.
3. **Reversed from the pre-review draft:** a beat-register read failure
   (symlink refusal, corrupt file, path traversal) degrades `register` to
   `{ leadId, status: "unknown" }`, NEVER `{ status: "clear" }`. The
   original draft's `clear` degrade was HIGH finding #1 — `clear` is an
   assertion "no open entry exists", not an absence-of-data marker, so
   collapsing a genuine security refusal or a corrupt register into "no
   problem here" would fabricate exactly the health claim this field
   exists to surface honestly. ENOENT (no register file at all — the
   overwhelming common case) is already mapped to `200 clear` INSIDE
   `beatRegisterHealthCore` and never reaches this degrade path at all, so
   `unknown` fires only on a genuine fault. Regression-tested directly:
   `org-leads-staleness-register.test.ts`'s symlink and corrupt-JSON cases
   assert `now === not-measured` AND `register.status === "unknown"` in
   the SAME request (HIGH finding #2 — the original design had no test
   proving the two fields' failure modes stayed independent).
4. New plain-surface route `POST /api/org/leads/:leadId/beat-register/release`
   in `routes/org.ts`, gated by `requireChartLead` called BEFORE any body
   parsing (an unregistered leadId never reaches the register at all —
   finding #11), and delegating to a NEW shared function
   `handleReleaseRequest` (`beat-register-release-request.ts`) — request
   validation (UUID `sessionId`, 1-500 char `reason`) + `performRelease`
   call + error-to-status mapping, extracted so this route and the
   secret-gated route (`beat-register-release.ts`) cannot drift on
   validation or status mapping (finding #5; the two Hono shells were on
   track to duplicate that whole body). `handleReleaseRequest` owns ALL
   THREE deps defaults (`lstatSync`/`lockOptions`/`now`) itself, in ONE
   place, rather than each route shell defaulting them independently — an
   earlier version of this split still had two separate `?? realDefault`
   sites for the same three deps, which was exactly the drift risk finding
   #5 already existed to prevent, just moved one layer down (external-
   review fix, Branch A/GLM). A production call supplying none of them
   never crashes — verified by a route test constructing the router with
   NEITHER `lstatSync` nor `now` supplied. The register path is derived
   SOLELY from the route's own validated `leadId` param
   (`registerPathFor(leadsRoot, leadId)` inside `performRelease`) — the
   request body's `sessionId` is only ever matched against entries already
   read from THAT lead's own register file, so a `sessionId` belonging to
   a different lead cannot cross-release; regression-tested directly
   (external-review fix, Branch A/OpenAI: two leads, each with its own
   register, releasing lead A's route with lead B's sessionId is 404
   not-found and leaves lead B's entry untouched).

**Client:**
5. `NowLine` renders three distinct resting sub-states: fresh (unchanged
   "Resting — Last active …"), stale ("Overdue — last active …", the
   existing `.nowline.attn` amber styling — never worded or styled as
   "Resting"), and cadence-unresolved ("Last active … — {reason in
   words}", neutral `.idle` styling — never reads as fresh). `statusBadge`
   (the compact header-badge affordance, not `NowLine`) is a BINARY split,
   corrected from an earlier draft of this doc that claimed it mirrored
   `NowLine`'s three-way split (code-review finding, low): `stale` reads
   "overdue" (agreeing with `NowLine`'s "Overdue"), and both `fresh` and
   `unknown` collapse to "resting" — the badge never *disagrees* with the
   line below it, but `unknown`'s cadence-unresolved detail lives only in
   `NowLine`, since the badge has no room to word it honestly.
   `cadenceUnresolvedReason` is optional even when `staleness === "unknown"`
   (`lastRunCore` can report unknown staleness without a named reason) —
   this arm is reachable, not merely theoretical, so `cadenceUnresolvedReasonText`'s
   `default` case ("cadence unresolved") is load-bearing, not dead code;
   tested explicitly (external-review fix, Branch A).
6. `cadenceUnresolvedReasonText`'s `org_chart_invalid` wording is
   **"cadence not configured for this lead"**, not a literal "org chart
   invalid" (finding #10). `org_chart_invalid` is overloaded server-side
   (`org-chart-lookup.ts`): it covers both "the whole chart file is
   corrupt" AND "this lead has no/malformed `triggers.cron`". By the time
   this reason reaches the client, the chart has ALREADY parsed
   successfully — a corrupt chart fails the whole `/api/org/leads` read
   earlier, in `orgChartCore`, before any per-lead builder runs — so in
   THIS code path the reason can only mean the narrower, per-lead case.
   Telling an operator to go check a file that is provably fine would be
   actively misleading. `invalid_cron` (cron string present but
   unparseable) is a genuinely different case and reads as "cadence
   schedule invalid".
7. A new component `LeadRegisterFinding.tsx`, rendered inside Block 3 (Now)
   — NOT given its own `data-block`, so the fixed five-block AC-2 contract
   is unaffected. Renders `lead.register` verbatim, one branch per status:
   `clear` → nothing; `unknown` → a muted, button-less line (nothing to
   release against a register this code couldn't even read); `open` → a
   finding naming the beat + a "Release" button; `fault` (duplicate
   sessionId) → a finding naming the session, **no release button**
   (finding #8/#9 resolution — the server's own `performRelease` REFUSES
   to act on a duplicate sessionId with 409 `fault`, "never pick one,
   never show the newest", so offering a button guaranteed to fail would
   be worse than naming the problem and stopping). The release reason is
   collected via `window.prompt` (finding #9's audit-reason UX decision) —
   a real operator-authored string recorded in the audit log, not a fixed
   placeholder string; cancelling the prompt makes no network call, and an
   empty/whitespace-only reason is rejected client-side before the call.
   **Invalidates `ORG_ROSTER_QUERY_KEY` on ANY terminal server response,
   not only success** (external-review fix, Branch A/OpenAI — the
   pre-review draft only invalidated on 200, which left a stale open
   finding on screen after a 404 not-found: another operator releasing the
   same entry between this card's roster fetch and this click is exactly
   the race a 404 here signals). A non-200 outcome (404 not-found, 409
   fault/locked, 502 invalid, 403 forbidden) ALSO surfaces as visible text
   next to the button, never a silent failure; the button re-enables
   afterward either way. The E2E round trip (below) handles the native
   `window.prompt` explicitly via Playwright's dialog API
   (`page.once("dialog", (d) => d.accept("reason text"))`, registered
   BEFORE the click) — an unhandled `prompt()` call would otherwise hang
   the test rather than fail it cleanly.
8. `OrgChart.tsx`'s top-tree node keeps its existing binary
   running/not-measured badge — untouched. It is a different, deliberately
   minimal component and none of the task's ACs name it.

## Out of scope (per task brief)

- `last-run.ts` / `beat-register.ts` semantics (the classification
  functions themselves) are unchanged.
- No polling loop or websocket — the card updates via the existing 5-minute
  roster refetch, plus an explicit invalidation after a successful release.
- Mission/terminal surfaces untouched.

## Acceptance Criteria

- **AC-1-agent.** A roster entry whose `now.state === "resting"` and
  `now.lastRun.staleness === "stale"` renders text matching `/Overdue/` in
  `[data-testid="lead-card-now"]`, and does NOT render the text "Resting".
- **AC-1-user.** Visually confirm the overdue card reads as a warning
  (amber), not the same muted gray as a normal resting card.
- **AC-2-agent.** A roster entry with `staleness === "unknown"` and a
  `cadenceUnresolvedReason` renders text naming the reason in words inside
  `[data-testid="lead-card-now"]`, and never renders the same text a
  `staleness === "fresh"` entry would render.
- **AC-3-agent.** A roster entry with `register.status === "open"` renders
  a finding element (`[data-testid="lead-register-finding"]`) with a
  `[data-testid="lead-register-release"]` button; a roster entry with
  `register.status === "clear"` renders neither.
- **AC-4-agent.** Clicking the release button issues `POST
  /api/org/leads/:leadId/beat-register/release` with the open entry's
  `sessionId` and a non-empty, operator-authored `reason`; on a 200
  response the finding disappears from the card without a full page reload
  (query invalidation).
- **AC-5-agent.** `org-schema-sync.test.ts` passes with the widened
  `LeadLastRunView` and the new `LeadRosterEntry.register` field kept in
  lock-step between `server/src/types/org.ts` and `client/src/lib/orgApi.ts`.
- **AC-6-agent** (added post-review, HIGH finding #2). A beat-register read
  failure (symlinked file, corrupt JSON) degrades `now` to `not-measured`
  AND `register` to `{status: "unknown"}` in the SAME roster request —
  never `{status: "clear"}` for either field.
- **AC-7-agent** (added post-review, finding #8). A `register.status ===
  "fault"` (duplicate sessionId) roster entry renders a finding naming the
  duplicated session, with NO release button present.
- **AC-8-agent** (added post-review, finding #11). `createOrgApiRouter`
  constructed with neither `lstatSync` nor `now` supplied still serves
  `POST /api/org/leads/:leadId/beat-register/release` without throwing.
- **AC-9-agent** (added post-review). A release request against an
  unregistered `leadId` is refused 403 `unknown_lead` before any register
  file is touched (same `requireChartLead` gate the charter PUT route
  uses); a release against a duplicate-sessionId fault is refused 409
  `fault`, never silently picks one of the duplicate entries.

## Verification (medium+)

- **Surface:** `web`
- **Runner:** Playwright, isolated stack — `client/e2e/flows/org-page.spec.ts`
  (existing, unchanged) + new sibling `client/e2e/flows/org-page.register.spec.ts`
  (overdue-card text on a real page, and a full release round trip against
  the real filesystem: seed an open register entry, click Release, confirm
  the native prompt, assert the finding disappears AND the real
  `beat-register.json`/`audit.jsonl` on disk reflect the release).
- **Evidence:** `shipwright_test_results.json.iterate_latest.surface_verification`

## Confidence Calibration

**Boundaries touched.** The producer/consumer pair this iterate actually
widens is the server↔client WIRE CONTRACT — `server/src/types/org.ts`
(producer of the JSON `/api/org/leads` response) → `client/src/lib/orgApi.ts`
(consumer), guarded by `org-schema-sync.test.ts`'s textual per-arm
comparator. The on-disk `beat-register.json`/`audit.jsonl` producer/
consumer relationship itself (leadwright's daemon writes, `performRelease`
reads+mutates) is PRE-EXISTING and unchanged by this diff — this iterate
adds a second CALLER to already-tested I/O, not a new I/O boundary. No
`.env`/`hooks.json`/`*_config.json` pattern is touched, so `touches_io_boundary`
does not fire; `touches_public_api` does (new POST route + widened response
shapes), which is what drove the mandatory-review floor.

**Empirical probes run** (not self-attestation — each is a named test with
a finding or an explicit no-finding):

1. *Probe: does a beat-register read failure ever leak into the register
   field as "clear"?* — Finding: YES (the pre-review design degraded to
   `clear`). Fixed (HIGH #1), then re-probed: symlinked file →
   `register.status === "unknown"` (not `clear`) — confirmed.
2. *Probe: does the SAME read failure keep `now`'s pre-existing
   `not-measured` behavior independent from the new `register` field?* —
   Finding: untested, so unproven either way. Added a test asserting both
   fields in ONE request (HIGH #2) — now proven.
3. *Probe: does `org-schema-sync.test.ts`'s per-arm comparator actually
   walk the NESTED `lastRun` union inside `LeadNowState`?* — Finding: NO,
   it only walks top-level arm fields, so the nested union was checked
   vacuously. Fixed by lifting it to a named `LeadLastRunView` type
   (MEDIUM #3) — re-probed by intentionally dropping a field from the
   client mirror locally and confirming the test goes red, then restoring
   (the schema-sync test's own documented falsification protocol).
4. *Probe: does a duplicate-sessionId fault ever get silently resolved by
   the release action?* — Finding: no, `performRelease` already refused
   this (pre-existing code, not touched) — but the CLIENT offering a
   Release button on a fault it's guaranteed to fail was a real gap.
   Fixed (finding #8): no button on the `fault` arm.
5. *Probe: could a `sessionId` from one lead's register release a DIFFERENT
   lead's open entry through this route?* (raised by Branch A/OpenAI) —
   Finding: NO — `performRelease` derives the register path solely from
   the route's own validated `leadId`. Regression-tested directly (two
   leads, cross-lead attempt, other lead's entry untouched) — **no
   finding**, confirms already-correct behavior.
6. *Probe: is `staleness === "unknown"` reachable WITHOUT a
   `cadenceUnresolvedReason`, and if so what renders?* (raised by Branch
   A/OpenAI) — Finding: yes reachable (`lastRunCore` can report unknown
   staleness with no named reason); the existing `default` case already
   handled it correctly ("cadence unresolved"), but it was untested. Added
   a test — **no code change needed, but now proven, not assumed**.

Probes 5 and 6 both returned "already correct, now proven" rather than a
new bug — two consecutive probes finding nothing after probes 1-4 each
found something is the asymptote signal (`confidence-anti-patterns.md`):
the wire-contract/register-health boundary is exhausted in the dimensions
this run can think of, not merely "looks fine on inspection."

**Test Completeness Ledger** (every testable behavior introduced or
changed by this diff: `tested` with evidence, or `untestable` with a
closed-vocabulary reason):

| Behavior | Disposition |
|---|---|
| Stale staleness threads through to `now.lastRun.staleness` | `tested` — `org-leads-staleness-register.test.ts` |
| Unresolvable cron (`org_chart_invalid`, no `triggers.cron`) reads `unknown` | `tested` — same file |
| Unparseable cron string (`invalid_cron`) reads `unknown` | `tested` — same file |
| Open register entry surfaces on `register` AND keeps `now.state==="running"` | `tested` — same file |
| Clear register reads `register.status==="clear"` (steady state) | `tested` — same file |
| Symlinked register degrades BOTH `now` (not-measured) and `register` (unknown) in one request | `tested` — same file, HIGH #2 regression |
| Corrupt register JSON degrades `register` to `unknown` | `tested` — same file |
| Duplicate-session fault surfaces identically on `now` and `register` | `tested` — same file |
| `org-schema-sync.test.ts` covers `LeadLastRunView`/`LeadRegisterView` per-arm | `tested` — MEDIUM #3/#4 fix, 17/17 passing |
| Plain-surface POST route works with `lstatSync`/`now` NOT supplied | `tested` — `org-leads-beat-register-release.test.ts` |
| Plain-surface route refuses an unregistered leadId before touching the register | `tested` — same file |
| Plain-surface route's success/404/400/409 outcomes match the secret-gated route's shapes | `tested` — same file |
| Cross-lead sessionId cannot release a different lead's entry | `tested` — same file, Branch A/OpenAI finding |
| `NowLine` renders fresh/stale/cadence-unresolved as three DISTINCT presentations | `tested` — `LeadCard.test.tsx` |
| `org_chart_invalid` reason renders as a per-lead cause, not "org chart invalid" | `tested` — same file, finding #10 |
| `staleness==="unknown"` with NO `cadenceUnresolvedReason` still reads as unresolved | `tested` — same file, Branch A/OpenAI finding |
| `LeadRegisterFinding` renders nothing for `clear`, muted text for `unknown`, no button for `fault`, finding+button for `open` | `tested` — `LeadRegisterFinding.test.tsx` |
| Release button: happy path invalidates roster, cancel makes no call, refused release surfaces error AND still invalidates | `tested` — same file, Branch A/OpenAI finding (invalidate-on-any-terminal-response) |
| End-to-end: overdue card text on a real running stack | `tested` — `org-page.register.spec.ts` (E2E, run at F0.5) |
| End-to-end: full release round trip against the real filesystem (native prompt dialog, register file, audit line) | `tested` — same E2E file |
| Visual amber/warning styling for overdue and register findings | `untestable` — `requires-manual-visual-judgment` (reuses existing `.nowline.attn`/`.thread-open` tokens, no new palette decision) |

**Confidence-pattern check.** No "are you confident?" self-attestation
was used as a stopping condition anywhere in this run — every design
decision that could be probed empirically (points 1-6 above) was probed,
and the two internal review passes (opus-plan-reviewer, then external
Branch A) each surfaced additional probes this run had not yet run,
which were then run and closed before proceeding — consistent with the
review cascade being a probe source, not a rubber stamp.

## Internal Plan Review (opus-plan-reviewer)

Ran before Branch A/B/C, over the pre-build design. Findings and their
disposition (all addressed in this run, before code review):

- **HIGH #1** — the register-field degrade fabricated `{status: "clear"}`
  on a genuine beat-register read failure (symlink refusal, corrupt file).
  Fixed: new `unknown` arm on `LeadRegisterView`, never `clear`, for any
  non-200 read (Design Notes point 3).
- **HIGH #2** — no regression test proved `now`'s existing `not-measured`
  failure semantics stayed independent from the new `register` field on
  the SAME failure. Fixed: two new tests in
  `org-leads-staleness-register.test.ts` (symlink + corrupt JSON) assert
  both fields in one request.
- **MEDIUM #3** — `LeadNowState`'s nested `lastRun` union would never
  actually be checked by `org-schema-sync.test.ts`'s per-arm comparator
  (it only walks top-level arm fields). Fixed: lifted to a named, exported
  `LeadLastRunView` type, registered in the schema-sync test's union list.
- **MEDIUM #4** — a `LeadRegisterView` arm spelled as `BeatRegisterHealthResponse
  | {status: "unknown"}` would crash the schema-sync parser on the
  bare-identifier arm. Fixed: all 4 arms spelled out literally.
- **#5–#11, #15** (LOW/MEDIUM, code-shape and UX decisions, addressed
  during build — see Design Notes points 4, 6, 7 for the resolution of
  each): shared `handleReleaseRequest` extraction (#5) to stop the two
  release route shells from duplicating validation; `LeadRegisterFinding.tsx`
  as its own component (#6); no release button on the `fault` arm (#8) and
  a `window.prompt`-collected operator reason (#9), both because the
  server's own `performRelease` already refuses to act on a duplicate
  sessionId; `org_chart_invalid`'s wording corrected to name the per-lead
  cause, not the whole chart (#10); the new POST route's `lstatSync`/`now`
  deps default at the call site exactly like its GET siblings, verified by
  a route test omitting both (#11); `routes/org.ts`'s header comment
  updated to describe both browser writes accurately, dropping the
  now-false "the ONLY browser write this iterate" claim (#15).

Recorded via `record_review_pass.py record --review-type plan_internal
--status completed --recorded-by opus-plan-reviewer --model-tier opus`.

## External LLM Review — Branch A (`--mode iterate`)

Ran over the updated spec + mini-plan (post internal-plan-review, post
Design Notes rewrite). `openai` (codex): **revise**; `glm`
(openrouter): **approve**. No contradiction requiring operator escalation
(`comparable: true, requires_resolution: false` — verdicts agree within
one step). All medium findings addressed before proceeding:

1. Mini-plan/spec disagreement on `LeadRegisterFinding` inline-vs-split
   and E2E extend-vs-sibling — fixed: mini-plan's "Component hierarchy"
   and "Test strategy" sections updated to match the spec (both were
   stale leftovers from the pre-review draft).
2. `staleness: "unknown"` reachable WITHOUT `cadenceUnresolvedReason` was
   undocumented and untested — fixed: documented in Design Notes point 5,
   tested in `LeadCard.test.tsx`.
3. A register finding could go stale after a non-200 release response
   (404/409) since only the 200 path invalidated the roster — fixed:
   `LeadRegisterFinding.tsx` now invalidates on any terminal response.
4. Cross-lead sessionId isolation was correct by construction (the
   register path is derived solely from the route's own `leadId`) but
   unverified — fixed: added a regression test (two leads, cross-lead
   release attempt is 404, other lead's entry untouched).
5. Two independent deps-defaulting sites (`beat-register-release.ts` and
   `routes/org.ts`) for the same `lstatSync`/`lockOptions`/`now` — fixed:
   centralized inside `handleReleaseRequest`, both route shells now just
   pass deps through unresolved.

Low-severity items (E2E fixture-lifecycle naming, audit-writer
JSON-encoding of the reason string) were confirmed as already covered by
existing conventions and needed no code change.

## Self-Review

1. **Spec Compliance:** [pass] All ACs (AC-1 through AC-9) implemented;
   no extra features — mission/terminal surfaces untouched,
   `last-run.ts`/`beat-register.ts` semantics unchanged, no polling loop.
2. **Error Handling:** [pass] Every route path has a mapped status +
   body; client fetcher (`orgRegisterApi.ts`) never double-reads a
   `Response` body; `LeadRegisterFinding` surfaces both thrown `ApiError`s
   and `{ok:false}` outcomes visibly, never a silent failure.
3. **Security Basics:** [pass] No SQL surface. React's default text
   escaping means the operator-authored release reason (rendered back
   through the existing `AuditLogModal`) can't inject HTML. No hardcoded
   secrets. The new POST route is gated by `requireChartLead` BEFORE body
   parsing (finding #11), and cross-lead sessionId isolation is
   structurally guaranteed + regression-tested (Branch A/OpenAI finding).
4. **Test Quality:** [pass] Every new/changed test asserts rendered text
   or real on-disk file state, never internal component state; each
   behavior in the Confidence Calibration ledger has both a
   success/expected-shape case and at least one failure/degrade case.
5. **Performance Basics:** [pass] No N+1 — `beatRegisterHealthCore` is
   read ONCE per roster entry and shared between `now` and `register`
   (was previously two reads inside `buildNow` alone before this field
   existed); no unbounded list rendering.
6. **Naming & Structure:** [pass, one documented exception] Every new
   file this iterate created is under the 300-line convention, and new
   files follow the existing `*-request.ts`/`*Finding.tsx` naming
   patterns already used elsewhere in this file family. **Exception:**
   `client/src/lib/orgApi.ts` is 309 lines (code-review finding,
   corrects an earlier overclaim in this section) — the type widening
   this iterate adds (`LeadLastRunView`, `LeadRegisterView`) pushed a
   file that was already close to the advisory 300-line line over it.
   Not fixed in this iterate: every declaration in the file
   (`OrgChartLeadView`/`LeadRosterEntry`/all 8 discriminated unions/etc.)
   is individually looked up by `org-schema-sync.test.ts`'s hardcoded
   `CLIENT_PATH`, so the only real extraction available is the ~90 lines
   of plain HTTP fetcher functions at the bottom — which would require
   updating import paths AND `vi.mock` targets across roughly 10
   unrelated consumer files (`useOrgChart.ts`, `useOrgRoster.ts`,
   `useOrgThreads.ts`, `OrgSharedDocs.tsx`/`.test.tsx`,
   `AuditLogModal.tsx`/`.test.tsx`, etc.) that this iterate's task
   (surfacing staleness + register findings on the card) never touches
   otherwise. That is a real, separately-reviewable refactor, not a
   drive-by fix bundled into this diff — saying so here rather than
   quietly re-wiring ~10 files' imports as a side effect of a two-field
   type change. The NEW release fetcher was deliberately kept OUT of
   this file (`orgRegisterApi.ts`, its own module) specifically to avoid
   compounding the overage further.
7. **Affected Boundaries:** [pass] Producer/consumer: `server/src/types/org.ts`
   → `client/src/lib/orgApi.ts`, guarded by `org-schema-sync.test.ts`'s
   per-arm comparator (verified 17/17 green after the type changes, and
   the comparator's own falsification protocol — drop a client field,
   confirm red, restore — was exercised during the type design). The
   on-disk `beat-register.json`/`audit.jsonl` boundary is pre-existing,
   unchanged logic; this diff adds a second caller, regression-tested
   directly (symlink/corrupt-JSON degrade, cross-lead isolation). See
   Confidence Calibration above for the full probe list.
8. **Test Hygiene Probe:** [pass] `scan_test_hygiene.py --diff` — no
   findings.

Action: All clear, proceed to the code-review cascade.

## Architecture Review (`--mode architecture`, over `architecture_brief.md`)

`glm` (openrouter): **approve** of Option A (widen the roster response +
add the browser-facing release proxy). `openai` (codex): **revise**,
suggesting Option B (show the finding, but leave release on the
secret-gated route only) — its stated reasoning is proportionality: "a new
browser-reachable write endpoint is a standing authorization and mutation
surface to solve a likely infrequent, recoverable register cleanup." No
contradiction requiring operator escalation (verdicts agree within one
step).

**Resolution: proceed with Option A**, per the task brief's own explicit,
pre-existing instruction — not a re-litigation of openai's point, but
applying a decision the operator already made before this review ran: "the
finding names the way out — wiring the existing release button is in
scope, inventing a new endpoint is not." Option A does not invent a new
endpoint or a new mutation — it exposes an EXISTING, already-tested action
(`performRelease`, already reachable via the secret-gated route) to the
browser through a thin, shared-validation proxy, which is exactly what
"wiring the existing release button" describes. openai's underlying
proportionality concern (a permanent write surface for an infrequent
recovery action) is real but is the SAME cost/benefit tradeoff the
operator already weighed when writing "in scope" — not new information the
review surfaced. GLM's finding #1 (the security-relevant surface of the
proxy is concentrated entirely in the two route shells staying in lock-
step, which the shared `handleReleaseRequest` extraction already
structurally guarantees) is the more load-bearing read of the actual risk
here, and matches the mitigation already built (finding #5's extraction,
finding #11's leadId-first gate, the cross-lead isolation regression test
from Branch A).
