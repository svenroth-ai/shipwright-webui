# Mini-Plan: commit-c2-contract-sweep

## Files to add

1. `server/src/external/__tests__/api-contract-baseline.json`
   - Verbatim copy of `.shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_c2_api_baseline.json`.
   - Co-located with its consumer; future updates are atomic with the test.

2. `server/src/external/__tests__/api-contract-sweep.test.ts`
   - Self-contained — duplicates the small `inMemoryDeps()` helper from
     `routes.test.ts` rather than extracting a shared module (keep blast
     radius minimal; extraction = separate iterate if it pays off later).
   - Imports the baseline JSON via `import baseline from "./api-contract-baseline.json" with { type: "json" }`.
   - One `describe("api contract sweep — C2 baseline")` block + one
     `it.each(baseline.endpoints)` per endpoint (gives per-endpoint
     vitest output naming → fast triage when one fails).
   - Two additional `it(...)` blocks for the two pseudo-entries that aren't
     normal routes:
     - `run_config.no_mutation` — assert POST/PATCH/PUT/DELETE return 404
       (Hono default; no handler for those methods).
     - `transcript.multi_tab_stateless` — two parallel `app.request()` calls
       same `fromByte`+`expectFingerprint`, assert identical responses.

## Files to modify

None. CI already runs `npm test -- --run` in `server/` (`.github/workflows/ci.yml`),
and vitest's `include: ["**/*.test.ts"]` auto-picks the new file.

## Test strategy (RED → GREEN)

1. **RED phase:**
   - First implementation: a minimal sweep that just iterates `baseline.endpoints`
     and calls `app.request(method, path)`. Most calls will fail validation or hit
     "not found" branches — that's fine; the assertion is "status is in the
     documented allowed-set".
   - Run the suite against current `server/src/external/**/routes.ts` post-C2-merge.
   - Expect: all 22 endpoints reachable (no Hono default-404 except for the
     explicitly-asserted `run_config.no_mutation` case).

2. **GREEN phase:**
   - Suite passes against current `routes.ts` topology.

3. **Regression-guard validation (Confidence Calibration probe #2):**
   - Temporarily comment out `app.route("/", tasksRouter)` (or equivalent) in
     `server/src/external/routes.ts`.
   - Run the suite — must turn RED with clear per-endpoint failure messages.
   - Re-instate the mount. Re-run — back to GREEN.
   - Document the experiment in the iterate ADR rationale, then revert.

## Assertion shape (per endpoint)

Pseudocode:

```ts
it.each(baseline.endpoints)("$id — $method $path", async (ep) => {
  // 1. Resolve allowed-status set: success.status + every error_branches[].status
  const allowedStatuses = new Set<number>();
  if (ep.success?.status) allowedStatuses.add(ep.success.status);
  if (ep.success?.variants) ep.success.variants.forEach(v => allowedStatuses.add(ep.success.status));
  ep.error_branches?.forEach(b => allowedStatuses.add(b.status));

  // 2. Build shape-valid synthetic payload (empty body for GET/DELETE;
  //    "{}" for POST/PATCH — enough to reach validation, not pass it)
  const init: RequestInit = { method: ep.method };
  if (ep.method === "POST" || ep.method === "PATCH") {
    init.body = "{}";
    init.headers = { "Content-Type": "application/json" };
  }

  // 3. Substitute :id / :projectId / :toolUseId / :path placeholders
  //    with deterministic-but-nonexistent IDs (so we hit 404 not 400)
  const resolvedPath = ep.path
    .replace(/:id\b/g, "task-does-not-exist")
    .replace(/:projectId\b/g, "project-does-not-exist")
    .replace(/:toolUseId\b/g, "tool-use-does-not-exist");

  const res = await app.request(resolvedPath, init);

  // 4. Status must be in allowed set
  expect(allowedStatuses.has(res.status)).toBe(true);

  // 5. If success path (status 200) and the baseline documents `keys`:
  //    assert documented keys are a subset of response keys.
  if (res.status === 200 && ep.success?.keys && res.headers.get("content-type")?.includes("json")) {
    const body = await res.json();
    for (const k of ep.success.keys) expect(body).toHaveProperty(k);
  }
});
```

## Edge cases the sweep deliberately does NOT cover

- Variant-shaped success responses (transcript's discriminated union on
  `status`, run-config's 4-variant on `status`) — the per-variant key set
  is asserted only when the synthetic payload happens to land on that
  variant. The sweep is a **surface** test, not a **shape exhaustiveness**
  test. Existing per-router suites cover variants in depth.
- Raw-bytes endpoints (`projects.file`) — the baseline records header names
  rather than JSON keys; the sweep skips the JSON-key check and only
  asserts status when the response is raw bytes.
- Path-prefix mounting bugs that route the right method to the right path
  but bind it to the wrong handler — out of scope; would require comparing
  handler identity, which is opaque in Hono.

## Order of operations

1. Copy baseline JSON → `server/src/external/__tests__/api-contract-baseline.json`
2. Write `api-contract-sweep.test.ts` (start with reachability + status-set
   assertions only; add success-key assertions in a second pass once those
   are GREEN — fail-fast triage)
3. Run vitest — expect GREEN
4. Regression probe: comment out one `app.route(...)`, re-run — expect RED
   with clear failure for every endpoint that router owned
5. Revert the probe, confirm GREEN
6. Self-review + Confidence Calibration
7. External code review
8. F0 / F0.5 / F1-F12

## Alternative considered

- **Pytest under `shared/` driven by curl + booted server** — matches the
  ad-hoc sweep exactly. **Rejected:** needs port allocation + USERPROFILE
  isolation in CI, slower, more flaky, two test runners to maintain.
  Vitest in-memory is hermetic and uses the same harness pattern already
  established in `routes.test.ts`.

- **Extract `inMemoryDeps()` into a shared `_test-harness.ts`** —
  **Deferred:** the duplication is ~15 LOC and the existing helper is
  already in `routes.test.ts`. Extracting now ratchets coupling between
  the sweep and the legacy 775-LOC routes.test.ts. If a third or fourth
  consumer materializes, extract then.
