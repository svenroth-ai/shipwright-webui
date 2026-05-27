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
