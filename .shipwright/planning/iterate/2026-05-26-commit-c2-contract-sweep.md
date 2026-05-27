# Iterate Spec: commit-c2-contract-sweep

- **Run ID:** iterate-2026-05-26-commit-c2-contract-sweep
- **Type:** change
- **Complexity:** medium
- **Status:** draft

## Goal

Codify the C2 API contract sweep (currently an ad-hoc worktree-only pytest from
campaign-C / C2 pre-merge verification) as a tracked, CI-runnable vitest suite
under `server/src/external/__tests__/`, anchored to the committed
`_c2_api_baseline.json`. After this lands, any change to
`server/src/external/**/routes.ts` (or any of the 9 sub-routers) that drops,
renames, or restructures an endpoint will fail CI deterministically instead
of leaking to runtime.

## Acceptance Criteria

- [ ] (E) A vitest suite at `server/src/external/__tests__/api-contract-sweep.test.ts`
  enumerates every endpoint in the C2 baseline and exercises it through Hono's
  in-memory `app.request()` (no port binding, no subprocess, hermetic).
- [ ] (E) The suite imports its baseline from
  `server/src/external/__tests__/api-contract-baseline.json` — a copy of the
  C2 planning-dir baseline, co-located with its consumer so future updates
  are atomic with the suite. Use plain `import baseline from "./api-contract-baseline.json"`
  (tsconfig has `resolveJsonModule: true` and `module: NodeNext`).
- [ ] (E) The suite uses **per-endpoint targeted probes** (not allowed-status-set
  membership). For each baseline endpoint, a `PROBE_TABLE` entry defines the
  exact request shape AND the exact expected status — so a regression that
  swaps `400` for `404` (or vice versa) on the same endpoint still fails.
- [ ] (E) A meta-test asserts every `baseline.endpoints[].id` has at least one
  entry in `PROBE_TABLE`; adding an endpoint to the baseline without a probe
  fails CI (drift-detection in the additive direction).
- [ ] (E) For every baseline endpoint with a documented success response that
  is hermetically reachable (`tasks.list`, `inbox.list`, `tasks.transcript`
  on a nonexistent task → `{status:"missing"}`, `projects.run_config` on a
  nonexistent project → `{status:"missing"}` or similar variants),
  the probe deliberately targets the success path AND asserts the documented
  success-key set is a subset of the actual response keys.
- [ ] (E) For load-bearing error invariants the suite asserts the documented
  status code:
  - `tasks.get` not-found → 404
  - `tasks.delete` not-found → 404
  - `tasks.patch` not-found → 404
  - `tasks.patch` at_least_one_field_required → 400
  - `tasks.launch` not-found → 404
  - `tasks.fork` parent-not-found → 404
  - `tasks.transcript` not-found → 404
  - `inbox.dismiss` toolUseId-not-found → 404
  - `projects.actions` project-not-found → 404
  - `projects.preview` project-not-found → 404
  - `projects.run_config` project-not-found → 404
  - `projects.tree` project-not-found → 404
  - `projects.file` MUST be probed TWICE:
    1. Missing `path` query arg → 400 (`path_required`)
    2. With `path=README.md` + nonexistent projectId → 404 (`project_not_found`)
  - `projects.actions_stub` project-not-found → 404
  - `projects.actions_upload` project-not-found → 404
  - `projects.actions_upload_delete` project-not-found → 404
  - `run_config.no_mutation` POST/PATCH/PUT/DELETE → 404 (Hono default — no handler defined; CLAUDE.md rule 12)
- [ ] (E) The transcript multi-tab stateless invariant (CLAUDE.md rule 4) is
  asserted: two parallel `app.request()` calls with the same `fromByte` +
  `expectFingerprint` return bytewise-identical responses (status + body).
- [ ] (E) `cmd /c npm.cmd --prefix server run test -- --run` and
  `cmd /c npm.cmd --prefix server run typecheck` both green.
- [ ] (E) The suite runs as part of `npm test` in the existing `server-checks`
  CI job — no `.github/workflows/*.yml` changes required (vitest's
  `include: ["**/*.test.ts"]` auto-picks the new file).
- [ ] (E) New file count ≤ 3 (suite + baseline JSON copy + at most one
  shared in-memory deps helper if extraction reduces duplication; see
  mini-plan for the call).

## Spec Impact

- **Classification:** none
- **NONE justification:** Internal test infrastructure that codifies the
  bit-perfect-API-contract verification already done ad-hoc for C2. No FR
  changes; the API surface itself is unchanged.

## Out of Scope

- Refactoring the existing `routes.test.ts` (775 LOC, grandfathered) or any
  sub-router test file. The new suite stands alongside them.
- Adding new endpoint coverage beyond the 22-entry baseline. Endpoints added
  post-C2 (or pre-C2 but missing from the baseline) are deliberately NOT
  rolled in — the baseline is a frozen anchor against the C2 split point.
- Replacing the planning-dir copy of `_c2_api_baseline.json` (kept as the
  historical record tied to the campaign).
- Detecting "extra endpoints registered but not in baseline" (drift in the
  other direction) — Hono does not expose its route registry conveniently;
  this would require either a build-time scan of `*/routes.ts` source or an
  internal API. Out of scope; the dominant regression mode the sweep
  addresses is silently-dropped endpoints, not silently-added ones.

