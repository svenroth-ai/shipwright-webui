/*
 * idle-heartbeat-composition.test.ts
 * iterate-2026-06-02-terminal-idle-attachment-gate — AC5
 *
 * End-to-end guard for the exact incident path (session 42feb775): a remote
 * client's socket goes half-open (laptop sleep / Tailscale drop). The
 * attachment-gated idle ceiling (Part A) keeps the pty immortal WHILE the
 * socket still counts as attached; the WS heartbeat (Part B, shipped
 * 2026-05-31) then terminates the dead socket, whose onClose runs
 * `detachAndCount` → attachCount 0 → the idle grace finally arms and the
 * orphan is reaped. Composition of the two parts, with the REAL heartbeat
 * monitor + the REAL pty-manager detach (no mocks of either).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { PtyManager, type PtyHandleApi, type PtySpawnFn } from "./pty-manager.js";
import { startWsHeartbeat } from "./ws-heartbeat.js";

const TASK = "44444444-5555-6666-7777-888888888888";
const IDLE_MS = 1000;

interface FakePty extends PtyHandleApi {
  __killed: boolean;
}

function makeManager(): { mgr: PtyManager; lastPty: () => FakePty } {
  let last: FakePty | undefined;
  const spawn: PtySpawnFn = () => {
    const exitListeners: Array<(e: { exitCode: number }) => void> = [];
    const fake: FakePty = {
      __killed: false,
      onData() {
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
    };
    last = fake;
    return fake;
  };
  const mgr = new PtyManager({ spawn, idleTimeoutMs: IDLE_MS });
  return { mgr, lastPty: () => last as FakePty };
}

/** Fake `ws` raw socket that never answers a pong (a half-open peer). */
function makeDeadRawSocket(onTerminate: () => void) {
  return {
    readyState: 1, // WS_OPEN
    ping() {},
    terminate() {
      onTerminate();
    },
    on() {},
    off() {},
  };
}

describe("AC5 — idle ceiling × WS heartbeat composition", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps an attached pty alive until the heartbeat reaps its dead socket, then arms the grace", () => {
    vi.useFakeTimers();
    const { mgr, lastPty } = makeManager();
    mgr.spawn(TASK, { cwd: "/tmp", shell: "bash" });
    const conn = { id: "ws-dead" };
    mgr.attach(TASK, conn);

    // The real WS onClose path runs detachAndCount; wire terminate() to it,
    // mirroring `ws-upgrade-handler`'s onClose → detachAndCount.
    let tick: (() => void) | null = null;
    const raw = makeDeadRawSocket(() => {
      mgr.detachAndCount(TASK, conn);
    });
    startWsHeartbeat(
      { raw },
      {
        intervalMs: 1,
        maxMissedPongs: 1, // reap on the 2nd unanswered tick
        setIntervalFn: (fn) => {
          tick = fn as () => void;
          return 0 as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: () => {},
      },
    );

    // While the (dying) socket is still attached, the ceiling must NOT fire.
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(lastPty().__killed).toBe(false);
    expect(mgr.attachCount(TASK)).toBe(1);

    // Heartbeat detects the dead peer. The REAL monitor tolerates one miss:
    // tick 1 → ping (still attached), tick 2 → terminate → detach. Proves the
    // live heartbeat (not a hardcoded shortcut) drives the reap.
    tick!();
    expect(mgr.attachCount(TASK)).toBe(1); // 1 missed pong → ping, not yet reaped
    tick!();
    expect(mgr.attachCount(TASK)).toBe(0); // 2nd miss → terminate → onClose → detach

    // Now genuinely orphaned → reaped after the grace elapses.
    vi.advanceTimersByTime(IDLE_MS + 50);
    expect(lastPty().__killed).toBe(true);
    expect(mgr.get(TASK)).toBeUndefined();
  });
});
