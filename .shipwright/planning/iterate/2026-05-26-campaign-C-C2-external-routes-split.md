# Iterate — Campaign C / C2 — external/routes.ts split

- **Date:** 2026-05-26
- **Run-ID:** `iterate-2026-05-26-campaign-C-C2-external-routes-split`
- **Branch:** `iterate/campaign-C-C2-external-routes-split`
- **Base:** `origin/main @ ce08c5d`
- **Type:** refactor — Spec-Impact = `none` (internal split; bit-perfect contract preserved)
- **Complexity:** medium (canonical classifier returns `small` with `touches_public_api`; spec body labels HIGH-RISK because of 2879-LOC blast radius across the central API surface).
- **Surface:** `api`
- **Campaign:** `2026-05-25-bloat-cleanup-C-webui` — sub-iterate C2 (LAST IN CHAIN)

## Goal

Split `server/src/external/routes.ts` (2879 LOC, grandfathered in
`shipwright_bloat_baseline.json`) into 9 sub-routers grouped by concern,
plus a thin registration shell. Remove the baseline entry per
cleanup-invariant (a) or (b).

Each sub-router exports a Hono `Hono` instance (the parent currently
constructs a `new Hono()`; staying on the same primitive avoids a
type-skew risk vs. `OpenAPIHono` and matches the parent's existing
mount style). The shell wires them all into the same parent Hono app
via `app.route("/", subRouter)` — keeping every existing path string
verbatim (each handler currently reads `/api/external/...` literally,
not a mount-relative path), so the wire-level URL surface stays
byte-identical.

## Acceptance Criteria

### Structure
- [ ] (E) `server/src/external/tasks/routes.ts` — owns `POST/GET/PATCH/DELETE /api/external/tasks(/:id)` + `/fork` + `/close` + `/backlog`. ≤ 300 LOC.
- [ ] (E) `server/src/external/launch/routes.ts` — owns `POST /api/external/tasks/:id/launch`. ≤ 300 LOC.
- [ ] (E) `server/src/external/transcript/routes.ts` — owns `GET /api/external/tasks/:id/transcript`. ≤ 300 LOC.
- [ ] (E) `server/src/external/inbox/routes.ts` — owns `GET /api/external/inbox` + `POST /api/external/inbox/:toolUseId/dismiss`. ≤ 300 LOC.
- [ ] (E) `server/src/external/actions/routes.ts` — owns `GET /api/external/projects/:projectId/actions` + `POST/DELETE /api/projects/:id/actions-upload` + `POST /api/projects/:id/actions-stub`. ≤ 300 LOC.
- [ ] (E) `server/src/external/preview/routes.ts` — owns `POST /api/external/projects/:projectId/preview`. ≤ 300 LOC.
- [ ] (E) `server/src/external/file/routes.ts` — owns `GET /api/external/projects/:projectId/file`. ≤ 300 LOC.
- [ ] (E) `server/src/external/tree/routes.ts` — owns `GET /api/external/projects/:projectId/tree`. ≤ 300 LOC.
- [ ] (E) `server/src/external/run-config/routes.ts` — owns `GET /api/external/projects/:projectId/run-config`. ≤ 300 LOC.
- [ ] (E) `server/src/external/index.ts` or shrunk `routes.ts` shell (≤ 150 LOC) — mount-and-bind only. NO inline handlers.
- [ ] (E) Shared helpers (`withLiveSession`, `withLiveJsonlMtime`, `validatePhaseForProject`, `dryRunTemplate`, `parseIntSafe`, `resolvePhaseTaskCreateFields`, `validateProjectIdOrError`, `normalizeDescription`, `normalizeStringArray`, `readLeadCreateFields`, `FILE_MAX_BYTES`, `MIME_BY_EXTENSION`, `sanitizeContentDispositionFilename`, `ACTIONS_UPLOAD_MAX_BYTES`, `clearInboxDeriveCache`, `ExternalRouteProjectView`) extracted into `server/src/external/_shared/helpers.ts` (or per-domain `_helpers.ts`). Each helper file ≤ 300 LOC.
- [ ] (E) Old `server/src/external/routes.ts` either DELETED or shrunk to ≤ 300 LOC entry-point that re-exports `clearInboxDeriveCache`, `FILE_MAX_BYTES`, `MIME_BY_EXTENSION`, `sanitizeContentDispositionFilename`, `ExternalRouteProjectView` for back-compat with the 14 sibling test files.
- [ ] (E) `shipwright_bloat_baseline.json` entry for `server/src/external/routes.ts` REMOVED.

