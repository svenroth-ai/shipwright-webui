# Sub-Iterate C2 — external/routes.ts split (HIGH RISK, LAST IN CHAIN)

- **Campaign:** 2026-05-25-bloat-cleanup-C-webui
- **Source plan row:** §6.2 C2
- **Risk:** **HOCH** — zentrale API-Surface. Every client.api.* call path must resolve to the same handler logic post-split. SQLite-lock, JSONL interleave, replay-snapshot, multi-writer state files all flow through these routes.
- **Complexity:** medium (9 sub-routers + 1 registration shell + test-file natural split)
- **Surface:** `api` (curl probes against running server)
- **Branch base:** C5's branch (stacked) — LAST sub-iterate
- **Type:** refactor (change with classification = none)

## Goal

Split `server/src/external/routes.ts` (2879 LOC) into 9 sub-routers grouped by concern, plus a registration shell:

| Sub-router | File | Owns endpoints |
|---|---|---|
| tasks | `server/src/external/tasks/routes.ts` | `GET /api/external/tasks`, `POST /api/external/tasks`, `GET /api/external/tasks/:id`, `PATCH /api/external/tasks/:id`, `DELETE /api/external/tasks/:id` |
| launch | `server/src/external/launch/routes.ts` | `POST /api/external/tasks/:id/launch`, `POST /api/external/tasks/:id/relaunch` |
| transcript | `server/src/external/transcript/routes.ts` | `GET /api/external/tasks/:id/transcript` (stateless byte-offset) |
| inbox | `server/src/external/inbox/routes.ts` | `GET /api/external/inbox`, `POST /api/external/inbox/:id/resolve` |
| actions | `server/src/external/actions/routes.ts` | `GET /api/external/projects/:id/actions` |
| preview | `server/src/external/preview/routes.ts` | preview dev-server spawn/kill endpoints (ADR-044, `shell:false` enforced) |
| file | `server/src/external/file/routes.ts` | file read/write under realpath path-guard (CLAUDE.md rule 10) |
| tree | `server/src/external/tree/routes.ts` | tree listing under realpath path-guard + `.gitignore` directory-form negation (commit 5c7f539) |
| run-config | `server/src/external/run-config/routes.ts` | read-only run-config endpoints (CLAUDE.md rule 12) |
| registration | `server/src/external/index.ts` (or `routes.ts` shell, ≤150 LOC) | `app.route("/tasks", tasksRouter); app.route("/inbox", inboxRouter); ...` mount-and-bind only |

`server/src/external/routes.test.ts` (775 LOC, Phase-0 grandfathered) naturally splits into per-router test files — that LOC reduction is a deliberate side effect, not a goal in itself (per user prompt hard constraint).

## Acceptance Criteria

- [ ] (E) Each of 9 sub-router files exists at the paths above, each exports a Hono `OpenAPIHono` (or `Hono`) instance, each ≤300 LOC.
- [ ] (E) `server/src/external/index.ts` or shell file exists, ≤150 LOC, ONLY does mount registration (no inline handlers).
- [ ] (E) Old `server/src/external/routes.ts` is either:
  - (b) DELETED (replaced by directory of sub-modules + registration shell) — baseline entry REMOVED per cleanup-invariant (b); OR
  - (a) Reduced to ≤300 LOC if it must remain as the entry point — baseline entry REMOVED per cleanup-invariant (a).
- [ ] (E) `shipwright_bloat_baseline.json` entry for `server/src/external/routes.ts` REMOVED.
- [ ] (E) Per-router test files exist under their sub-router directory — `server/src/external/{tasks,launch,...}/__tests__/routes.test.ts`, each ≤300 LOC. Old `routes.test.ts` shrinks naturally (per user prompt) — if any remnant >300 LOC, it must split further or be removed.
- [ ] (E) RED→GREEN per-router vitest:
  - Each sub-router test file written before its router moves; tests assert exact endpoint matching (method + path + status + response keys) AND error paths (400/404/409/500 codes).
  - The mandatory tests (per CLAUDE.md):
    - `tasks/__tests__/routes.test.ts`: PATCH ELOCKED → 409 (rule 6); GET reads canonical schema v3 (rule 15)
    - `launch/__tests__/routes.test.ts`: `phaseTaskRef` mismatch → 409 (rule 13); `phaseTaskRef + actionId` → 400 mixed_launch_intents (rule 13)
    - `transcript/__tests__/routes.test.ts`: stateless byte-offset (rule 4) — server NEVER writes a per-session cache; concurrent multi-tab fetches return identical bytes for same `fromByte+expectFingerprint`
    - `inbox/__tests__/routes.test.ts`: pagination + filter contract
    - `actions/__tests__/routes.test.ts`: response key contract (read by `useActions()` client hook)
    - `preview/__tests__/routes.test.ts`: `shell:false` invariant (rule 9 ADR-044); unsupported command rejected
    - `file/__tests__/routes.test.ts`: null-byte input → hard-reject (rule 10); realpath escape → reject
    - `tree/__tests__/routes.test.ts`: `.gitignore` directory-form negation honored (regression guard for commit 5c7f539)
    - `run-config/__tests__/routes.test.ts`: read-only — POST/PATCH return 405; reader resolves through `core/run-config-reader.ts` (rule 12)
