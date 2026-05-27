/*
 * server/src/external/__tests__/api-contract-probes.ts
 *
 * Probe table consumed by `api-contract-sweep.test.ts`. Lives in its own
 * module so the test file stays under the 300-LOC project guideline; the
 * table's 22+ entries dominate file length and rarely change in lockstep
 * with the assertion harness.
 *
 * Adding a new endpoint: also update
 * `server/src/external/__tests__/api-contract-baseline.json` so the
 * meta-tests in the consumer suite stay green (every baseline id has a
 * probe; every probe id resolves to a baseline entry).
 */

/** Path-segment sentinels for the 404-by-design probes. */
export const NONEXISTENT_TASK = "task-does-not-exist-123";
export const NONEXISTENT_PROJECT = "project-does-not-exist-123";
export const NONEXISTENT_TOOL_USE = "tool-use-does-not-exist-123";
/**
 * Path-segment sentinel for the 400-by-design probes that need a project
 * to EXIST so they can reach a post-existence validator (e.g.
 * `projects.file` reaches `path_required` only after the project lookup
 * succeeds). The consumer suite wires `getProjectById` to return a
 * synthetic project record for this id and undefined otherwise.
 */
export const EXISTENT_PROJECT = "test-project-existent";

export interface Probe {
  /** Which `baseline.endpoints[].id` this probe covers. */
  baselineId: string;
  /** Human-readable description appears in vitest output. */
  describe: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Fully-substituted concrete URL (no `:id` placeholders). */
  path: string;
  /** JSON-stringified into request body if present; sets Content-Type. */
  body?: unknown;
  /** Exact status code expected. NOT an allowed-set; one number. */
  expectStatus: number;
  /**
   * When set, asserts `body.error === expectErrorCode` for JSON responses.
   * Used for load-bearing error invariants (CLAUDE.md rules 4, 6, 9, 10, 12, 13).
   */
  expectErrorCode?: string;
  /**
   * When set, asserts `body.status === expectStatusField` for the
   * discriminated-union endpoints (transcript, run-config).
   */
  expectStatusField?: string;
  /**
   * When set, asserts every key is present in the response JSON body
   * (subset check via `toHaveProperty`). Skipped for non-JSON responses.
   */
  expectKeys?: readonly string[];
}

/**
 * Per-endpoint deterministic request shape + EXACT expected status. Multiple
 * entries may share one `baselineId` (e.g. `tasks.patch` probes both 404 and
 * 400 paths via separate seed-needed `it(...)` in the consumer suite).
 *
 * Order matches the baseline file for diff-friendliness.
 */
