/*
 * idle-reaper.test.ts — iterate-2026-06-02-terminal-idle-attachment-gate
 *
 * The orphan-GC must reap a pty only when it is genuinely orphaned —
 * idle AND with NO WS client attached. The historical bug (session
 * 42feb775, 2026-06-02): a pty where Claude waited at an interactive
 * AskUserQuestion prompt produced no I/O for 30 min, so the pure
 * I/O-silence ceiling reaped it WHILE a client was watching, losing the
 * un-persisted turn on resume.
 *
 * These tests pin the attachment-gating contract on the pure module
 * (timer-seam injected — no fake globals, fully deterministic).
 */

import { describe, expect, it, vi } from "vitest";
import { IdleReaper, DEFAULT_IDLE_TIMEOUT_MS } from "./idle-reaper.js";

const TASK = "11111111-2222-3333-4444-555555555555";
const TIMEOUT = 1000;

/** Deterministic manual scheduler — no real or fake global timers. */
function makeScheduler() {
  let seq = 0;
  let now = 0;
  const tasks = new Map<number, { fn: () => void; due: number }>();
  return {
    setTimeoutFn: ((fn: () => void, ms: number) => {
      const id = ++seq;
      tasks.set(id, { fn, due: now + ms });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as (fn: () => void, ms: number) => ReturnType<typeof setTimeout>,
    clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
      tasks.delete(id as unknown as number);
    }) as (id: ReturnType<typeof setTimeout>) => void,
    advance(ms: number) {
      now += ms;
      const due: Array<[number, () => void]> = [];
      for (const [id, t] of tasks) {
        if (t.due <= now) due.push([id, t.fn]);
      }
      for (const [id, fn] of due) {
        tasks.delete(id);
        fn();
      }
    },
    pending: () => tasks.size,
  };
}

function makeReaper(onReap: (taskId: string) => void) {
  const sched = makeScheduler();
  const reaper = new IdleReaper({
    timeoutMs: TIMEOUT,
    onReap,
    setTimeoutFn: sched.setTimeoutFn,
    clearTimeoutFn: sched.clearTimeoutFn,
  });
  return { reaper, sched };
}

describe("IdleReaper — attachment-gated orphan GC", () => {
  it("exports a 12h default grace", () => {
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(43_200_000);
  });

  it("AC2: arms when attachCount === 0 and reaps after the timeout", () => {
    const onReap = vi.fn();
    const { reaper, sched } = makeReaper(onReap);
    reaper.touch(TASK, 0);
    expect(reaper.isArmed(TASK)).toBe(true);
    sched.advance(TIMEOUT + 1);
    expect(onReap).toHaveBeenCalledExactlyOnceWith(TASK);
    expect(reaper.isArmed(TASK)).toBe(false);
  });

  it("AC1: does NOT arm while a client is attached (attachCount > 0) — never reaps", () => {
    const onReap = vi.fn();
    const { reaper, sched } = makeReaper(onReap);
    reaper.touch(TASK, 1);
    expect(reaper.isArmed(TASK)).toBe(false);
    sched.advance(TIMEOUT * 5);
    expect(onReap).not.toHaveBeenCalled();
  });

  it("AC3: re-attach before expiry disarms the grace (the pty survives)", () => {
    const onReap = vi.fn();
    const { reaper, sched } = makeReaper(onReap);
    reaper.touch(TASK, 0); // detached → grace armed
    sched.advance(TIMEOUT / 2); // halfway through the grace
    reaper.touch(TASK, 1); // a client re-attaches
    expect(reaper.isArmed(TASK)).toBe(false);
    sched.advance(TIMEOUT * 2);
    expect(onReap).not.toHaveBeenCalled();
  });

  it("re-touch while still detached resets the grace (idle from the last touch)", () => {
    const onReap = vi.fn();
    const { reaper, sched } = makeReaper(onReap);
    reaper.touch(TASK, 0);
    sched.advance(TIMEOUT * 0.75);
    reaper.touch(TASK, 0); // e.g. late pty output with nobody watching
    sched.advance(TIMEOUT * 0.75); // 1.5× total, but only 0.75× since last touch
    expect(onReap).not.toHaveBeenCalled();
    sched.advance(TIMEOUT * 0.5); // now past the timeout since last touch
    expect(onReap).toHaveBeenCalledExactlyOnceWith(TASK);
  });

  it("cancel() disarms an armed grace", () => {
    const onReap = vi.fn();
    const { reaper, sched } = makeReaper(onReap);
    reaper.touch(TASK, 0);
    reaper.cancel(TASK);
    expect(reaper.isArmed(TASK)).toBe(false);
    sched.advance(TIMEOUT * 2);
    expect(onReap).not.toHaveBeenCalled();
  });

  it("tracks tasks independently", () => {
    const onReap = vi.fn();
    const { reaper, sched } = makeReaper(onReap);
    const A = "aaaaaaaa-2222-3333-4444-555555555555";
    const B = "bbbbbbbb-2222-3333-4444-555555555555";
    reaper.touch(A, 0); // orphaned → armed
    reaper.touch(B, 1); // watched → not armed
    sched.advance(TIMEOUT + 1);
    expect(onReap).toHaveBeenCalledExactlyOnceWith(A);
  });

  it("a corrupted negative attachCount disarms (never reaps) — safe direction", () => {
    const onReap = vi.fn();
    const { reaper, sched } = makeReaper(onReap);
    reaper.touch(TASK, -1);
    expect(reaper.isArmed(TASK)).toBe(false);
    sched.advance(TIMEOUT * 2);
    expect(onReap).not.toHaveBeenCalled();
  });

  it("cancel() on an unknown task is a no-op", () => {
    const onReap = vi.fn();
    const { reaper } = makeReaper(onReap);
    expect(() => reaper.cancel("unknown")).not.toThrow();
    expect(reaper.isArmed("unknown")).toBe(false);
  });
});
