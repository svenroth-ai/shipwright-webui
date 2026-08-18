# Beat-register release, last-run staleness, and open-register finding

**Run:** `iterate-2026-08-18-org-route-beat-register` (V4a-2B, extends
`iterate-2026-08-17-org-route-leads`).

## Context

Leadwright's `beat-register.json` / `.beat.lock` two-guard gate can strand a
lead permanently `beat-lock-held` after a crashed beat, with no recovery path
except manual file surgery. This run adds the runtime half of the leads org
route: a release action for the register, tri-state last-run staleness, and
an open-register health finding — reusing the same host+secret-gated
`/api/external/org/*` family 2A already shipped, never inventing a new trust
boundary.

## Decision

Three additions, one write:
1. `POST /api/external/org/leads/:leadId/beat-register/release` — the ONE
   permitted write against leadwright's runtime store, a JSON-safe mirror of
   leadwright's own `recoverRegisterEntry` (force-close an open entry,
   append exactly one `beat_recovered` audit line, idempotent on retry).
2. `GET /api/external/org/leads/:leadId/last-run` — tri-state staleness
   (`fresh` / `stale` / `unknown-cadence`), computed server-side as
   `3 * cronIntervalMs(triggers.cron)`, never hardcoded.
3. `GET /api/external/org/leads/:leadId/beat-register` — a `clear` / `open`
   / `fault` finding; a duplicate `sessionId` is always `fault`, on both the
   read AND (added during code review) the write path — never resolved by
   picking one.

## Consequences

Release clears only the register half of the gate — `.beat.lock` is
untouched, and the response's `residualLockWarning` says so explicitly. The
release action's register-close and its `beat_recovered` audit append are
non-atomic (audit runs after the lock releases), mirroring a limitation
leadwright's own function already has — disclosed, not fixed, across three
review rounds. Full findings/dispositions table below.

## Rationale

Mirroring leadwright's existing, already-shipped contract (including its
known limitations) was preferred throughout over inventing a divergent,
un-mirrored recovery mechanism — the task brief's explicit instruction.
Every fix applied during review either closed a genuine new gap (TOCTOU
vanish-windows, symlink bypass, duplicate-fault-on-write, case-sensitivity)
or extended an existing principle (fault-on-duplicate) to a path it hadn't
reached yet; nothing was fixed by inventing new leadwright-side semantics.

## Rejected alternatives

- Picking the first/newest matching entry on a duplicate-`sessionId` fault
  (write path) — rejected per FR-01.70(D)'s "never resolved by picking one",
  extended from reads to writes during the external code-review cascade.
- Making the register-close and audit-append atomic (e.g. write the audit
  line while still holding the register lock) — rejected as a divergence
  from leadwright's own shipped, already-accepted ordering; see the
  MIRRORED LIMITATION disposition below.
- Rate-limiting / minimum-secret-length enforcement on this route family —
  inherited-and-reaffirmed decision from 2A, out of scope for this run.

## Full review-cascade findings + dispositions

**Plan Review (Step 3.5, both `revise`, converging):** corrected `:leadId`
validation-before-path-construction prose, defined missing-register-on-POST
as 404 without creating the file, required a narrow in-place merge (not
reconstruction) on release write, aligned org-chart-lookup's failure-mode
policy with `org-chart.ts`'s existing 403, pinned the `beat_recovered`
audit shape to leadwright's own `AuditEntry` verbatim, required a post-lock
canonical-path recheck before read-modify-write. All adopted before Build.

**Internal Plan Review (`opus-plan-reviewer`, 6 findings):** 1 high
(prose ambiguity in the audit-guard description — verified the actual
code already handled it correctly; only the spec prose was corrected), 5
low/medium completeness gaps (mini-plan wording, guard-strength wording,
missing `update: 1_000` lock heartbeat, missing lock-contention test,
missing `beat_id` field) — all fixed before Build.

**Stage 1 (`spec-reviewer`, HARD-GATE): PASS.** One disclosed, non-blocking
observation (generic-UUID vs strict-UUIDv4 regex).

**Stage 2 (`code-reviewer`, 4 findings, all fixed):** `guardExistingTarget`
ENOENT-intolerance (a TOCTOU-deleted register 500'd instead of 404),
duplicate `OrgSymlinkEscapeError` class (now imported from the shared one),
`routes.test.ts`'s `ALL_ENDPOINTS` gate-coverage gap (three new routes
added, 20→38 tests), `performRelease` over the 50-line guideline (extracted
`checkRegisterReachable` + `recordRecoveryAudit`).

**External code-review cascade (Branch A, openrouter, 3 findings):**
(1, fixed) dangling-`audit.jsonl`-symlink bypass via `existsSync` — replaced
with `wx`-flag `ensureAuditFile` + an unconditional `guardExistingTarget`,
mirroring `decisions-lock.ts`'s own reviewed pattern. (2, fixed) a
duplicate-`sessionId` fault where the first match is closed and a second is
open made release silently no-op on the open entry forever — release now
refuses outright (409, no mutation) on >1 match. (3, disclosed not fixed)
register-close/audit-append non-atomicity — see MIRRORED LIMITATION below.

**Stage 3 (`doubt-reviewer`, fresh-context adversarial, 3 findings):**
(1, high, fixed) a THIRD vanish-window between the pre-lock guard's pass and
`lockfile.lock()` itself — with `realpath: true`, `proper-lockfile`'s own
`fs.realpath()` call rejects `ENOENT` if the register disappears there,
which fell through to an uncaught 500; now wrapped and mapped to the same
graceful 404. (2, medium, fixed) `UUID_RE`'s case-insensitive `/i` flag
could pass a differently-cased sessionId through validation that would then
silently mismatch the real (always-lowercase) register entry — `/i`
removed. (3, low, disclosed not fixed) a symlink-swap during the same
pre-lock window could make `lockfile.lock()` briefly lock an
attacker-chosen realpath before `postGuard` rejects it — assessed as within
the already-accepted local-machine/Tailscale threat model.

**MIRRORED LIMITATION (register-close/audit-append non-atomicity):**
identified and explicitly re-affirmed across the Plan Review (PR-9),
Internal Plan Review, and the external code-review cascade — three
independent passes converging on the same, already-decided disclosure. The
task brief instructs mirroring leadwright's `recoverRegisterEntry` contract
rather than inventing a divergent recovery mechanism leadwright itself does
not have; a crash between register-close and audit-append leaves a
recovered-but-unaudited entry with no retry path to add the missing line,
identical to leadwright's own behavior.

## Verification

Full org-route unit suite: 200 tests (17 files), typecheck clean. Full
server suite: 313 files / 3594 tests, typecheck + lint clean, no
bloat-baseline ratchet. F0.5 (`surface: api`): 15/15 real-HTTP checks
against a live Hono server + real filesystem-backed `leadsRoot`, including
disk-state assertions (register genuinely closed, exactly one real
`audit.jsonl` line, idempotent no-duplicate on retry).
