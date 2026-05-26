# Mini-plan — Campaign C / C2 — external/routes.ts split

- **Run-ID:** `iterate-2026-05-26-campaign-C-C2-external-routes-split`
- **Branch:** `iterate/campaign-C-C2-external-routes-split`
- **Type:** refactor — Spec-Impact `none`
- **Complexity:** medium — HIGH RISK (central API surface, ~30 endpoints)

## File map — what moves, what stays

### NEW files (each ≤ 300 LOC)

| Path | Owns | Estimated LOC |
|---|---|---|
| `server/src/external/_shared/helpers.ts` | `withLiveSession`, `withLiveJsonlMtime`, `validatePhaseForProject`, `parseIntSafe`, `validateProjectIdOrError`, `normalizeDescription`, `normalizeStringArray`, `readLeadCreateFields`, `ExternalRouteProjectView` interface, `ACTIVE_IDLE_THRESHOLD_MS`, `IDLE_REACTIVATE_THRESHOLD_MS`, `TITLE_MAX_LENGTH`, `DESCRIPTION_MAX_LENGTH` | ~240 |
| `server/src/external/_shared/phase-task-helpers.ts` | `resolvePhaseTaskCreateFields`, type `PhaseTaskCreateFields` | ~90 |
| `server/src/external/_shared/inbox-cache.ts` | `inboxDeriveCache`, `inboxNegativeCache`, `clearInboxDeriveCache`, `NEGATIVE_RESULT_TTL_MS`, type `InboxDeriveCacheEntry` | ~70 |
| `server/src/external/_shared/createDeps.ts` | shared `CreateRouterArgs` interface (every sub-router takes the same deps so the shell injects once) | ~80 |
| `server/src/external/tasks/routes.ts` | `POST /tasks`, `GET /tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`, `POST /tasks/:id/fork`, `POST /tasks/:id/close`, `POST /tasks/:id/backlog`, `DELETE /tasks/:id` | ~290 |
| `server/src/external/launch/routes.ts` | `POST /tasks/:id/launch` (the meatiest single endpoint — ~470 LOC in original; extract sub-helpers below) | ~290 |
| `server/src/external/launch/_helpers.ts` | `applyPhaseTaskBranch`, `applyActionSubstitutionBranch`, `applyLegacyFallbackBranch`, `parseLaunchBody` | ~290 |
| `server/src/external/transcript/routes.ts` | `GET /tasks/:id/transcript` | ~140 |
| `server/src/external/inbox/routes.ts` | `GET /inbox`, `POST /inbox/:toolUseId/dismiss` | ~290 |
| `server/src/external/inbox/_helpers.ts` | cold-path derive + terminal-prompt post-pass extraction | ~140 |
| `server/src/external/actions/routes.ts` | `GET /projects/:projectId/actions`, `POST /api/projects/:id/actions-stub`, `POST /api/projects/:id/actions-upload`, `DELETE /api/projects/:id/actions-upload` | ~290 |
| `server/src/external/actions/_helpers.ts` | `dryRunTemplate`, `ACTIONS_UPLOAD_MAX_BYTES`, the `actionsPref` resolver | ~70 |
| `server/src/external/preview/routes.ts` | `POST /projects/:projectId/preview` | ~110 |
| `server/src/external/file/routes.ts` | `GET /projects/:projectId/file` + `FILE_MAX_BYTES`, `MIME_BY_EXTENSION`, `sanitizeContentDispositionFilename` (or import from `_shared/file-helpers.ts`) | ~290 |
| `server/src/external/file/_helpers.ts` | `MIME_BY_EXTENSION`, `FILE_MAX_BYTES`, `sanitizeContentDispositionFilename` (so file/routes.ts stays under cap) | ~120 |
| `server/src/external/tree/routes.ts` | `GET /projects/:projectId/tree` | ~150 |
| `server/src/external/run-config/routes.ts` | `GET /projects/:projectId/run-config` | ~60 |

### Registration shell

| Path | Notes |
|---|---|
| `server/src/external/routes.ts` (kept, shrunk) | Re-exports `clearInboxDeriveCache`, `FILE_MAX_BYTES`, `MIME_BY_EXTENSION`, `sanitizeContentDispositionFilename`, `ExternalRouteProjectView` (16 sibling test files import from `./routes.js`). Defines `createExternalRoutes(args)` which constructs `app = new Hono()`, instantiates the 9 sub-routers with the shared deps, and `app.route("/", subRouter)` each. ≤ 150 LOC. |

**Strategy decision — cleanup-invariant (a):** keep the original `routes.ts` path
as the shell (≤ 150 LOC) rather than delete + recreate as `index.ts`. Rationale:
14 sibling test files (`routes.backlog.test.ts`, `routes.delete-cascade.test.ts`,
…) already import from `./routes.js` — deleting the file would force a
mechanical rename of every import statement, which is mechanical churn the
spec explicitly de-prioritises (test files >300 LOC grandfathered in Phase 0
are not touched unless natural). Shell with re-exports satisfies
cleanup-invariant (a): "the original file path still exists post-split AND is
now ≤ its limit → REMOVE the entry from the entries list." Baseline entry
gets dropped.

