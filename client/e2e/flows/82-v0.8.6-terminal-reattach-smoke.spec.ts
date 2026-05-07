/*
 * Spec 82 — v0.8.6 terminal reattach + card-cleanup smoke
 * (iterate-2026-05-08-v0-8-6-terminal-reattach-and-card-cleanup).
 *
 * Investigation-led empirical regression for ACs that surfaced after
 * v0.8.5 manual UAT:
 *
 *   - AC-2: navigating Task → Board → Task does NOT accumulate
 *           Claude-banner copies in the rendered xterm. The user-visible
 *           contract is "what I see after coming back === what I saw
 *           when I left". v0.8.5 AC-3 added a defensive `term.clear()`
 *           on `replay_start`; the regression report says count gets
 *           WORSE after the v0.8.5 ship. This spec measures
 *           empirically and is intended to FAIL pre-fix to prove the
 *           bug, then turn green after the targeted fix in this iterate.
 *
 *   - AC-3: navigating Task → Board → Task does NOT leave the user
 *           reading a `embedded-terminal-readonly` banner ("Read-only
 *           — another tab is the active writer for this task."). The
 *           historical fix was the `writer-promoted` envelope; the
 *           regression suggests the old conn-token isn't released
 *           synchronously on TaskDetailPage unmount, so the new
 *           attach gets reader role. Same fixture as AC-2.
 *
 *   - AC-4: TaskCard on TaskBoard does NOT render a Terminal CTA.
 *           v0.8.5 AC-6 removed it from TaskDetailHeader; this iterate
 *           catches the missed surface. Click on the card body is the
 *           navigation affordance.
 *
 * Each test is authored to FAIL against the pre-fix stack and to PASS
 * after the matching Stage-1/2/3 fix lands.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// The current user's local projects.json is the source of truth here —
// the older specs hardcoded a different uuid for the same project name
// and worked only because they navigated directly to /tasks/{id}
// (board filter never queried). For AC-4 we need the card on the
// board, so the projectId must match a real project in the user's
// local registry.
const SHIPWRIGHT_WEBUI_PROJECT_ID = "eab3bd8d-d89a-4b8c-aaaa-60a5ff856407";

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "v086-spec82-"));
}

async function cleanupCwd(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function createAndLaunch(
  request: APIRequestContext,
  cwd: string,
  title: string,
): Promise<string> {
  // Pass `projectId` so the task lands in the same bucket the
  // TaskBoard filters on (localStorage["webui.activeProjectId"]).
  // Otherwise the task ends up in the synthesized "unassigned" bucket
  // and the AC-4 board-navigation case never finds the card.
  const created = await request.post("/api/external/tasks", {
    data: {
      title,
      cwd,
      actionId: "new-plain",
      projectId: SHIPWRIGHT_WEBUI_PROJECT_ID,
    },
  });
  if (!created.ok()) {
    throw new Error(`create: HTTP ${created.status()} — ${await created.text()}`);
  }
  const cBody = (await created.json()) as { task: { taskId: string } };
  const taskId = cBody.task.taskId;
  const launched = await request.post(
    `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
    { data: { actionId: "new-plain" } },
  );
  if (!launched.ok()) {
    throw new Error(`launch: HTTP ${launched.status()} — ${await launched.text()}`);
  }
  return taskId;
}

async function deleteTask(
  request: APIRequestContext,
  taskId: string,
): Promise<void> {
  try {
    await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`);
  } catch {
    /* best-effort */
  }
}