export const PROBE_TABLE: Probe[] = [
  // ------------------------------- tasks ---------------------------------
  {
    baselineId: "tasks.create",
    describe: "POST /tasks empty body → 200 (title/cwd default)",
    method: "POST",
    path: "/api/external/tasks",
    body: {},
    expectStatus: 200,
    expectKeys: ["task"],
  },
  {
    baselineId: "tasks.list",
    describe: "GET /tasks empty store → 200 {tasks: []}",
    method: "GET",
    path: "/api/external/tasks",
    expectStatus: 200,
    expectKeys: ["tasks"],
  },
  {
    baselineId: "tasks.get",
    describe: "GET /tasks/:id nonexistent → 404 Task not found",
    method: "GET",
    path: `/api/external/tasks/${NONEXISTENT_TASK}`,
    expectStatus: 404,
    expectErrorCode: "Task not found",
  },
  {
    baselineId: "tasks.launch",
    describe: "POST /tasks/:id/launch nonexistent → 404 Task not found",
    method: "POST",
    path: `/api/external/tasks/${NONEXISTENT_TASK}/launch`,
    body: {},
    expectStatus: 404,
    expectErrorCode: "Task not found",
  },
  {
    baselineId: "tasks.patch",
    describe: "PATCH /tasks/:id nonexistent → 404 Task not found",
    method: "PATCH",
    path: `/api/external/tasks/${NONEXISTENT_TASK}`,
    body: { title: "new" },
    expectStatus: 404,
    expectErrorCode: "Task not found",
  },
  // tasks.patch 400 at_least_one_field_required is exercised in a
  // dedicated test in the consumer suite (needs a seeded task to pass
  // the 404 gate).
  {
    baselineId: "tasks.fork",
    describe: "POST /tasks/:id/fork nonexistent parent → 404 Parent task not found",
    method: "POST",
    path: `/api/external/tasks/${NONEXISTENT_TASK}/fork`,
    body: {},
    expectStatus: 404,
    expectErrorCode: "Parent task not found",
  },
  {
    baselineId: "tasks.transcript",
    describe: "GET /tasks/:id/transcript nonexistent task → 404 Task not found (existence gate)",
    method: "GET",
    path: `/api/external/tasks/${NONEXISTENT_TASK}/transcript`,
    expectStatus: 404,
    expectErrorCode: "Task not found",
  },
  // tasks.transcript {status:"missing"} variant + multi-tab stateless
  // invariant exercised in dedicated tests in the consumer suite.
  // ------------------------------- inbox ---------------------------------
  {
    baselineId: "inbox.list",
    describe: "GET /inbox empty store → 200 {items: []}",
    method: "GET",
    path: "/api/external/inbox",
    expectStatus: 200,
    expectKeys: ["items"],
  },
  {
    baselineId: "inbox.dismiss",
    describe: "POST /inbox/:toolUseId/dismiss unknown toolUseId → 404",
    method: "POST",
    path: `/api/external/inbox/${NONEXISTENT_TOOL_USE}/dismiss`,
    body: {},
    expectStatus: 404,
    expectErrorCode: "toolUseId not found in any pending set",
  },
  // ------------------------- tasks lifecycle -----------------------------
  {
    baselineId: "tasks.close",
    describe: "POST /tasks/:id/close nonexistent → 404 Task not found",
    method: "POST",
    path: `/api/external/tasks/${NONEXISTENT_TASK}/close`,
    body: {},
    expectStatus: 404,
    expectErrorCode: "Task not found",
  },
  {
    baselineId: "tasks.backlog",
    describe: "POST /tasks/:id/backlog nonexistent → 404 Task not found",
    method: "POST",
    path: `/api/external/tasks/${NONEXISTENT_TASK}/backlog`,
    body: {},
    expectStatus: 404,
    expectErrorCode: "Task not found",
  },
  {
    baselineId: "tasks.delete",
    describe: "DELETE /tasks/:id nonexistent → 404 Task not found",
    method: "DELETE",
    path: `/api/external/tasks/${NONEXISTENT_TASK}`,
    expectStatus: 404,
    expectErrorCode: "Task not found",
  },
  // ----------------------------- projects --------------------------------
  {
    baselineId: "projects.actions",
    describe: "GET /projects/:id/actions nonexistent project → 404",
    method: "GET",
    path: `/api/external/projects/${NONEXISTENT_PROJECT}/actions`,
    expectStatus: 404,
    expectErrorCode: "project_not_found",
  },
  {
    baselineId: "projects.preview",
    describe: "POST /projects/:id/preview nonexistent project → 404",
    method: "POST",
    path: `/api/external/projects/${NONEXISTENT_PROJECT}/preview`,
    body: {},
    expectStatus: 404,
    expectErrorCode: "project_not_found",
  },
  {
    baselineId: "projects.run_config",
    describe: "GET /projects/:id/run-config nonexistent project → 404",
    method: "GET",
    path: `/api/external/projects/${NONEXISTENT_PROJECT}/run-config`,
    expectStatus: 404,
    expectErrorCode: "project_not_found",
  },
  {
    baselineId: "projects.tree",
    describe: "GET /projects/:id/tree nonexistent project → 404",
    method: "GET",
    path: `/api/external/projects/${NONEXISTENT_PROJECT}/tree`,
    expectStatus: 404,
    expectErrorCode: "project_not_found",
  },
  // projects.file is probed TWICE per spec: with-path + nonexistent
  // project → 404 project_not_found, then missing ?path + EXISTENT
  // project → 400 path_required. The handler checks project existence
  // FIRST (file/routes.ts:42-46), so the 400 branch is only reachable
  // when the project resolves.
  {
    baselineId: "projects.file",
    describe: "GET /projects/:id/file with ?path + nonexistent project → 404",
    method: "GET",
    path: `/api/external/projects/${NONEXISTENT_PROJECT}/file?path=README.md`,
    expectStatus: 404,
    expectErrorCode: "project_not_found",
  },
  {
    baselineId: "projects.file",
    describe: "GET /projects/:id/file existent project + missing ?path → 400 path_required",
    method: "GET",
    path: `/api/external/projects/${EXISTENT_PROJECT}/file`,
    expectStatus: 400,
    expectErrorCode: "path_required",
  },
  // ----------------- actions stub + upload (under /api/projects) ---------
  {
    baselineId: "projects.actions_stub",
    describe: "POST /api/projects/:id/actions-stub nonexistent project → 404",
    method: "POST",
    path: `/api/projects/${NONEXISTENT_PROJECT}/actions-stub`,
    body: {},
    expectStatus: 404,
    expectErrorCode: "project_not_found",
  },
  {
    baselineId: "projects.actions_upload",
    describe: "POST /api/projects/:id/actions-upload nonexistent project → 404",
    method: "POST",
    path: `/api/projects/${NONEXISTENT_PROJECT}/actions-upload`,
    body: {},
    expectStatus: 404,
    expectErrorCode: "project_not_found",
  },
  {
    baselineId: "projects.actions_upload_delete",
    describe: "DELETE /api/projects/:id/actions-upload nonexistent project → 404",
    method: "DELETE",
    path: `/api/projects/${NONEXISTENT_PROJECT}/actions-upload`,
    expectStatus: 404,
    expectErrorCode: "project_not_found",
  },
  // ---------------- run-config no-mutation pseudo-endpoint ---------------
  // The four POST/PATCH/PUT/DELETE probes live in a dedicated `it(...)` in
  // the consumer suite; this PROBE_TABLE entry is a sentinel so the
  // meta-test passes. Any single non-GET probe here would be misleading —
  // the rule is "no method other than GET is registered", not "DELETE
  // returns 404".
  {
    baselineId: "run_config.no_mutation",
    describe: "(covered by dedicated multi-method test in consumer suite)",
    method: "POST",
    path: `/api/external/projects/${NONEXISTENT_PROJECT}/run-config`,
    expectStatus: 404,
  },
  // -------------- transcript multi-tab stateless pseudo-endpoint ---------
  // Sentinel for the meta-test; the actual invariant lives in a dedicated
  // `it(...)` in the consumer suite (needs a seeded task).
  {
    baselineId: "transcript.multi_tab_stateless",
    describe: "(covered by dedicated parallel-fetch test in consumer suite)",
    method: "GET",
    path: `/api/external/tasks/${NONEXISTENT_TASK}/transcript`,
    expectStatus: 404,
  },
];
