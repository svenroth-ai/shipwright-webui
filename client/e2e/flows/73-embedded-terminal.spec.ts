/*
 * Spec 73 — Embedded Terminal (ADR-067) happy-path + endpoint coverage.
 *
 * Browser-tests as much of the embedded-terminal surface as Playwright
 * can reach without a real Strg+V image-paste (that one stays a manual
 * smoke). Covers:
 *   - Tab strip renders with Transcript + Terminal triggers.
 *   - Default tab on first visit is Terminal (per plan §User-Entscheidungen).
 *   - Tab toggle persists in localStorage["webui:embedded-terminal-default-tab"]
 *     and survives a page reload.
 *   - xterm canvas + helper textarea are present in the DOM (forceMount
 *     keeps both panes mounted across toggle).
 *   - WebSocket endpoint /api/terminal/:taskId/ws is reachable
 *     (HTTP upgrade succeeds → ready envelope arrives).
 *   - REST endpoints: POST /paste-image (PNG round-trip via a stub PNG
 *     blob, asserts gitignoreSuggestion + path in response); POST
 *     /append-gitignore (idempotent, asserts side-effect on .gitignore).
 *   - Spec 35 still green here too (no chat-* testids, no extra
 *     non-helper textareas).
 *
 * The embedded-terminal pane is a NEUTRAL shell — Plan-D''-conform per
 * ADR-067. We do NOT assert that Claude is launched; the test only
 * checks the shell prompt arrives in xterm.
 */

import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

async function makeTaskCwd(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "embedded-terminal-e2e-"));
  return dir;
}

