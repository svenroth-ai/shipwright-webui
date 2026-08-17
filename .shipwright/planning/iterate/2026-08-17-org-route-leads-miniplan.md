# Mini-Plan — org-route-leads

**run_id:** `iterate-2026-08-17-org-route-leads`

## 1. Files to create/modify

New:
- `server/src/config.ts` — edit: add `leadsRoot`, `leadsRouteSecret` to `ServerConfig` + `getConfig()`.
- `server/src/external/org/_helpers.ts` — new: constants (write allowlist,
  usage refresh interval, ADR number regex), `resolveOrgTarget()`,
  `isAllowedOrgRouteHost()`, `checkOrgSecret()`.
- `server/src/external/org/file-write.ts` — new: `PUT /api/external/org/file` (mirrors `write.ts`, no lock).
- `server/src/external/org/file-read.ts` — new: `GET /api/external/org/file` (mirrors `file/routes.ts` GET, allowlist-scoped).
- `server/src/external/org/org-chart.ts` — new: `GET /api/external/org/org-chart` + the mirrored type.
- `server/src/external/org/usage.ts` — new: `GET /api/external/org/leads/:leadId/usage`.
- `server/src/external/org/decisions-lock.ts` — new: FR-04.28 lock wrapper (`withDecisionsLock`), entry-block parsing/formatting helpers.
- `server/src/external/org/countersign.ts` — new: `POST /api/external/org/decisions/countersign`.
- `server/src/external/org/routes.ts` — new: `createOrgRouter(deps)` — mounts the 5 handlers behind the host+secret gate middleware.
- `server/src/external/org/__tests__/*.test.ts` — new: one test file per handler + one 2-process concurrency spec.

Edit:
- `server/src/index.ts` — hoist `resolveHonoHost(process.env)` above the
  `createExternalRoutes(...)` call site (currently computed later, at the
  `serve()` call); pass it + the new config through; mount `createOrgRouter`.
- `server/src/external/routes.ts` — accept + pass through `honoHost` and
  `leadsRouteSecret`/`leadsRoot`, mount `createOrgRouter`.
- `server/src/external/__tests__/api-contract-probes.ts` +
  `api-contract-baseline.json` — register the 5 new endpoints (403/401 probes
  — these routes 403 without a configured secret in the test harness, which
  is itself the correct-and-testable default-closed behavior).
- `.env.example` — document `SHIPWRIGHT_LEADS_ROUTE_SECRET`.

## 2. Work breakdown

1. **Config + host-pass-through plumbing.** Add config fields; hoist
   `resolveHonoHost` call in `index.ts`; thread `honoHost` through
   `createExternalRoutes` → `createOrgRouter`. Test: a unit test on the
   hoisted call site asserting `resolveHonoHost` is invoked exactly once
   during route construction (regression guard against a future re-add of a
   second call).
2. **`_helpers.ts` — the three gates + allowlist, standalone and pure.**
   `isAllowedOrgRouteHost(host)` (loopback ∪ 100.64.0.0/10), the write
   allowlist (5 literals + charter pattern) and `resolveOrgTarget(leadsRoot,
   relpath)`. Tests: host-gate table (loopback v4/v6 allow, 0.0.0.0 deny,
   in-range/out-of-range Tailscale IPs), allowlist enumerates all 6 kinds +
   rejects org-chart.json + traversal + absolute + symlink (reuse the
   injectable-`lstat` seam from `write.ts`).
3. **`file-read.ts` / `file-write.ts`.** Byte-identical posture to
   `file/routes.ts` GET + `write.ts` PUT, scoped to `resolveOrgTarget`
   instead of a project root, host+secret gates applied via router
   middleware (built in step 6, so these two handlers are written against an
   already-gated `Hono` app in tests). Tests: happy path read+write+re-read
   round-trip, If-Match 409, missing-target 404, disallowed target 403,
   symlink 403.
