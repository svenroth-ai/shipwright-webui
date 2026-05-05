/*
 * Spec 78 — Reattach under pty-load (AC-3, iterate-2026-05-05).
 *
 * Bug (UAT 2026-05-05):
 *   Re-attaching to a task while its pty was emitting high-volume
 *   output produced a lingering "read-only" banner — the new tab
 *   stayed reader-role for seconds-to-minutes because the prior
 *   tab's ws.close was queued behind the data envelopes the server
 *   was still trying to drain.
 *
 * Fix: PtyManager grew a watchdog (AC-3b) that evicts a writer
 * whose WS bufferedAmount has been above the stuck threshold for
 * ≥ 2s. Eviction follows the standard detach() path so the per-conn
 * pause refcount (AC-3a) cleans up + the next reader is promoted
 * with `writer-promoted` envelope.
 *
 * Outcome detection (per the Spec 76 pattern): WebSocket frame
 * capture. The new tab MUST receive `ready{role:writer}` (or a
 * reader→writer-promoted hop) within a bounded time window after
 * re-attach, NOT a stuck reader role indefinitely.
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const SHIPWRIGHT_WEBUI_PROJECT_ID = "50e86b6e-3ade-44c4-9e21-2c62c65f804e";

interface CapturedFrame {
  ts: number;
  kind: "tx" | "rx" | "open" | "close";
  text: string;
  url?: string;
}

function attachWsCapture(page: Page): { frames: CapturedFrame[] } {
  const frames: CapturedFrame[] = [];
  page.on("websocket", (ws) => {
    const url = ws.url();
    if (!url.includes("/api/terminal/")) return;
    frames.push({ ts: Date.now(), kind: "open", text: url, url });
    ws.on("framesent", (f) => {
      const payload = typeof f.payload === "string" ? f.payload : "";
      frames.push({ ts: Date.now(), kind: "tx", text: payload, url });
    });
    ws.on("framereceived", (f) => {
      const payload = typeof f.payload === "string" ? f.payload : "";
      frames.push({ ts: Date.now(), kind: "rx", text: payload, url });
    });
    ws.on("close", () => {
      frames.push({ ts: Date.now(), kind: "close", text: url, url });
    });
  });
  return { frames };
}

async function cleanup(request: APIRequestContext, taskId: string): Promise<void> {
  if (!taskId) return;
  try {
    await request.delete(`http://localhost:3847/api/external/tasks/${taskId}`);
  } catch {
    /* ignore */
  }
}

/** Wait until the new attach receives a frame asserting the given role. */
async function awaitWriterRole(
  page: Page,
  frames: CapturedFrame[],
  afterTs: number,
  timeoutMs = 30_000,
): Promise<{ achieved: boolean; viaPromotion: boolean }> {
  const observeUntil = Date.now() + timeoutMs;
  let viaPromotion = false;
  while (Date.now() < observeUntil) {
    for (const f of frames) {
      if (f.kind !== "rx" || f.ts < afterTs) continue;
      if (f.text.includes('"type":"writer-promoted"')) {
        viaPromotion = true;
        return { achieved: true, viaPromotion };
      }
      if (
        f.text.includes('"type":"ready"') &&
        f.text.includes('"role":"writer"')
      ) {
        return { achieved: true, viaPromotion };
      }
    }
    await page.waitForTimeout(200);
  }
  return { achieved: false, viaPromotion };
}

