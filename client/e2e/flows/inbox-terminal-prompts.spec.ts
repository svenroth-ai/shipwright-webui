/*
 * Spec — inbox-terminal-prompts (iterate-2026-05-18).
 *
 * Phase 1 (AC1): clicking an Inbox card lands on TaskDetail with the
 * embedded terminal focused — the cursor sits in the type area, ready to
 * answer, with NO extra click. This is the browser-only behavior that
 * cannot be unit-tested for real (the unit suite mocks xterm).
 *
 * Seeds a task + a plain-text-question JSONL (the simplest Inbox card to
 * materialize on a fresh stack). The Phase-2 `terminal_prompt` server +
 * detector chain is covered by the executed server integration suite
 * (routes.test.ts — 5 terminal_prompt cases) + the real @xterm/headless
 * mirror test (headless-mirror.visible-text.test.ts).
 *
 * Requires the real stack — seeds via the API + a JSONL on disk, exactly
 * like spec 33 / inbox-awaiting-user.
 */

import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

test.describe("Inbox → Terminal focus (iterate-2026-05-18-inbox-terminal-prompts)", () => {
  test("clicking an Inbox card lands on TaskDetail with the terminal focused (AC1)", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const questionUuid = `e2e-itp-${stamp}`;

    // cwd must be a real directory — the terminal WS upgrade rejects an
    // unresolvable cwd (`task_cwd_unresolvable`) and never spawns the pty,
    // so the terminal would never reach `ready` and never focus.
    const create = await request.post("/api/external/tasks", {
      data: { title: "inbox-terminal-prompts-focus", cwd: homedir() },
    });
    const { task } = (await create.json()) as {
      task: { taskId: string; sessionUuid: string };
    };

    const encodedDir = path.join(PROJECTS_DIR, `e2e-inbox-itp-${stamp}`);
    mkdirSync(encodedDir, { recursive: true });
    writeFileSync(
      path.join(encodedDir, `${task.sessionUuid}.jsonl`),
      JSON.stringify({
        type: "assistant",
        uuid: questionUuid,
        sessionId: task.sessionUuid,
        message: {
          content: [
            { type: "text", text: "Approach A or approach B — which would you like?" },
          ],
        },
      }) + "\n",
      "utf-8",
    );

    // Load the app shell at "/" then navigate to the Inbox in-app — a
    // direct `goto("/inbox")` only works behind a dev server with an SPA
    // fallback; the prod server serves static files only.
    await page.goto("/");
    await page.getByRole("link", { name: /^inbox/i }).first().click();
    await expect(page.getByTestId("inbox-page")).toBeVisible();

    const card = page.getByTestId(`inbox-card-${questionUuid}`);
    await expect(card).toBeVisible({ timeout: 25_000 });

    await card.click();

    // Landed on TaskDetail…
    await expect(page.getByTestId("task-detail-page")).toBeVisible({
      timeout: 15_000,
    });
    // …with the Terminal tab active (the focusTerminal nav-state forces it)…
    await expect(page.getByTestId("task-detail-terminal")).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 15_000 },
    );
    // …and the xterm helper textarea (xterm's keyboard sink) focused — the
    // cursor is in the terminal, no extra click needed (AC1).
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused({
      timeout: 20_000,
    });
  });
});
