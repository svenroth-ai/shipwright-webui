# Iterate Spec — org-route-leads (Item 2A, V4a-2A)

**run_id:** `iterate-2026-08-17-org-route-leads`
**source:** `leadwright-spec-2026-08-16-schritt-0d` (`C:\01_Development\leadwright\spec\triage-v1-v4a.md`, revision 2, item "2A")
**kind:** feature · **complexity:** medium (`touches_auth`) · **spec impact:** ADD

## What

A new, tightly-scoped read/write route on `~/.claude/leads/**` (the leadwright
org directory — not a Shipwright project). Models on
`server/src/external/file/write.ts` (extension/target allowlist, path-guard +
realpath-guard, symlink rejection via injectable `lstat`, atomic tmp+rename
write), with three additions write.ts does not need:

1. A host-bind allowlist gate (loopback or Tailscale) — the org directory is
   PO/leadwright/organization-wide data, more sensitive than one project file.
2. A shared-secret gate.
3. A cross-process `proper-lockfile` contract for the one action (countersign)
   that races leadwright's own daemon process on the same file.

## Explicitly out of scope (per the triage doc's own split, §"Warum V4a geteilt ist")

- **Item 2B** (runtime-store reads: last-run timestamp, open-register finding,
  release action) — blocked on leadwright §9 Schritt 0a, which does not exist
  yet. This run builds **zero** write path into `~/.claude/leads/<lead-id>/`
  runtime state, not even a general one — Auflage (4) is intentionally left
  unimplemented so it stays inert rather than becoming a guessed contract
  leadwright would have to reverse-engineer later.
- **Item 3** (the Org page, client) — accompanies 2A but is a distinct,
  non-autonomous item. This run adds no `client/src` changes.

## Binding decisions carried from the launch card (supersede stale spec prose)

