/*
 * Spec — inbox-lead-question-discuss-terminal (iterate-2026-09-08).
 *
 * "Discuss in terminal" (PO decision 2026-09-07 — no ping-pong): clicking it
 * on a `lead_question` inbox card prewarms the task's pty via the existing
 * `POST /api/terminal/:taskId/spawn` and lands on TaskDetail with a real,
 * working embedded terminal — the part that cannot be proven by the
 * mocked-fetch unit test (`InboxCard.LeadQuestion.test.tsx`), which only
 * proves the client made the right call, not that the real spawn → WS
 * upgrade pipeline actually produces a live pty.
 *
 * Seeds a task whose `description` carries leadwright's
 * `<!-- lead-question:TYPE -->` marker (`_lead.ts`'s `appendLeadQuestions`
 * derives the card straight from that field — no JSONL needed, unlike
 * `ask_tool`/`terminal_prompt`).
 *
 * The fixture task carries no `projectId`, so it lands in the "Unassigned"
 * bucket — the isolated-stack harness's contamination guard hard-fails the
 * whole run if such a task is still on disk when the suite exits, so this
 * spec deletes its own fixture task in a `finally` regardless of outcome.
 */

import { test, expect } from "@playwright/test";
import { homedir } from "node:os";

test.describe("Inbox lead-question → Discuss in terminal", () => {
  test("opens a working terminal session for the card's task via the existing spawn route", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const create = await request.post("/api/external/tasks", {
      data: {
        title: "inbox-lead-question-discuss-terminal",
        // cwd must be real — the WS upgrade rejects an unresolvable cwd
        // (`task_cwd_unresolvable`) and never spawns the pty.
        cwd: homedir(),
        description: `<!-- lead-question:decision -->\nApproach A or approach B for e2e ${stamp}?`,
      },
    });
    const { task } = (await create.json()) as { task: { taskId: string } };
    const itemKey = `lq-${task.taskId}`;

    try {
      await page.goto("/inbox");
      await expect(page.getByTestId("inbox-page")).toBeVisible();

      const card = page.getByTestId(`inbox-card-${itemKey}`);
      await expect(card).toBeVisible({ timeout: 25_000 });

      // The caveat is on the card's own surface, not a tooltip.
      await expect(page.getByTestId(`inbox-lead-terminal-caveat-${itemKey}`)).toContainText(
        /isn't the lead/i,
      );

      const [spawnResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/terminal/${task.taskId}/spawn`) &&
            res.request().method() === "POST",
        ),
        page.getByTestId(`inbox-lead-discuss-terminal-${itemKey}`).click(),
      ]);
      expect(spawnResponse.ok()).toBe(true);

      // Landed on TaskDetail (no round-trip through the answer form)…
      await expect(page.getByTestId("task-detail-page")).toBeVisible({ timeout: 15_000 });
      // …with a real, connected terminal — the WS upgrade is the
      // authoritative pty creation path, so this is the actual "working
      // terminal session" from AC(a), not just the prewarm response above.
      await expect(page.locator(".xterm-helper-textarea")).toBeVisible({ timeout: 20_000 });
    } finally {
      // This fixture task has no projectId (lands in "Unassigned"); the
      // isolated-stack harness's contamination guard fails the whole run
      // if it is still on disk when the suite exits.
      await request.delete(`/api/external/tasks/${task.taskId}`);
    }
  });
});
