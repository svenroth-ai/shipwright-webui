/*
 * ws-upgrade-handler.detach.test.ts — onClose / onError atomic-detach
 * tests.
 *
 * Split from ws-upgrade-handler.test.ts per the Stop-hook bloat gate.
 * Covers iterate spec AC (d): atomic detachAndCount + conditional
 * fire-and-forget flushMirrorSnapshot when remainingAttachCount=0
 * (ADR-092). Also documents the dual-fire onError+onClose behaviour
 * preserved from origin/main — external code review MED #3.
 */

import { describe, expect, it } from "vitest";

import { buildWsHandlers } from "./ws-upgrade-handler.js";
import {
  makeCtx,
  makePtyManager,
  makeWs,
} from "./ws-upgrade-handler.fixtures.js";

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
  // onError and onClose call detachAndCount unconditionally. node-pty +
  // @hono/node-ws fires ONE of these per WS lifecycle in practice
  // (close on clean shutdown, error on socket break), but the dedupe-
  // against-double-detach lives in ptyManager itself (the second
  // detachAndCount sees no entry → remainingAttachCount=0). External
  // code review MED #3 (openrouter/openai, 2026-05-27): we record the
  // behavior here so a future implementation that adds internal dedup
  // is a deliberate decision, not an accidental silent change.
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
    // flushMirrorSnapshot is idempotent (snapshot-store.ts PQueue per
    // task) so two fire-and-forget calls are safe.
    expect(pm.__mocks.flushMirrorSnapshot).toHaveBeenCalledTimes(2);
  });
});
