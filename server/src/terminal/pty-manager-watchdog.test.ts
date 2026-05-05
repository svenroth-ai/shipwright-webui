/*
 * pty-manager-watchdog.test.ts — AC-3b (iterate-2026-05-05).
 *
 * The writer-stuck watchdog evicts a writer whose WS bufferedAmount has
 * been above the stuck threshold for at least the configured duration.
 * Eviction follows the standard `detach()` cleanup chain (pause refcount
 * release + reader promotion + onPromoteToWriter).
 *
 * Per external review v2 (gemini-2 + openai-9): the eviction signal is
 * SOCKET DRAINAGE, not pty emission. A runaway pty keeps lastDataAt
 * fresh forever, so a heuristic on pty timing was inverted — would
 * never evict the dead writer under exactly the load conditions that
 * trigger the bug.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  PtyManager,
  type PtyHandleApi,
  type PtySpawnFn,
} from "./pty-manager.js";

const TASK = "11111111-2222-3333-4444-555555555555";

interface FakePty extends PtyHandleApi {
  __paused: number;
  __resumed: number;
  __killed: boolean;
  __emit(data: string): void;
}

function createFakePty(): FakePty {
  const dataListeners: Array<(s: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number }) => void> = [];
  const fake: FakePty = {
    __paused: 0,
    __resumed: 0,
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
    pause() {
      fake.__paused++;
    },
    resume() {
      fake.__resumed++;
    },
    __emit(data) {
      for (const l of dataListeners) l(data);
    },
  };
  return fake;
}

function makeSpawn(): { fn: PtySpawnFn; lastPty: () => FakePty } {
  let last: FakePty | undefined;
  const fn: PtySpawnFn = () => {
    last = createFakePty();
    return last;
  };
  return {
    fn,
    lastPty: () => {
      if (!last) throw new Error("no pty spawned yet");
      return last;
    },
  };
}

/** WS-conn stand-in with a settable bufferedAmount field. */
interface FakeConn {
  id: string;
  bufferedAmount: number;
}

