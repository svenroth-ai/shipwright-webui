/*
 * Spec — inbox-phase-gate (iterate-2026-10-29-inbox-guided-phase-questions).
 *
 * A guided-mode phase paused at a human gate (`.shipwright/run_loop_state.json`
 * → `paused_human_gate`, `currentPhaseTaskId`) must be visible in the Inbox even
 * though no picker text is detectable. Seeds a real project dir with that
 * loop-state and a task bound to the paused phase task, then asserts the
 * "Awaiting your reply" card appears; flipping the loop back to `running`
 * must clear it.
 *
 * The fixture task has no projectId (lands in "Unassigned"); it is deleted in a
 * `finally` so the harness contamination guard stays quiet.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test.describe("Inbox phase gate", () => {
  // @covers FR-01.04
  test("shows a paused guided phase and clears it on resume", async ({ page, request }) => {
    const proj = mkdtempSync(path.join(tmpdir(), "inbox-phase-gate-"));
    mkdirSync(path.join(proj, ".shipwright"), { recursive: true });
    const loopFile = path.join(proj, ".shipwright", "run_loop_state.json");
    const phaseTaskId = "ptk-" + Date.now().toString(16);
    const setLoop = (status: string) =>
      writeFileSync(loopFile, JSON.stringify({ status, currentPhaseTaskId: phaseTaskId }));
    setLoop("paused_human_gate");

    const create = await request.post("/api/external/tasks", {
      data: { title: "inbox-phase-gate", cwd: proj, phaseTaskId },
    });
    const { task } = (await create.json()) as { task: { taskId: string } };
    const itemKey = `pg-${task.taskId}`;

    try {
      await page.goto("/inbox");
      await expect(page.getByTestId("inbox-page")).toBeVisible();
      const card = page.getByTestId(`inbox-card-${itemKey}`);
      await expect(card).toBeVisible({ timeout: 25_000 });
      await expect(card).toContainText("Awaiting your reply");
      await expect(page.getByTestId(`inbox-question-text-${itemKey}`)).toContainText(
        /waits for your answer/i,
      );

      setLoop("running");
      await page.reload();
      await expect(page.getByTestId("inbox-page")).toBeVisible();
      await expect(page.getByTestId(`inbox-card-${itemKey}`)).toHaveCount(0, {
        timeout: 25_000,
      });
    } finally {
      await request.delete(`/api/external/tasks/${task.taskId}`);
      rmSync(proj, { recursive: true, force: true });
    }
  });
});
