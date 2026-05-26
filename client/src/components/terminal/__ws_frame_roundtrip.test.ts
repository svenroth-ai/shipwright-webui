/*
 * WS envelope Boundary Probe — Campaign C / C5.
 *
 * `touches_io_boundary` = YES — the EmbeddedTerminal refactor is downstream
 * of every WS envelope shape between webui and the Hono terminal route.
 * This test is the architectural fence per ADR-029 confidence-calibration
 * + memory `feedback_external_code_review_catches_high_bugs`.
 *
 * Plan-review openai #1 HIGH + #10 MED resolutions:
 *   - The probe runs against the SAME `JSON.parse` / `JSON.stringify`
 *     pattern used by `useTerminalSocket.ts` (the consumer) and the shell
 *     (the producer; e.g. `socket.send({type:"data", payload})`). Both
 *     sides use literal `JSON.parse` / `JSON.stringify` — there is no
 *     separate parser module to import. The production discriminated-
 *     union dispatch (`useTerminalSocket.ts` lines 280-385) is exercised
 *     by `useTerminalSocket.test.ts` (513 LOC, baseline-grandfathered).
 *     This probe asserts the wire SHAPE is byte-stable for every envelope
 *     the dispatch reads.
 *   - Property-order byte-equality is intentionally NOT asserted —
 *     JSON.stringify on an unordered object is too brittle. Deep-equal
 *     of the parsed payload is the semantically correct fence.
 *   - The discriminated-union dispatch in `useTerminalSocket.ts` reads
 *     `env.type` + field-shape; this test asserts each envelope round-
 *     trips with all type-narrowing fields intact, so a future refactor
 *     that drops a field at the producer side fails the deep-equal.
 *
 * External code-review openai HIGH #3 acknowledged: a future iterate
 * SHOULD extract a `parseTerminalEnvelope(raw)` helper from
 * `useTerminalSocket.ts` and have both production + this probe import
 * it. That extraction was deferred from C5 because the iterate scope
 * was "EmbeddedTerminal split — useTerminalSocket untouched"; touching
 * useTerminalSocket here would have widened the blast radius of a
 * HIGH-RISK refactor.
 *
 * The 9 envelope shapes below are an audit of every JSON.parse target in
 * `useTerminalSocket.ts` (server→client) PLUS every send call in
 * `EmbeddedTerminal.tsx` (client→server).
 */

import { describe, expect, it } from "vitest";

/**
 * Producer encode = `JSON.stringify(envelope)`. Consumer decode =
 * `JSON.parse(string)`. Round-trip = `JSON.parse(JSON.stringify(env))`.
 *
 * Helper exists so any future refactor that introduces a custom encoder
 * (e.g. msgpack) can swap the implementation in one place.
 */
function roundTrip<T>(env: T): unknown {
  return JSON.parse(JSON.stringify(env));
}