- **Host allowlist is loopback OR Tailscale (100.64.0.0/10)** — "PO decision
  2026-08-16", confirmed by `lead-model-spec.md:2465` ("Im Tailnet ist die
  Org-Route erreichbar … entschieden 2026-08-16 auf 'Loopback oder
  Tailnet'"). The triage doc's own Abnahme bullet ("bei einer Tailscale-IP …
  verweigert die Route") is the STALE half-sentence this decision overrode;
  the launch card and the model spec agree and are newer, so they win.
- The resolved bind host is **computed once in `index.ts` and passed through**
  as a dependency — never re-derived per request (`resolveHonoHost` calls
  `execSync` on the Tailscale branch).
- `org-chart.json` is **readable, not writable** through this route (the
  write allowlist is exactly the 5 named docs + `<lead-id>/charter.md`).

## Design decisions I own (not specified verbatim upstream) — documented so they read as a contract, not an accident

1. **Route surface** (single router, mounted at `/api/external/org`):
   - `GET /api/external/org/file?path=<relpath>` — raw-byte read, same
     6-target allowlist as the write side (mirrors `file/routes.ts` GET:
     symlink/realpath defense, ETag fingerprint). Needed so the write side's
     `If-Match` optimistic-concurrency contract (mirrored from `write.ts`) is
     actually usable — a client cannot construct `If-Match` without a prior
     read. `org-chart.json` is deliberately **not** reachable through this
     generic path (see below).
   - `PUT /api/external/org/file?path=<relpath>` — write, same allowlist,
     edit-existing-only (mirrors `write.ts` exactly, minus the lock — the
     card's stated exception).
   - `GET /api/external/org/org-chart` — a **named, typed** read of
     `org-chart.json`, distinct from the generic byte-serving `/file` route.
     Kept separate (rather than letting `/file?path=org-chart.json` serve it)
     because the acceptance bar is "malformed → error, never a half
     structure" — that needs actual parsing, not byte-streaming.
   - `GET /api/external/org/leads/:leadId/usage` — the Punkt-8 consumption
     read interface.
   - `POST /api/external/org/decisions/countersign` — the Punkt-5 action.
   All five sit behind the same two gates (host allowlist, secret), applied
   once as router-level middleware.

2. **Org-chart mirror, not import.** `leadwright/lib/org-chart.ts` is a
   different repo/package; CLAUDE.md rule 7 (no cross-package imports, shared
   shapes are verbatim mirrors in `server/src/types/`) is the closest
   precedent inside this repo for exactly this situation, so the same
   discipline applies across the repo boundary: a **lightweight structural
   mirror** (top-level shape: `version`, `po`, `leads: Record<id, {
   reports_to, manages, domain, name, charter_path }>`), not a byte-for-byte
   port of leadwright's `.strict()` Zod schema (cycle detection, kebab-case
   regexes, `escalation_target` validity). Rationale: the triage doc itself
   settles this ("im Auftrag ist sie eine benannte Antwortform, mehr nicht")
   — write-time invariants stay leadwright's job; our read side only needs to
   refuse a non-JSON / structurally-missing file, never accept a half
   structure.

3. **Decision-log transfer format (I define this — FR-04.03/FR-04.35 assign
   the number "in the V4a action", i.e. here).** Both `decisions-proposed.md`
   and `decision_log.md` use **opaque, header-delimited blocks** — I do not
   parse or understand the Context/Decision/Consequence prose inside an
   entry (that is the daemon's form-check, upstream of this route):
   - Proposed: `## [<ISO-8601 timestamp>] <lead-id>` followed by body lines,
     up to the next `## [` header or EOF.
   - Logged: `## ADR-<4-digit> [<timestamp>] <lead-id>` — same body, moved
     verbatim. `ADR-NNNN` (4-digit) matches the worked example already in
     `lead-model-spec.md` ("ADR-0007 löst ADR-0003 ab"), not this repo's own
     3-digit `ADR-NNN` convention (different log, deliberately not
     conflated).
   - Countersign request body: `{ "timestamp": "<ISO-8601>" }` — identifies
     the entry by its proposed-side key (proposed entries have no number
     yet).
   - Next number = `max(existing ADR-NNNN in decision_log.md) + 1`, or 1 if
     none. Computed **inside** the lock's critical section (read decision_log
     right before the atomic writes) so two racing countersigns can never
     both compute the same next number.

4. **Lock target = `decisions-proposed.md` only.** It is the file both
   processes (webui countersign, leadwright daemon's own appends) actually
   contend on; `decision_log.md` has exactly one writer (this action), so
   serializing on the proposed-side file is sufficient to make the whole
   read-modify-write-across-two-files sequence atomic with respect to the
   daemon. Matches `lead-model-spec.md` 4.1a: "keine getrennten
   Arbeitsbäume, deshalb genügt ein Dateilock" (one file lock is enough,
   singular).

5. **Usage read interface (Punkt 8).**
   - Location: `~/.claude/leads/<lead-id>/usage.json` (per-lead — the org
     chart's `monthly_token_budget`/`budget` field and Item 2B's timestamp
     are both per-lead; a shared aggregate file would need a shape leadwright
     never asked for).
   - Shape: `{ leadId, measured: false } | { leadId, measured: true,
     costUsd: number, runCount: number, windowDays: number, asOf: string }`.
     `measured` is the explicit non-null/non-undefined "not measured" state
     the card requires.
   - Refresh cadence: a named constant, `LEADS_USAGE_REFRESH_INTERVAL_MS`
     (5 minutes) — documents the interval a future client poller should use;
     this route itself does no polling (stateless read, like every other
     external GET in this codebase).
   - The data source (`usage.json`) does not exist yet — leadwright writes it
     in its own §9 Schritt 2. Missing file ⇒ `measured: false`, 200, not 404
     (this is the CONTRACT, queryable before the producer exists).

6. **Secret gate.** New env var `SHIPWRIGHT_LEADS_ROUTE_SECRET`, header
   `X-Shipwright-Leads-Secret`, constant-time compare
   (`crypto.timingSafeEqual`, length-normalized first). Unset env var ⇒ every
   request 503 `leads_route_not_configured` (fail-closed, distinguishable
   from a wrong/missing header, which is 401 `invalid_secret`).

## Confidence Calibration

- **Boundaries touched:** filesystem (`~/.claude/leads/**`, new surface),
  network (bind-host gate on an existing global config value), a second
  cross-process lock contract (`proper-lockfile`, joining leadwright's
  `lib/file-locks.ts` on the same file from outside this repo).
- **Empirical probes:** (recorded after Build, see Step 7.5 update below)
- **Test Completeness Ledger:** see `## Test Completeness Ledger` below.
- **Confidence-pattern check:** depth — the two-process lock proof is the one
  place a same-process `Promise.all` test would be a false green (all fs
  calls in `write.ts`'s pattern are synchronous, no event-loop yield), so the
  concurrency proof spawns a real child process. Breadth — allowlist,
  host-gate and secret-gate each get both an ALLOW and a DENY case; the
  allowlist test enumerates the full 6-entry list by iterating the exported
  constant, so a future 7th entry cannot silently go untested.

## Architecture Review (Step 3.5 second call — over this brief)

**Verdicts:** openai `revise`, deepseek `reject`. Full text in
`iterate-2026-08-17-org-route-leads/architecture_brief.md`'s directory
(external review call recorded via `--run-id`).

**Reconciliation (written in the open, per protocol — the brief withheld
rejection reasons on purpose, so this is where they re-enter):**

- **Deepseek's core objection — build a local CLI instead of a network
  route.** Not adopted. This is not an open design question this run gets to
  re-decide: the launch card explicitly calls for "a new, tightly scoped
  read/write **route**", gives an HTTP-shaped acceptance bar (status codes,
  request paths, a host-BIND allowlist that is meaningless for a local CLI),
  and cites a dated PO decision (2026-08-16) for one of its specific rules.
  The reviewer saw only the brief (by design, no rejection-rationale
  pre-loading) and proposed an alternative the brief's own "Options on the
  table" already listed as C ("do not add a webui route") — which the
  binding card had already ruled out before this run started. Re-asking the
  PO to re-confirm a choice they already made in detail is not what
  "stop only for a genuine PO decision" means.
- **Both reviewers' shared point — the usage endpoint (Punkt 8) has no
  producer or consumer yet, ship it later.** Not adopted, for the same
  reason, and the triage doc pre-empts this exact objection explicitly: "die
  Form wird trotzdem jetzt festgelegt, weil das Folgepaket V4b an ihr hängt
  und sich sonst selbst eine improvisiert" (the shape is fixed now anyway,
  because the follow-up package would otherwise invent its own). The launch
  card independently lists "Consumption read interface: location AND shape
  AND refresh cadence" as required. Kept in scope.
