/*
 * v0.9.5 / Iterate B — Replay-snapshot envelope (ADR-089).
 *
 * Mandatory real-browser smoke for the new replay protocol. Verifies
 * the four acceptance criteria from the iterate spec:
 *   AC-1 Snapshot path: when a snapshot file exists for a task AND the
 *        version matches the server's pinned `@xterm/headless`, the WS
 *        attach MUST emit `replay_snapshot` and MUST NOT emit any
 *        `replay_chunk` / `replay_start` envelope.
 *   AC-2 Wire shape: the `replay_snapshot` envelope MUST carry
 *        `{data, cols, rows, terminalVersion}` with correct shapes,
 *        and the client MUST render the data into xterm.js DOM.
 *        Verified line-by-line against the serialised payload —
 *        rendered text content must contain the snapshot's data.
 *   AC-3 No-snapshot path (post-ADR-087 / Iterate C retirement fence):
 *        when no snapshot file exists, the WS MUST emit zero replay
 *        envelopes (no `replay_snapshot`, no `replay_start` /
 *        `replay_chunk` / `replay_separator` / `replay_end` — the
 *        chunked-fallback path was retired in Iterate C). The client
 *        sees a blank terminal with a live shell. The AC-3 reviewer
 *        recommended also asserting close-on-replay-only — we cover
 *        that in a dedicated assertion when a `done` task is available,
 *        otherwise skip cleanly (the contract holds for any task
 *        that's not currently launching).
 *   AC-4 Resize+refresh+replay: a real cols/rows resize before refresh
 *        does NOT corrupt the post-refresh replay. The snapshot's
 *        cols/rows reflect the LATEST pty dims at finalize time (per
 *        ADR-088 invariant + snapshot-store header semantics).
 *
 * Strategy:
 *   - Per-test setup writes a deterministic snapshot file under
 *     `~/.shipwright-webui/terminal-scrollback/<taskId>.snapshot` for
 *     the test target task; per-test teardown removes it. The user's
 *     normal scrollback `.log` files are NEVER touched.
 *   - The xterm.js pinned version (6.0.0) matches the server's pinned
 *     `@xterm/headless` version (also 6.0.0; architecture invariant
 *     #4 from the planning doc, amended in ADR-097 — both pinned EXACT,
 *     same major).
 *
 * This file IS the F0.5 web surface_verification runner for Iterate B.
 */

import { test, expect, type WebSocket as PWWebSocket } from "@playwright/test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const SCROLLBACK_DIR = path.join(
  os.homedir(),
  ".shipwright-webui",
  "terminal-scrollback",
);

// Pinned by the architecture invariant in the planning doc (amended in
// ADR-097: 5.5.0 → 6.0.0 + envelope v1 → v2). Mirrors the value in
// server/node_modules/@xterm/headless/package.json.
const PINNED_TERMINAL_VERSION = "6.0.0";

interface WsEnvelope {
  type: string;
  raw: string;
  parsed: Record<string, unknown> | null;
}

interface WsCapture {
  url: string;
  envelopes: WsEnvelope[];
  closed: boolean;
}

function attachWsCapture(page: import("@playwright/test").Page): WsCapture[] {
  const capture: WsCapture[] = [];
  page.on("websocket", (ws: PWWebSocket) => {
    if (!ws.url().includes("/api/terminal/")) return;
    const entry: WsCapture = { url: ws.url(), envelopes: [], closed: false };
    capture.push(entry);
    ws.on("framereceived", (frame) => {
      if (typeof frame.payload !== "string") return;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(frame.payload) as Record<string, unknown>;
      } catch {
        /* ignore non-JSON */
      }
      const type =
        parsed && typeof parsed.type === "string" ? parsed.type : "<no-type>";
      entry.envelopes.push({ type, raw: frame.payload.slice(0, 400), parsed });
    });
    ws.on("close", () => {
      entry.closed = true;
    });
  });
  return capture;
}

function pickAuthoritativeWs(
  capture: WsCapture[],
  taskId: string,
): WsCapture | undefined {
  const matching = capture.filter(
    (c) =>
      c.url.includes(`/api/terminal/${taskId}/ws`) && c.envelopes.length > 0,
  );
  // StrictMode mount-1 transient discard — last WS wins.
  return matching.length > 0 ? matching[matching.length - 1] : undefined;
}