4. **`org-chart.ts`.** Parse `~/.claude/leads/org-chart.json`, minimal
   structural check (JSON.parse + `version`/`po`/`leads` presence,
   `leads[id].reports_to`/`manages` array-or-null shape) — NOT the full
   leadwright Zod schema (cycles, kebab-case, escalation targets — those
   stay leadwright's write-time job). Tests: well-formed → typed body,
   missing file → 404 (there is nothing to serve, distinct from usage's
   "not measured" — org-chart absence is a setup problem, not a steady
   state), malformed JSON / wrong top-level shape → 502 `org_chart_invalid`
   (never a half object).
5. **`usage.ts`.** Read `~/.claude/leads/<leadId>/usage.json`; missing file →
   `{leadId, measured:false}` 200; present+valid → `{leadId, measured:true,
   costUsd, runCount, windowDays, asOf}` 200; present+malformed → 502 (same
   "never a half structure" bar as org-chart). Exports
   `LEADS_USAGE_REFRESH_INTERVAL_MS`. Tests: all three states.
6. **`decisions-lock.ts` + `countersign.ts`.** `withDecisionsLock(leadsRoot,
   fn)` — `ensureFile` then `lockfile.lock(decisionsProposedPath, {stale:
   10_000, realpath: true, retries: {...}})` (no `lockfilePath` override).
   `parseEntryBlocks` / `formatLoggedEntry` for the header-delimited format
   (spec §"Design decisions I own", point 3). `countersign.ts` composes them:
   find by timestamp → 404 if absent → compute next `ADR-NNNN` from
   `decision_log.md` inside the lock → append + rewrite atomically → release.
   Tests (same-process): entry found/moved/numbered, entry-not-found 404,
   numbering continues from existing max, malformed existing log entry
   doesn't crash the scan (regex-only, ignores non-matching headers).
7. **Two-process concurrency proof (the card's explicit ask).** A Vitest
   spec that `child_process.fork()`s **two separate Node processes**, each
   running a small script that calls the real `withDecisionsLock` against
   the same temp `decisions-proposed.md`/`decision_log.md` pair with two
   *different* proposed entries seeded up front, and asserts the two
   resulting `decision_log.md` numbers are N and N+1 with no gap and no
   collision — this is the proof a same-process `Promise.all` cannot give
   (`write.ts`-style fs calls are synchronous; the event loop never yields
   between read and rename inside one process).
8. **Symlink lock proof.** A Windows-CI-safe test using a **Junction**
   (`fs.symlinkSync(..., 'junction')` on win32, real symlink on POSIX) so
   both "processes" (here: two `withDecisionsLock` calls, one through the
   direct path, one through the junction) contend on the literal same lock
   file once `realpath: true` resolves them to one canonical path — asserts
   they serialize (second call observes the first's release) rather than
   silently operating on two different `<path>.lock` directories.
9. **`routes.ts` — the router + gate middleware**, wiring all five handlers.
   Tests: no-secret-configured → 503 all five; wrong/missing header → 401 all
   five; disallowed host → 403 all five (using the injectable `honoHost` dep,
   not a real bind); happy path smoke per handler once gated.
10. **`index.ts` / `routes.ts` wiring**, `.env.example`, contract-baseline +
    probe-table registration. Test: `api-contract-sweep.test.ts` stays green.

## 3. Data model changes

None (no `client/src` schema, no project-scoped store schema). New on-disk
shapes are all under `~/.claude/leads/**`, outside this repo's own state
files — documented as a contract in the spec, not enforced by a schema file
here (leadwright owns the write side for org-chart/usage; this route owns the
write side for the 6-target allowlist + the decision-log transfer format).

## 4. Test strategy

Vitest unit/integration only (no client, no E2E — this is a server-only,
non-UI surface; Item 3, the client page, is the E2E-bearing follow-up).
Real-filesystem tests using `os.tmpdir()` fixtures for the leads root (never
`~/.claude/leads` itself). The two-process spec is the one test that
genuinely needs `child_process`, not a mock — noted explicitly in the iterate
spec's Confidence Calibration as the asymmetry: everything else is a normal
Hono `app.request()` unit test.

## 5. Alternative approach considered — rejected because

**Alternative: one route per file** (`PUT /api/external/org/conventions`,
`PUT /api/external/org/decision-log`, …) instead of one path-parametrized
route (`PUT /api/external/org/file?path=`). Rejected because the acceptance
bar explicitly wants a single enumerable allowlist a test can "count off"
(Abnahme: "Ein Test zählt die Liste ab") — six literal routes would smear
that one list across six handler registrations instead of one array, and
`file/routes.ts` already establishes the query-param-path convention this
route reuses everywhere else (GET/PUT `/file?path=`) for consistency with the
one other filesystem-write surface in this codebase.