### NEW test files (each ≤ 300 LOC)

| Path | Mandatory cases |
|---|---|
| `server/src/external/tasks/__tests__/routes.test.ts` | PATCH ELOCKED→409 (rule 6); GET reads canonical schema v3 (rule 15); create + list + get + delete happy path; PATCH error matrix (`field_not_editable`, `invalid_priority`, `invalid_phase`, `invalid_complexity_hint`). |
| `server/src/external/launch/__tests__/routes.test.ts` | `phaseTaskRef` mismatch→409 (rule 13); `phaseTaskRef + actionId`→400 `mixed_launch_intents`; `done`-state→409 `launch_invalid_state`; `claimToken`→409 `task_claimed`; legacy fallback path (no actionId, no project). |
| `server/src/external/transcript/__tests__/routes.test.ts` | Stateless byte-offset multi-tab probe (rule 4); `status: "missing"` + `task.state` transitions (`active`→`jsonl_missing`); `status: "rotated"`; `active`→`idle` decay. |
| `server/src/external/inbox/__tests__/routes.test.ts` | `ask_tool` precedence over `text_question`; `terminal_prompt` post-pass (AC3 + AC7); dismiss-then-GET round-trip; negative-cache TTL. |
| `server/src/external/actions/__tests__/routes.test.ts` | response key contract `{actions, phases, defaults, preview, diagnostics, fromUser}`; schema validation errors echoed in `errors[]`; `invalid_placeholder` 400. |
| `server/src/external/preview/__tests__/routes.test.ts` | `shell: false` invariant via captured spawn opts in injected previewManager; `preview_unavailable` 501; structured error codes 400/500. |
| `server/src/external/file/__tests__/routes.test.ts` | null-byte input → hard-reject 400 `path_traversal`; realpath escape via symlink → 400; oversize → 413; unknown extension → 415. |
| `server/src/external/tree/__tests__/routes.test.ts` | `.gitignore` directory-form negation honored (commit 5c7f539 regression); traversal → 400; ENOTDIR → 400. |
| `server/src/external/run-config/__tests__/routes.test.ts` | Status discriminated union `ok` / `missing` / `v1_legacy` / `invalid`; POST/PATCH return server's not-matched default (404 — Hono default behavior); `project_not_found` 404; `project_path_unavailable` 400. |

### DELETED (or naturally consumed)
- `server/src/external/routes.test.ts` (843 LOC, Phase-0 grandfathered) — describes migrate to the per-router test files. Final file deleted from the tree.

## Test strategy — RED-first per slice

Sequence — one sub-router at a time:

1. **Author the per-router test file FIRST** — assert the contract from the
   committed `_c2_api_baseline.json` for that endpoint set. Use `Hono` directly
   in-process via `createXxxRouter({...deps...})` + `app.request(...)` rather
   than booting a server (matches existing `routes.test.ts` style).
2. **Run the per-router test — expect RED** (no implementation yet).
3. **Move handlers from `routes.ts` to the sub-router** — verbatim, preserving
   every comment + branch.
4. **Re-run per-router test — expect GREEN**.
5. **Re-run the full server vitest** (`SHIPWRIGHT_NETWORK_PROFILE=local
   cmd /c node_modules\.bin\vitest.cmd run`) — every existing sibling test
   file (the 14 listed above) MUST stay green. The shell's re-exports
   keep their imports valid.
6. Stop. Move to the next sub-router.

**Order of slices** (low-risk first, so the shell builds confidence before the
two highest-blast-radius slices land):
1. `run-config` (smallest — 1 endpoint, read-only)
2. `preview` (1 endpoint, well-isolated)
3. `actions` (4 endpoints, includes the `/api/projects/...` non-external paths)
4. `tree` (1 endpoint, contained gitignore logic)
5. `file` (1 endpoint, contained file-helpers; extract MIME table to `_helpers.ts` first)
6. `inbox` (2 endpoints, complex but contained)
7. `transcript` (1 endpoint, contained state machine)
8. `tasks` (8 endpoints, schema-heavy — extract `validateProjectIdOrError` first to `_shared`)
9. `launch` (1 endpoint, 470 LOC of branches — extract `_helpers.ts` first; HIGHEST RISK)
10. **Shrink `routes.ts` to shell** + verify all 16 sibling test files still pass.
11. **Drop baseline entry** + run full vitest one more time + run typecheck + lint.

## Contract-sweep design — `_c2_contract_sweep.py`

Pytest harness driven by the committed `_c2_api_baseline.json`. For each entry:

```python
@pytest.mark.parametrize("endpoint", load_baseline())
def test_endpoint_contract(endpoint, live_server):
    """For every endpoint in the baseline, hit it and assert:
       - HTTP method matches
       - status code matches (happy or documented error)
       - response top-level key set matches
       - response error code (if any) matches
    """
    resp = live_server.request(
        endpoint["method"],
        endpoint["path"].replace(":id", "test-task-id"),
        json=endpoint.get("body"),
    )
    assert resp.status_code == endpoint["expected_status"]
    body = resp.json()
    assert set(body.keys()) >= set(endpoint["expected_keys"])
```