### Tests (RED→GREEN per slice)
- [ ] (E) Per-router test files exist under `server/src/external/{tasks,launch,transcript,inbox,actions,preview,file,tree,run-config}/__tests__/routes.test.ts`. Each ≤ 300 LOC. Mandatory cases per CLAUDE.md:
  - `tasks/__tests__/routes.test.ts`: PATCH ELOCKED → 409 (rule 6); GET reads canonical schema v3 (rule 15).
  - `launch/__tests__/routes.test.ts`: `phaseTaskRef` mismatch → 409 (rule 13); `phaseTaskRef + actionId` → 400 `mixed_launch_intents` (rule 13).
  - `transcript/__tests__/routes.test.ts`: stateless byte-offset (rule 4) — concurrent multi-tab fetches return identical bytes for same `fromByte+expectFingerprint`.
  - `inbox/__tests__/routes.test.ts`: pagination + filter contract.
  - `actions/__tests__/routes.test.ts`: response key contract.
  - `preview/__tests__/routes.test.ts`: `shell:false` invariant via injected previewManager mock; unsupported command rejected.
  - `file/__tests__/routes.test.ts`: null-byte input → hard-reject (rule 10); realpath escape → reject.
  - `tree/__tests__/routes.test.ts`: `.gitignore` directory-form negation honored (commit 5c7f539 regression guard).
  - `run-config/__tests__/routes.test.ts`: POST/PATCH return 405 (rule 12) — METHOD-NOT-ALLOWED is enforced by Hono's default-not-matched 404 in the current impl; the contract is "no POST/PATCH endpoint defined → server returns 404". Spec test asserts 404 OR explicit 405 — whichever the parent app emits unchanged.
- [ ] (E) The historical `server/src/external/routes.test.ts` (843 LOC) fans out naturally into the per-router files. Each new file ≤ 300 LOC; legacy `routes.test.ts` deleted (its `describe()` blocks migrate).
- [ ] (E) 14 sibling `*.test.ts` files (`routes.backlog.test.ts`, `routes.delete-cascade.test.ts`, `routes.edit-fields.test.ts`, `routes.launch-dryrun.test.ts`, `routes.launch-newplain-resume.test.ts`, `routes.launch-resume-description.test.ts`, `routes.live-session.test.ts`, `routes.transcript-newplain-active-stays.test.ts`, `routes.transcript-newplain-idle.test.ts`, `phase-task-launch.test.ts`, `actions-routes.test.ts`, `actions-schema-validation.test.ts`, `actions-upload.test.ts`, `file-route.test.ts`, `project-patch-route.test.ts`, `run-config-route.test.ts`, `tree-route.test.ts`) continue to import `createExternalRoutes` and `clearInboxDeriveCache` from `./routes.js` (the shell). Shell re-exports preserve back-compat.

### API Contract
- [ ] (E) **Bit-perfect API contract.** Pre-split baseline `_c2_api_baseline.json` (committed alongside this spec). Post-split contract sweep enumerates every endpoint and asserts:
  - Same HTTP method
  - Same path string (including `/api/external/` vs `/api/projects/` prefix split)
  - Same status code for each documented success + error branch
  - Same top-level response key set
  - Same response key set for documented error codes