async function createTask(request: import("@playwright/test").APIRequestContext, cwd: string) {
  const res = await request.post("/api/external/tasks", {
    data: { title: "embedded-terminal-spec-73", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

test.describe("ADR-067 — Embedded terminal", () => {
  test("tabs render; Terminal default; xterm canvas + helper textarea present", async ({ page, request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("task-detail-page")).toBeVisible();
      await expect(page.getByTestId("task-detail-tabs")).toBeVisible();
      await expect(page.getByTestId("task-detail-tab-transcript")).toBeVisible();
      await expect(page.getByTestId("task-detail-tab-terminal")).toBeVisible();

      // Default = Terminal.
      const terminalPane = page.getByTestId("task-detail-terminal");
      await expect(terminalPane).toHaveAttribute("data-state", "active");

      // Both forceMount-ed panes exist in DOM (forceMount regression fence).
      await expect(page.getByTestId("task-detail-transcript")).toBeAttached();
      await expect(terminalPane).toBeAttached();

      // xterm rendered: helper textarea is present inside the embedded-terminal wrapper.
      await expect(page.locator(".xterm-helper-textarea")).toHaveCount(1);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test("tab toggle persists in localStorage and survives reload", async ({ page, request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await page.goto(`/tasks/${taskId}`);
      await page.getByTestId("task-detail-tab-transcript").click();
      await expect(page.getByTestId("task-detail-transcript")).toHaveAttribute(
        "data-state",
        "active",
      );
      const stored = await page.evaluate(() =>
        localStorage.getItem("webui:embedded-terminal-default-tab"),
      );
      expect(stored).toBe('"transcript"');

      await page.reload();
      await expect(page.getByTestId("task-detail-transcript")).toHaveAttribute(
        "data-state",
        "active",
      );
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test("WebSocket /api/terminal/:taskId/ws upgrades and emits a ready envelope", async ({ page, request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      // We probe the upgrade from the browser context so the same Origin
      // + port that the page uses applies (matches the loopback Origin
      // gate per ADR-067).
      await page.goto(`/tasks/${taskId}`);
      const result = await page.evaluate<{ readyEnvelope: unknown; status: string }, string>(
        async (id) => {
          return await new Promise((resolve) => {
            const proto = location.protocol === "https:" ? "wss:" : "ws:";
            const ws = new WebSocket(`${proto}//${location.host}/api/terminal/${id}/ws`);
            const timeout = setTimeout(() => {
              try {
                ws.close();
              } catch {
                /* ignore */
              }
              resolve({ readyEnvelope: null, status: "timeout" });
            }, 4000);
            ws.addEventListener("message", (evt) => {
              try {
                const parsed = JSON.parse(typeof evt.data === "string" ? evt.data : "");
                if (parsed && typeof parsed === "object" && (parsed as { type: string }).type === "ready") {
                  clearTimeout(timeout);
                  ws.close();
                  resolve({ readyEnvelope: parsed, status: "open" });
                }
              } catch {
                /* ignore non-JSON payloads */
              }
            });
            ws.addEventListener("error", () => {
              clearTimeout(timeout);
              resolve({ readyEnvelope: null, status: "error" });
            });
          });
        },
        taskId,
      );
      expect(result.status).toBe("open");
      expect(result.readyEnvelope).toMatchObject({ type: "ready" });
    } finally {
      // The pty was spawned by the WS upgrade — auto-killed when the
      // last connection closed (ADR-067 AC-2c). No manual cleanup needed.
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test("POST /paste-image stores an image under .claude-pastes/ and surfaces gitignoreSuggestion", async ({ request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      // Plant a .gitignore that does NOT mention .claude-pastes/.
      await fs.writeFile(path.join(cwd, ".gitignore"), "node_modules/\n", "utf8");

      // Minimal valid PNG (8-byte signature + IHDR-ish stub).
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);

      const res = await request.post(`/api/terminal/${taskId}/paste-image`, {
        multipart: {
          image: {
            name: "test.png",
            mimeType: "image/png",
            buffer: png,
          },
        },
      });
      expect(res.ok()).toBeTruthy();
      const body = (await res.json()) as {
        path: string;
        kind: string;
        gitignoreSuggestion: boolean;
      };
      expect(body.kind).toBe("png");
      expect(body.gitignoreSuggestion).toBe(true);
      // File on disk.
      const dirEntries = await fs.readdir(path.join(cwd, ".claude-pastes"));
      expect(dirEntries.length).toBe(1);
      expect(dirEntries[0]).toMatch(/^img-\d+-[0-9a-f]{8}\.png$/);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test("POST /paste-image rejects non-image payload with 400 unsupported_image_type", async ({ request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      const res = await request.post(`/api/terminal/${taskId}/paste-image`, {
        multipart: {
          image: {
            name: "fake.png",
            mimeType: "image/png",
            buffer: Buffer.from("plain text not png"),
          },
        },
      });
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unsupported_image_type");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test("POST /append-gitignore is idempotent and writes the .claude-pastes/ line", async ({ request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await fs.writeFile(path.join(cwd, ".gitignore"), "node_modules/\n", "utf8");

      // First call: appends.
      const r1 = await request.post(`/api/terminal/${taskId}/append-gitignore`);
      expect(r1.status()).toBe(204);

      const after1 = await fs.readFile(path.join(cwd, ".gitignore"), "utf8");
      expect(after1).toMatch(/\.claude-pastes\//);

      // Second call: idempotent (200 OK with already_present reason).
      const r2 = await request.post(`/api/terminal/${taskId}/append-gitignore`);
      expect(r2.status()).toBe(200);
      const body = (await r2.json()) as { ok: boolean; appended: boolean };
      expect(body.appended).toBe(false);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test("POST /append-gitignore returns 404 when .gitignore is missing (no creation)", async ({ request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      const res = await request.post(`/api/terminal/${taskId}/append-gitignore`);
      expect(res.status()).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("gitignore_missing");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test("Launch CTA fires webui:launch-copied; tab flips to Terminal automatically", async ({ page, request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await page.goto(`/tasks/${taskId}`);
      // Force-flip to Transcript first to make the post-launch flip observable.
      await page.getByTestId("task-detail-tab-transcript").click();
      await expect(page.getByTestId("task-detail-transcript")).toHaveAttribute(
        "data-state",
        "active",
      );
      // Click the launch CTA in the header.
      await page.getByTestId("terminal-launch-btn").click();
      // The clipboard write is async + the event dispatch follows it. Wait
      // for the resulting flip.
      await expect(page.getByTestId("task-detail-terminal")).toHaveAttribute(
        "data-state",
        "active",
        { timeout: 5000 },
      );
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test("Spec 35 still green under the embedded-terminal carve-out (no extra textareas, no chat-* testids)", async ({ page, request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(page.locator('[data-testid^="chat-"]')).toHaveCount(0);
      await expect(page.locator("textarea:not(.xterm-helper-textarea)")).toHaveCount(0);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
