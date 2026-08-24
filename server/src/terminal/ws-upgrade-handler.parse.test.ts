/*
 * ws-upgrade-handler.parse.test.ts — inbound JSON parsing table +
 * onMessage routing tests.
 *
 * Split from ws-upgrade-handler.test.ts per the Stop-hook bloat gate.
 * Covers iterate spec AC (c): table-driven parse table for isWSInbound
 * (valid data / valid resize / malformed JSON / wrong discriminator /
 * structurally invalid) + onMessage routing (writer / reader / silently
 * dropped paths) — external plan review MED #7.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { buildWsHandlers, isWSInbound } from "./ws-upgrade-handler.js";
import {
  makeCtx,
  makePtyManager,
  makeWs,
  readSent,
  type MockPtyManager,
  type MockWs,
} from "./ws-upgrade-handler.fixtures.js";

// ---------------------------------------------------------------------------
// isWSInbound parse table
// ---------------------------------------------------------------------------

describe("isWSInbound — inbound parsing discriminator", () => {
  const table: Array<{ desc: string; input: unknown; ok: boolean }> = [
    { desc: "valid data frame", input: { type: "data", payload: "hi" }, ok: true },
    {
      desc: "valid resize frame",
      input: { type: "resize", cols: 80, rows: 24 },
      ok: true,
    },
    // Post-replay redraw nudge (iterate-2026-07-27, FR-01.28). Dimension-LESS
    // on purpose: the pty already has the right size, and a caller that could
    // pick one could reflow the very grid the nudge is repairing.
    { desc: "valid redraw frame", input: { type: "redraw" }, ok: true },
    {
      desc: "redraw ignores stray dimensions rather than rejecting",
      input: { type: "redraw", cols: 80, rows: 24 },
      ok: true,
    },
    // Reader-scroll/copy exception (iterate-2026-08-24-terminal-readonly-
    // scroll-copy) — same shape as `data`, distinct discriminator.
    {
      desc: "valid mouse frame",
      input: { type: "mouse", payload: "\x1b[<64;30;7M" },
      ok: true,
    },
    {
      desc: "mouse with non-string payload",
      input: { type: "mouse", payload: 42 },
      ok: false,
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

// ---------------------------------------------------------------------------
// onMessage routing
// ---------------------------------------------------------------------------

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
    // Clear ready/second-attach sends so we only inspect onMessage responses.
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

  it("writer + redraw → ptyManager.forceRedraw (dimension-less)", () => {
    // The whole point of a dedicated frame: a same-size resize would be
    // swallowed by the v0.8.6 no-op dedupe, so the TUI would never repaint.
    pm.__mocks.getRole.mockReturnValueOnce("writer");
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "redraw" }) } as never,
      ws as never,
    );
    expect(pm.__mocks.forceRedraw).toHaveBeenCalledWith("task-1");
    expect(pm.__mocks.resize).not.toHaveBeenCalled();
  });

  it("reader + redraw → NO forceRedraw (a reader must never poke the pty)", () => {
    pm.__mocks.getRole.mockReturnValueOnce("reader");
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "redraw" }) } as never,
      ws as never,
    );
    expect(pm.__mocks.forceRedraw).not.toHaveBeenCalled();
    const types = readSent(ws).map((s) => (s as { type?: string }).type);
    expect(types).toContain("read_only");
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

  // Reader-scroll/copy exception (iterate-2026-08-24-terminal-readonly-
  // scroll-copy). Claude's live TUI implements scroll + selection-for-copy
  // via SGR mouse reports (see terminal-mouse-report.ts); the writer gate
  // above blocked ALL `data`, so a read-only viewer could do neither. A
  // `mouse` message carries the same bytes but bypasses that gate — the
  // server re-validates the payload SHAPE itself rather than trusting the
  // client's tag (isSgrMouseReport), so this is not spoofable via `type`.
  describe("'mouse' — reader scroll/copy exception", () => {
    const wheel = { type: "mouse", payload: "\x1b[<64;30;7M" };

    it("writer + valid SGR mouse report → writeMouseReport, no read_only", () => {
      pm.__mocks.getRole.mockReturnValueOnce("writer");
      handlers.onMessage?.({ data: JSON.stringify(wheel) } as never, ws as never);
      expect(pm.__mocks.writeMouseReport).toHaveBeenCalledWith("task-1", wheel.payload);
      expect(pm.__mocks.write).not.toHaveBeenCalled();
      const types = readSent(ws).map((s) => (s as { type?: string }).type);
      expect(types).not.toContain("read_only");
    });

    it("reader + valid SGR mouse report → writeMouseReport too — the whole point of this exception", () => {
      pm.__mocks.getRole.mockReturnValueOnce("reader");
      handlers.onMessage?.({ data: JSON.stringify(wheel) } as never, ws as never);
      expect(pm.__mocks.writeMouseReport).toHaveBeenCalledWith("task-1", wheel.payload);
      const types = readSent(ws).map((s) => (s as { type?: string }).type);
      expect(types).not.toContain("read_only");
    });

    it("reader + a payload that is NOT actually a SGR mouse report → REJECTED even though the client tagged it 'mouse' (server re-validates the shape, not the client's claim)", () => {
      pm.__mocks.getRole.mockReturnValueOnce("reader");
      handlers.onMessage?.(
        { data: JSON.stringify({ type: "mouse", payload: "rm -rf /\n" }) } as never,
        ws as never,
      );
      expect(pm.__mocks.writeMouseReport).not.toHaveBeenCalled();
    });

    it("roleless (unattached conn) + mouse → NOT written", () => {
      pm.__mocks.getRole.mockReturnValueOnce(null as never);
      handlers.onMessage?.({ data: JSON.stringify(wheel) } as never, ws as never);
      expect(pm.__mocks.writeMouseReport).not.toHaveBeenCalled();
    });
  });

  it("malformed JSON → silently dropped", () => {
    handlers.onMessage?.({ data: "{not json" } as never, ws as never);
    expect(pm.__mocks.write).not.toHaveBeenCalled();
    expect(pm.__mocks.resize).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("invalid discriminator → silently dropped", () => {
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "bogus" }) } as never,
      ws as never,
    );
    expect(pm.__mocks.write).not.toHaveBeenCalled();
    expect(pm.__mocks.resize).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  // iterate-2026-06-18 — app-level liveness ping. Answered with a pong
  // BEFORE the role gate so the client can detect a silently dead socket.
  it("writer + ping → pong (no pty side-effect)", () => {
    pm.__mocks.getRole.mockReturnValueOnce("writer");
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "ping" }) } as never,
      ws as never,
    );
    expect(pm.__mocks.write).not.toHaveBeenCalled();
    expect(pm.__mocks.resize).not.toHaveBeenCalled();
    const types = readSent(ws).map((s) => (s as { type?: string }).type);
    expect(types).toEqual(["pong"]);
  });

  it("reader + ping → pong, NOT read_only (readers stay alive too)", () => {
    pm.__mocks.getRole.mockReturnValueOnce("reader");
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "ping" }) } as never,
      ws as never,
    );
    const types = readSent(ws).map((s) => (s as { type?: string }).type);
    expect(types).toEqual(["pong"]);
    expect(types).not.toContain("read_only");
  });

  it("roleless (pre-ready) ping → pong, proving the reply is BEFORE the role gate", () => {
    // getRole returns null while the writer slot is still being resolved. The
    // pong MUST still fire (AC-7: answered before the role gate) and getRole
    // must not even be consulted for a ping.
    pm.__mocks.getRole.mockReturnValue(null as never);
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "ping" }) } as never,
      ws as never,
    );
    const types = readSent(ws).map((s) => (s as { type?: string }).type);
    expect(types).toEqual(["pong"]);
    expect(pm.__mocks.getRole).not.toHaveBeenCalled();
  });
});
