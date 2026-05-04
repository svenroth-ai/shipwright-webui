/*
 * Spec 35 — Regression guard: the architecture rejects any in-webui chat
 * panel. Scanning a fresh task detail must NOT produce any
 * `[data-testid^="chat-"]` or message-input textbox. If someone
 * re-introduces an inline chat UI inadvertently, this spec fails on PR.
 *
 * ADR-067 (2026-05-03) carve-out: the embedded terminal pane mounts an
 * xterm.js Terminal whose accessibility helper renders a hidden
 * `.xterm-helper-textarea` (used for IME composition and keyboard
 * forwarding into the pty). That element is NOT a chat composer — it
 * has no submit button, no message bubble, no react-state binding to
 * Claude. The selector below excludes it explicitly so the
 * no-chat-composer fence still fires on every OTHER textarea (which
 * would be a real composer regression). The carve-out is named, bounded,
 * and reviewed; do NOT broaden it.
 */

import { test, expect } from "@playwright/test";

test.describe("No chat panel (architecture guard)", () => {
  test("task detail has no chat-* testids and no message textbox", async ({ page, request }) => {
    const create = await request.post("/api/external/tasks", {
      data: { title: "no-chat-guard", cwd: "C:/tmp/no-chat" },
    });
    const { task } = (await create.json()) as { task: { taskId: string } };

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();

    // No chat-*-prefixed testids anywhere.
    const chatNodes = page.locator('[data-testid^="chat-"]');
    await expect(chatNodes).toHaveCount(0);

    // No `<input role="textbox">` or `<textarea>` used for sending messages.
    // ADR-067 carve-out: xterm's accessibility helper textarea is excluded
    // (see header comment).
    const textareas = page.locator("textarea:not(.xterm-helper-textarea)");
    await expect(textareas).toHaveCount(0);
  });
});