- **What I did take from both reviews:** the emphasis that this route is a
  standing operational surface (secret rotation, allowlist maintenance, a
  cross-repo lock/format contract) sharpened the spec's existing "Design
  decisions I own" section into an explicit contract (host-gate, secret-gate,
  entry-block format) rather than something implicit — no scope change, a
  documentation gain.

No operator stop: both objections resolve to a design question the binding
card had already settled with specific, dated reasoning, not one this run
is free to re-decide.

## Plan Review (Step 3.5 first call — mini-plan vs spec)

**Verdicts:** both `revise`. Both reviewers independently found the same
critical gap (converging findings are the strongest signal a review pass can
give); adopted in full:

1. **[HIGH, both] The generic `PUT /file` allowlist includes
   `decision_log.md` and `decisions-proposed.md` — the exact two files the
   countersign lock exists to serialize — so an unlocked write to either via
   the generic route bypasses FR-04.28 entirely, using only the shared
   secret.** Not removable (the spec's own Abnahme bar requires a successful
   write attempt on all six allowed kinds, `decision_log.md` included) — the
   fix is that `file-write.ts` wraps its atomic write in the SAME
   `withDecisionsLock` when (and only when) the resolved target's `kind` is
   `decision_log` or `decisions_proposed`. Every write path to those two
   files now goes through one lock, whether it arrives via the generic route
   or the countersign action.
2. **[MEDIUM, both] Countersign should key on `{timestamp, leadId}`, not
   timestamp alone** — a proposed-entry header carries both; two leads (or
   two proposals in the same wall-clock second) could collide on timestamp
   alone. Adopted: request body becomes `{ timestamp, leadId }`, matched
   exactly against both header fields.