test.describe("Spec 82 — v0.8.6 terminal reattach + card cleanup", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      try {
        localStorage.setItem("webui.activeProjectId", id);
        // Pin the center-tab to "terminal" so navigation lands on the
        // dark canvas without an extra click. The default already is
        // "terminal" but a stale localStorage from a previous test
        // could be on "transcript".
        localStorage.setItem(
          "webui:embedded-terminal-default-tab",
          '"terminal"',
        );
      } catch {
        /* noop */
      }
    }, SHIPWRIGHT_WEBUI_PROJECT_ID);
  });

  test("AC-2: terminal full-buffer (incl. scrollback) does not accumulate across Task → Board → Task navigation", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createAndLaunch(request, cwd, "ac2-noaccumulate");
    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      // First-visit grace: pty emits prompt + (optional) replay.
      await page.waitForTimeout(2_000);

      // Emit a deterministic banner-shaped payload via keystrokes so
      // the test does NOT depend on Claude actually being launched in
      // the pty (new-plain stays on a bare shell prompt). 20 unique
      // BANNER lines + a marker — enough volume that scrollback
      // accumulation is detectable in the buffer-line count even with
      // some natural prompt-redraw drift.
      // PowerShell on Windows is the default shell; on POSIX the same
      // for-loop syntax works in bash via `seq`. For cross-shell
      // compatibility, use a simple `echo` chain instead.
      await page.getByTestId("embedded-terminal-canvas").click();
      const bannerCmd = Array.from(
        { length: 20 },
        (_, i) => `echo BANNER_LINE_${String(i).padStart(2, "0")}`,
      ).join("; ");
      await page.keyboard.type(bannerCmd);
      await page.keyboard.press("Enter");
      // Allow the pty to echo the command + emit all 20 lines + redraw
      // the prompt afterwards.
      await page.waitForTimeout(2_500);

      // Capture FULL xterm buffer (visible viewport AND scrollback) via
      // the test-only window.__embeddedTerminal handle. `.xterm-rows`
      // on its own would only show the visible viewport — which masks
      // scrollback accumulation, the user-visible bug we're chasing.
      const captureBufferStats = async (): Promise<{
        lineCount: number;
        outputLineCount: number;
      }> => {
        return page.evaluate(() => {
          const term = (
            window as unknown as {
              __embeddedTerminal?: {
                buffer: {
                  active: {
                    length: number;
                    getLine(i: number): { translateToString(): string } | undefined;
                  };
                };
              } | null;
            }
          ).__embeddedTerminal;
          if (!term) return { lineCount: -1, outputLineCount: -1 };
          const lineCount = term.buffer.active.length;
          // Count standalone output lines that match exactly
          // `BANNER_LINE_NN` (no shell prompt prefix). The user typed
          // ONE long `echo X; echo Y; ...` command which produces 20
          // such standalone output lines — one per echo. These do NOT
          // appear in the typed command echo (the command has them as
          // substrings of `echo BANNER_LINE_NN` not as standalone
          // lines), and PowerShell's READLINE repaint of the input
          // line never produces standalone-`BANNER_LINE_NN` content
          // either.
          //
          // So a SINGLE typed-and-executed run gives exactly 20 of
          // these. A replay of the same disk content gives 20 again.
          // Accumulation across N visits would give N×20.
          let outputLineCount = 0;
          const exact = /^BANNER_LINE_\d{2}$/;
          for (let i = 0; i < lineCount; i++) {
            const line = term.buffer.active.getLine(i);
            if (!line) continue;
            const text = line.translateToString().trim();
            if (exact.test(text)) outputLineCount += 1;
          }
          return { lineCount, outputLineCount };
        });
      };

      const initial = await captureBufferStats();
      // Sanity: must have emitted exactly 20 standalone `BANNER_LINE_NN`
      // output lines (one per echo in the typed command). Less than that
      // means the keystroke fixture didn't run all 20.
      expect(initial.outputLineCount).toBe(20);

      // Round-trip 1: Task → Board → Task
      await page.goto(`/`);
      await page.waitForTimeout(1_000);
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      await page.waitForTimeout(2_500);
      const afterTrip1 = await captureBufferStats();

      // Round-trip 2 (more pressure)
      await page.goto(`/`);
      await page.waitForTimeout(500);
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      await page.waitForTimeout(2_500);
      const afterTrip2 = await captureBufferStats();

      // Idempotency contract: there should be EXACTLY 20 standalone
      // `BANNER_LINE_NN` output lines after each revisit — same as
      // the initial. The disk scrollback contains ONE run; one replay
      // paints it once into a fresh xterm. Accumulation would push
      // the count to 40, 60, …
      expect(afterTrip1.outputLineCount).toBe(20);
      expect(afterTrip2.outputLineCount).toBe(20);
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("AC-3: read-only banner is NOT shown after Task → Board → Task navigation", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createAndLaunch(request, cwd, "ac3-no-readonly");
    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      // First visit — banner must not be there.
      await expect(
        page.getByTestId("embedded-terminal-readonly"),
      ).toHaveCount(0);

      // Leave + return.
      await page.goto(`/`);
      await page.waitForTimeout(1_500);
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });

      // The read-only banner shows when `socket.role === "reader"`.
      // After single-tab navigation the user MUST stay writer; banner
      // must not be present.
      await expect(
        page.getByTestId("embedded-terminal-readonly"),
      ).toHaveCount(0);

      // Also verify the data-role attribute reflects writer.
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-role", "writer", { timeout: 5_000 });
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("AC-4: TaskCard on TaskBoard has NO Terminal CTA on awaiting/active states", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createAndLaunch(request, cwd, "ac4-no-card-cta");
    try {
      // Navigate to TaskBoard. The created task should appear as a
      // card in awaiting_external_start (the initial state right
      // after launch). The card testid carries the taskId suffix
      // (`task-card-${taskId}`); look it up directly so we don't
      // depend on TaskBoard rendering the title in any specific spot.
      await page.goto(`/`);
      const card = page.getByTestId(`task-card-${taskId}`);
      await expect(card).toBeVisible({ timeout: 15_000 });

      // The Terminal CTA on TaskCard wraps a TerminalLaunchButton in a
      // span with `data-testid={`task-card-terminal-${taskId}`}`. Its
      // absence is the AC-4 contract — the card body itself remains
      // the click target for "open the task detail page".
      await expect(
        page.getByTestId(`task-card-terminal-${taskId}`),
      ).toHaveCount(0);
      // Defensive: also assert that no button inside the card carries
      // the v0.8.3-style "Terminal" label. The TerminalLaunchButton
      // renders the `label` prop verbatim.
      await expect(
        card.locator('button', { hasText: /^Terminal$/ }),
      ).toHaveCount(0);
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
