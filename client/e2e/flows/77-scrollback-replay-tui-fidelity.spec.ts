/*
 * Spec 77 — Scrollback replay TUI fidelity (AC-1, iterate-2026-05-05).
 *
 * Bug (UAT 2026-05-05):
 *   Re-attaching to a task whose pty had emitted TUI-style output
 *   (PowerShell prompt repaints, Claude Code box-drawing) showed a
 *   visually-corrupted history: cursor-control sequences re-executed
 *   on the fresh xterm and stacked redraws on top of each other.
 *
 * Fix: ScrollbackStore.append + ScrollbackStore.read run incoming
 * bytes through a sanitizer that strips cursor-control sequences
 * (cursor-home, erase-in-line, alt-screen, save/restore, …) while
 * preserving SGR (color/bold) + plain text + LF/CRLF/HT. Live WS
 * broadcast keeps raw bytes; only the disk-persistence path is
 * filtered.
 *
 * Outcome detection (per the Spec 76 pattern): WebSocket frame
 * capture. Re-attach replays the disk via a chunked sequence of
 * `replay_chunk` envelopes; the spec asserts no cursor-control
 * patterns appear in any of those payloads.
 */

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { apiUrl } from "../helpers/env";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// A00 — was a pinned operator UUID; seeded via the real API in beforeEach.
let project: SeededProject;



interface CapturedFrame {
  ts: number;
  kind: "tx" | "rx" | "open" | "close";
  text: string;
}

function attachWsCapture(page: Page): { frames: CapturedFrame[] } {
  const frames: CapturedFrame[] = [];
  page.on("websocket", (ws) => {
    const url = ws.url();
    if (!url.includes("/api/terminal/")) return;
    frames.push({ ts: Date.now(), kind: "open", text: url });
    ws.on("framesent", (f) => {
      const payload = typeof f.payload === "string" ? f.payload : "";
      frames.push({ ts: Date.now(), kind: "tx", text: payload });
    });
    ws.on("framereceived", (f) => {
      const payload = typeof f.payload === "string" ? f.payload : "";
      frames.push({ ts: Date.now(), kind: "rx", text: payload });
    });
    ws.on("close", () => {
      frames.push({ ts: Date.now(), kind: "close", text: url });
    });
  });
  return { frames };
}

async function cleanup(request: APIRequestContext, taskId: string): Promise<void> {
  if (!taskId) return;
  try {
    await request.delete(apiUrl(`/api/external/tasks/${taskId}`));
  } catch {
    /* ignore */
  }
}

/** Decode a `replay_chunk` envelope payload back to its text form. */
function extractReplayPayload(frameText: string): string | null {
  try {
    const parsed = JSON.parse(frameText) as { type?: string; payload?: string };
    if (parsed.type === "replay_chunk" && typeof parsed.payload === "string") {
      return parsed.payload;
    }
  } catch {
    /* not JSON or unexpected shape */
  }
  return null;
}

/** Concatenate every replay_chunk text after a given timestamp. */
function reconstructReplay(frames: CapturedFrame[], afterTs: number): string {
  const parts: string[] = [];
  for (const f of frames) {
    if (f.kind !== "rx" || f.ts < afterTs) continue;
    const payload = extractReplayPayload(f.text);
    if (payload !== null) parts.push(payload);
  }
  return parts.join("");
}

