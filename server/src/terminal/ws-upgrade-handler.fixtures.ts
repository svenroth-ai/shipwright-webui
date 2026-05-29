/*
 * ws-upgrade-handler.fixtures.ts — shared test fixtures for the three
 * ws-upgrade-handler.*.test.ts files (split out of the original
 * 570-LOC single test file in iterate-2026-05-27-ws-upgrade-handler-
 * split, after the Stop-hook bloat gate fired on 570 > 300).
 *
 * Each fixture mocks one collaborator of buildWsHandlers — PtyManager,
 * SdkSessionsStore, the WSContext-like ws object. Vitest's `vi.fn`
 * exposes call-count assertions; the MockPtyManager preserves the
 * mocks on a `__mocks` field so tests can read .mock.calls without
 * re-casting.
 */

import { vi } from "vitest";

import type { ValidatedWsUpgradeContext } from "./ws-upgrade-handler.js";
import type { PtyManager, PtyHandleMeta } from "./pty-manager.js";
import type {
  ExternalTask,
  ExternalTaskState,
} from "../core/sdk-sessions-store.js";

// ---------------------------------------------------------------------------
// Task + meta
// ---------------------------------------------------------------------------

export function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
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

export function makeMeta(overrides: Partial<PtyHandleMeta> = {}): PtyHandleMeta {
  return {
    taskId: "task-1",
    cwd: "/tmp/proj",
    shell: "pwsh.exe",
    shellKind: "pwsh",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock WS
// ---------------------------------------------------------------------------

export interface MockWs {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

export function makeWs(): MockWs {
  return {
    send: vi.fn(),
    close: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Mock PtyManager
// ---------------------------------------------------------------------------

export interface MockPtyManager extends PtyManager {
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

export function makePtyManager(
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

// ---------------------------------------------------------------------------
// Mock SdkSessionsStore (only patch + persist + get are used by the handler)
// ---------------------------------------------------------------------------

export function makeStore(): {
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

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export function makeCtx(
  overrides: Partial<ValidatedWsUpgradeContext> = {},
): ValidatedWsUpgradeContext {
  return {
    taskId: "task-1",
    task: makeTask(),
    trustedCwd: "/tmp/proj",
    ptyManager: makePtyManager(),
    store: makeStore() as unknown as ValidatedWsUpgradeContext["store"],
    retentionDays: 1,
    scrollbackDirHint: "<scrollback>",
    resolveShell: () => "pwsh.exe",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function readSent(ws: MockWs): unknown[] {
  return ws.send.mock.calls.map((args) => {
    const raw = args[0] as string;
    return JSON.parse(raw);
  });
}

/** Drain microtasks so the async IIFE inside onOpen runs to completion. */
export async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}
