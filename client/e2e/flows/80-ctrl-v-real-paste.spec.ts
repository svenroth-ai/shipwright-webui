/*
 * Spec 80 — v0.8.3 AC-1: real-browser Ctrl+V image-paste regression
 * (iterate-2026-05-07-v0-8-3-terminal-paste-and-padding).
 *
 * v0.8.2's Spec 79 AC-3 dispatched a hand-built `paste` ClipboardEvent
 * directly on a synthetic textarea inside the terminal container. That
 * passed, but never proved that REAL Ctrl+V at the shell prompt reaches
 * our handler — xterm.js's Ctrl+V keybinding bypasses ClipboardEvent
 * and uses async `navigator.clipboard.readText()`, which resolves to
 * text only and silently dropped images.
 *
 * This spec drives the real path:
 *   1. Grant `clipboard-read` + `clipboard-write` on the BrowserContext
 *      so navigator.clipboard.read() can run without a permission prompt.
 *   2. Write a synthetic PNG to the OS clipboard via
 *      `navigator.clipboard.write([new ClipboardItem({"image/png": blob})])`.
 *   3. Focus the embedded terminal's canvas (xterm's textarea sits
 *      inside it; key events route to the focused descendant).
 *   4. Press `Control+V`.
 *   5. Poll the task's cwd until the file lands under
 *      `<cwd>/.shipwright-webui/pastes/img-<ts>-<rand>.png`. This is
 *      the user-visible truth-test the spec promised.
 *
 * Browser scope: Chromium-only. Firefox does not support
 * `navigator.clipboard.read()` for non-text payloads as of writing;
 * the EmbeddedTerminal handler intentionally falls through to xterm's
 * own readText path on Firefox (covered by the wiring unit test in
 * EmbeddedTerminal.test.tsx — "Firefox / non-secure-context fallback").
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const SHIPWRIGHT_WEBUI_PROJECT_ID = "50e86b6e-3ade-44c4-9e21-2c62c65f804e";

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "v083-spec80-"));
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
  request: APIRequestContext,
  cwd: string,
  title = "v083-spec80",
): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title, cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
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

async function waitForPastedImage(
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  const pastesDir = path.join(cwd, ".shipwright-webui", "pastes");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const entries = await fs.readdir(pastesDir);
      const png = entries.find(
        (e) => /^img-\d+-[0-9a-f]+\.png$/i.test(e) || e.endsWith(".png"),
      );
      if (png) return path.join(pastesDir, png);
    } catch {
      /* dir may not exist yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`pasted image did not land in ${pastesDir} within ${timeoutMs}ms`);
}

test.describe("Spec 80 — v0.8.3 Ctrl+V real-paste regression", () => {
  test.setTimeout(60_000);

  // Chromium-only: clipboard.read for non-text payloads is not portable
  // across Firefox and WebKit. The Firefox-fallback path is unit-tested
  // separately in EmbeddedTerminal.test.tsx.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "clipboard.read for non-text payloads — Chromium only",
  );

  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript((id) => {
      try {
        localStorage.setItem("webui.activeProjectId", id);
      } catch {
        /* noop */
      }
    }, SHIPWRIGHT_WEBUI_PROJECT_ID);
  });

  test("Ctrl+V at the shell prompt with an image clipboard → file lands under <cwd>/.shipwright-webui/pastes/", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd, "spec80-ctrlv");
    try {
      await page.goto(`/tasks/${taskId}`);

      // Wait for EmbeddedTerminal mount + WS ready handshake.
      await page.waitForSelector(
        '[data-testid="embedded-terminal-canvas"]',
        { timeout: 15_000 },
      );
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });

      // Plant a 1×1 PNG on the OS clipboard via the Async Clipboard API.
      // The PNG is a minimal valid 8-byte signature + IHDR chunk + a
      // minimal IDAT + IEND so browsers accept it as image/png. Real
      // image content does not matter — the test only proves the
      // round-trip from Ctrl+V → clipboard.read() → /paste-image →
      // server fs write reaches the user-visible file.
      await page.evaluate(async () => {
        // 1×1 transparent PNG, base64. Decoded to a Uint8Array on the
        // page so the ClipboardItem type-map is honoured by Chromium.
        const b64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: "image/png" });
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
      });

      // Focus the embedded terminal so xterm's textarea (its inner
      // descendant) receives the keydown chord. xterm dispatches its
      // KeyboardEvent into our attachCustomKeyEventHandler before the
      // browser's text-paste pipeline can touch the textarea.
      await page.getByTestId("embedded-terminal-canvas").click();

      await page.keyboard.press("Control+V");

      // Server writes the file synchronously inside the /paste-image
      // POST handler — the round-trip should land within ~1.5 s on a
      // warm tmpdir (Spec 79 AC-4 budget).
      const filePath = await waitForPastedImage(cwd, 5_000);
      expect(filePath).toBeTruthy();
      expect(filePath).toContain(path.join(".shipwright-webui", "pastes"));

      // Read back and assert magic bytes — confirms the blob round-trip
      // wasn't truncated by FormData / multipart parsing.
      const buf = await fs.readFile(filePath);
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
      expect(buf[2]).toBe(0x4e);
      expect(buf[3]).toBe(0x47);
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