interface ApiTask {
  taskId: string;
  actionId?: string;
  state?: string;
}

async function listTasks(
  page: import("@playwright/test").Page,
): Promise<ApiTask[]> {
  const resp = await page.request
    .get(`/api/external/tasks`)
    .then((r) => (r.ok() ? r.json() : null))
    .catch(() => null);
  return ((resp as { tasks?: ApiTask[] }) || {}).tasks ?? [];
}

async function writeSnapshotFor(
  taskId: string,
  cols: number,
  rows: number,
  data: string,
): Promise<void> {
  const header = `# shipwright-snapshot v2 xterm@${PINNED_TERMINAL_VERSION} ${cols}x${rows}\n`;
  const body = header + data;
  await fs.mkdir(SCROLLBACK_DIR, { recursive: true });
  await fs.writeFile(path.join(SCROLLBACK_DIR, `${taskId}.snapshot`), body, {
    encoding: "utf8",
  });
}

async function removeSnapshotFor(taskId: string): Promise<void> {
  try {
    await fs.unlink(path.join(SCROLLBACK_DIR, `${taskId}.snapshot`));
  } catch {
    /* best-effort */
  }
}

test.describe("ADR-089 — replay_snapshot envelope path", () => {
  test("AC-1: WS attach MUST emit replay_snapshot AND MUST NOT emit replay_chunk when a snapshot is on disk", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    const tasks = await listTasks(page);
    const target = tasks.find(
      (t) => t.state !== "launching" && t.actionId !== "new-plain",
    );
    test.skip(
      !target,
      "No non-launching non-new-plain task in session — Iterate-B snapshot path requires a target.",
    );

    const FIXTURE = "ITERATE-B-SNAPSHOT-FIXTURE: cell-state replay payload\r\n$ ";
    await writeSnapshotFor(target!.taskId, 80, 24, FIXTURE);
    try {
      const capture = attachWsCapture(page);
      await page.goto(`/tasks/${target!.taskId}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      const terminalTab = page.getByRole("tab", { name: /terminal/i });
      if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await terminalTab.click();
      }
      await page.waitForTimeout(4_000);

      const ws = pickAuthoritativeWs(capture, target!.taskId);
      expect(ws, "expected WS frames").toBeDefined();
      const envTypes = (ws?.envelopes ?? []).map((e) => e.type);
      // eslint-disable-next-line no-console
      console.log(
        `[ADR-089 AC-1] task=${target!.taskId} envelopes=${JSON.stringify(envTypes)}`,
      );

      // STRICT: snapshot envelope present.
      expect(envTypes).toContain("replay_snapshot");
      // STRICT: NO chunked replay envelopes.
      expect(envTypes).not.toContain("replay_start");
      expect(envTypes).not.toContain("replay_chunk");
      expect(envTypes).not.toContain("replay_separator");
      expect(envTypes).not.toContain("replay_end");
    } finally {
      await removeSnapshotFor(target!.taskId);
    }
  });

  test("AC-2: replay_snapshot wire shape MUST match {data, cols, rows, terminalVersion} AND the client MUST render the data into xterm.js DOM", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    const tasks = await listTasks(page);
    const target = tasks.find(
      (t) => t.state !== "launching" && t.actionId !== "new-plain",
    );
    test.skip(!target, "No suitable task in session.");

    // Use plain ASCII text so the xterm.js DOM contains it verbatim
    // (escape sequences would re-render and complicate the visible
    // assertion). The marker is unique so we can locate it in the
    // .xterm-rows text content.
    const MARKER = "ITERATEB-VERBATIM-MARKER-XYZ";
    const FIXTURE = `${MARKER}\r\nLine 2\r\nLine 3`;
    await writeSnapshotFor(target!.taskId, 80, 24, FIXTURE);
    try {
      const capture = attachWsCapture(page);
      await page.goto(`/tasks/${target!.taskId}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      const terminalTab = page.getByRole("tab", { name: /terminal/i });
      if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await terminalTab.click();
      }
      await page.waitForTimeout(4_000);

      const ws = pickAuthoritativeWs(capture, target!.taskId);
      const snap = ws?.envelopes.find((e) => e.type === "replay_snapshot");
      expect(snap, "replay_snapshot envelope required").toBeDefined();
      // Wire-shape assertions.
      expect(snap!.parsed!.data).toBe(FIXTURE);
      expect(snap!.parsed!.cols).toBe(80);
      expect(snap!.parsed!.rows).toBe(24);
      expect(snap!.parsed!.terminalVersion).toBe(PINNED_TERMINAL_VERSION);

      // DOM-render assertion (ADR-097 migration). xterm.js 6.0 + WebGL
      // renderer no longer mirrors text into `.xterm-rows > div`; read
      // from the xterm buffer via the test handle exposed by
      // EmbeddedTerminal. The marker rendered SOMEWHERE in the buffer
      // confirms term.write(data) executed.
      await expect(page.locator('[data-testid="embedded-terminal"]')).toBeVisible({ timeout: 5_000 });
      await expect.poll(async () => {
        const text = await page.evaluate(() => {
          const w = window as unknown as { __embeddedTerminal?: { buffer: { active: { length: number; getLine(y: number): { translateToString(t?: boolean): string } | undefined } } } | null };
          const t = w.__embeddedTerminal;
          if (!t) return "";
          const buf = t.buffer.active;
          const lines: string[] = [];
          for (let y = 0; y < buf.length; y++) {
            const l = buf.getLine(y);
            if (l) lines.push(l.translateToString(false));
          }
          return lines.join("\n");
        });
        return text;
      }, { timeout: 5_000 }).toContain(MARKER);
    } finally {
      await removeSnapshotFor(target!.taskId);
    }
  });

  test("AC-3 (ADR-087 retirement): legacy chunked-replay envelopes are NEVER emitted, no matter the snapshot state", async ({
    page,
  }) => {
    // Iterate C (ADR-087) retired the chunked-replay path. The server
    // MUST NEVER emit `replay_start` / `replay_chunk` /
    // `replay_separator` / `replay_end` for any task — whether or not
    // a snapshot exists on disk. When no snapshot exists, the client
    // simply receives no replay history (blank terminal with live
    // shell), by design.
    test.setTimeout(30_000);

    const tasks = await listTasks(page);
    const target = tasks.find(
      (t) =>
        t.state !== "launching" &&
        t.state !== "done" &&
        t.state !== "launch_failed",
    );
    test.skip(!target, "No suitable task in session for retirement fence.");
    // Ensure no snapshot on disk so the "fallback" path is forced.
    await removeSnapshotFor(target!.taskId);

    const capture = attachWsCapture(page);
    await page.goto(`/tasks/${target!.taskId}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    const terminalTab = page.getByRole("tab", { name: /terminal/i });
    if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await terminalTab.click();
    }
    await page.waitForTimeout(4_000);

    const ws = pickAuthoritativeWs(capture, target!.taskId);
    expect(ws, "expected WS frames").toBeDefined();
    const envTypes = (ws?.envelopes ?? []).map((e) => e.type);
    // eslint-disable-next-line no-console
    console.log(
      `[ADR-087 AC-3] task=${target!.taskId} envelopes=${JSON.stringify(envTypes)}`,
    );

    // STRICT: chunked envelopes MUST NEVER appear in the stream.
    expect(envTypes).not.toContain("replay_start");
    expect(envTypes).not.toContain("replay_chunk");
    expect(envTypes).not.toContain("replay_separator");
    expect(envTypes).not.toContain("replay_end");
    // Snapshot may or may not appear depending on whether the live
    // pty produced enough state to write one — both outcomes are
    // valid per the plan's "no replay" trade-off.
  });

  test("AC-4: resize before refresh + replay restores correctly via replay_snapshot", async ({
    page,
  }) => {
    test.setTimeout(45_000);

    const tasks = await listTasks(page);
    const target = tasks.find(
      (t) => t.state !== "launching" && t.actionId !== "new-plain",
    );
    test.skip(!target, "No suitable task in session.");

    // Write a snapshot whose cols/rows match a "post-resize" state so
    // we can verify that the resized dims are reflected in the
    // envelope and the client renders correctly.
    const RESIZED_COLS = 100;
    const RESIZED_ROWS = 28;
    const MARKER = "ITERATEB-AC4-AFTER-RESIZE-MARKER";
    const FIXTURE = `${MARKER}\r\nresized at ${RESIZED_COLS}x${RESIZED_ROWS}\r\n$ `;
    await writeSnapshotFor(target!.taskId, RESIZED_COLS, RESIZED_ROWS, FIXTURE);
    try {
      // Mount, resize the viewport so xterm emits a resize over the WS,
      // refresh, and verify the post-refresh attach receives the
      // replay_snapshot with the embedded cols/rows.
      await page.setViewportSize({ width: 1400, height: 900 });
      const capture1 = attachWsCapture(page);
      await page.goto(`/tasks/${target!.taskId}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      const terminalTab = page.getByRole("tab", { name: /terminal/i });
      if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await terminalTab.click();
      }
      await page.waitForTimeout(2_000);

      // Resize mid-session — client emits a `resize` envelope to the
      // server. We don't strictly verify the server rebroadcasts; the
      // assertion is post-refresh.
      await page.setViewportSize({ width: 1100, height: 700 });
      await page.waitForTimeout(1_500);

      // Re-attach via refresh — captures everything anew.
      const capture2 = attachWsCapture(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      const terminalTab2 = page.getByRole("tab", { name: /terminal/i });
      if (await terminalTab2.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await terminalTab2.click();
      }
      await page.waitForTimeout(4_000);

      const ws = pickAuthoritativeWs(capture2, target!.taskId);
      expect(ws, "post-refresh WS frames").toBeDefined();
      const envTypes = (ws?.envelopes ?? []).map((e) => e.type);
      // eslint-disable-next-line no-console
      console.log(
        `[ADR-089 AC-4] post-refresh envelopes=${JSON.stringify(envTypes)}`,
      );

      // STRICT: snapshot envelope present, no chunked envelopes.
      expect(envTypes).toContain("replay_snapshot");
      expect(envTypes).not.toContain("replay_chunk");

      // STRICT: cols/rows from the snapshot header MUST match the
      // post-resize dims we wrote.
      const snap = ws!.envelopes.find((e) => e.type === "replay_snapshot");
      expect(snap!.parsed!.cols).toBe(RESIZED_COLS);
      expect(snap!.parsed!.rows).toBe(RESIZED_ROWS);

      // STRICT: DOM renders the marker after refresh (ADR-097 migration —
      // read from xterm buffer; .xterm-rows is no longer populated under
      // xterm 6.0 + WebGL).
      await expect(page.locator('[data-testid="embedded-terminal"]')).toBeVisible({ timeout: 5_000 });
      await expect.poll(async () => {
        const text = await page.evaluate(() => {
          const w = window as unknown as { __embeddedTerminal?: { buffer: { active: { length: number; getLine(y: number): { translateToString(t?: boolean): string } | undefined } } } | null };
          const t = w.__embeddedTerminal;
          if (!t) return "";
          const buf = t.buffer.active;
          const lines: string[] = [];
          for (let y = 0; y < buf.length; y++) {
            const l = buf.getLine(y);
            if (l) lines.push(l.translateToString(false));
          }
          return lines.join("\n");
        });
        return text;
      }, { timeout: 5_000 }).toContain(MARKER);

      // Suppress unused variable lint: capture1 documents the pre-
      // refresh WS lifecycle the test exercises.
      void capture1;
    } finally {
      await removeSnapshotFor(target!.taskId);
      // Reset viewport for downstream test runs.
      await page
        .setViewportSize({ width: 1280, height: 720 })
        .catch(() => undefined);
    }
  });

  test("AC-6 (iterate-2026-05-21-fix-terminal-flicker-on-closed-task): replay-only attach does NOT trigger a reconnect storm — count of authoritative WS attaches stays bounded", async ({
    page,
  }) => {
    // Regression for the "terminal flickers when going back to a closed task"
    // bug. Pre-fix: server closes the replay-only WS with code 1000, client
    // unconditionally `scheduleReconnect()`s, attemptsRef resets to 0 on
    // every successful open → infinite reconnect loop, each reconnect
    // replays the snapshot → visible blank-then-repaint flicker every
    // ~200 ms. Post-fix: gated on `replayOnlyRef.current === true &&
    // closeCode === 1000`, no reconnect.
    test.setTimeout(30_000);

    const tasks = await listTasks(page);
    const target = tasks.find(
      (t) => t.state === "done" || t.state === "launch_failed",
    );
    test.skip(
      !target,
      "No done/launch_failed task in session — flicker regression requires a terminal-state task as fixture.",
    );

    const MARKER = "ITERATE-FLICKER-FIX-AC6-MARKER";
    await writeSnapshotFor(target!.taskId, 80, 24, MARKER);
    try {
      const capture = attachWsCapture(page);
      await page.goto(`/tasks/${target!.taskId}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      const terminalTab = page.getByRole("tab", { name: /terminal/i });
      if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await terminalTab.click();
      }
      // Wait long enough for the FIRST reconnect-backoff window (200 ms)
      // PLUS several additional cycles. Pre-fix this window contained
      // multiple authoritative WS attaches; post-fix it contains exactly
      // one. 4 s is comfortably > 200 ms + 400 + 800 + 1600 = 3 s of
      // potential backoff cascade.
      await page.waitForTimeout(4_000);

      const authoritative = capture.filter(
        (c) =>
          c.url.includes(`/api/terminal/${target!.taskId}/ws`) &&
          c.envelopes.length > 0,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[iterate-flicker-fix AC-6] authoritative-ws-count=${authoritative.length} ` +
          `urls=${JSON.stringify(authoritative.map((a) => a.url))}`,
      );

      // STRICT: exactly one authoritative WS per visit. Pre-fix this
      // would be many (memory: decision_log calls out "~290 refresh/sec").
      // Bound is `<= 2` to be tolerant of React.StrictMode dev
      // double-mount where mount-1 transiently opens a WS and gets
      // close-on-replay-only before mount-2 takes over — both could
      // legitimately register envelopes. Anything beyond 2 indicates
      // the reconnect loop has re-emerged.
      expect(authoritative.length, "no reconnect storm").toBeLessThanOrEqual(2);

      // The winning capture got the replay_snapshot envelope exactly
      // once (per-WS guarantee from the server contract). With the bug,
      // the same capture object wouldn't see multiple snapshots — each
      // reconnect creates a NEW capture entry — so the per-WS count is
      // still 1; the reconnect storm shows up only as elevated capture
      // count. Both invariants together (capture count + per-WS count)
      // confirm exactly-one snapshot replay per visit.
      const winning = authoritative[authoritative.length - 1];
      const snapshotCount = winning.envelopes.filter(
        (e) => e.type === "replay_snapshot",
      ).length;
      expect(snapshotCount, "exactly one snapshot per WS").toBe(1);
    } finally {
      await removeSnapshotFor(target!.taskId);
    }
  });

  test("AC-5: completed-task replay-only path emits replay_snapshot AND server closes the WS cleanly", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    const tasks = await listTasks(page);
    const target = tasks.find(
      (t) => t.state === "done" || t.state === "launch_failed",
    );
    test.skip(
      !target,
      "No done/launch_failed task in session — AC-5 requires a terminal-state task as fixture.",
    );

    const MARKER = "ITERATEB-AC5-REPLAY-ONLY-MARKER";
    await writeSnapshotFor(target!.taskId, 80, 24, MARKER);
    try {
      const capture = attachWsCapture(page);
      await page.goto(`/tasks/${target!.taskId}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      const terminalTab = page.getByRole("tab", { name: /terminal/i });
      if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await terminalTab.click();
      }
      // Wait long enough for the server-side close-on-replay-only path
      // to execute. The server closes the WS with code 1000 after
      // sending the replay sequence.
      await page.waitForTimeout(5_000);

      const ws = pickAuthoritativeWs(capture, target!.taskId);
      expect(ws, "WS must have been attempted").toBeDefined();
      const envTypes = (ws?.envelopes ?? []).map((e) => e.type);
      // eslint-disable-next-line no-console
      console.log(
        `[ADR-089 AC-5] replay-only task=${target!.taskId} envelopes=${JSON.stringify(envTypes)} closed=${ws!.closed}`,
      );

      // STRICT: ready envelope with replayOnly:true.
      const ready = ws!.envelopes.find((e) => e.type === "ready");
      expect(ready).toBeDefined();
      expect((ready!.parsed as { replayOnly?: boolean })?.replayOnly).toBe(
        true,
      );

      // STRICT: snapshot envelope fired (we wrote a snapshot for this
      // task).
      expect(envTypes).toContain("replay_snapshot");
      expect(envTypes).not.toContain("replay_chunk");

      // STRICT: WS closed by server (replay-only path).
      expect(ws!.closed).toBe(true);
    } finally {
      await removeSnapshotFor(target!.taskId);
    }
  });
});
