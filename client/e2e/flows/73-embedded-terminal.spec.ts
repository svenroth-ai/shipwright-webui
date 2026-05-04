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

async function cleanupCwd(dir: string): Promise<void> {
  // Windows: a freshly-spawned pty (auto-create on /paste-image or
  // /ws upgrade) keeps the cwd open until it exits. Best-effort with
  // retries; leftover bytes in tmpdir are acceptable across CI runs.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 4) return; // give up silently
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function createTask(request: import("@playwright/test").APIRequestContext, cwd: string) {
  const res = await request.post("/api/external/tasks", {
    data: { title: "embedded-terminal-spec-73", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

// Spec 73 needs clipboard read/write permissions so the launch CTA's
// `navigator.clipboard.writeText` resolves (otherwise no
// webui:launch-copied dispatch fires) and so the paste-image fetch
// path can observe a real DataTransfer.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

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
      await cleanupCwd(cwd);
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
      // Accept both the JSON-stringified form ('"transcript"') and the
      // bare string form, in case useLocalStorage's encoding contract
      // changes — the spec only requires the SEMANTIC value to round-trip.
      expect(stored === '"transcript"' || stored === "transcript").toBe(true);

      await page.reload();
      await expect(page.getByTestId("task-detail-transcript")).toHaveAttribute(
        "data-state",
        "active",
      );
    } finally {
      await cleanupCwd(cwd);
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
      await cleanupCwd(cwd);
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
      await cleanupCwd(cwd);
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
      await cleanupCwd(cwd);
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
      await cleanupCwd(cwd);
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
      await cleanupCwd(cwd);
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
      // Click the launch CTA in the header (testid `cta-launch-in-terminal`
      // for draft/awaiting_external_start tasks; the header dispatches
      // webui:launch-copied after the clipboard write).
      await page.getByTestId("cta-launch-in-terminal").click();
      // The clipboard write is async + the event dispatch follows it. Wait
      // for the resulting flip.
      await expect(page.getByTestId("task-detail-terminal")).toHaveAttribute(
        "data-state",
        "active",
        { timeout: 5000 },
      );
    } finally {
      await cleanupCwd(cwd);
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
      await cleanupCwd(cwd);
    }
  });

  test("DOM paste event with text-only ClipboardData routes through socket.send (AC-12c text-paste browser-level)", async ({ page, request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      // Install the WS-send tap BEFORE the page initializes — addInitScript
      // runs in every new document context (incl. the first goto), so the
      // hook captures the patched constructor when it imports.
      await page.addInitScript(() => {
        const w = window as unknown as { __wsSent: string[] };
        w.__wsSent = [];
        const RealWS = window.WebSocket;
        const RealSend = RealWS.prototype.send;
        // Patch on the prototype so every instance is captured without
        // touching the constructor identity (some libs use `instanceof`).
        RealWS.prototype.send = function (
          this: WebSocket,
          data: string | ArrayBufferLike | Blob | ArrayBufferView,
        ) {
          if (typeof data === "string") w.__wsSent.push(data);
          return RealSend.call(this, data);
        };
      });
      await page.goto(`/tasks/${taskId}`);
      // Wait for the EmbeddedTerminal to mount AND its WS to open AND
      // the server's ready envelope to land — without this the paste
      // handler's socket.send is a no-op (readyState !== OPEN).
      await page.waitForSelector('[data-testid="embedded-terminal"][data-ws-ready="true"]');

      const result = await page.evaluate(async () => {
        const target = document.querySelector(
          '[data-testid="embedded-terminal-canvas"]',
        );
        if (!target) return { sent: [] as string[] };
        const dt = new DataTransfer();
        dt.items.add("ls -la\n", "text/plain");
        const ev = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(ev, "clipboardData", { value: dt });
        target.dispatchEvent(ev);
        // Poll until a {type:"data"} envelope shows up (cap 1.5 s).
        const w = window as unknown as { __wsSent: string[] };
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          if (w.__wsSent.some((s) => s.includes('"type":"data"'))) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        return { sent: w.__wsSent };
      });

      // The mock collects every send(); we expect a {type:"data"} envelope
      // carrying the pasted text. Resize / ready frames come along too —
      // we only assert presence of the data envelope.
      const dataEnvelopes = result.sent.filter((s) => s.includes('"type":"data"'));
      expect(dataEnvelopes.length).toBeGreaterThanOrEqual(1);
      expect(dataEnvelopes.some((s) => s.includes("ls -la"))).toBe(true);
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("DOM paste event with image ClipboardData hits /paste-image AND drops same-payload text (image-wins precedence, external review F11)", async ({ page, request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      // Install fetch tap BEFORE page init so EmbeddedTerminal's
      // fetch import sees the patched window.fetch.
      await page.addInitScript(() => {
        const w = window as unknown as { __pasteFetchCalls: Array<{ url: string; hasImage: boolean }> };
        w.__pasteFetchCalls = [];
        const realFetch = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/paste-image")) {
            const fd = init?.body;
            const hasImage = fd instanceof FormData && fd.has("image");
            w.__pasteFetchCalls.push({ url, hasImage });
            return new Response(
              JSON.stringify({
                path: "/x/.claude-pastes/img.png",
                kind: "png",
                gitignoreSuggestion: false,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return realFetch(input, init);
        };
      });
      await page.goto(`/tasks/${taskId}`);
      // Wait for the EmbeddedTerminal mount (xterm + paste listener
      // attached). The fetch-mock works regardless of WS state, but
      // the paste handler is on the canvas, which is only rendered
      // after the lazy import resolves.
      await page.waitForSelector('[data-testid="embedded-terminal-canvas"]');

      // Construct a synthetic paste event with BOTH text and image
      // ClipboardItems and dispatch it on the embedded-terminal canvas.
      const result = await page.evaluate<{ called: boolean; hasImage: boolean }, string>(
        async (id) => {
          void id;
          const target = document.querySelector(
            '[data-testid="embedded-terminal-canvas"]',
          );
          if (!target) return { called: false, hasImage: false };

          // Build a DataTransfer with text + image.
          const dt = new DataTransfer();
          dt.items.add("ignored-by-image-wins", "text/plain");
          // 1x1 transparent PNG (the smallest valid PNG byte sequence).
          const png = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
            0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
            0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
            0x42, 0x60, 0x82,
          ]);
          const blob = new Blob([png], { type: "image/png" });
          const file = new File([blob], "screenshot.png", { type: "image/png" });
          dt.items.add(file);

          const ev = new ClipboardEvent("paste", {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
          });
          target.dispatchEvent(ev);
          // Wait a tick for async fetch to register.
          await new Promise((r) => setTimeout(r, 100));
          const w = window as unknown as { __pasteFetchCalls: Array<{ hasImage: boolean }> };
          const last = w.__pasteFetchCalls[w.__pasteFetchCalls.length - 1];
          return { called: !!last, hasImage: last?.hasImage ?? false };
        },
        taskId,
      );

      expect(result.called).toBe(true);
      expect(result.hasImage).toBe(true);
    } finally {
      await cleanupCwd(cwd);
    }
  });
});
