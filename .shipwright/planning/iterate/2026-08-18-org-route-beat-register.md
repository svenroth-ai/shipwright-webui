# Iterate: V4a-2B — Org-Route Runtime Part (Beat-Register Release, Last-Run Staleness, Register Finding)

**run_id:** iterate-2026-08-18-org-route-beat-register
**Source:** `leadwright/spec/triage-v1-v4a.md` Item 2B (private/German source repo;
this file is the tracked English record of what was built and why, per this
repo's own convention — `spec/` lives in the sibling `leadwright` repo and is
gitignored there too). Sequencing card: Track B / W3, unblocked 2026-08-17 by
leadwright #11 (`8f8bbed`, FR-04.41, run_id `iterate-2026-08-17-beat-lock-register`).
**Type:** feature (extends FR-01.70, the existing Leads org route) ·
**Complexity:** medium (self-upgraded from the classifier's `small` — see below)

## Complexity Note

`classify_complexity.py` returned `small` (`touches_public_api` risk floor,
no scope-keyword match). Self-upgraded to `medium`: this diff adds a new
external API surface consuming a cross-repo contract (leadwright's
`beat-register.json` / `last-run.json` / `audit.jsonl` shapes, verbatim
mirrors per CLAUDE.md rule 7 — no cross-package import is possible, this is
a separate repo), adds a new server dependency (`cron-parser`, `touches_build`),
and reimplements a genuine cross-process lock contract (FR-04.28) against a
file leadwright's own daemon writes concurrently — the same class of risk
that made the leadwright-side counterpart (iterate-2026-08-17-beat-lock-register)
self-upgrade to medium. Positive evidence, not absence of evidence.

## Spec Impact

**MODIFY** `FR-01.70` (Leads org route) in `.shipwright/planning/01-adopted/spec.md`
— extends the existing route family with three new endpoints; the route's
description, gates, and existing five endpoints are unchanged. No AC section
existed yet for FR-01.70; this run adds the first one.

## The four names this run consumes (decided by leadwright, not re-derived)

Per `leadwright/.shipwright/planning/iterate/2026-08-17-beat-lock-register.md`
§"The four names":

| | Decision | Consumed here as |
|---|---|---|
| a. Beat register | `~/.claude/leads/<lead-id>/beat-register.json`, `{version:1, entries: BeatRegisterEntry[]}`, `BeatRegisterEntry = {sessionId, beatId, leadId, pid, startedAt, closedAt}`. Open iff `closedAt === null`. Duplicate `sessionId` = fault. | Read (health) + narrow write (release only) target. |
| b. Last-run | `~/.claude/leads/<lead-id>/last-run.json`, `{lastRunAt, sessionId}`, stamped on beat START. | Read-only target for the staleness endpoint. |
| c. Cadence | `Lead.triggers.cron` (org-chart.json), threshold = `3 * cronIntervalMs(triggers.cron)`. leadwright explicitly left `cronIntervalMs` unbuilt ("this run only fixes and documents the source; no new interval-math helper is added here... L6/webui work"). **This run builds `cronIntervalMs`.** | Computed here via `cron-parser` (already a leadwright dependency, MIT). |
| d. Release log | `~/.claude/leads/<lead-id>/audit.jsonl`, `AuditKind: "beat_recovered"`, one line per recovery, idempotent (second call on a closed entry appends nothing). | Write target for the release action, matching `recoverRegisterEntry`'s exact idempotency contract. |

## Design decisions I own

1. **Route shape** — three new endpoints under the existing `/api/external/org/*`
   family (same host+secret gates, applied once as router middleware — no new
   gate logic):
   - `GET /api/external/org/leads/:leadId/last-run` — staleness display.
   - `GET /api/external/org/leads/:leadId/beat-register` — register health
     (mirrors leadwright's `RegisterHealth`: `clear` / `open` / `fault`).
   - `POST /api/external/org/leads/:leadId/beat-register/release` — the ONE
     permitted write action against the runtime store (trap #4: no other
     write path is added).
2. **Staleness is tri-state, not boolean** (`"fresh" | "stale" | "unknown"`),
   matching this codebase's established idiom for "can't tell yet" states
   (`usage.ts`'s `measured: false`, never a guessed `false`/`0`). `"unknown"`
   fires when `triggers.cron` can't be resolved (org-chart missing/invalid,
   lead not in the chart, or an unparseable cron string) — a lead with no
   `last-run.json` is `measured: false` outright (a different, more basic
   state; the two must not collapse into one).
3. **Boundary rule**: `stale = ageMs > 3 * cadenceMs` (strictly greater) — a
   last-run exactly at the threshold is NOT stale. Explicitly tested at the
   boundary (spec traps demand it).
4. **Cadence lookup is per-lead and independent of chart-wide validity.** A
   dedicated narrow reader (`org-chart-lookup.ts`) looks up only
   `leads[leadId].triggers.cron` (+ `reports_to`, for the audit log's
   `parent_lead_id`) directly from the raw parsed JSON — it does NOT route
   through `org-chart.ts`'s `parseOrgChart`, which requires every lead in the
   file to pass full structural validation. A malformed entry for a
   *different* lead must not break this lead's staleness display; the two
   readers solve different problems (one needs "the whole chart or an
   error", the other needs "this one lead's two fields, best-effort").
   Guard strength: `usage.ts`'s pattern specifically (lstat + full
   `realPathGuard` parent-directory-escape check) — `org-chart.ts` does only
   a bare lstat with no `realPathGuard` call, which is the wrong precedent
   to cite here (Internal Plan Review fix; the code already did this, the
   prose just named both ambiguously).
5. **The release action's lock mirrors leadwright's `lib/file-locks.ts`
   `withLock` DEFAULTS exactly** (`stale: 300_000`, `retries: 10`,
   `minTimeout: 50`, `maxTimeout: 1000`, `factor: 2`, `realpath: true`, no
   `lockfilePath` override — proper-lockfile's own `<path>.lock`), not the
   10s default `decisions-lock.ts` used for `decisions-proposed.md`. The two
   are different files with a different known counterpart: leadwright's own
   `beat-register.ts` mutations (`openRegisterEntry`/`closeRegisterEntry`)
   already ship with these exact parameters — genuinely serializing against
   them means matching them, not inventing a different threshold the way 2A
   reasonably did for a file with no writer yet.
6. **`parent_lead_id` for the audit entry is resolved best-effort** from
   `org-chart-lookup.ts`'s `reports_to` field, falling back to `null` if the
   chart can't be read — the release action must not depend on org-chart
   validity to succeed (it exists specifically to recover a stuck state;
   making it transitively fail on an unrelated chart problem would defeat
   its purpose). `null` here means "couldn't resolve", not "reports to the
   PO" — accepted imprecision, documented in code, since the alternative
   (blocking the one recovery action on a healthy org-chart read) is worse.
7. **Release response is honest about the residual lock** (trap #2):
   `recovered: true` responses carry a `residualLockWarning` string field
   stating `.beat.lock` is untouched and may still deny starts for up to its
   stale window. No field claims or implies "the lead can run again now".
8. **`org-chart.json`'s existing typed read (`org-chart.ts`) is untouched.**
   The new per-lead cron/reports_to lookup does not extend `OrgChartLeadView`
   or `parseOrgChart` — see decision 4. The Org-page client work (leadwright
   triage Item 3, webui W4, not this run) that wants to *display* the chart
   with triggers can extend that separately when it needs to.

## Plan Review

`external_review.py --mode iterate`, both providers (openrouter/openai +
openrouter/deepseek), verdict **revise** from both, no contradiction. 16
findings total (7 openai, 9 deepseek), several overlapping. Adopted before
build:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| PR-1 | high (security) | `audit.jsonl` had no symlink/containment check before append — every other write target in this family does. | **fixed, with a correction added by Internal Plan Review below** — the guard is `existsSync`-gated: when `audit.jsonl` doesn't exist yet (a lead's first-ever recovery), no guard runs and `open(path,"a")` creates it fresh; when it already exists, the same `lstat`+`realPathGuard` guard the register file uses runs before the append. An unconditional guard (what this row originally implied) would 500 on every first-ever recovery, since `realPathGuard` requires the target to already exist. |
| PR-2 | medium (edge-case, both) | POST `/release` would `ensureFile` a brand-new `beat-register.json` even for an unknown-session request against a lead that never had one — side effect on a 404 path. | **fixed** — `lstat` the register file FIRST; ENOENT → `404 not-found` immediately, no lock acquired, nothing created. Lock/`ensureFile` only run when the file already exists. |
| PR-3 | medium (dependency, deepseek) | Read-modify-write risked silently dropping fields leadwright's shape doesn't declare (or adds later) if the writer reconstructed a narrow object. | **fixed** — mutation is in-place on the fully-parsed JSON value (only `entries[i].closedAt` is set); the write is of that same object, so unknown fields round-trip untouched. |
| PR-4 | medium (dependency, both) | No `version`/shape validation before mutating — corrupt producer data could be silently treated as clear/open, or a mutation attempted against it. | **fixed** — a structural type-guard (`version === 1`, entries array, each entry's 6 fields typed) gates BOTH the GET health read and the POST mutation; a failure is `502 beat_register_invalid` on GET and refuses the mutation (`502`, no write) on POST — never a guessed health/staleness value. |
| PR-5 | low (risk, openai) | Lock-acquisition failure (contention/stale, `ELOCKED`) had no defined mapping — would fall through to a generic 500. | **fixed** — `ELOCKED` maps to `409 beat_register_locked`; every other lock error still 500s. |
| PR-6 | medium (security, deepseek) | `org-chart-lookup`'s symlink/containment failures collapsed into the same generic bucket as "missing" or "malformed JSON" — inconsistent with `org-chart.ts`'s own 403 policy for the same condition. | **fixed** — `readLeadOrgInfo` returns a distinct `org_chart_symlink` reason; `last-run.ts` surfaces it as its own `cadenceUnresolvedReason` value (still `staleness:"unknown"`, 200 — this route serves staleness, not chart bytes, so it doesn't 403 the way `org-chart.ts` does, but the distinction is no longer silently lost). |
| PR-7 | medium (approach, openai) | `cronIntervalMs`'s timezone was unspecified; `cron-parser` defaults to system-local, which is nondeterministic across deployments. | **fixed** — `CronExpressionParser.parse(cron, {currentDate: from, tz: "UTC"})` explicit. |
| PR-8 | high (edge-case, openai) | Recovering an entry whose `sessionId` is duplicated (register `fault` state) is ambiguous — `.find()` closes only the first match, register stays inconsistent. | **disclosed, not changed** — this is IDENTICAL to leadwright's own `recoverRegisterEntry`, which also does not special-case a duplicate-sessionId register before mutating (verified by reading `lib/beat-register.ts` directly). The task brief is explicit: "Mirror that contract; do not invent a second one." Building stricter fault-detection here would make webui's release action behave DIFFERENTLY from leadwright's own admin-facing equivalent of the same operation over the same file — a worse outcome than sharing a known, already-shipped limitation. Documented in code at the mutation site. |
| PR-9 | high (risk, openai) | Register-write and audit-append are not atomic; a crash between them (or an audit-write failure) leaves a recovered entry with no `beat_recovered` record, and a retry (now idempotent-closed) would never re-append it. | **disclosed, not changed** — same ordering leadwright's own `recoverRegisterEntry` uses (append AFTER the lock's critical section, gated on `recovered === true`). Making webui's copy atomic across the two files while leadwright's own is not would mean the two implementations of "the same action" have different failure semantics — worse for a contract meant to be shared. Documented in code. |
| PR-10 | low (edge-case, deepseek) | Two DISTINCT open entries (not a duplicate sessionId) aren't flagged as a fault by `evaluateRegisterHealth` — only the first is reported. | **disclosed, not changed** — same behavior as leadwright's own function (verified by reading `lib/beat-register.ts`); FR-04.41's lock is what is supposed to prevent this state from occurring at all, so it is leadwright's invariant to strengthen if ever needed, not a webui-invented gap. A test proves our mirror matches leadwright's exact behavior for this input. |
| PR-11 | medium (dependency, deepseek) | `server/package-lock.json` wasn't named alongside `server/package.json` in the file list. | **fixed** — `npm install` regenerates it; added to the file list below. |
| PR-12 | medium (security, deepseek) | Lead-id validation before path construction wasn't explicit enough in the mini-plan prose. | **already covered** — `LEAD_ID_RE` (existing, shared) is checked before any `path.join` in all three new routes, matching `usage.ts`'s established pattern; the mini-plan's Work Breakdown named this but the prose above it didn't spell it out. No code change beyond what was already planned. |

Not adopted (out of scope for this run, noted for the record): recurrence-aware
staleness for irregular cron schedules (monthly/DST-crossing) instead of the
next-two-occurrences approximation (openai, medium) — the task brief asks to
"derive [the threshold] from `triggers.cron`", not to build exact-occurrence
scheduling; the approximation is disclosed in code and in the Confidence
Calibration below. `leadsRoot` cross-repo path-identity verification (deepseek,
medium) — inherited from 2A's existing config resolution, not a new surface
this run introduces.

## Internal Plan Review (opus-plan-reviewer)

- **Ran:** yes
- **Severity:** high
- **Findings:**
  - [high, architecture] The PR-1 disposition text above ("same lstat+realPathGuard guard as the register file, applied to the audit path too") reads as an unconditional guard, which — if built literally — would break the happy path: `realPathGuard` requires the target to exist (it calls `realpathSync`), so a lead's FIRST-EVER recovery (no `audit.jsonl` yet) would fail. **Verified against the actual code, not just the prose**: `beat-register-release.ts`'s `appendAuditLine` already gates the guard behind `existsSync(auditPath)` — when the file doesn't exist yet, the guard is skipped entirely and `openSync(auditPath, "a")` creates it fresh; the guard only runs (safely, since the file now exists) on a subsequent append. No code change needed. **Fixed**: this spec's PR-1 row (below) is corrected to describe the actual `existsSync`-gated pattern instead of the ambiguous phrasing that misled the review, and a dedicated test is added (fresh tmpdir with ONLY `beat-register.json`, no pre-existing `audit.jsonl` — release still recovers and creates the file with exactly one line).
  - [medium, completeness] Mini-plan step 5's prose didn't spell out PR-2's lstat-first-then-404 ordering — an implementer building strictly from the mini-plan could reintroduce the bug PR-2 already found. **Fixed**: mini-plan step 5 rewritten to state the ordering explicitly (already how the code was built).
  - [medium, architecture] Decision 4's "guarded like `org-chart.ts`/`usage.ts`" cited two routes with different guard strength (`org-chart.ts` has no `realPathGuard` call at all; `usage.ts` does). **Verified against the actual code**: `org-chart-lookup.ts` already uses `usage.ts`'s stronger pattern (lstat + full `realPathGuard`). **Fixed**: decision 4's wording tightened to name `usage.ts`'s pattern specifically, not both.
  - [low, completeness] The release lock's `update` (heartbeat) parameter was omitted from `DEFAULT_LOCK_OPTIONS` — proper-lockfile's own default when omitted is `stale/2` (150s here), not leadwright's actual `1_000`ms. Undercut decision 5's "mirrors ... exactly" claim. **Fixed**: `update: 1_000` added explicitly.
  - [low, completeness] No lock-contention test was listed for PR-5's ELOCKED→409 mapping despite the test-strategy section committing to real file locks. **Fixed**: added to the mini-plan's POST /release test list.
  - [low, completeness] The `beat_recovered` audit entry's field list wasn't pinned to leadwright's own payload — `beat_id` (from the recovered entry) was missing. `validateEntry` doesn't require it, so this wouldn't have broken leadwright's reader, but would have silently diverged from parity with leadwright's own recovery events. **Fixed**: `beat_id: entry.beatId` added to the appended entry.
- **Known limitations (unchanged, still correctly disclosed, not fixed):** PR-8 (duplicate-sessionId fault ambiguity), PR-9 (register-write/audit-append non-atomicity — the reviewer's high finding above showed one *trigger* for this gap was broader than described, not that the gap itself needed fixing), PR-10 (two distinct open entries not flagged as fault), the cron approximation for irregular schedules, and `leadsRoot` cross-repo path-identity (inherited from 2A). All are genuine, reasoned mirrors of leadwright's own shipped contract — re-opening them would make webui's copy diverge from what it exists to share.
- **Status:** 1 high fixed (documentation — code was already correct), 5 lower-severity fixed, 5 disclosed (unchanged), 0 declined.

## What changed (planned)

1. `server/package.json` + `server/package-lock.json` — add `cron-parser`
   (`^5.5.0`, MIT, already a leadwright dependency — same library, same
   major version).
2. `server/src/external/org/cron.ts` (new) — pure `cronIntervalMs(cron, from)`
   + `evaluateStaleness(lastRunAt, cadenceMs, now)`. No fs access.
3. `server/src/external/org/org-chart-lookup.ts` (new) — `readLeadOrgInfo(leadsRoot, leadId, lstat?)`,
   narrow per-lead reader (decision 4), symlink + realpath guarded via
   `usage.ts`'s stronger pattern (lstat + full `realPathGuard`).
4. `server/src/external/org/last-run.ts` (new) — the staleness route.
5. `server/src/external/org/beat-register.ts` (new) — shared shapes
   (`BeatRegisterEntryView`, `RegisterHealth`) + fs helpers + the
   register-health GET route, with its own local mirror of
   `evaluateRegisterHealth` (JSON-safe response shapes, not an import —
   cross-repo).
6. `server/src/external/org/beat-register-release.ts` (new) — thin Hono
   route shell (request validation, error-to-status mapping) for the POST
   release action.
6a. `server/src/external/org/beat-register-release-core.ts` (new, added
    post-Build during the code-review cascade) — the release action itself
    (locking, register mutation, audit append, local mirror of
    `recoverRegisterEntry`), split out of `beat-register-release.ts` a
    second time when the Stage-2 fixes pushed it back over the 300-line
    guideline. See "## Code Review" below.
7. `server/src/external/org/routes.ts` — wire the three new routes
   (last-run, beat-register health, beat-register release) into
   `createOrgRouter`.
8. `server/src/external/org/__tests__/{cron,org-chart-lookup,last-run,beat-register,beat-register-release}.test.ts` (new).
9. `server/src/external/org/__tests__/beat-register-confidence-probes.test.ts`
   (new) — the Confidence Calibration probes (round-trip across the two
   route modules, real concurrent-lock race, embedded-newline round-trip,
   UTF-8 BOM).
10. `.shipwright/planning/01-adopted/spec.md` — extend FR-01.70's row +
    add its first `### FR-01.70` AC section.
11. `.env.example` — no change needed; confirmed leadsRoot/secret env vars
    already documented from 2A.

## Code Review

Full cascade run post-Build (this repo's `CLAUDE.md` standing grant —
spawned without asking).

**Stage 1 (`spec-reviewer`, HARD-GATE): PASS.** Every FR-01.70 (B)/(C)/(D)
acceptance criterion present and faithful; all 12 Plan Review + 5 Internal
Plan Review dispositions correctly reflected in shipped code. One minor
non-blocking observation (generic-UUID vs strict-UUIDv4 regex) — disclosed,
not fixed.

**Stage 2 (`code-reviewer`): PASS, 4 findings, all fixed.**
1. (medium/correctness) `guardExistingTarget`'s `lstat` had no ENOENT
   tolerance — a TOCTOU-deleted register (leadwright's daemon is a real
   second writer) propagated as an unhandled 500. Fixed: a new `vanished`
   (404) outcome, mapped to the same not-found `ReleaseOutcome` the
   `existsSync` check already produces.
2. (medium/architecture) A duplicate, independent `OrgSymlinkEscapeError`
   class shadowed the one already shared by `decisions-lock.ts` /
   `countersign.ts` / `file-write.ts`. Fixed: import + re-export the shared
   one instead.
3. (medium/correctness) `routes.test.ts`'s `ALL_ENDPOINTS` gate-coverage
   list wasn't extended to the three new routes — nothing would catch a
   future regression dropping one of them from the shared host+secret
   middleware. Fixed: all three added; gate suite grew 20→38 tests.
4. (low/readability) `performRelease` crossed the 50-line guideline.
   Fixed: extracted `checkRegisterReachable` (pre-lock) and
   `recordRecoveryAudit` (post-release), leaving only the lock-acquire/
   critical-section/release in the main body.

**External cascade (Branch A, openrouter): `revise`, 3 findings.**
deepseek returned an empty reply (`status: degraded`); openai answered.
1. (medium/security) `appendAuditLine`'s `existsSync`-gated guard let a
   **dangling** `audit.jsonl` symlink bypass it entirely (`existsSync`
   follows symlinks and reports a dangling one as absent) — `openSync(...,
   "a")` would then create/write through it outside `leadsRoot`. **Fixed**:
   replaced with `ensureAuditFile` (`wx` flag — fails `EEXIST` against ANY
   pre-existing path, including a dangling symlink, without following it)
   + an unconditional `guardExistingTarget` call, mirroring
   `decisions-lock.ts`'s own already-reviewed `ensureFile` pattern
   verbatim.
2. (medium/spec) A duplicate-`sessionId` fault where the first match is
   closed and a second is open made release a silent, permanent no-op on
   the open entry (`.find()` picked the first match) — contradicting
   FR-01.70(D)'s "never resolved by picking one" applied only to reads.
   **Fixed**: release now refuses outright (409, no mutation, no audit
   line) when the requested `sessionId` has more than one match.
3. (medium/bug) Register-close and audit-append are non-atomic; a crash
   between them leaves a recovered-but-unaudited entry with no retry path.
   **Disclosed, not fixed** — this is the SAME limitation already
   identified and explicitly decided across the Plan Review (PR-9) and
   Internal Plan Review specifically to mirror leadwright's own
   `recoverRegisterEntry` ordering; the task brief instructs mirroring
   that contract rather than inventing a divergent recovery mechanism
   leadwright itself doesn't have.

All three fixes above added their own regression test (dangling-symlink
guard, duplicate-fault-on-release, TOCTOU-vanished-register), and the full
org route suite (198 tests) + typecheck stayed green throughout.

**Stage 3 (`doubt-reviewer`): fresh-context adversarial pass, 3 findings
(2 fixed, 1 disclosed).** This diff qualified (real `proper-lockfile`
concurrency + irreversible writes to a shared runtime store).
1. (high/concurrency) A THIRD vanish-window exists between
   `checkRegisterReachable`'s pass and `lockfile.lock()` itself — with
   `realpath: true` (the default here), `proper-lockfile`'s own `lock()`
   calls `fs.realpath(file)` first and rejects `ENOENT` if the register
   disappeared in that gap (confirmed by reading
   `server/node_modules/proper-lockfile/lib/lockfile.js` directly and
   reproducing it empirically against a real deleted file). Left
   unguarded, this fell to the route handler's bare `throw err` and
   surfaced as an uncaught 500 instead of the same graceful 404 the other
   two windows already produce. **Fixed**: wrapped the `lockfile.lock()`
   call in its own try/catch mapping `ENOENT` to `{ok:false,
   reason:"not-found"}`; everything else (`ELOCKED` included) still
   propagates unchanged. Regression test added in
   `beat-register-release-guards.test.ts`, using a `vi.mock("proper-lockfile")`
   wrapper around the real module to make `lock()` reject with `ENOENT`
   for exactly one call — ESM module namespaces can't be `vi.spyOn`'d
   directly.
2. (medium/correctness) `UUID_RE` used a case-insensitive `/i` flag, but
   register entry matching (`e.sessionId === sessionId`) is an exact,
   unnormalized comparison. leadwright's `crypto.randomUUID()` is always
   lowercase, so a differently-cased-but-validly-shaped `sessionId` passed
   validation and then silently mismatched the real entry, returning 404
   for a session with a genuinely open beat. **Fixed**: removed the `/i`
   flag — a differently-cased input is now rejected up front as 400
   `sessionId_invalid`. Regression test added.
3. (low/security) A symlink-swap during the same pre-lock window could
   make `lockfile.lock()` briefly lock an attacker-chosen realpath,
   creating a transient stray lock directory before `postGuard` rejects
   it. **Disclosed, not fixed** — within the already-accepted
   local-machine/Tailscale threat model this host+secret-gated route
   family operates under (single-operator machine); flagged for the
   record only.

Both fixes above added their own regression test; the full org route
suite grew to 200 tests, and the full server suite (313 files / 3594
tests) + typecheck + lint stayed green throughout. Review cascade is now
fully terminal (`self`/`plan`/`spec`/`code`/`doubt`/`external_code`/
`plan_internal` all `completed`).

## Confidence Calibration

- **Boundaries touched:** filesystem (three new JSON producer/consumer
  surfaces this repo only ever reads or narrowly appends — never rewrites
  leadwright's own beat lifecycle), a cross-process lock contract
  (`beat-register.json`, raced against leadwright's own daemon-side writer
  in principle, though no daemon exists yet to run concurrently against in
  this repo's own test suite — see Empirical probes).
- **Empirical probes run:** four adversarial probes beyond the per-route unit
  suites (`beat-register-confidence-probes.test.ts`), asking "what would a
  producer→file→consumer round-trip or a genuine race catch that the unit
  tests miss?" instead of asking "am I confident?":
  1. **Round 1 (round-trip, `touches_io_boundary`'s core case):**
     `POST /release` and `GET /beat-register` are two separate route
     modules that both touch `beat-register.json` — does the GET route
     observe the POST route's write in the same request cycle, with no
     stale in-memory cache? Wired both onto one `Hono()` instance and
     asserted `open` → release → `clear`. **Finding: none** — no cache
     layer exists, the second GET reads the file the first POST just
     wrote.
  2. **Round 2 (genuine concurrency, not sequential):** two `POST /release`
     calls fired via `Promise.all` (not the sequential "call twice" the
     per-route suite already covers) against the SAME open entry, using
     real `proper-lockfile` locking (no mock). **Finding: none** —
     exactly one call recovers, exactly one `beat_recovered` line is
     written; `proper-lockfile`'s retry+stale contract serializes the
     race onto the file lock as designed.
  3. **Round 3 (non-ASCII + embedded control character in written data):**
     a release `reason` containing an embedded raw newline and umlauts
     (`"hung beat\nline two — ümläut — \"quoted\""`) — does the JSONL
     one-entry-per-line invariant survive a value that itself contains a
     newline? **Finding: none** — `JSON.stringify` escapes the embedded
     `\n` inside the string, so the audit line stays exactly one physical
     line and round-trips byte-for-byte through `JSON.parse`.
  4. **Round 4 (`boundary-probes.md` UTF-8 BOM category, adapted for a
     machine-only JSON format):** a `org-chart.json` prefixed with a raw
     UTF-8 BOM (`\xEF\xBB\xBF`) — does `readLeadOrgInfo` silently mis-parse
     it (the env-iterate's original bug class) or crash uncaught?
     **Finding: none new** — `JSON.parse` throws on the BOM-prefixed text,
     and that throw is already mapped to `org_chart_invalid` by the
     existing malformed-JSON handling (the same "malformed → explicit
     error, never a half structure" contract every other parse failure
     gets). Judged **disclosed, not fixed**: `org-chart.json` is
     machine-written by leadwright's own `JSON.stringify` (which never
     emits a BOM), so this is defense-in-depth against an input class the
     real producer cannot generate, not a live risk — no silent
     corruption either way.
  **Asymptote:** all four probes found nothing requiring a code change
  (Round 4's finding is "existing handling already correct," not a new
  bug) — two-in-a-row-clean (Rounds 3+4) after two also-clean rounds
  (1+2), well past the "stop after one clean probe" floor. No
  yes-then-bug happened in this run, so condition 4 of the stopping rule
  (`confidence-anti-patterns.md`) is also satisfied. Probing this
  boundary stops here.
- **Test Completeness Ledger:** every testable behavior introduced by this
  run is `tested`; nothing is disposed `untestable`. By category:
  - `unit` (54 across the five per-route suites): `cronIntervalMs` +
    `evaluateStaleness` incl. both boundary edges; `readLeadOrgInfo`'s five
    failure reasons + the cross-lead-tolerance case + symlink; `last-run`'s
    not-measured / measured-fresh / measured-stale / boundary-exact /
    three unknown-cadence causes / invalid-leadId / symlink / malformed
    payload; `beat-register` GET's clear / open / fault / malformed /
    unsupported-version / invalid-leadId / symlink; `beat-register-release`
    POST's recovered / already-closed-noop / not-found (register present
    and register absent) / body-validation (three shapes) / symlink /
    lock-contention (real `proper-lockfile`, not mocked) /
    parent-lead-id-resolved / parent-lead-id-null.
  - `integration` (round-trip, 2 of the 4 probes above): Round 1
    (producer/consumer round-trip across the two route modules) and
    Round 2 (real concurrent-lock race) are `category:"integration"`
    behaviors, not unit-scoped — recorded in F5c.
  - No behavior is disposed `untestable`; the closed vocabulary
    (`requires-prod-credential` etc.) does not apply anywhere in this
    diff — every producer/consumer pair here is local filesystem state
    under test control.
- **Confidence-pattern check:** no "are you confident?" self-attestation
  was substituted for a probe at any point in this run — every claim in
  this section is backed by a named test that ran and is cited above by
  file. `cross_component` does not apply (no framework merge/churn/hook
  machinery touched), so the Integration Stopping Rule's mandatory
  `category:"integration"` behavior is satisfied by Rounds 1+2 on a
  belt-and-suspenders basis, not because the risk flag forced it.