- [ ] (E) Bloat-check PR-comment ✅ no anti-ratchet AND zero advisory crossings.
- [ ] (E) `cmd /c npm.cmd --prefix server run typecheck` green.
- [ ] (E) `cmd /c npm.cmd --prefix server run lint` green.
- [ ] (E) `SHIPWRIGHT_NETWORK_PROFILE=local cmd /c node_modules\.bin\vitest.cmd run` (from `server/`) green.
- [ ] (E) `cmd /c npm.cmd --prefix client run typecheck` green.
- [ ] (E) `cmd /c node_modules\.bin\vitest.cmd run` (from `client/`) green.

## Spec Impact

- **Classification:** none
- **NONE justification:** Internal refactor. The split preserves every endpoint's
  method + path + middleware + status codes + response shape. No FR / ADR is
  affected; no architecture document changes (the External-launch routes
  section in `.shipwright/agent_docs/architecture.md` will be updated to point
  at the new directory layout, but the load-bearing rules — stateless
  transcript, ELOCKED→409, `shell:false`, path-guard via `realpath`, schema
  v3 write-on-touch — remain enforced byte-for-byte in the moved handlers).

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| Each sub-router | `client/src/lib/externalApi.ts` + all hooks | HTTP request + response JSON |
| `tasks/routes.ts` | `client/src/hooks/useExternalTasks.ts`, `useTask.ts`, `useStartTask.ts`, `useReassignTask.ts`, `useUpdateProject.ts` | JSON over HTTP |
| `launch/routes.ts` | `client/src/hooks/useLaunchTask.ts`, `useContinuePipeline.ts` | JSON over HTTP |
| `transcript/routes.ts` | `client/src/hooks/useTaskTranscript.ts` | JSON over HTTP, stateless byte-offset |
| `inbox/routes.ts` | `client/src/hooks/useExternalInbox.ts`, `useTriage.ts` | JSON over HTTP |
| `actions/routes.ts` | `client/src/hooks/useProjectActions.ts` + Settings UI | JSON over HTTP |
| `preview/routes.ts` | `client/src/components/external/PreviewButton.tsx` | JSON over HTTP |
| `file/routes.ts` | `client/src/hooks/useFileContent.ts`, `<img>` direct loads | bytes + headers |
| `tree/routes.ts` | `client/src/hooks/useFileTree.ts` | JSON over HTTP |
| `run-config/routes.ts` | `client/src/hooks/useRunConfig.ts` | JSON over HTTP |

`touches_io_boundary` = NO (per canonical taxonomy — JSON HTTP is not on the
IO_BOUNDARY list), but contract preservation is the highest-risk concern of
this iterate. Mandatory empirical contract sweep below.

## Verification (F0.5) — surface `api`

- **Runner commands:**
  ```bash
  # 1. Boot isolated server on a temp USERPROFILE so the real
  #    sdk-sessions.json is untouched; bind loopback (project memory
  #    feedback_dev_vs_autostart_port_conflict — coexist with the
  #    production 3847 listener).
  cmd /c npm.cmd --prefix server run build
  PORT=3848 SHIPWRIGHT_NETWORK_PROFILE=local USERPROFILE=/tmp/c2-userprofile \
    node server/dist/index.js &
  # wait for ready (poll GET /api/diagnostics)

  # 2. Contract sweep against the running server
  uv run --with pytest --with requests pytest \
    .shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_c2_contract_sweep.py -v

  # 3. Per-router vitest
  cd server && SHIPWRIGHT_NETWORK_PROFILE=local cmd /c node_modules\.bin\vitest.cmd run src/external

  # 4. Typecheck + lint (both workspaces)
  cmd /c npm.cmd --prefix server run typecheck
  cmd /c npm.cmd --prefix server run lint
  cmd /c npm.cmd --prefix client run typecheck

  # 5. surface_verification.py wrapper
  uv run --with openai \
    "C:/Users/SvenRoth/.claude/plugins/cache/shipwright/shared/scripts/surface_verification.py" \
    --project-root . \
    --run-id "iterate-2026-05-26-campaign-C-C2-external-routes-split" \
    --surface api
  ```