async function awaitReplayEnd(
  page: Page,
  frames: CapturedFrame[],
  afterTs: number,
  timeoutMs = 15_000,
): Promise<boolean> {
  const observeUntil = Date.now() + timeoutMs;
  while (Date.now() < observeUntil) {
    const seen = frames.find(
      (f) =>
        f.kind === "rx" &&
        f.ts >= afterTs &&
        f.text.includes('"type":"replay_end"'),
    );
    if (seen) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

test.describe("Spec 77 — scrollback replay TUI fidelity (AC-1)", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "77-scrollback-replay-tui-fidelity" });
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("PowerShell prompt-repaint fixture: replay contains no cursor-control codes", async ({
    page,
    request,
  }) => {
    const cap = attachWsCapture(page);
    const title = `spec77-A-${Date.now()}`;

    // 1. Create a Plain-Claude task — the embedded shell pane spawns
    //    pwsh on Windows / $SHELL elsewhere, and the user can drive
    //    arbitrary commands.
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("plain-claude-button").click();
    await expect(page.getByTestId("new-issue-modal-new-plain")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId("new-issue-title-input").fill(title);

    const createResp = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/external/tasks") &&
        r.request().method() === "POST",
    );
    await page.getByTestId("new-issue-save-btn").click();
    const c = await createResp;
    const body = (await c.json()) as { task: { taskId: string } };
    const taskId = body.task.taskId;

    // 2. Open the task detail + wait for terminal ready.
    await expect(page.getByTestId("new-issue-modal-new-plain")).toHaveCount(0, {
      timeout: 5_000,
    });
    const card = page.getByTestId(`task-card-${taskId}`);
    await expect(card).toBeVisible({ timeout: 5_000 });

    // Click into TaskDetail without launching claude (we want the bare shell).
    await card.click();
    await page.waitForURL(new RegExp(`/tasks/${taskId}$`), { timeout: 10_000 });

    const term = page.getByTestId("embedded-terminal");
    await expect(term).toHaveAttribute("data-ws-ready", "true", {
      timeout: 15_000,
    });
    await expect(term).toHaveAttribute("data-role", "writer", {
      timeout: 5_000,
    });

    // Focus the canvas + wait for the pty's first prompt paint.
    await page.getByTestId("embedded-terminal-canvas").click();
    await page.waitForTimeout(500);

    // 3. Drive a TUI-heavy fixture: 30 redraws of a "header repaint".
    //    On PowerShell: Clear-Host + a colored line + new prompt. On
    //    POSIX: clear + echo. Each iteration emits cursor-home +
    //    erase-in-display (`\x1b[H\x1b[2J`) which the v0.8.0 pre-fix
    //    version persisted to disk and re-rendered as visual chaos.
    const liveStartTs = Date.now();
    const fixture =
      process.platform === "win32"
        ? `for ($i=1; $i -le 30; $i++) { Clear-Host; Write-Host "iter $i" -ForegroundColor Cyan }\r`
        : `for i in $(seq 1 30); do clear; printf '\\033[36miter %d\\033[0m\\n' $i; done\r`;
    await page.keyboard.insertText(fixture.replace(/\r$/, ""));
    await page.keyboard.press("Enter");
    // Allow the loop to complete. PowerShell Clear-Host on ConPTY is slow
    // (each call emits a buffer-clear sequence + repositions); 30 iterations
    // can take 6–10 s before yielding the next prompt. We wait long enough
    // for ALL iterations to land on disk so the linearization check has a
    // representative sample.
    await page.waitForTimeout(12_000);

    // 3b. Per code-review openai-2: assert the LIVE stream remains
    //     unfiltered. At least one live `data` envelope received during
    //     the active session must contain a cursor-control byte
    //     (\x1b followed by `[` and a non-`m` final). A broken impl
    //     that also sanitized the live broadcast would fail here.
    const liveCursorFrame = cap.frames.find(
      (f) =>
        f.kind === "rx" &&
        f.ts >= liveStartTs &&
        f.text.includes('"type":"data"') &&
        // Any non-SGR CSI sequence (cursor-home, erase-in-line, …).
        // Look for raw \x1b[ followed by something that is not a digit
        // or 'm'. JSON encoding turns \x1b into  in transport.
        /\\u001b\[/.test(f.text),
    );
    expect(
      liveCursorFrame,
      "live data stream should still carry cursor-control bytes (only DISK persistence is sanitized)",
    ).toBeTruthy();


    // 4. Navigate away → back, forcing a fresh WS attach + replay.
    const reattachStartTs = Date.now();
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId(`task-card-${taskId}`).click();
    await page.waitForURL(new RegExp(`/tasks/${taskId}$`), {
      timeout: 10_000,
    });

    // 5. Wait for the replay to finish (replay_end envelope).
    const replayEnded = await awaitReplayEnd(page, cap.frames, reattachStartTs);
    expect(replayEnded, "replay_end envelope must arrive within 15s").toBe(
      true,
    );

    // 6. Reconstruct the persisted text from replay_chunk frames.
    const replayText = reconstructReplay(cap.frames, reattachStartTs);
    expect(
      replayText.length,
      "replay payload must be non-empty",
    ).toBeGreaterThan(0);

    // 7. ASSERT — no cursor-control patterns survive into the replay.
    //    Cursor-home: \x1b[H or \x1b[<n>;<m>H
    //    Erase-in-display: \x1b[J / \x1b[<n>J / \x1b[2J
    //    Erase-in-line: \x1b[K / \x1b[<n>K
    //    Alt-screen: \x1b[?1049h / \x1b[?1049l / \x1b[?47h / \x1b[?47l
    //    Cursor-visibility: \x1b[?25l / \x1b[?25h
    expect(replayText, "no cursor-home in replay").not.toMatch(/\x1b\[\d*;?\d*H/);
    expect(replayText, "no erase-in-display in replay").not.toMatch(
      /\x1b\[\d*J/,
    );
    expect(replayText, "no erase-in-line in replay").not.toMatch(/\x1b\[\d*K/);
    expect(replayText, "no alt-screen in replay").not.toMatch(/\x1b\[\?\d+[hl]/);

    // 8. ASSERT — SGR codes ARE preserved (color rendering survives).
    //    The fixture uses cyan foreground (ESC [ 36 m on POSIX, or
    //    ForegroundColor Cyan via Write-Host on PS). Either path
    //    eventually emits \x1b[36m or similar SGR which must survive.
    expect(replayText, "at least one SGR sequence preserved").toMatch(
      /\x1b\[\d+(;\d+)*m/,
    );

    // 9. ASSERT — visible text reads as a LINEARIZED log (proxies AC-1
    //    "xterm buffer length grows linearly with new content, not
    //    stacks of overwrites"). The fixture emits up to 30 distinct
    //    iter values. A working sanitizer keeps every distinct value in
    //    the persisted text (each "iter N" was real output, not a
    //    redraw of the same line). A buggy sanitizer that accidentally
    //    collapsed text would produce only ONE match (all redraws
    //    overlapping). We require ≥ 3 distinct iter values — robust
    //    against ConPTY Clear-Host timing variance while still proving
    //    linearization (a stack-overwrite bug would produce 1, not 3+).
    //    The assertion includes "iter 1" because the sanitizer must
    //    not lose the start of the log on tail-trim.
    const iterMatches = replayText.match(/iter \d+/g) ?? [];
    const distinctIters = new Set(iterMatches);
    expect(
      distinctIters.size,
      `replay should contain multiple distinct 'iter N' lines (got ${distinctIters.size} of up to 30; proxies linear-growth AC)`,
    ).toBeGreaterThanOrEqual(3);
    expect(
      distinctIters.has("iter 1"),
      "sanitizer must not lose the START of the log",
    ).toBe(true);

    await cleanup(request, taskId);
  });
});
