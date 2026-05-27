/*
 * ws-upgrade-handler.test.ts — lifecycle + inbound-parsing tests for
 * the WS upgrade body extracted in iterate-2026-05-27-ws-upgrade-handler-split
 * (ADR-103 retirement candidate #1).
 *
 * Coverage maps to the iterate spec ACs + external plan review MED #4:
 *   (a) replay-only attach emits a ready envelope with the right fields
 *       AND then closes the socket cleanly.
 *   (b) live attach emits a ready envelope with the exact field set
 *       (key parity assertion — external plan review LOW #10).
 *   (c) inbound-message parsing table (valid data / resize, malformed
 *       JSON, wrong discriminator, structurally invalid payload).
 *   (d) onClose triggers a single atomic detachAndCount + a
 *       fire-and-forget flushMirrorSnapshot iff the remaining count is 0
 *       (ADR-092 atomic-detach contract — external plan review MED #5).
 *   (e) new-plain awaiting_external_start → active flip (AC-4).
 *
 * Full WS attach against a real pty is covered by the Playwright E2E
 * (`client/e2e/flows/82-v0.8.6-terminal-reattach-smoke.spec.ts` and
 * the C5 split smoke). These tests stay native-binary-free.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  buildWsHandlers,
  isWSInbound,
  type ValidatedWsUpgradeContext,
} from "./ws-upgrade-handler.js";
import type { PtyManager, PtyHandleMeta } from "./pty-manager.js";
import type {
  ExternalTask,
  ExternalTaskState,
} from "../core/sdk-sessions-store.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "00000000-0000-0000-0000-000000000001",
    cwd: "/tmp/proj",
    pluginDirs: [],
    state: "active" as ExternalTaskState,
    title: "test",
    projectId: "unassigned",
    createdAt: "2026-05-27T00:00:00.000Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

function makeMeta(overrides: Partial<PtyHandleMeta> = {}): PtyHandleMeta {
  return {
    taskId: "task-1",
    cwd: "/tmp/proj",
    shell: "pwsh.exe",
    shellKind: "pwsh",
    ...overrides,
  };
}

interface MockWs {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeWs(): MockWs {
  return {
    send: vi.fn(),
    close: vi.fn(),
  };
}

interface MockPtyManager extends PtyManager {
  // expose the mocks for assertions
  __mocks: {
    get: ReturnType<typeof vi.fn>;
    spawn: ReturnType<typeof vi.fn>;
    attach: ReturnType<typeof vi.fn>;
    subscribeForConnection: ReturnType<typeof vi.fn>;
    pauseForConn: ReturnType<typeof vi.fn>;
    resumeForConn: ReturnType<typeof vi.fn>;
    serializeMirrorIfLive: ReturnType<typeof vi.fn>;
    detachAndCount: ReturnType<typeof vi.fn>;
    flushMirrorSnapshot: ReturnType<typeof vi.fn>;
    getRole: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  };
}

function makePtyManager(
  opts: {
    ptyExistsBefore?: boolean;
    attachResult?: { role: "writer" | "reader"; hadPriorWriter: boolean };
    remainingAttachCount?: number;
    liveSnapshot?: unknown;
  } = {},
): MockPtyManager {
  const ptyExistsBefore = opts.ptyExistsBefore ?? false;
  const attachResult = opts.attachResult ?? { role: "writer", hadPriorWriter: false };
  const remainingAttachCount = opts.remainingAttachCount ?? 0;
  const liveSnapshot = opts.liveSnapshot ?? null;

  const get = vi.fn(() => (ptyExistsBefore ? makeMeta() : undefined));
  const spawn = vi.fn(() => makeMeta());
  const attach = vi.fn(() => attachResult);
  const subscribeForConnection = vi.fn();
  const pauseForConn = vi.fn();
  const resumeForConn = vi.fn();
  const serializeMirrorIfLive = vi.fn(async () => liveSnapshot);
  const detachAndCount = vi.fn(() => ({ remainingAttachCount }));
  const flushMirrorSnapshot = vi.fn(async () => undefined);
  const getRole = vi.fn(() => attachResult.role);
  const write = vi.fn();
  const resize = vi.fn();

  const m = {
    get, spawn, attach, subscribeForConnection,
    pauseForConn, resumeForConn,
    serializeMirrorIfLive, detachAndCount, flushMirrorSnapshot,
    getRole, write, resize,
    __mocks: {
      get, spawn, attach, subscribeForConnection,
      pauseForConn, resumeForConn,
      serializeMirrorIfLive, detachAndCount, flushMirrorSnapshot,
      getRole, write, resize,
    },
  } as unknown as MockPtyManager;
  return m;
}

function makeStore(): {
  get: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(),
    patch: vi.fn(),
    persist: vi.fn(async () => undefined),
  };
}

function makeCtx(
  overrides: Partial<ValidatedWsUpgradeContext> = {},
): ValidatedWsUpgradeContext {
  return {
    taskId: "task-1",
    task: makeTask(),
    trustedCwd: "/tmp/proj",
    ptyManager: makePtyManager(),
    // store is structurally typed in ValidatedWsUpgradeContext; the
    // handler only calls .patch and .persist, both shaped on the mock.
    store: makeStore() as unknown as ValidatedWsUpgradeContext["store"],
    retentionDays: 1,
    scrollbackDirHint: "<scrollback>",
    resolveShell: () => "pwsh.exe",
    ...overrides,
  };
}

function readSent(ws: MockWs): unknown[] {
  return ws.send.mock.calls.map((args) => {
    const raw = args[0] as string;
    return JSON.parse(raw);
  });
}

// Helper: drain microtasks so the async IIFE inside onOpen runs to
// completion (replay-only branch + live branch both schedule async
// work after the synchronous ready emit).
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// (a) Replay-only attach
// ---------------------------------------------------------------------------

describe("buildWsHandlers — replay-only branch", () => {
  it("emits a ready envelope and closes for state=done", async () => {
    const ctx = makeCtx({ task: makeTask({ state: "done" }) });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    expect(handlers.onOpen).toBeDefined();
    expect(handlers.onMessage).toBeUndefined();
    expect(handlers.onClose).toBeUndefined();
    expect(handlers.onError).toBeUndefined();
    handlers.onOpen?.({} as Event, ws as never);
    await flushAsync();

    const sent = readSent(ws);
    const ready = sent.find(
      (s) => (s as { type?: string }).type === "ready",
    ) as Record<string, unknown> | undefined;
    expect(ready).toBeDefined();
    expect(ready).toMatchObject({
      type: "ready",
      role: "reader",
      shellKind: null,
      cwd: "/tmp/proj",
      replayOnly: true,
      terminalReset: false,
      ptyReused: false,
      retentionDays: 1,
      scrollbackDir: "<scrollback>",
    });
    expect(ws.close).toHaveBeenCalledWith(1000);
  });

  it("also fires for state=launch_failed", async () => {
    const ctx = makeCtx({ task: makeTask({ state: "launch_failed" }) });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);
    await flushAsync();
    const sent = readSent(ws);
    const ready = sent.find(
      (s) => (s as { type?: string }).type === "ready",
    ) as { replayOnly: boolean } | undefined;
    expect(ready?.replayOnly).toBe(true);
  });

  it("does NOT call ptyManager.spawn / attach / subscribe", async () => {
    const pm = makePtyManager();
    const ctx = makeCtx({
      task: makeTask({ state: "done" }),
      ptyManager: pm,
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    await flushAsync();
    expect(pm.__mocks.spawn).not.toHaveBeenCalled();
    expect(pm.__mocks.attach).not.toHaveBeenCalled();
    expect(pm.__mocks.subscribeForConnection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (b) Live attach — ready envelope shape
// ---------------------------------------------------------------------------

describe("buildWsHandlers — live branch ready envelope", () => {
  it("emits a ready envelope with exactly the documented field set", () => {
    const pm = makePtyManager({
      ptyExistsBefore: false,
      attachResult: { role: "writer", hadPriorWriter: false },
    });
    const ctx = makeCtx({
      ptyManager: pm,
      task: makeTask({ state: "active" }),
    });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);

    const sent = readSent(ws);
    const ready = sent.find(
      (s) => (s as { type?: string }).type === "ready",
    ) as Record<string, unknown> | undefined;
    expect(ready).toBeDefined();
    // Exact key set — guards against accidental drift in the
    // envelope contract (external plan review LOW #10).
    expect(new Set(Object.keys(ready!))).toEqual(
      new Set([
        "type",
        "role",
        "shellKind",
        "cwd",
        "replayOnly",
        "terminalReset",
        "ptyReused",
        "scrollbackBytes",
        "retentionDays",
        "scrollbackDir",
      ]),
    );
    expect(ready).toMatchObject({
      type: "ready",
      role: "writer",
      shellKind: "pwsh",
      cwd: "/tmp/proj",
      replayOnly: false,
      ptyReused: false,
      scrollbackBytes: 0,
      retentionDays: 1,
      scrollbackDir: "<scrollback>",
    });
  });

  it("ptyReused tracks hadPriorWriter (true) not ptyExistedBeforeAttach", () => {
    // Setup: pty exists in prewarm state (no writer attached yet).
    // hadPriorWriter=false in this case; iterate-2026-05-27-fix-pty-
    // reused-prewarm-race contract.
    const pm = makePtyManager({
      ptyExistsBefore: true,
      attachResult: { role: "writer", hadPriorWriter: false },
    });
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);
    const ready = readSent(ws).find(
      (s) => (s as { type?: string }).type === "ready",
    ) as { ptyReused: boolean };
    expect(ready.ptyReused).toBe(false);
  });

  it("emits second-attach envelope when role=reader", () => {
    const pm = makePtyManager({
      attachResult: { role: "reader", hadPriorWriter: true },
    });
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);
    const types = readSent(ws).map((s) => (s as { type?: string }).type);
    expect(types).toContain("ready");
    expect(types).toContain("second-attach");
  });

  it("does NOT emit second-attach when role=writer", () => {
    const pm = makePtyManager({
      attachResult: { role: "writer", hadPriorWriter: false },
    });
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);
    const types = readSent(ws).map((s) => (s as { type?: string }).type);
    expect(types).not.toContain("second-attach");
  });
});

// ---------------------------------------------------------------------------
// (c) Inbound message parsing table
// ---------------------------------------------------------------------------

describe("isWSInbound — inbound parsing discriminator", () => {
  const table: Array<{ desc: string; input: unknown; ok: boolean }> = [
    { desc: "valid data frame", input: { type: "data", payload: "hi" }, ok: true },
    {
      desc: "valid resize frame",
      input: { type: "resize", cols: 80, rows: 24 },
      ok: true,
    },
    { desc: "wrong discriminator", input: { type: "ping" }, ok: false },
    {
      desc: "data with non-string payload",
      input: { type: "data", payload: 42 },
      ok: false,
    },
    {
      desc: "resize with missing rows",
      input: { type: "resize", cols: 80 },
      ok: false,
    },
    {
      desc: "resize with string cols",
      input: { type: "resize", cols: "80", rows: 24 },
      ok: false,
    },
    { desc: "null", input: null, ok: false },
    { desc: "non-object", input: "hello", ok: false },
    { desc: "missing type field", input: { payload: "hi" }, ok: false },
  ];
  for (const row of table) {
    it(`${row.desc} → ${row.ok ? "accepted" : "rejected"}`, () => {
      expect(isWSInbound(row.input)).toBe(row.ok);
    });
  }
});

describe("buildWsHandlers — onMessage routing", () => {
  let pm: MockPtyManager;
  let handlers: ReturnType<typeof buildWsHandlers>;
  let ws: MockWs;

  beforeEach(() => {
    pm = makePtyManager({
      attachResult: { role: "writer", hadPriorWriter: false },
    });
    const ctx = makeCtx({ ptyManager: pm });
    handlers = buildWsHandlers(ctx);
    ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);
    // Clear ready/second-attach sends so we only inspect onMessage
    // responses below.
    ws.send.mockClear();
  });

  it("writer + valid data → ptyManager.write", () => {
    pm.__mocks.getRole.mockReturnValueOnce("writer");
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "data", payload: "ls\n" }) } as never,
      ws as never,
    );
    expect(pm.__mocks.write).toHaveBeenCalledWith("task-1", "ls\n");
  });

  it("writer + valid resize → ptyManager.resize", () => {
    pm.__mocks.getRole.mockReturnValueOnce("writer");
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "resize", cols: 120, rows: 40 }) } as never,
      ws as never,
    );
    expect(pm.__mocks.resize).toHaveBeenCalledWith("task-1", 120, 40);
  });

  it("reader role → emits read_only and skips write", () => {
    pm.__mocks.getRole.mockReturnValueOnce("reader");
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "data", payload: "ls\n" }) } as never,
      ws as never,
    );
    expect(pm.__mocks.write).not.toHaveBeenCalled();
    const types = readSent(ws).map((s) => (s as { type?: string }).type);
    expect(types).toContain("read_only");
  });

  it("malformed JSON → silently dropped", () => {
    handlers.onMessage?.({ data: "{not json" } as never, ws as never);
    expect(pm.__mocks.write).not.toHaveBeenCalled();
    expect(pm.__mocks.resize).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("invalid discriminator → silently dropped", () => {
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "ping" }) } as never,
      ws as never,
    );
    expect(pm.__mocks.write).not.toHaveBeenCalled();
    expect(pm.__mocks.resize).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (d) Atomic detach + snapshot-on-last-detach
// ---------------------------------------------------------------------------

describe("buildWsHandlers — onClose / onError atomic detach", () => {
  it("onClose calls detachAndCount once and flushes when count=0", () => {
    const pm = makePtyManager({ remainingAttachCount: 0 });
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    handlers.onClose?.({} as CloseEvent, makeWs() as never);
    expect(pm.__mocks.detachAndCount).toHaveBeenCalledTimes(1);
    expect(pm.__mocks.flushMirrorSnapshot).toHaveBeenCalledWith("task-1");
  });

  it("onClose does NOT flush when other attaches remain", () => {
    const pm = makePtyManager({ remainingAttachCount: 1 });
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    handlers.onClose?.({} as CloseEvent, makeWs() as never);
    expect(pm.__mocks.detachAndCount).toHaveBeenCalledTimes(1);
    expect(pm.__mocks.flushMirrorSnapshot).not.toHaveBeenCalled();
  });

  it("onError takes the same path (atomic detach + conditional flush)", () => {
    const pm = makePtyManager({ remainingAttachCount: 0 });
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    handlers.onError?.({} as Event, makeWs() as never);
    expect(pm.__mocks.detachAndCount).toHaveBeenCalledTimes(1);
    expect(pm.__mocks.flushMirrorSnapshot).toHaveBeenCalledTimes(1);
  });

  // Documents the dual-fire behavior preserved from origin/main: both
  // onError and onClose call detachAndCount unconditionally. node-pty
  // + @hono/node-ws fires ONE of these per WS lifecycle in practice
  // (close on clean shutdown, error on socket break), but the
  // dedupe-against-double-detach lives in ptyManager itself (the
  // second detachAndCount sees no entry → remainingAttachCount=0).
  // External code review MED #3 (openrouter/openai, 2026-05-27): we
  // record the behavior here so a future implementation that adds
  // internal dedup is a deliberate decision, not an accidental
  // silent change.
  it("onError followed by onClose for the same conn: both fire detachAndCount", () => {
    const pm = makePtyManager({ remainingAttachCount: 0 });
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);
    handlers.onError?.({} as Event, ws as never);
    handlers.onClose?.({} as CloseEvent, ws as never);
    // 2 detach calls — the dedupe responsibility lives in PtyManager.
    expect(pm.__mocks.detachAndCount).toHaveBeenCalledTimes(2);
    // flushMirrorSnapshot is idempotent (snapshot-store.ts PQueue
    // per task) so two fire-and-forget calls are safe.
    expect(pm.__mocks.flushMirrorSnapshot).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// (e) new-plain awaiting_external_start → active flip (AC-4)
// ---------------------------------------------------------------------------

describe("buildWsHandlers — new-plain state flip", () => {
  it("flips awaiting_external_start → active when actionId=new-plain", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({
        state: "awaiting_external_start",
        actionId: "new-plain",
      }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).toHaveBeenCalledWith("task-1", { state: "active" });
    expect(store.persist).toHaveBeenCalled();
  });

  it("does NOT flip for non-new-plain actionId", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({
        state: "awaiting_external_start",
        actionId: "resume",
      }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).not.toHaveBeenCalled();
  });

  it("does NOT flip when state is already active", () => {
    const store = makeStore();
    const ctx = makeCtx({
      store: store as unknown as ValidatedWsUpgradeContext["store"],
      task: makeTask({ state: "active", actionId: "new-plain" }),
    });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    expect(store.patch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pause/resume balance — locks-aware sanity check (external plan review MED #5)
// ---------------------------------------------------------------------------

describe("buildWsHandlers — pause-stake balance", () => {
  it("calls pauseForConn before and resumeForConn after the replay IIFE", async () => {
    const pm = makePtyManager();
    const ctx = makeCtx({ ptyManager: pm });
    const handlers = buildWsHandlers(ctx);
    handlers.onOpen?.({} as Event, makeWs() as never);
    await flushAsync();
    expect(pm.__mocks.pauseForConn).toHaveBeenCalledTimes(1);
    expect(pm.__mocks.resumeForConn).toHaveBeenCalledTimes(1);
  });
});
