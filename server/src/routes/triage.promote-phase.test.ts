/*
 * triage.promote-phase.test.ts — iterate-2026-09-19-codex-launch-phase-empty.
 * The promote handler never set `phase` on the created task, so a
 * Codex-runtime task promoted from triage got no SKILL.md pointer line in
 * its launch prompt (buildCodexPrompt gates that line on `phase`) outside a
 * project with an iterate-covering AGENTS.md. Promoted tasks are always
 * iterate work (PROMOTED_TASK_ACTION_ID is hardcoded to "new-iterate"), so
 * `phase` is stamped unconditionally, the same way `actionId` already is.
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

describe("POST /api/triage/:projectId/promote — phase stamping", () => {
  let h: Harness;

  afterEach(() => h?.cleanup());

  it("stamps phase='iterate' on the created task", async () => {
    h = await makeHarness({
      runTriageCli: async (input) => ({ kind: "ok", operation: input.operation, item: { id: input.itemId, status: "promoted" } }),
    });
    seed(h, "trg-bbbb0001");
    const response = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promoteBody("trg-bbbb0001")),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(h.store.get(body.task.taskId)!.phase).toBe("iterate");
  });
});
