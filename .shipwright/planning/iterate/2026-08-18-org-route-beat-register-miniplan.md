# Mini-Plan: V4a-2B — Org-Route Runtime Part

**run_id:** iterate-2026-08-18-org-route-beat-register

## 1. Files to create/modify

| File | Change |
|---|---|
| `server/package.json` | edit — add `cron-parser` dependency |
| `server/src/external/org/cron.ts` | new — pure cron math |
| `server/src/external/org/org-chart-lookup.ts` | new — narrow per-lead reader |
| `server/src/external/org/last-run.ts` | new — GET staleness route |
| `server/src/external/org/beat-register.ts` | new — shared shapes + GET health route |
| `server/src/external/org/beat-register-release.ts` | new — POST release route (split out to stay under the 300-line file guideline) |
| `server/src/external/org/routes.ts` | edit — wire the three new routes |
| `server/src/external/org/__tests__/cron.test.ts` | new |
| `server/src/external/org/__tests__/org-chart-lookup.test.ts` | new |
| `server/src/external/org/__tests__/last-run.test.ts` | new |
| `server/src/external/org/__tests__/beat-register.test.ts` | new — GET health |
| `server/src/external/org/__tests__/beat-register-release.test.ts` | new — POST release |
| `.shipwright/planning/01-adopted/spec.md` | edit — FR-01.70 row + new AC section |

## 2. Work breakdown

1. `cron.ts` — `cronIntervalMs(cron, from)` via `cron-parser`'s
   `CronExpressionParser.parse(cron, {currentDate: from}).next()` called
   twice, diffed; `evaluateStaleness(lastRunAt, cadenceMs, now)` — pure
   arithmetic, `stale = ageMs > 3*cadenceMs`. Test: valid cron → correct ms;
   invalid cron string → `ok:false`; boundary (`ageMs === threshold` → not
   stale, `+1ms` → stale).
2. `org-chart-lookup.ts` — `readLeadOrgInfo(leadsRoot, leadId, lstat?)`:
   lstat the chart file (ENOENT → `org_chart_missing`; symlink → treat as
   `org_chart_invalid`, no route context here so no 403 — this is a library
   function, the route decides status codes), realpath containment,
   JSON.parse, narrow lookup of `leads[leadId].triggers.cron` +
   `leads[leadId].reports_to`, no full-chart validation. Test: missing file,
   invalid JSON, missing leadId key, lead present but no `triggers.cron`,
   well-formed lookup, and — the point of decision 4 — a DIFFERENT lead's
   malformed entry does not break this lead's lookup.
3. `last-run.ts` — the route. `lstat` last-run.json (ENOENT → `measured:false`),
   symlink → 403, realpath containment, parse + shape-check, then call
   `readLeadOrgInfo` + `cronIntervalMs` + `evaluateStaleness`; `staleness:"unknown"`
   with a `cadenceUnresolvedReason` when either step fails. Test: not-measured
   (no file), measured+fresh, measured+stale, boundary-exact, unknown-cadence
   (missing chart / lead not in chart / unparseable cron), symlink-forbidden,
   invalid-leadId 400, malformed last-run.json 502.
4. `beat-register.ts` GET — lstat register file (ENOENT → `status:"clear"`),
   symlink → 403, realpath containment, parse + shape-check (502 on
   malformed), local `evaluateRegisterHealth` mirror (duplicate-sessionId
   fault wins over open). Test: clear (no file), clear (empty entries), open,
   fault (duplicate sessionId — fault wins even if one entry is also
   "open"-shaped), malformed-JSON 502, symlink 403, invalid-leadId 400.
