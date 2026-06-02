/*
 * pty-manager.idle-attachment.test.ts
 * iterate-2026-06-02-terminal-idle-attachment-gate
 *
 * Regression guard for the data-loss bug (session 42feb775, 2026-06-02):
 * the 30-min idle ceiling reaped a pty WHILE a client was attached and
 * Claude was waiting at an interactive prompt (no pty I/O), losing the
 * un-persisted final turn on `claude --resume`.
 *
 * Contract: the idle ceiling fires ONLY when no WS client is attached.
 *   - attached  → never reaped, however long the pty is silent  (AC1)
 *   - detached  → grace arms; reaped after the timeout            (AC2)
 *   - re-attach before expiry → grace disarmed, pty survives      (AC3)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { PtyManager, type PtyHandleApi, type PtySpawnFn } from "./pty-manager.js";

const TASK = "22222222-3333-4444-5555-666666666666";
const IDLE_MS = 1000;

interface FakePty extends PtyHandleApi {
  __killed: boolean;
  __emit(data: string): void;
}

function createFakePty(): FakePty {
  const dataListeners: Array<(s: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number }) => void> = [];
  const fake: FakePty = {
    __killed: false,
    onData(cb) {
      dataListeners.push(cb);
      return { dispose() {} };
    },
    onExit(cb) {
      exitListeners.push(cb);
      return { dispose() {} };
    },
    write() {},
    resize() {},
    kill() {
      fake.__killed = true;
      for (const l of exitListeners) l({ exitCode: 0 });
    },
    pause() {},
    resume() {},
    __emit(data) {
      for (const l of dataListeners) l(data);
    },
  };
  return fake;
}

function makeManager(): { mgr: PtyManager; lastPty: () => FakePty } {
  let last: FakePty | undefined;
  const spawn: PtySpawnFn = () => {
    last = createFakePty();
    return last;
  };
  const mgr = new PtyManager({ spawn, idleTimeoutMs: IDLE_MS });
  return { mgr, lastPty: () => last as FakePty };
}

describe("pty-manager — idle ceiling is gated on client attachment", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC1: a pty with an attached client is NOT reaped even when idle past the ceiling", () => {
    vi.useFakeTimers();
    const { mgr, lastPty } = makeManager();
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const conn = { id: "ws-1" };
    mgr.attach(TASK, conn); // a client is watching

    // No pty I/O at all (Claude waiting at AskUserQuestion). Far past ceiling.
    vi.advanceTimersByTime(IDLE_MS * 5);

    expect(lastPty().__killed).toBe(false);
    expect(mgr.get(TASK)).toBeDefined();
  });

  it("AC2: a fully-detached pty arms the grace and is reaped after the ceiling", () => {
    vi.useFakeTimers();
    const { mgr, lastPty } = makeManager();
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const conn = { id: "ws-1" };
    mgr.attach(TASK, conn);
    const { remainingAttachCount } = mgr.detachAndCount(TASK, conn);
    expect(remainingAttachCount).toBe(0);

    vi.advanceTimersByTime(IDLE_MS + 50);

    expect(lastPty().__killed).toBe(true);
    expect(mgr.get(TASK)).toBeUndefined();
  });

  it("AC3: re-attach before the grace elapses keeps the pty alive", () => {
    vi.useFakeTimers();
    const { mgr, lastPty } = makeManager();
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const conn1 = { id: "ws-1" };
    mgr.attach(TASK, conn1);
    mgr.detachAndCount(TASK, conn1); // grace arms
    vi.advanceTimersByTime(IDLE_MS / 2); // partway through

    const conn2 = { id: "ws-2" }; // user reconnects (e.g. on the train)
    mgr.attach(TASK, conn2);
    vi.advanceTimersByTime(IDLE_MS * 2);

    expect(lastPty().__killed).toBe(false);
    expect(mgr.get(TASK)).toBeDefined();
  });

  it("a detached pty that keeps producing output is not reaped (active != orphan)", () => {
    vi.useFakeTimers();
    const { mgr, lastPty } = makeManager();
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    // never attached, but the shell is actively emitting just under the ceiling
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(IDLE_MS * 0.6);
      lastPty().__emit(`tick ${i}\r\n`); // resets the grace each time
    }
    expect(lastPty().__killed).toBe(false);
    // …then it goes quiet → reaped after one full ceiling
    vi.advanceTimersByTime(IDLE_MS + 50);
    expect(lastPty().__killed).toBe(true);
  });
});