test.describe("Spec 78 — re-attach under pty-load (AC-3)", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      try {
        localStorage.setItem("webui.activeProjectId", id);
      } catch {
        /* noop */
      }
    }, SHIPWRIGHT_WEBUI_PROJECT_ID);
  });

  test("re-attach during high-volume pty output: new tab reaches writer role within 30s", async ({
    browser,
    request,
  }) => {
    // 1. Page A — create + open the task, drive a high-volume payload.
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.addInitScript((id) => {
      try {
        localStorage.setItem("webui.activeProjectId", id);
      } catch {
        /* noop */
      }
    }, SHIPWRIGHT_WEBUI_PROJECT_ID);

    const capA = attachWsCapture(pageA);
    void capA; // captured for diagnostics; not asserted on
    const title = `spec78-${Date.now()}`;

    await pageA.goto("/");
    await expect(pageA.getByTestId("task-board-page")).toBeVisible({
      timeout: 10_000,
    });

    await pageA.getByTestId("plain-claude-button").click();
    await expect(pageA.getByTestId("new-issue-modal-new-plain")).toBeVisible({
      timeout: 5_000,
    });
    await pageA.getByTestId("new-issue-title-input").fill(title);

    const createResp = pageA.waitForResponse(
      (r) =>
        r.url().endsWith("/api/external/tasks") &&
        r.request().method() === "POST",
    );
    await pageA.getByTestId("new-issue-save-btn").click();
    const c = await createResp;
    const body = (await c.json()) as { task: { taskId: string } };
    const taskId = body.task.taskId;

    await expect(pageA.getByTestId("new-issue-modal-new-plain")).toHaveCount(0, {
      timeout: 5_000,
    });
    const cardA = pageA.getByTestId(`task-card-${taskId}`);
    await expect(cardA).toBeVisible({ timeout: 5_000 });
    await cardA.click();
    await pageA.waitForURL(new RegExp(`/tasks/${taskId}$`), {
      timeout: 10_000,
    });

    const termA = pageA.getByTestId("embedded-terminal");
    await expect(termA).toHaveAttribute("data-ws-ready", "true", {
      timeout: 15_000,
    });
    await expect(termA).toHaveAttribute("data-role", "writer", {
      timeout: 5_000,
    });

    await pageA.getByTestId("embedded-terminal-canvas").click();
    await pageA.waitForTimeout(500);

    // High-volume payload — keeps the pty emitting bytes for several
    // seconds so the close envelope on pageA's WS gets queued behind
    // data envelopes (the original bug condition).
    const payload =
      process.platform === "win32"
        ? `for ($i=1; $i -le 5000; $i++) { Write-Host "line $i with some payload to fill the wire" }\r`
        : `for i in $(seq 1 5000); do echo "line $i with some payload to fill the wire"; done\r`;
    await pageA.keyboard.insertText(payload.replace(/\r$/, ""));
    await pageA.keyboard.press("Enter");
    // Give the loop a moment to actually start emitting.
    await pageA.waitForTimeout(800);

    // 2. Page B — open a new browser context (separate session, distinct
    //    WS conn) + navigate directly to the running task's TaskDetail.
    //    This is the "user closed laptop, came back, opened a new tab"
    //    scenario.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.addInitScript((id) => {
      try {
        localStorage.setItem("webui.activeProjectId", id);
      } catch {
        /* noop */
      }
    }, SHIPWRIGHT_WEBUI_PROJECT_ID);

    const capB = attachWsCapture(pageB);

    const reattachAt = Date.now();
    // 3. Close pageA — simulates a real tab-close. The ws.close envelope
    //    will be queued behind the pty's still-draining data envelopes;
    //    only the watchdog + bufferedAmount drainage signal can free the
    //    writer slot under this load.
    await pageA.close();
    await ctxA.close();

    // 4. Open pageB on the live task — should attach as reader (since
    //    the writer slot is still nominally held by the dead pageA WS),
    //    then get promoted via the watchdog within 30s.
    await pageB.goto(`/tasks/${taskId}`);
    const termB = pageB.getByTestId("embedded-terminal");
    await expect(termB).toHaveAttribute("data-ws-ready", "true", {
      timeout: 30_000,
    });

    // 5. Assert: writer role achieved within 30s, either directly via
    //    `ready{role:writer}` (close was processed in time) or via a
    //    `writer-promoted` envelope (watchdog evicted the stuck
    //    writer). Both outcomes are acceptable — the bug was that
    //    NEITHER happened.
    const result = await awaitWriterRole(pageB, capB.frames, reattachAt);
    expect(
      result.achieved,
      `pageB must reach writer role within 30s after re-attach (frames so far: ${capB.frames
        .filter((f) => f.kind === "rx")
        .map((f) => f.text.slice(0, 80))
        .join(" | ")})`,
    ).toBe(true);

    // 5b. Per code-review openai-4: assert the read-only banner is
    //     ABSENT in the DOM. The bug surface was a banner that
    //     persisted after re-attach. With the watchdog/promotion
    //     fixed, the banner must clear within a small window.
    await expect(termB).toHaveAttribute("data-role", "writer", {
      timeout: 5_000,
    });
    await expect(
      pageB.getByTestId("embedded-terminal-readonly"),
      "read-only banner must be absent after writer promotion",
    ).toHaveCount(0, { timeout: 5_000 });

    await ctxB.close();
    await cleanup(request, taskId);
  });
});
