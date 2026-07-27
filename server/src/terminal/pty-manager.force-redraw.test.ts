/*
 * pty-manager.force-redraw.test.ts — the post-replay redraw nudge
 * (iterate-2026-07-27, FR-01.28).
 *
 * `forceRedraw` re-applies the pty's CURRENT dimensions, deliberately bypassing
 * the `resize()` no-op dedupe. Both halves are load-bearing and pinned here:
 *
 *   - the DEDUPE stays (v0.8.6 AC-2 — a same-size `resize()` must NOT reach the
 *     pty, or PowerShell repaints its banner on every attach-storm resize);
 *   - the NUDGE bypasses it (Zed/xterm: the kernel only auto-delivers SIGWINCH
 *     when the size actually CHANGES, so a same-size re-attach leaves a
 *     fullscreen TUI's screen model stale — and Claude Code's differential
 *     CUF repaint then keeps stale characters in every skipped cell).
 *
 * Both directions matter: a future refactor that "simplifies" forceRedraw into
 * resize() re-breaks the smear, and one that drops the dedupe re-breaks v0.8.6.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { PtyManager, type PtyManagerOpts } from "./pty-manager.js";

interface FakePty {
  resize: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function makeFakePty(): FakePty {
  return {
    resize: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    kill: vi.fn(),
    pid: 4242,
  };
}

/**
 * Reach into the manager's private entry map to install a fake pty. Spawning a
 * real one needs a whitelisted shell + a live cwd (CLAUDE.md rule 17 / DO-NOT
 * #17) and would make this a slow integration test; the unit under test is the
 * dedupe/bypass decision, which is pure bookkeeping.
 */
function installEntry(
  mgr: PtyManager,
  taskId: string,
  pty: FakePty,
  seed: { cols?: number; rows?: number; tornDown?: boolean } = {},
): void {
  const entries = (mgr as unknown as { entries: Map<string, unknown> }).entries;
  entries.set(taskId, {
    pty,
    lastResizeCols: seed.cols,
    lastResizeRows: seed.rows,
    tornDown: seed.tornDown ?? false,
    conns: new Map(),
  });
}

let mgr: PtyManager;
let pty: FakePty;

beforeEach(() => {
  pty = makeFakePty();
  // `spawn` is never exercised here — every test installs its entry directly
  // (see installEntry). It is required by the constructor, so it is stubbed.
  mgr = new PtyManager({
    spawn: vi.fn(() => pty) as unknown as PtyManagerOpts["spawn"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PtyManager.resize — the no-op dedupe stays (v0.8.6 AC-2)", () => {
  it("does NOT reach the pty when cols/rows are unchanged", () => {
    installEntry(mgr, "t1", pty, { cols: 100, rows: 40 });
    mgr.resize("t1", 100, 40);
    expect(pty.resize).not.toHaveBeenCalled();
  });

  it("DOES reach the pty on a real dimension change", () => {
    installEntry(mgr, "t1", pty, { cols: 100, rows: 40 });
    mgr.resize("t1", 94, 40);
    expect(pty.resize).toHaveBeenCalledWith(94, 40);
  });
});

describe("PtyManager.forceRedraw — bypasses the dedupe exactly once", () => {
  it("re-applies the CURRENT dimensions even though nothing changed", () => {
    installEntry(mgr, "t1", pty, { cols: 100, rows: 40 });
    mgr.forceRedraw("t1");
    // Same size as recorded — this is the whole point: node-pty raises a
    // SIGWINCH-driven redraw on every resize call, changed or not.
    expect(pty.resize).toHaveBeenCalledWith(100, 40);
    expect(pty.resize).toHaveBeenCalledTimes(1);
  });

  it("does not disturb the recorded dimensions (a later real resize still lands)", () => {
    installEntry(mgr, "t1", pty, { cols: 100, rows: 40 });
    mgr.forceRedraw("t1");
    mgr.resize("t1", 100, 40); // still a no-op — forceRedraw must not clear state
    expect(pty.resize).toHaveBeenCalledTimes(1);
    mgr.resize("t1", 90, 40);
    expect(pty.resize).toHaveBeenLastCalledWith(90, 40);
  });

  it("is a no-op for an unknown task", () => {
    expect(() => mgr.forceRedraw("nope")).not.toThrow();
    expect(pty.resize).not.toHaveBeenCalled();
  });

  it("is a no-op for a pty that was never sized (fresh spawn draws its first frame anyway)", () => {
    installEntry(mgr, "t1", pty, {});
    mgr.forceRedraw("t1");
    expect(pty.resize).not.toHaveBeenCalled();
  });

  it("is a no-op for a torn-down entry", () => {
    installEntry(mgr, "t1", pty, { cols: 100, rows: 40, tornDown: true });
    mgr.forceRedraw("t1");
    expect(pty.resize).not.toHaveBeenCalled();
  });

  // AC-3 says "swallows a resize throw" without qualifying the thrown TYPE, and
  // JS permits throwing anything. A naive `(err as Error).message` survives the
  // Error case and re-throws on `null` (external code review MEDIUM + LOW).
  for (const [label, thrown] of [
    ["an Error", new Error("pty is gone")],
    ["null", null],
    ["a bare string", "pty is gone"],
    ["a plain object", { code: 267 }],
  ] as const) {
    it(`swallows ${label} thrown by pty.resize`, () => {
      pty.resize.mockImplementation(() => {
        throw thrown;
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      installEntry(mgr, "t1", pty, { cols: 100, rows: 40 });
      expect(() => mgr.forceRedraw("t1")).not.toThrow();
    });
  }
});