## Design Notes

n/a — no UI surface.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | `server/src/external/__tests__/api-contract-sweep.test.ts` | reads `api-contract-baseline.json` (committed JSON) |

`touches_io_boundary` = NO. The new file is a test that consumes a static
JSON snapshot; no producer/consumer split. The baseline JSON is read-only
test fixture material. No new write surface introduced.

## Confidence Calibration (filled at finalization)

- **Boundaries touched:** None per the canonical risk taxonomy. The
  contract sweep itself codifies the load-bearing boundary (HTTP request
  shape × 22 endpoints) — the sweep is the probe, not the boundary.
- **Empirical probes run:**
  1. ✅ Suite against current main → 30/30 GREEN (24 PROBE_TABLE rows + 2
     seeded tests + 1 multi-tab + 1 no-mutation + 3 meta-tests).
  2. ✅ Regression-guard probe: commented out
     `app.route("/", createTreeRouter({...}))` in
     `server/src/external/routes.ts` line 219. Initial run still
     PASSED (a hole — the JSON content-type check was a soft `if`,
     not an `expect`). Strengthened the assertion: when
     `expectErrorCode|expectStatusField|expectKeys` is set, the suite
     now REQUIRES `application/json` content-type and FAILS with a
     precise message naming the framework-default-404 / unmounted-
     router class of regression. Re-ran with tree still unmounted →
     RED (1 failure on `projects.tree` with diagnostic
     `content-type=text/plain — expected application/json`).
     Re-instated mount → 30/30 GREEN.
  3. ✅ Full server suite re-run AFTER the harness change to confirm no
     collateral regression elsewhere in `server/`: 100/100 files,
     1279/1279 tests passed.
  4. ✅ Typecheck: `npx tsc --noEmit` clean (zero output).
  5. ✅ Lint: `npm run lint` — no new warnings on `api-contract-*.ts`
     files (pre-existing warnings in unrelated files are untouched).
- **Edge cases NOT probed + why acceptable:** runtime-only behaviors like
  ELOCKED (CLAUDE.md rule 6), `phase_task_session_uuid_mismatch` (rule 13),
  preview spawn `shell:false` (rule 9) — these have dedicated existing
  tests under `routes.backlog.test.ts`, `phase-task-launch.test.ts`,
  `preview/__tests__/` and are not the sweep's job. The sweep verifies
  surface presence + shape, not deep handler logic.
- **Confidence-pattern check:** One yes-then-bug cycle fired during this
  iterate (the initial regression-guard probe surfaced a false-GREEN
  in my own assertion shape — exactly the asymptote heuristic in
  `references/confidence-anti-patterns.md`). One additional probe
  ran (full server suite re-run after the assertion fix) before F0;
  no further bugs surfaced.

## Self-Review (7-point checklist)

1. **Goal achieved.** The C2 contract sweep is now a tracked vitest
   suite under `server/src/external/__tests__/`. Triage item resolved:
   the empirical anchor for "bit-perfect API contract" lives in the
   repo, not in worktree-only memory.
2. **Tests assert outcomes, not internal state.** Every probe asserts
   HTTP-surface observables (status code, error code, response keys,
   bytewise body identity). No private-module imports.
3. **Wiring verified.** The regression-guard probe (Confidence
   Calibration probe #2) empirically proves the suite catches a
   dropped sub-router mount with a precise diagnostic.
4. **Happy path + error path coverage.** 200 paths covered for
   `tasks.list`, `tasks.create`, `inbox.list`, `tasks.transcript`
   missing variant. 400/404 paths covered for all 22 baseline
   endpoints + the `at_least_one_field_required` 400. The transcript
   multi-tab stateless invariant has its own dedicated test.
5. **No tests that always pass.** Every assertion has a way to fail —
   PROBE_TABLE entries use exact `toBe(probe.expectStatus)`, the
   content-type check uses `toContain` after `expect()` (not bare
   `if`), the multi-tab test uses `toBe(bodyA)` on actual response
   bytes.
6. **Scope discipline.** No refactor of existing `routes.test.ts` or
   sub-router test files; `inMemoryDeps()` duplicated rather than
   extracted (15 LOC; extract on third consumer). PROBE_TABLE pulled
   out only because the test file crossed 300 LOC after the initial
   write — pure mechanical compliance with project bloat guideline.
7. **Affected Boundaries probe.** None per canonical risk taxonomy
   (HTTP JSON not in `IO_BOUNDARY_FILE_PATTERNS`). The new file is a
   test that consumes a static JSON snapshot; no new producer surface.

## Verification (medium+)

- **Surface:** `cli`
- **Runner command:**
  `SHIPWRIGHT_NETWORK_PROFILE=local cmd /c npm.cmd --prefix server run test -- --run src/external/__tests__/api-contract-sweep.test.ts`
- **Evidence path:** vitest stdout captured to
  `.shipwright/runs/iterate-2026-05-26-commit-c2-contract-sweep/surface_verification.json`
  via `surface_verification.py`.
- **Justification:** Surface = cli because the artifact under test is a
  test suite. No web/api surface change. No browser dimension.