- **Evidence path:** pytest contract-sweep log + per-router vitest log + curl response captures (≥1 per endpoint) + `.shipwright/runs/iterate-2026-05-26-campaign-C-C2-external-routes-split/surface_verification.json`.
- **`tests_run` MUST be ≥ 30** (≥ 30 endpoint × 1 happy-path probe + per-router error-branch tests in vitest).

## Confidence Calibration (mandatory — HIGH RISK)

- **Boundaries touched:** HTTP request/response shape × 9 sub-routers × ~30 endpoints.

- **Empirical probes — to be run during finalization:**
  1. Pre-split API baseline snapshot at C2-start (committed `_c2_api_baseline.json`).
  2. Post-split contract sweep enumerating endpoints from the baseline JSON.
  3. Per-router vitest with mocked dependencies asserting status codes + response keys.
  4. Stateless transcript multi-tab probe (rule 4) — two parallel `?fromByte=0&expectFingerprint=<fp>` fetches return identical bytes.
  5. ELOCKED → 409 probe (rule 6) — mock `proper-lockfile` to throw `ELOCKED`; assert PATCH `/tasks/:id` returns 409 with `{error: "sdk-sessions.json is locked, retry"}`.
  6. Preview `shell:false` invariant probe (rule 9) — inject a `previewManager` that records the spawn options; assert `shell: false` is never overridden.
  7. Path-guard null-byte + realpath escape probe (rule 10) — `?path=foo%00bar` → reject; symlink target outside project root → reject.
  8. `.gitignore` directory-form negation regression (commit 5c7f539) — a `!/.shipwright/agent_docs/` rule re-includes the directory.
  9. Phase-task launch mismatch → 409 probe (rule 13) — `phaseTaskRef` whose `sessionUuid` mismatches the task's session → 409 `phase_task_session_uuid_mismatch`.

- **Edge cases NOT probed + why acceptable:** mid-flight race conditions (PATCH while DELETE) not probed — outside Campaign-C scope, would be a separate iterate.
- **Confidence-pattern check:** if "are you confident?"-yes-then-bug pattern fires after sweep returns green, run a 10th probe — a curl-driven smoke against the live `node dist/index.js` (NOT just the test fixture) before F11.

## External Review + Code Review (ADR-029)

- **Step 3.5 — External LLM Plan Review:** RUN (medium + HIGH RISK). Provider OpenRouter via `external_review.py --mode iterate`.
- **Step 3.7 — Code Review Cascade:** the runner has NO Agent tool, so the internal code-reviewer subagent is `delegated_to_orchestrator` / `skipped_no_agent_tool`. External LLM code-review at finalize is MANDATORY per memory `feedback_external_code_review_catches_high_bugs` — `external_review.py --mode code` over the diff before F6.

## Hard Constraints

- Bit-perfect API contract — no endpoint may drop, rename, restructure response keys, or change status codes.
- Stateless transcript (CLAUDE.md rule 4) preserved — no per-session byte-offset cache.
- Read-only run-config (CLAUDE.md rule 12) preserved — no POST/PATCH handler defined.
- All path-guard endpoints flow through `core/path-guard.ts` (rule 10).
- Each sub-router exports a Hono router instance; parent registers by mount path — NO inline handlers in the shell.
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.
- Test files >300 LOC grandfathered in Phase 0 are not touched unless they fall out of a split naturally (per cleanup-invariant).
- `routes.ts` shell, if kept, must re-export `clearInboxDeriveCache`, `FILE_MAX_BYTES`, `MIME_BY_EXTENSION`, `sanitizeContentDispositionFilename`, `ExternalRouteProjectView` — the 14 sibling test files import from `./routes.js`.

---

See [`.../sub-iterates/C2-external-routes-split.md`](./campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C2-external-routes-split.md) for the campaign-level spec
and [`_cleanup-invariant.md`](./campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_cleanup-invariant.md) for the cleanup-invariant block.