3. **[HIGH/MEDIUM, both] The two-file move is not crash-atomic — a crash
   between the `decision_log.md` append and the `decisions-proposed.md`
   rewrite would double-log on retry.** Adopted: before appending, scan
   `decision_log.md` for an existing entry whose header already carries the
   same `(timestamp, leadId)` pair; if found, the action is idempotent —
   reuse that entry's number, just ensure the proposed-side entry is (still)
   removed, and return 200 without minting a new number.
4. **[HIGH, openai] Symlink defense is only planned for the generic `/file`
   allowlist — `decisions-lock.ts`'s direct reads/writes of
   `decision_log.md` / `decisions-proposed.md` have no equivalent guard.**
   Adopted: `withDecisionsLock` resolves both paths through
   `resolveOrgAllowlistedTarget` (path-guard) and an `lstat` symlink check
   before doing anything, mirroring `file-write.ts`'s own posture, rather
   than touching the filesystem directly.
5. **[HIGH, both] `usage.ts`'s `leadId` route param has no validation before
   `join(leadsRoot, leadId, "usage.json")` — a traversal vector.** Adopted:
   `LEAD_ID_RE` (already used for the charter-pattern check) is exported
   from `_helpers.ts` as the one shared validator, reused by both the
   charter allowlist match and the usage route; an invalid `leadId` is 400
   before any filesystem access, and the resolved path additionally gets a
   realpath containment check.
6. **[MEDIUM, both] Org-chart / usage validation depth.** Re-checked against
   the already-written `parseOrgChart` — it already rejects non-object
   leads, missing/mistyped `domain`/`name`/`reports_to`/`manages`/
   `charter_path`, so this is largely already satisfied; `usage.ts` (not yet
   written at review time) gets the same treatment: reject non-finite /
   negative `costUsd` or `runCount`, reject a non-string `asOf`.
7. **[LOW/MEDIUM, both] Status-code contract mismatch in the mini-plan prose
   (503 in the spec vs. "403/401" in the mini-plan's contract-baseline
   step).** The mini-plan wording was sloppy, not the design — fixed to the
   single contract: host-gate checked first (403 `host_not_allowed`), then
   secret (503 `leads_route_not_configured` when unset, 401
   `invalid_secret` on missing/wrong header).
8. **[LOW, both] Verify `proper-lockfile` is a direct dependency, not
   transitive.** Confirmed — `server/src/index.ts` already imports it
   directly (`import * as lockfile from "proper-lockfile"`); no
   `package.json` change needed.
9. **[LOW, openai] A "resolveHonoHost called exactly once" spy test is
   brittle / tests internals, not the property.** Adopted the suggested
   reframe: the org router never imports `resolveHonoHost` at all (receives
   `honoHost: string` as a plain dependency) — enforced by construction, not
   a call-count assertion — and gate tests inject different host strings to
   prove the dependency is actually consulted.
10. **[LOW, deepseek] The two-process concurrency spec must prove
    serialization (overlapping critical sections never happen), not just
    "eventually got sequential numbers."** Adopted: each child process
    records its own critical-section `{start, end}` timestamps; the test
    asserts the two intervals do not overlap, in addition to asserting the
    numbers are `N`/`N+1`.
11. **[LOW, deepseek] The header-boundary regex must be a strict, anchored,
    full-line shape** (not "any line starting with `##`), else an opaque
    body line that happens to resemble a header would be mis-split.
    Adopted: `^## \[([^\]]+)\] (.+)$` (proposed) / `^## ADR-(\d{4}) \[([^\]]+)\]
    (.+)$` (logged), matched per-line, multiline mode. **Documented
    limitation, not fully closed:** a hostile or malformed proposed entry
    deliberately crafted to contain a line matching this exact shape could
    still confuse the split — that risk sits upstream of this route, in
    leadwright's own daemon "form check" (§4.1a: "Der Daemon prüft die
    Form"), which this route has no authority to change. A test demonstrates
    the current (best-effort) behavior against this case rather than
    claiming it is closed.