Fixture `live_server` boots `node dist/index.js` with
`PORT=3848 SHIPWRIGHT_NETWORK_PROFILE=local USERPROFILE=<temp>` (project
memory `feedback_iterate_e2e_isolated_userprofile` — temp `USERPROFILE` so
the real `~/.shipwright-webui/sdk-sessions.json` is untouched).

Test count target: ≥ 30 (one per endpoint × happy or canonical error path).

## Sequence — TDD slice loop

```
For each slice in [run-config, preview, actions, tree, file, inbox, transcript, tasks, launch]:
  1. Author server/src/external/<slice>/__tests__/routes.test.ts
  2. Author server/src/external/<slice>/routes.ts (NEW handler module — empty
     `createXxxRouter` that just `new Hono()`s an empty app — to give the
     test something to import).
  3. Run `cd server && SHIPWRIGHT_NETWORK_PROFILE=local cmd /c node_modules\.bin\vitest.cmd run src/external/<slice>` — expect RED.
  4. Move the relevant handlers from routes.ts into the new routes.ts; delete the moved code from the original routes.ts.
  5. Update routes.ts (or `_shared/createDeps.ts`) so the parent
     `createExternalRoutes` mounts the new sub-router via `app.route("/", createXxxRouter(args))`.
  6. Re-run the slice's vitest — expect GREEN.
  7. Run full server vitest — expect ALL GREEN (sibling test files still pass via the shell's re-exports).
  8. STOP. Move to next slice.

After all 9 slices:
  10. Shrink routes.ts to ≤ 150 LOC: only re-exports + createExternalRoutes shell + the back-compat re-exports for the 14 sibling tests.
  11. Run full server vitest one more time — expect GREEN.
  12. Run client typecheck + vitest — expect GREEN (client interacts via wire only, contract unchanged).
  13. Drop baseline entry → run pre-commit hook → expect GREEN.
```

## Risks & mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| `app.route("/", sub)` mount loses the `/api/external/` prefix because handlers use absolute paths | LOW (handlers are absolute) | Test step 7 every slice catches it immediately. |
| Inbox cache shared state breaks when split across files | MEDIUM | Extract `_shared/inbox-cache.ts` FIRST; export both maps + the clear helper; both shell and inbox-router import the SAME module instance. |
| Launch route 470 LOC of branches can't fit ≤ 300 LOC | HIGH | Extract `launch/_helpers.ts` with `applyPhaseTaskBranch`, `applyActionSubstitutionBranch`, `applyLegacyFallbackBranch`, `parseLaunchBody` BEFORE the move. |
| 14 sibling `routes.*.test.ts` files break on the move | MEDIUM | Shell re-exports `createExternalRoutes` + helpers. The siblings already pass `args` directly; the shell stays signature-stable. |
| Bit-perfect contract drifts on a status code | HIGH (spec invariant) | RED-first per-router test + post-split contract sweep against running server. |
| `proper-lockfile` ELOCKED branch in PATCH `/tasks/:id` only catches under contention; tested via mocking the store's persist | MEDIUM | Mock `store.persist` to throw `Object.assign(new Error("..."), { code: "ELOCKED" })`. |

## External Review checkpoints

- **Step 3.5 — External Plan Review:** RUN before any code change. Provider OpenRouter via `external_review.py --mode iterate`. Address every HIGH finding before Build.
- **Step 3.7 — Code Review Cascade:** runner has no Agent tool → `delegated_to_orchestrator` for the internal subagent. External LLM code review at finalize is mandatory.

## Finalization steps (F0 - F11)

After all 9 slices land + baseline drop:

- **F0:** Fresh-verify all 4 lanes (server typecheck, server lint, server vitest, client typecheck, client vitest).
- **F0.5:** boot isolated server + run `_c2_contract_sweep.py` + `surface_verification.py`.
- **F1:** drift check.
- **F2:** architecture impact = `component` (directory restructure of `server/src/external/`).
- **F3:** decision drop — title "external/routes.ts split into 9 sub-routers + registration shell".
- **F3a:** reflection.
- **F4:** changelog drop under `## Changed`.
- **F5:** test results JSON.
- **F5b:** `finalize_iterate.py` with `--event-extras-json '{"intent":"change","description":"...","spec_impact":"none","spec_impact_justification":"Internal refactor; API contract bit-perfect by acceptance criterion.","change_type":"tooling","none_reason":"internal refactor: routes split, behavior + API contract preserved","affected_frs":[],"new_frs":[],"tests":{"passed":N,"total":N,"e2e_run":false}}'`.
- **F6:** commit `refactor(server): split external/routes.ts into 9 sub-routers + registration shell`.
- **F6.5:** attach commit SHA.
- **F7b:** `commit_event_followup.py`.
- **F11:** push + `gh pr create --base main` with `Run-ID: iterate-2026-05-26-campaign-C-C2-external-routes-split` in body + bloat-check workflow PR-comment quoted.