describe("PtyManager — AC-3b watchdog (writer-stuck eviction)", () => {
  let spawn: ReturnType<typeof makeSpawn>;
  let now: number;
  const advance = (ms: number) => {
    now += ms;
  };

  beforeEach(() => {
    spawn = makeSpawn();
    now = 1_000_000_000_000;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeMgr(opts: { stuckMs?: number; thresholdBytes?: number } = {}) {
    return new PtyManager({
      spawn: spawn.fn,
      idleTimeoutMs: 60_000,
      watchdogEnabled: false, // tests drive the tick manually via private call
      watchdogStuckThresholdBytes: opts.thresholdBytes ?? 1024,
      watchdogStuckDurationMs: opts.stuckMs ?? 2000,
      now: () => now,
    });
  }

  /** Manually invoke the private watchdogTick — tests drive timing deterministically. */
  function tick(mgr: PtyManager): void {
    (mgr as unknown as { watchdogTick(): void }).watchdogTick();
  }

  it("evicts a writer that has been stuck above threshold for ≥ stuckMs", () => {
    const mgr = makeMgr({ stuckMs: 2000, thresholdBytes: 1024 });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    const writer: FakeConn = { id: "W", bufferedAmount: 0 };
    const reader: FakeConn = { id: "R", bufferedAmount: 0 };

    mgr.attach(TASK, writer);
    mgr.attach(TASK, reader);
    let promotedFiredFor: unknown = null;
    mgr.subscribeForConnection(TASK, writer, { onData: () => {} });
    mgr.subscribeForConnection(TASK, reader, {
      onData: () => {},
      onPromoteToWriter: () => {
        promotedFiredFor = reader;
      },
    });

    // Drive a delivery so deliverWithBackpressure records bufferedExceededSince.
    writer.bufferedAmount = 2048; // above threshold
    spawn.lastPty().__emit("payload-1");
    // Tick BEFORE 2s of stuck time — no eviction yet.
    advance(1500);
    tick(mgr);
    expect(mgr.getRole(TASK, writer)).toBe("writer");
    expect(promotedFiredFor).toBe(null);

    // Tick AFTER 2s of stuck time — eviction fires.
    advance(600); // total 2100ms ≥ 2000ms
    tick(mgr);
    expect(mgr.getRole(TASK, writer)).toBe(null); // evicted from connSubs
    expect(mgr.getRole(TASK, reader)).toBe("writer"); // promoted
    expect(promotedFiredFor).toBe(reader);
  });

  it("does NOT evict a writer that drains within the stuck window (transient saturation)", () => {
    const mgr = makeMgr({ stuckMs: 2000, thresholdBytes: 1024 });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    const writer: FakeConn = { id: "W", bufferedAmount: 0 };
    mgr.attach(TASK, writer);
    mgr.subscribeForConnection(TASK, writer, { onData: () => {} });

    writer.bufferedAmount = 2048;
    spawn.lastPty().__emit("payload-1");
    advance(1000);
    // Drain mid-window — bufferedAmount drops below threshold.
    writer.bufferedAmount = 200;
    spawn.lastPty().__emit("payload-2"); // updates bufferedExceededSince → null
    advance(1500); // total 2500ms but timer was reset
    tick(mgr);
    expect(mgr.getRole(TASK, writer)).toBe("writer");
  });

  it("does NOT evict a writer that stays under threshold (healthy)", () => {
    const mgr = makeMgr({ stuckMs: 2000, thresholdBytes: 1024 });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    const writer: FakeConn = { id: "W", bufferedAmount: 200 };
    mgr.attach(TASK, writer);
    mgr.subscribeForConnection(TASK, writer, { onData: () => {} });

    spawn.lastPty().__emit("payload-1");
    advance(5000);
    tick(mgr);
    expect(mgr.getRole(TASK, writer)).toBe("writer");
  });

  it("skips eviction per-conn when bufferedAmount is missing; warn fires once globally", () => {
    const mgr = makeMgr();
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    // Conn without bufferedAmount field (simulates legacy WS adapter).
    const writer = { id: "W" }; // no bufferedAmount
    mgr.attach(TASK, writer);
    mgr.subscribeForConnection(TASK, writer, { onData: () => {} });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    tick(mgr); // capability detected as missing → warn
    tick(mgr); // already missing for this conn → no second warn
    tick(mgr);

    const watchdogWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("watchdog disabled"),
    );
    expect(watchdogWarns.length).toBe(1);
    // Writer is unaffected — per-conn capability missing means this
    // specific writer falls back to ws.close-driven release only.
    expect(mgr.getRole(TASK, writer)).toBe("writer");
    warnSpy.mockRestore();
  });

  it("AC-3b post-review fix: capability is per-conn — one missing conn does not disable other conns", () => {
    // Two tasks: taskA's writer has bufferedAmount; taskB's writer
    // doesn't. Watchdog must evict taskA when stuck, NOT silently
    // disable for both.
    const mgr = makeMgr({ stuckMs: 100, thresholdBytes: 1024 });
    const TASK_A = "11111111-2222-3333-4444-aaaaaaaaaaaa";
    const TASK_B = "11111111-2222-3333-4444-bbbbbbbbbbbb";
    mgr.spawn(TASK_A, { cwd: process.cwd(), shell: "bash" });
    mgr.spawn(TASK_B, { cwd: process.cwd(), shell: "bash" });

    const writerA: FakeConn = { id: "WA", bufferedAmount: 4096 };
    const writerB = { id: "WB" }; // no bufferedAmount
    mgr.attach(TASK_A, writerA);
    mgr.attach(TASK_B, writerB);
    mgr.subscribeForConnection(TASK_A, writerA, { onData: () => {} });
    mgr.subscribeForConnection(TASK_B, writerB, { onData: () => {} });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Tick 1 — both writers seen. WriterA: bufferedAmount > threshold,
    // start the stuck-timer. WriterB: capability missing → skipped + warn.
    tick(mgr);
    advance(150);
    // Tick 2 — WriterA's timer is now ≥ 100ms → evict. WriterB still
    // skipped silently (warn already logged once).
    tick(mgr);

    expect(mgr.getRole(TASK_A, writerA)).toBe(null); // evicted
    expect(mgr.getRole(TASK_B, writerB)).toBe("writer"); // untouched
    warnSpy.mockRestore();
  });

  it("force-evict releases the writer's pause stake (no refcount leak)", () => {
    const mgr = makeMgr({ stuckMs: 100 });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const fake = spawn.lastPty();

    const writer: FakeConn = { id: "W", bufferedAmount: 0 };
    mgr.attach(TASK, writer);
    mgr.subscribeForConnection(TASK, writer, { onData: () => {} });

    // Writer holds a pause stake (mid-replay scenario).
    mgr.pauseForConn(TASK, writer);
    expect(fake.__paused).toBe(1);
    expect(fake.__resumed).toBe(0);

    // Push above threshold + age past stuckMs → watchdog evicts.
    writer.bufferedAmount = 4096;
    spawn.lastPty().__emit("seg-1");
    advance(200);
    tick(mgr);

    // pty.resume MUST have fired during force-evict — refcount cleanup.
    expect(fake.__resumed).toBe(1);
    expect(mgr.getRole(TASK, writer)).toBe(null);
  });

  it("stale ws.close after eviction is a no-op for the writer slot", () => {
    const mgr = makeMgr({ stuckMs: 100 });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    const oldWriter: FakeConn = { id: "OLD", bufferedAmount: 4096 };
    const newWriter: FakeConn = { id: "NEW", bufferedAmount: 0 };
    mgr.attach(TASK, oldWriter);
    mgr.attach(TASK, newWriter);
    mgr.subscribeForConnection(TASK, oldWriter, { onData: () => {} });
    mgr.subscribeForConnection(TASK, newWriter, { onData: () => {} });

    spawn.lastPty().__emit("payload");
    advance(200);
    tick(mgr); // evicts oldWriter, promotes newWriter
    expect(mgr.getRole(TASK, newWriter)).toBe("writer");

    // Now the delayed ws.close for oldWriter arrives.
    mgr.detach(TASK, oldWriter);
    // newWriter remains writer — stale close did not flip the slot.
    expect(mgr.getRole(TASK, newWriter)).toBe("writer");
  });

  it("watchdog timer is cleared on killAll()", () => {
    vi.useFakeTimers();
    const watchdogMgr = new PtyManager({
      spawn: spawn.fn,
      watchdogEnabled: true,
      watchdogIntervalMs: 1000,
      now: () => now,
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    watchdogMgr.killAll();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
