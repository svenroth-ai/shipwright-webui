/*
 * A19 (FR-01.63) — the honest terminal fallback, end to end.
 *
 * DECIDED BY SVEN, 2026-07-14: when Claude stops mid-run to ask, the Inbox SHOWS
 * the question and offers a "jump to the terminal" navigation. The operator types
 * the reply THEMSELVES in the task's embedded terminal. The WebUI writes NOTHING.
 *
 * This proves both halves as a real browser flow (not a unit mock):
 *   AC2 — clicking the CTA lands on Files & Terminal, Terminal segment active,
 *         terminal focused (the next keystroke goes into the live session).
 *   AC1 — the Inbox navigation adds ZERO outbound `data` frames to the pty: the
 *         WS capture records no data-frame caused by the navigation (only the
 *         operator's own later keystrokes would — and this flow types none).
 *
 * Seeds via the API + a JSONL on disk (same pattern as spec 33 / inbox-terminal-
 * prompts). No hardcoded host:port, no operator UUIDs (helpers/env + fixtures).
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { attachWsCapture, outboundDataFrames } from "../helpers/ws-capture";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

test.describe("Inbox → terminal fallback (A19, FR-01.63)", () => {
  let project: SeededProject;
  let taskId: string;
  let seededJsonlDir: string | undefined;

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
    // Remove the JSONL we seeded so no stale Claude-session dir lingers.
    if (seededJsonlDir) {
      try {
        rmSync(seededJsonlDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  test("the CTA navigates to the focused terminal and writes NOTHING to the pty", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const toolUseId = `e2e-a19-${stamp}`;

    project = await seedProject(request, { name: "a19-fallback", adopted: true });
    await setActiveProject(page, project.projectId);
    // A real, resolvable cwd — the terminal WS upgrade rejects an unresolvable
    // cwd (`task_cwd_unresolvable`) and never spawns the pty, so it would never
    // reach `ready` / focus.
    const task = await seedTask(request, {
      title: "Add password reset flow",
      projectId: project.projectId,
      cwd: homedir(),
    });
    taskId = task.taskId;

    // Seed a pending AskUserQuestion (with options) so the ask_tool card + its
    // "Answer in the terminal" CTA materialize on /inbox.
    const encodedDir = path.join(PROJECTS_DIR, `e2e-a19-${stamp}`);
    seededJsonlDir = encodedDir;
    mkdirSync(encodedDir, { recursive: true });
    writeFileSync(
      path.join(encodedDir, `${task.sessionUuid}.jsonl`),
      JSON.stringify({
        type: "assistant",
        sessionId: task.sessionUuid,
        message: {
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "Reset link expiry — 1 hour or 24 hours?",
                    header: "Priority",
                    options: [{ label: "1 hour" }, { label: "24 hours" }],
                  },
                ],
              },
            },
          ],
        },
      }) + "\n",
      "utf-8",
    );

    const cap = attachWsCapture(page);

    // Prod server serves static files only (no SPA fallback for a deep goto),
    // so load "/" then navigate in-app.
    await page.goto("/");
    await page.getByRole("link", { name: /^inbox/i }).first().click();
    await expect(page.getByTestId("inbox-page")).toBeVisible();

    const cta = page.getByTestId(`inbox-resume-${toolUseId}`);
    await expect(cta).toBeVisible({ timeout: 25_000 });
    // The CTA says what it does — it navigates, it does not "answer" for you.
    await expect(cta).toContainText(/answer in the terminal/i);

    const clickAt = Date.now();
    await cta.click();

    // Landed on TaskDetail…
    await expect(page.getByTestId("task-detail-page")).toBeVisible({ timeout: 15_000 });
    // …Files & Terminal tab, Terminal segment active…
    await expect(page.getByTestId("task-detail-terminal")).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 15_000 },
    );

    // Wait for the WS to be READY before asserting focus (StrictMode aborts the
    // first embedded-terminal WS; the terminal reports readiness via the attr).
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 25_000 });

    // …and the xterm keyboard sink is focused — the next keystroke goes into the
    // live session, typed by the operator (AC2).
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused({ timeout: 20_000 });

    // Let any (buggy) frame land before counting, THEN assert the fence: the
    // Inbox navigation caused ZERO outbound `data` frames to the pty (AC1). Only
    // the operator's own keystrokes would — and this flow types none.
    await page.waitForTimeout(1_500);
    const dataFrames = outboundDataFrames(cap, taskId, clickAt);
    expect(
      dataFrames.map((f) => f.payload),
      "the Inbox terminal-fallback navigation must write NOTHING to the pty (A19 fence)",
    ).toEqual([]);
  });
});
