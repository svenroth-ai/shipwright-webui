/*
 * ws-upgrade-handler.test.ts — replay-only + live-attach + new-plain +
 * pause-stake balance tests.
 *
 * Sibling files (split per Stop-hook bloat gate on the original 570-LOC
 * single file, 2026-05-27):
 *   - ws-upgrade-handler.parse.test.ts  — inbound JSON parse table + onMessage
 *   - ws-upgrade-handler.detach.test.ts — onClose / onError atomic detach
 *
 * Coverage of the iterate spec ACs (subset):
 *   (a) replay-only attach: ready envelope shape, close cleanly, no
 *       pty spawn/attach/subscribe call
 *   (b) live attach: ready envelope EXACT key set, ptyReused tracks
 *       hadPriorWriter, second-attach envelope when role=reader
 *   (e) new-plain awaiting_external_start → active flip (AC-4)
 *   pause-stake balance: pauseForConn / resumeForConn called exactly once
 *
 * Full WS attach against a real pty is covered by Playwright E2E.
 */

import { describe, expect, it } from "vitest";

import { buildWsHandlers, type ValidatedWsUpgradeContext } from "./ws-upgrade-handler.js";
import {
  flushAsync,
  makeCtx,
  makePtyManager,
  makeStore,
  makeTask,
  makeWs,
  readSent,
} from "./ws-upgrade-handler.fixtures.js";

// ---------------------------------------------------------------------------
// (a) Replay-only branch
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
    const ctx = makeCtx({ ptyManager: pm, task: makeTask({ state: "active" }) });
    const handlers = buildWsHandlers(ctx);
    const ws = makeWs();
    handlers.onOpen?.({} as Event, ws as never);

    const sent = readSent(ws);
    const ready = sent.find(
      (s) => (s as { type?: string }).type === "ready",
    ) as Record<string, unknown> | undefined;
    expect(ready).toBeDefined();
    // Exact key set — guards against envelope drift (external plan review LOW #10).
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

  it("ptyReused tracks hadPriorWriter (false) not ptyExistedBeforeAttach", () => {
    // pty exists in prewarm state (no writer attached yet) →
    // hadPriorWriter=false. iterate-2026-05-27-fix-pty-reused-prewarm-race.
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
// Pause-stake balance (external plan review MED #5)
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
