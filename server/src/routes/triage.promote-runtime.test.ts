/*
 * triage.promote-runtime.test.ts — Codex Light §3.5's scoped promote
 * behavior: no per-task RuntimeToggle on this surface (PromoteModal.tsx has
 * no launch form) — promote reads the GLOBAL `settings.runtimeDefault`
 * directly, server-side, and stamps it on the created task.
 */
import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { appendLine, makeHarness, TRIAGE_HEADER, type Harness } from "./_triage-api-harness.js";
import { _clearCache_TEST_ONLY } from "../core/triage-store.js";

function seed(h: Harness, id: string): void {
  writeFileSync(h.triagePath, `${TRIAGE_HEADER}\n${appendLine(id)}\n`);
  _clearCache_TEST_ONLY();
}

function promoteBody(triageId: string) {
  return { triageId, priority: "P1", domain: "engineering", tags: [] };
}

describe("POST /api/triage/:projectId/promote — runtime default", () => {
  let h: Harness;

  afterEach(() => h?.cleanup());

  it("stamps runtime='codex' when settings.runtimeDefault is codex", async () => {
    h = await makeHarness({
      getCodexRuntimeDefault: async () => "codex",
      runTriageCli: async (input) => ({ kind: "ok", operation: input.operation, item: { id: input.itemId, status: "promoted" } }),
    });
    seed(h, "trg-aaaa0001");
    const response = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promoteBody("trg-aaaa0001")),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(h.store.get(body.task.taskId)!.runtime).toBe("codex");
  });

  it("defaults to 'claude' when getCodexRuntimeDefault is absent", async () => {
    h = await makeHarness({
      runTriageCli: async (input) => ({ kind: "ok", operation: input.operation, item: { id: input.itemId, status: "promoted" } }),
    });
    seed(h, "trg-aaaa0002");
    const response = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promoteBody("trg-aaaa0002")),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(h.store.get(body.task.taskId)!.runtime).toBe("claude");
  });

  it("defaults to 'claude' when getCodexRuntimeDefault resolves undefined", async () => {
    h = await makeHarness({
      getCodexRuntimeDefault: async () => undefined,
      runTriageCli: async (input) => ({ kind: "ok", operation: input.operation, item: { id: input.itemId, status: "promoted" } }),
    });
    seed(h, "trg-aaaa0003");
    const response = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promoteBody("trg-aaaa0003")),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(h.store.get(body.task.taskId)!.runtime).toBe("claude");
  });

  it("local PR-review preflight finding — a malformed persisted settings value (settings-reader.ts does no shape validation) normalizes to 'claude', not passed through raw", async () => {
    h = await makeHarness({
      // settings.json is unvalidated JSON — simulate a hand-edited/stale value.
      getCodexRuntimeDefault: async () => "banana" as unknown as "codex",
      runTriageCli: async (input) => ({ kind: "ok", operation: input.operation, item: { id: input.itemId, status: "promoted" } }),
    });
    seed(h, "trg-aaaa0004");
    const response = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promoteBody("trg-aaaa0004")),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(h.store.get(body.task.taskId)!.runtime).toBe("claude");
  });
});