- [ ] (E) **Bit-perfect API contract** — for every existing `client.api.<concern>.<endpoint>` call path that resolves today, the same payload + same status code is returned post-split. Verified by an automated contract sweep:
  - Server boots on `PORT=3848 SHIPWRIGHT_NETWORK_PROFILE=local USERPROFILE=<temp>` (memory `feedback_iterate_e2e_isolated_userprofile`).
  - A pytest probe enumerates `client/src/api/` for `.<endpoint>.` call paths AND hits each one with a synthetic-but-shape-valid payload via real curl, asserting exit-status + key set in response JSON match pre-split snapshot.
  - **Pre-split snapshot** captured from origin/main at C2-start time, committed to `.shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_c2_api_baseline.json`.
- [ ] (E) Bloat-check PR-comment ✅ no anti-ratchet AND zero advisory crossings.
- [ ] (E) `cmd /c npm.cmd --prefix server run typecheck && cmd /c npm.cmd --prefix server run lint` both green.

## Spec Impact

- **Classification:** none
- **NONE justification:** Internal refactor; API contract bit-perfect by acceptance criterion.

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| Each sub-router | `client/src/api/<concern>.ts` | HTTP request + response JSON |

`touches_io_boundary` = NO (per canonical risk taxonomy — JSON HTTP is not on the IO_BOUNDARY_FILE_PATTERNS list), but contract preservation is the highest-risk concern of this iterate. Mandatory contract-sweep above.

## Verification (F0.5)

- **Surface:** `api`
- **Runner commands:**
  ```bash
  # 1. Boot isolated server
  PORT=3848 SHIPWRIGHT_NETWORK_PROFILE=local USERPROFILE=/tmp/c2-test \
    cmd /c npm.cmd --prefix server run dev &
  # wait for ready
  # 2. Contract sweep
  uv run --with openai pytest .shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_c2_contract_sweep.py -v
  # 3. Per-router vitest
  cd server && SHIPWRIGHT_NETWORK_PROFILE=local cmd /c node_modules\.bin\vitest.cmd run src/external
  # 4. Typecheck + lint
  cmd /c npm.cmd --prefix server run typecheck
  cmd /c npm.cmd --prefix server run lint
  ```
- **Evidence path:** pytest contract-sweep log + vitest log + curl probe response captures (≥1 per endpoint) + surface_verification.json.
- **`tests_run` MUST be ≥ 30** (9 sub-routers × ≥3 cases each + contract sweep + multi-tab transcript test).

## Confidence Calibration (mandatory — HIGH RISK)

- **Boundaries touched:** HTTP request/response shape × 9 sub-routers × N endpoints. Roughly 30+ endpoints total.
- **Empirical probes run:**
  1. Pre-split API baseline snapshot at C2-start (committed JSON file)
  2. Post-split contract sweep enumerating client.api.* call paths
  3. Per-router vitest with mocked dependencies asserting status codes + response keys
  4. Stateless transcript multi-tab probe (rule 4)
  5. ELOCKED → 409 probe (rule 6)
  6. Preview `shell:false` invariant probe (rule 9)
  7. Path-guard null-byte + realpath escape probe (rule 10)
  8. `.gitignore` directory-form negation regression (commit 5c7f539)
  9. Phase-task launch mismatch → 409 probe (rule 13)
- **Edge cases NOT probed + why acceptable:** mid-flight race conditions (PATCH while DELETE) not probed — outside Campaign-C scope, would be a separate iterate.
- **Confidence-pattern check:** if "are you confident?"-yes-then-bug pattern fires, run one more probe before F11.

## External Review + Code Review (ADR-029)

- Step 3.5: **RUN** (medium + HIGH RISK).
- Step 3.7: **RUN** via orchestrator-spawned code-reviewer.
- **Additional:** External-LLM code-review mode at finalize per memory `feedback_external_code_review_catches_high_bugs`.

## Hard constraints

- Bit-perfect API contract — no endpoint may drop, rename, or restructure response keys mid-split. Verified via contract sweep.
- Stateless transcript (CLAUDE.md rule 4) preserved.
- Read-only run-config (CLAUDE.md rule 12) preserved — POST/PATCH must remain 405.
- All path-guard endpoints flow through `core/path-guard.ts` (CLAUDE.md rule 10 ADR-044).
- Each sub-router exports a Hono `OpenAPIHono` instance; parent registers by mount path — no inline handlers in the shell.
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.
- Test files >300 LOC grandfathered: `routes.test.ts` 775 → per-router files naturally; if any remnant exceeds 300 LOC it must split further.

---

See [`_cleanup-invariant.md`](./_cleanup-invariant.md) for the cleanup-invariant block.
