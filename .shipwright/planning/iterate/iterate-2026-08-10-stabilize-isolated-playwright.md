# Iterate Spec: stabilize isolated Playwright suite failures

- **Run ID:** iterate-2026-08-10-stabilize-isolated-playwright
- **Triage:** `trg-4dc1dae2`
- **Type:** bug
- **Complexity:** medium
- **Status:** verified

## Goal

Make the mutable Playwright suite run only against a disposable registry and
repair the campaign fixture so it leaves no project, task, or directory behind.
This is E2E-harness work only; application runtime behavior is out of scope.

## Root Cause Investigation

1. **Observed failure:** 53 isolated-suite scenarios failed while terminal,
   clipboard, transcript, media, and fixture flows were exercised. Live
   inspection also found test-owned projects and 125 unassigned fixture tasks
   in the operator registry.
2. **Reproduction:** setting `BASE_URL` makes `client/playwright.config.ts`
   skip its managed web server. The ordinary Playwright command then sends
   mutating fixture requests to that external stack without requiring
   `SHIPWRIGHT_E2E_ISOLATED=1` or a temporary home.
3. **Recent change:** the A00 harness added the isolated CI shell recipe but
   preserved the older external-`BASE_URL` bypass for normal local runs.
4. **Root cause:** the configuration boundary trusted an arbitrary external
   URL as equivalent to the isolated-stack contract, so the server inherited
   the real `USERPROFILE`/`HOME` and used the operator's persistent registry.

## Acceptance Criteria

- [x] **AC1 — default isolation:** `npm run test:e2e` creates a temporary
  `USERPROFILE`/`HOME`, sets `SHIPWRIGHT_E2E_ISOLATED=1`, starts Hono plus a
  production-client HTTP/WebSocket proxy on dedicated loopback ports, and
  points Playwright only at that client port.
- [x] **AC2 — fail closed:** invoking normal projects without the isolated
  sentinel fails before collection; an externally supplied `BASE_URL` cannot
  make mutable specs attach to an operator stack.
- [x] **AC3 — registry safety:** the harness resolves the registry under the
  OS temp directory before tests and fails if it escapes that location.
- [x] **AC4 — contamination guard:** after Playwright completes, the harness
  rejects any remaining `projectId=unassigned` task whose cwd is under the OS
  temporary directory or in a WebUI worktree.
- [x] **AC5 — campaign teardown:** both campaign fixtures retain their project
  ids and, in `finally`, delete them through `DELETE /api/projects/:id`, assert
  they no longer appear in `GET /api/projects`, then recursively remove their
  temporary directories even after an assertion failure.
- [x] **AC6 — live exception:** real-device/Tailscale probes remain a named
  quarantine command and use their existing task/project teardown instead of
  joining the default suite.

## Spec Impact

- **Classification:** none
- **Reason:** test launch and fixture lifecycle are corrected; the shipped
  Command Center runtime behavior and its requirements do not change.

## Out of Scope

- Production server/client runtime changes.
- Rewriting existing application registries or triage data.
- Turning real-device/Tailscale probes into isolated simulations.

## Verification (medium+)

- **Surface:** web
- **Runner:** `npm run test:e2e` from `client/`, plus the focused campaign
  fixture regression and the harness guard's Node tests.
- **Evidence:** `.shipwright/planning/iterate/iterate-2026-08-10-stabilize-isolated-playwright/`

## Confidence Calibration

| Behavior | Disposition | Evidence |
|---|---|---|
| Disposable registry is used | verified | normal isolated E2E: 412 passed, 8 skipped |
| External mutable stack is rejected | verified | fail-closed config + harness child-env unit test |
| Campaign project is deleted after success/failure | verified | focused campaign E2Es + owner-path teardown assertions |
| Fixture task contamination fails closed | verified | harness node tests: 3/3 passed |
