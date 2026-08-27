/*
 * Spec 105 — replay-only interaction-mode teardown + Reopen reconnect
 * (iterate-2026-08-27-terminal-replay-reset-reopen-reconnect).
 *
 * Real-browser proof for the two bugs the unit suites cover in isolation:
 *
 *   Bug A: a closed task's one-shot `replay_snapshot` left mouse-tracking
 *   mode latched ON in the reader's REAL xterm instance forever (no live pty
 *   ever follows up to turn it off) — disabling native DOM text selection
 *   (copy) and turning wheel-scroll into arrow-key bytes routed nowhere.
 *   `replay-snapshot.test.ts` proves the envelope BYTES are correct; this
 *   spec proves the real xterm.js build actually ends up in
 *   `modes.mouseTrackingMode === 'none'` after a genuine server round trip.
 *
 *   Bug B: Reopen (task-detail "…" menu here — the board drag-out-of-Done
 *   and TaskCard-menu paths share the identical `/reopen` endpoint and
 *   `useTerminalSocket` wiring, so this is the representative case) never
 *   reconnected the terminal WS. `EmbeddedTerminal.reopen-reconnect.test.tsx`
 *   proves the hook logic against a real-closing FakeWebSocket; this spec
 *   proves the full stack — the actual server's replay-only close, the
 *   actual client socket, the actual DOM — recovers without a page reload.
 *
 * Bug A's precondition (a persisted snapshot recorded with mouse-tracking
 * left on) is seeded by writing a `<taskId>.snapshot` file directly, in the
 * exact on-disk format `snapshot-store.ts` documents, rather than driving a
 * real live pty into that state. This was tried first (a plain shell command
 * echoing a raw `ESC[?1000h`) and is NOT reliable on Windows: ConPTY
 * re-serializes a child process's output through its own internal
 * screen-state model rather than passing bytes through verbatim, and a
 * private-mode DECSET it doesn't track for redraw purposes (verified with a
 * standalone @lydell/node-pty repro: `type`-ing a file containing
 * `ESC[?1000h` came out the other side with that sequence silently replaced
 * by an unrelated cursor-position escape) is exactly such a casualty.
 * Seeding the snapshot file directly sidesteps that platform limitation
 * without weakening what's proven: `ws-upgrade-handler.ts`'s replay-only
 * branch still reads this exact file through `SnapshotStore`, still builds
 * the envelope through the real `buildReplaySnapshotEnvelope`, and still
 * sends it over a real WS to a real xterm.js instance — the entire SUT for
 * Bug A never needed a live pty to begin with, only a recorded snapshot.
 */

import { cleanupCwd, cleanupTask, createTask, makeTaskCwd } from "../helpers/task-fixture";
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Mirrors `snapshot-store.ts`'s own version lookup so the fixture's header
 *  always matches whatever `@xterm/headless` version this checkout pins —
 *  never hardcoded, so a version bump can't silently desync the fixture. */
async function readPinnedTerminalVersion(): Promise<string> {
  const pkgPath = path.resolve(
    __dirname,
    "../../../server/node_modules/@xterm/headless/package.json",
  );
  const raw = await fs.readFile(pkgPath, "utf8");
  const json = JSON.parse(raw) as { version?: string };
  if (!json.version) throw new Error(`no version field in ${pkgPath}`);
  return json.version;
}

/** Writes a `<taskId>.snapshot` fixture straight into the scrollback dir the
 *  running (isolated-stack) server reads from — same `HOME`/`USERPROFILE`
 *  env this Playwright process inherited from `isolated-stack.mjs`, so
 *  `os.homedir()` here resolves to the identical directory the server used
 *  at boot. `data` embeds a real `ESC[?1000h` so the client's xterm parses
 *  it into `mouseTrackingMode: 'vt200'` on replay — exactly the recorded
 *  state a live Claude TUI leaves behind — before the server's teardown
 *  suffix (this iterate's fix) is appended after it.
 */
async function seedDoneSnapshot(taskId: string): Promise<void> {
  const terminalVersion = await readPinnedTerminalVersion();
  const dir = path.join(os.homedir(), ".shipwright-webui", "terminal-scrollback");
  await fs.mkdir(dir, { recursive: true });
  const header = `# shipwright-snapshot v2 xterm@${terminalVersion} 80x24\n`;
  const data = "\x1b[?1000hREADY>";
  await fs.writeFile(path.join(dir, `${taskId}.snapshot`), header + data, "utf8");
}

async function mouseTrackingMode(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: { modes?: { mouseTrackingMode?: string } } | null;
    };
    return w.__embeddedTerminal?.modes?.mouseTrackingMode ?? null;
  });
}

test.describe("@smoke terminal replay teardown + Reopen reconnect", () => {
  test.setTimeout(60_000);

  test("a closed task's replay tears mouse-tracking off; Reopen reconnects without a page reload", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd("replay-teardown-reopen-");
    let taskId = "";
    try {
      taskId = await createTask(request, cwd, `replay teardown + reopen ${Date.now()}`);

      // 1. Seed a snapshot recorded with mouse-tracking left on, then close
      // the task (state -> done) — the exact precondition the replay-only
      // branch reads on attach, without needing a live pty at all.
      await seedDoneSnapshot(taskId);
      const closed = await request.post(
        `/api/external/tasks/${encodeURIComponent(taskId)}/close`,
      );
      expect(closed.ok()).toBeTruthy();

      // 2. First-ever attach to this (already-done) task — the one-shot
      // replay-only path (AC-1/AC-3).
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("embedded-terminal-replay-only")).toBeVisible({
        timeout: 15_000,
      });
      // The one-shot close lands; the socket stays closed (AC-4 — no
      // reconnect loop for an unrelated attach).
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-open",
        "false",
        { timeout: 15_000 },
      );

      // Bug A, proven end-to-end: the REAL xterm instance's mouse-tracking
      // mode was torn down by the server's replay-only envelope, not just
      // left latched from the replayed snapshot.
      expect(await mouseTrackingMode(page)).toBe("none");

      // 3. Reopen via the task-detail "…" menu (AC-3) — one of the three
      // equivalent entry points (board drag-out-of-Done / TaskCard menu /
      // here); all three converge on the same `/reopen` endpoint and the
      // same `useTerminalSocket` wiring this spec exercises.
      await page.getByTestId("task-detail-menu-trigger").click();
      const reopenItem = page.getByTestId("task-detail-menu-reopen");
      await expect(reopenItem).toBeVisible();
      const reopenResp = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/external/tasks/${taskId}/reopen`) &&
          r.request().method() === "POST",
      );
      await reopenItem.click();
      expect((await reopenResp).ok()).toBeTruthy();

      // The terminal reconnects on its own — no page reload anywhere in
      // this test after the initial navigation to the done task.
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-open",
        "true",
        { timeout: 15_000 },
      );
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-ready",
        "true",
        { timeout: 20_000 },
      );
      await expect(page.getByTestId("embedded-terminal-replay-only")).toHaveCount(0);
    } finally {
      if (taskId) await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