5. `beat-register-release.ts` POST `/release` — body validation (`sessionId`
   UUIDv4 shape, `reason` non-empty ≤500 chars), THEN **`existsSync` the
   register file FIRST: missing → 404 `not-found` immediately, no lock
   acquired, nothing created** (Internal Plan Review fix — this ordering
   must come before any lock step, not after, or a request against a lead
   that never had a register creates one as a side effect of a 404).
   Only when the register file already exists: symlink-check + guard,
   `proper-lockfile` acquire (mirroring leadwright's `withLock` defaults
   including `update: 1_000` — decision 5) + re-check-after-acquire (mirrors
   `decisions-lock.ts`'s TOCTOU fix), read-modify-write via atomic
   tmp+rename (mirrors `countersign.ts`'s `atomicWrite`), release in
   `finally`, THEN append the audit entry (kind `beat_recovered`, fields
   mirroring `recoverRegisterEntry`'s own payload verbatim including
   `beat_id`) only when `recovered === true` — via `existsSync`-gated
   append (skip the guard when `audit.jsonl` doesn't exist yet, since
   `realPathGuard` requires the target to already exist; guard it once it
   does). Test (asserted against the actual files, per the task's
   acceptance criteria, not mocks):
   - Open entry → 200 `{ok:true, recovered:true, residualLockWarning}`,
     register file's `closedAt` now set, exactly one `beat_recovered` line
     appended to `audit.jsonl`.
   - Open entry, lead's `audit.jsonl` does NOT exist yet (fresh tmpdir with
     only `beat-register.json`) → same 200, `audit.jsonl` is created with
     exactly one line (Internal Plan Review fix — the case an unconditional
     guard would have broken).
   - Second call, same sessionId (now closed) → 200
     `{ok:true, recovered:false}`, audit.jsonl unchanged (no new line).
   - Unknown sessionId, register file present → 404 `{ok:false, reason:"not-found"}`.
   - Unknown sessionId, register file absent entirely → 404
     `{ok:false, reason:"not-found"}`, nothing created (plan-review PR-2).
   - Missing/invalid body → 400.
   - Symlinked register file → 403, no write attempted.
   - Lock held by a concurrent call (real `proper-lockfile` contention, not
     mocked) → 409 `beat_register_locked` (plan-review PR-5).
   - `parent_lead_id` resolves from org-chart when available, `null` when
     the chart can't be read (decision 6) — action still succeeds either way.

## 3. Component hierarchy

N/A — server-only, no UI in this run (Item 3 / webui W4 is separate,
sequenced after this).

## 4. Data model changes

None — this run reads/appends to files leadwright already defines the shape
of (beat-register.json, last-run.json, audit.jsonl, org-chart.json's
`triggers`/`reports_to` fields). No new persistent state owned by webui.

## 5. Test strategy

Vitest unit + integration (real tmpdir fixtures, real `Hono().request()`,
real file locks — no mocked fs for the lock/atomicity paths, matching this
family's existing convention in `countersign.test.ts`/`two-process-lock.test.ts`).
No E2E — no UI surface in this run (Phase Matrix: E2E "if feature+UI"; this
is server-only). No `touches_io_boundary` Boundary Probe beyond the
Test Completeness Ledger's own round-trip coverage of each new
producer/consumer pair (release-writes-register+audit, chart-read informs
last-run) — same bar `iterate-2026-08-17-org-route-leads` already set for
this route family.

## 6. Alternative approach (rejected)

**Considered:** derive the release action's lock parameters independently
(e.g. reuse `decisions-lock.ts`'s 10s-stale default, or invent a new
shorter/longer value) rather than mirroring leadwright's `lib/file-locks.ts`
`withLock` defaults exactly.

**Rejected because:** unlike `decisions-proposed.md` (where leadwright had
no writer yet when 2A shipped, so inventing a standalone default was the
only option), `beat-register.json` already has a real, shipped counterpart
writer on the leadwright side with concrete or bearing parameters
(`stale: 300_000`, `retries: 10`, `realpath: true`). `proper-lockfile`'s
mutual exclusion is enforced by the underlying `mkdir` atomicity regardless
of the `stale` value chosen by either side, so a mismatched `stale` would
not cause data corruption — but it WOULD mean the two sides disagree about
when a lock is considered abandoned, so a crash during a leadwright-held
lock could be treated as instantly-stale by webui's shorter timeout (or vice
versa), defeating the point of a shared staleness contract. Matching the
known, already-shipped value is strictly safer and costs nothing.
