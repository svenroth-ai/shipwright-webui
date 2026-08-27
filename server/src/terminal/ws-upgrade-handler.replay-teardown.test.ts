/*
 * ws-upgrade-handler.replay-teardown.test.ts — live-branch replay-snapshot
 * interaction-mode teardown (doubt-reviewer HIGH,
 * iterate-2026-08-27-terminal-replay-reset-reopen-reconnect).
 *
 * Split out of ws-upgrade-handler.test.ts (Stop-hook bloat gate: that file
 * crossed 300 lines) — a cohesive, self-contained block, same pattern as
 * the pre-existing .parse.test.ts / .detach.test.ts siblings.
 *
 * A no-live-pty attach (reaped pty / server restart, `ptyExistedBeforeAttach
 * === false`) replays the same kind of stale on-disk cell-state snapshot as
 * the replay-only branch, and no live pty will ever follow up to turn a
 * latched mouse-tracking/alt-scroll mode back off — reproducing Bug A's
 * dead-scroll/dead-copy defect through this other call site. AC-2
 * (live/resync byte-for-byte unchanged) requires the teardown to be ABSENT
 * when a live pty already existed before this attach.
 */

import { describe, expect, it } from "vitest";

import { buildWsHandlers } from "./ws-upgrade-handler.js";
import {
  flushAsync,
  makeCtx,
  makePtyManager,
  makeWs,
  readSent,
} from "./ws-upgrade-handler.fixtures.js";

describe("buildWsHandlers — live branch replay-snapshot interaction-mode teardown", () => {
  const mouseTrackingSnapshot = {
    version: "v2" as const,
    terminalVersion: "1.0.0",
    cols: 80,
    rows: 24,
    data: "\x1b[?1000h",
  };

  it("appends the teardown when no live pty existed before this attach (reaped/restarted)", async () => {
    const pm = makePtyManager({
      ptyExistsBefore: false,
      liveSnapshot: mouseTrackingSnapshot,
    });
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);
    await flushAsync();

    const snap = readSent(ws).find(
      (s) => (s as { type?: string }).type === "replay_snapshot",
    ) as { data: string } | undefined;
    expect(snap).toBeDefined();
    expect(snap!.data.endsWith("\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?9l\x1b[?1006l\x1b[?1007l")).toBe(true);
  });

  it("does NOT append the teardown when a live pty already existed (AC-2)", async () => {
    const pm = makePtyManager({
      ptyExistsBefore: true,
      liveSnapshot: mouseTrackingSnapshot,
    });
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);
    await flushAsync();

    const snap = readSent(ws).find(
      (s) => (s as { type?: string }).type === "replay_snapshot",
    ) as { data: string } | undefined;
    expect(snap).toBeDefined();
    expect(snap!.data.endsWith("\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?9l\x1b[?1006l\x1b[?1007l")).toBe(false);
  });
});