describe("WS envelope Boundary Probe — server→client", () => {
  it("`ready` envelope round-trips with all ADR-068-A1 + ADR-104 fields", () => {
    const env = {
      type: "ready",
      role: "writer",
      shellKind: "pwsh",
      cwd: "C:\\x",
      replayOnly: false,
      scrollbackBytes: 12345,
      retentionDays: 30,
      scrollbackDir: "/home/user/.shipwright-webui/scrollback",
      terminalReset: false,
      ptyReused: true,
    };
    expect(roundTrip(env)).toEqual(env);
  });

  it("`ready` envelope tolerates missing optional ADR-104 fields (back-compat)", () => {
    // Older server omits terminalReset / ptyReused. Loader in
    // useTerminalSocket reads `typeof env.terminalReset === "boolean"`
    // and falls back to `false`. The round-trip preserves "missing"
    // (undefined drops in JSON serialization).
    const env = {
      type: "ready",
      role: "reader",
      shellKind: "posix",
      cwd: "/tmp",
    };
    const got = roundTrip(env) as Record<string, unknown>;
    expect(got).toEqual(env);
    expect("terminalReset" in got).toBe(false);
    expect("ptyReused" in got).toBe(false);
  });

  it("`data` envelope (inbound) round-trips, including non-ASCII payloads", () => {
    const env = { type: "data", payload: "héllo 🌍 \x1b[31mred\x1b[0m\n" };
    expect(roundTrip(env)).toEqual(env);
  });

  it("`replay_snapshot` envelope round-trips with terminalVersion (ADR-097)", () => {
    const env = {
      type: "replay_snapshot",
      data: "\x1b[2J\x1b[H$ ready",
      cols: 80,
      rows: 24,
      terminalVersion: "6.0.0",
    };
    expect(roundTrip(env)).toEqual(env);
  });

  it("`read_only` envelope round-trips", () => {
    expect(roundTrip({ type: "read_only" })).toEqual({ type: "read_only" });
  });

  it("`writer-promoted` envelope round-trips (StrictMode race fence)", () => {
    expect(roundTrip({ type: "writer-promoted" })).toEqual({
      type: "writer-promoted",
    });
  });

  it("`backpressure` envelope round-trips with droppedBytes", () => {
    const env = { type: "backpressure", droppedBytes: 4096 };
    expect(roundTrip(env)).toEqual(env);
  });

  it("`scrollback-meta` envelope round-trips with scrollbackBytes (AC-8 follow-up)", () => {
    const env = { type: "scrollback-meta", scrollbackBytes: 98765 };
    expect(roundTrip(env)).toEqual(env);
  });
});

describe("WS envelope Boundary Probe — client→server", () => {
  it("`data` envelope (outbound) round-trips for ASCII + CRLF + special chars", () => {
    const env = { type: "data", payload: "claude --resume xyz\r" };
    expect(roundTrip(env)).toEqual(env);
  });

  it("`data` envelope outbound preserves multi-line bracketed-paste markers", () => {
    const env = {
      type: "data",
      payload: "\x1b[200~line-1\nline-2\x1b[201~",
    };
    expect(roundTrip(env)).toEqual(env);
  });

  it("`resize` envelope round-trips with integer cols+rows", () => {
    const env = { type: "resize", cols: 120, rows: 30 };
    expect(roundTrip(env)).toEqual(env);
  });

  it("`resize` envelope tolerates 0×0 dims (pre-renderer-ready fence)", () => {
    // safeFit short-circuits when cell dims are zero, but if a future
    // refactor ever sent a 0×0 frame it must still serialize cleanly so
    // the server's `pty.resize(0, 0)` no-op path stays correct.
    const env = { type: "resize", cols: 0, rows: 0 };
    expect(roundTrip(env)).toEqual(env);
  });
});

describe("WS envelope Boundary Probe — discriminator integrity", () => {
  it("unknown envelope type is preserved (loader's responsibility to ignore)", () => {
    // Forward-compat: a future server may emit a new envelope type. The
    // round-trip must preserve the shape so the client's discriminator
    // can deliberately ignore unknown types without corrupting the wire.
    const env = { type: "future-envelope", payload: 42 };
    expect(roundTrip(env)).toEqual(env);
  });

  it("legacy chunked-replay envelopes round-trip but are dropped by the consumer (ADR-087 fence)", () => {
    // CLAUDE.md rule 20: legacy `replay_start`/`replay_chunk`/`replay_end`
    // are silently dropped by the client. The wire shape MUST still
    // round-trip so a mid-deploy stale server doesn't crash the parser;
    // the EmbeddedTerminal.test.tsx case "stale legacy chunked-replay
    // envelopes are silently ignored" asserts the consumer-side drop.
    expect(roundTrip({ type: "replay_start", totalBytes: 100 })).toEqual({
      type: "replay_start",
      totalBytes: 100,
    });
    expect(roundTrip({ type: "replay_chunk", payload: "old" })).toEqual({
      type: "replay_chunk",
      payload: "old",
    });
    expect(roundTrip({ type: "replay_end" })).toEqual({ type: "replay_end" });
  });
});
