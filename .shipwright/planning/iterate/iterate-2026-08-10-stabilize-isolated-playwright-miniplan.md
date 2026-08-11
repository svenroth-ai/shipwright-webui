# Mini-Plan: stabilize isolated Playwright suite failures

- **Run ID:** iterate-2026-08-10-stabilize-isolated-playwright

1. Add a Node-owned default E2E launcher that creates a temp home, compiles and
   starts Hono plus a production-client HTTP/WebSocket proxy on separate
   loopback ports, verifies the resolved registry path, and removes all
   processes and temporary files afterward.
2. Fail closed in the normal Playwright configuration unless the launcher’s
   isolation sentinel is present; keep the named quarantine project as the sole
   live-stack exception.
3. Add a post-run registry inspection for leaked unassigned fixture tasks and
   unit-test its path classifier.
4. Put the start-campaign fixture’s registered-project delete, post-delete
   assertion, and directory removal in nested `try/finally` blocks.
5. Run focused E2E, type checks, harness tests, then the full isolated suite.

## Alternative considered

Keep the existing external-stack recipe and ask each mutable spec to self-lock.
Rejected: many specs mutate through ordinary API helpers, so one omitted
self-lock recreates the same operator-registry leak. The launch boundary is
the single reliable enforcement point.
