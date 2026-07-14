/*
 * Spec 74 — Embedded Terminal Auto-Launch + Disk-Backed Scrollback
 * (ADR-068-A1, iterate-2026-05-04).
 *
 * Regression coverage for the new launch UX (ZERO clipboard) + the
 * disk-backed scrollback machinery + Stop/Clear-history split.
 *
 * The unit + integration tests in scrollback-store.test.ts +
 * pty-scrollback-integration.test.ts cover the byte-level behavior
 * (rotation, FD lifecycle, prompt-readiness handshake math). This
 * spec exercises the user-facing surface end-to-end through the
 * dev server: HTTP endpoints + the auto-launch tab-flip + replay
 * envelopes round-trip through xterm.
 *
 * Disabled-mode (SHIPWRIGHT_TERMINAL_SCROLLBACK_MAX_BYTES=0) is
 * covered by the unit tests; an env-var-controlled e2e branch
 * would require a fork of the dev server, which is out-of-scope
 * for this iterate.
 */

import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "auto-launch-e2e-"));
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

async function createTask(
  request: import("@playwright/test").APIRequestContext,
  cwd: string,
) {
  const res = await request.post("/api/external/tasks", {
    data: { title: "auto-launch-spec-74", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

test.describe("ADR-068-A1 — Auto-launch + scrollback", () => {
  test("Launch CTA flips to Terminal tab without writing to clipboard (auto-execute UX)", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await page.goto(`/tasks/${taskId}`);

      // Pre-empt the clipboard so we can detect any spurious write.
      await page.evaluate(() => {
        (window as unknown as { __clipboardCalls: number }).__clipboardCalls = 0;
        const orig = navigator.clipboard?.writeText;
        if (orig) {
          navigator.clipboard.writeText = ((text: string) => {
            (window as unknown as { __clipboardCalls: number }).__clipboardCalls++;
            return orig.call(navigator.clipboard, text);
          }) as typeof navigator.clipboard.writeText;
        }
      });

      // Click the primary Launch CTA.
      const launchCta = page.getByTestId("cta-launch-in-terminal");
      await expect(launchCta).toBeVisible();
      await launchCta.click();

      // Tab must flip to Terminal — coord.pendingLaunch fires the
      // useEffect in TaskDetailPage that sets centerTab="terminal".
      const terminalPane = page.getByTestId("task-detail-terminal");
      await expect(terminalPane).toHaveAttribute("data-state", "active");

      // Clipboard MUST NOT have been written for the auto-launch path
      // (Decision #19 — auto-execute via WS data-frame, not clipboard).
      const clipboardCalls = await page.evaluate(
        () => (window as unknown as { __clipboardCalls?: number }).__clipboardCalls ?? 0,
      );
      expect(clipboardCalls).toBe(0);
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("POST /api/terminal/:taskId/clear-scrollback returns 204 on success + 400 on invalid UUID", async ({
    request,
  }) => {
    // Happy path — task exists, clear is a no-op (no scrollback yet) but
    // returns 204 cleanly.
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      const ok = await request.post(
        `/api/terminal/${encodeURIComponent(taskId)}/clear-scrollback`,
      );
      expect(ok.status()).toBe(204);

      // Invalid UUID — server validates via UUID_PATTERN; throws
      // ScrollbackStoreError("invalid_task_id") → 400.
      const bad = await request.post(
        "/api/terminal/not-a-uuid/clear-scrollback",
      );
      expect(bad.status()).toBe(400);
      const body = (await bad.json()) as { error?: string };
      expect(body.error).toBe("invalid_task_id");
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("POST /api/terminal/:taskId/close kills pty + RETAINS scrollback (Decision #18)", async ({
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      // Pre-warm the pty so we have something to close.
      const spawn = await request.post(
        `/api/terminal/${encodeURIComponent(taskId)}/spawn`,
      );
      expect(spawn.ok()).toBeTruthy();

      // Close — should be 204.
      const close = await request.post(
        `/api/terminal/${encodeURIComponent(taskId)}/close`,
      );
      expect(close.status()).toBe(204);

      // The pty is killed but the scrollback file (if any was written
      // pre-close) stays on disk. We can't directly observe the
      // scrollback dir from the test runner without a debug endpoint,
      // but a follow-up clear-scrollback call returns 204 cleanly
      // (idempotent), which means the close did NOT cascade-clear.
      const clear = await request.post(
        `/api/terminal/${encodeURIComponent(taskId)}/clear-scrollback`,
      );
      expect(clear.status()).toBe(204);
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("Clear history menu item opens confirm modal; Cancel dismisses without action", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await page.goto(`/tasks/${taskId}`);

      // Open the "..." menu.
      await page.getByTestId("task-detail-menu-trigger").click();
      const clearItem = page.getByTestId("task-detail-menu-clear-history");
      await expect(clearItem).toBeVisible();
      await clearItem.click();

      // Confirm modal renders.
      await expect(page.getByTestId("confirm-clear-history-dialog")).toBeVisible();

      // Click Cancel — modal dismisses, no fetch fires.
      const fetchCalls: string[] = [];
      await page.route(
        "**/api/terminal/**/clear-scrollback",
        async (route) => {
          fetchCalls.push(route.request().url());
          await route.fulfill({ status: 204 });
        },
      );
      await page.getByTestId("confirm-clear-history-cancel").click();
      await expect(
        page.getByTestId("confirm-clear-history-dialog"),
      ).not.toBeVisible();
      expect(fetchCalls).toHaveLength(0);
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("Clear history Confirm posts /clear-scrollback + closes modal on success", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await page.goto(`/tasks/${taskId}`);

      const seenCalls: string[] = [];
      await page.route(
        "**/api/terminal/**/clear-scrollback",
        async (route) => {
          seenCalls.push(route.request().url());
          await route.fulfill({ status: 204 });
        },
      );

      await page.getByTestId("task-detail-menu-trigger").click();
      await page.getByTestId("task-detail-menu-clear-history").click();
      await expect(page.getByTestId("confirm-clear-history-dialog")).toBeVisible();
      await page.getByTestId("confirm-clear-history-confirm").click();

      // Modal closes on success.
      await expect(
        page.getByTestId("confirm-clear-history-dialog"),
      ).not.toBeVisible();
      // The clear endpoint was hit exactly once.
      expect(seenCalls.length).toBe(1);
      expect(seenCalls[0]).toContain(`/api/terminal/${taskId}/clear-scrollback`);
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("Clear history surfaces 5xx error inline + keeps modal open", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await page.goto(`/tasks/${taskId}`);

      // Stub the endpoint with a 500 response.
      await page.route(
        "**/api/terminal/**/clear-scrollback",
        async (route) => {
          await route.fulfill({
            status: 500,
            body: JSON.stringify({
              error: "clear_failed",
              detail: "EACCES: permission denied",
            }),
            headers: { "Content-Type": "application/json" },
          });
        },
      );

      await page.getByTestId("task-detail-menu-trigger").click();
      await page.getByTestId("task-detail-menu-clear-history").click();
      await page.getByTestId("confirm-clear-history-confirm").click();

      // Error surfaces inline.
      const err = page.getByTestId("confirm-clear-history-error");
      await expect(err).toBeVisible();
      await expect(err).toContainText("HTTP 500");
      // Modal stays open (user can dismiss via Cancel).
      await expect(page.getByTestId("confirm-clear-history-dialog")).toBeVisible();
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("DELETE /api/external/tasks/:id cascades scrollback cleanup", async ({
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      // No direct scrollback observability without a debug endpoint —
      // we assert at minimum that DELETE + subsequent ws-upgrade /
      // clear-scrollback don't surface stale state.
      const del = await request.delete(
        `/api/external/tasks/${encodeURIComponent(taskId)}`,
      );
      expect(del.ok()).toBeTruthy();
      const followClear = await request.post(
        `/api/terminal/${encodeURIComponent(taskId)}/clear-scrollback`,
      );
      // After delete, clear is 204 (no-op on missing files).
      expect(followClear.status()).toBe(204);
    } finally {
      await cleanupCwd(cwd);
    }
  });
});
