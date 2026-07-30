/*
 * snapshot-parser-resync.test.ts — the MECHANISM that makes a snapshot restore
 * land one row off, and the preamble that closes it
 * (iterate-2026-07-30-terminal-ws-drop-resync, FR-01.28).
 *
 * WHY THIS FILE EXISTS. Smear mechanism #3 is a WS byte-window that
 * `PtyManager.deliverWithBackpressure` discards and never resends. The remedy is
 * a RESYNC: re-apply a fresh full-grid snapshot instead of letting Claude's
 * differential (CUF-skipping) repaints paint onto a holed grid.
 *
 * Building that remedy surfaced a second defect IN THE REMEDY'S OWN PRIMITIVE.
 * The client restores a snapshot with `term.reset()` then `term.write(data)`.
 * Measured against a real 110x52 recording, that lands **51 of 52 rows wrong**,
 * while a FRESH terminal fed the same payload is byte-exact (0 wrong).
 *
 * Bisection localized the divergence to the payload's very FIRST character, and
 * the cause is this:
 *
 *   `xterm.Terminal.reset()` does NOT reset the escape-sequence PARSER.
 *
 * A dropped chunk truncates the byte stream mid-sequence BY DEFINITION (the real
 * recording's reproducing cut ends with `ESC [ 3 8 ; 2` — a half-written
 * truecolor CSI). The parser is therefore parked in a non-ground state, and the
 * first bytes of the repair snapshot are swallowed as continuation of that
 * truncated sequence — so the whole restored grid shifts by one row.
 *
 * Three other hypotheses were REFUTED and must not be re-run: deferred/pending
 * wrap, async write ordering (an empty write, a microtask AND a macrotask tick
 * all still swallow), and a surviving DECSTBM scroll region (every observable
 * buffer field is identical before the write).
 *
 * The fix is served, not client-side: `buildReplaySnapshotEnvelope` prepends
 * CAN (0x18 — ISO 6429 "abort sequence in progress") + CUP-home. That single
 * seam covers attach replay, reconnect replay AND resync. `CAN` alone was
 * verified to recover all six truncation classes, so the abort is doing the work
 * and the CUP is the payload's own precondition, made explicit.
 *
 * Assertions are ABSOLUTE, not merely A/B: a differential alone cannot tell
 * "both right" from "both wrong".
 */

import { describe, it, expect } from "vitest";
import { Terminal } from "@xterm/headless";
import { HeadlessMirror } from "./headless-mirror.js";
import { buildReplaySnapshotEnvelope } from "./replay-snapshot.js";

/** Control bytes from their code points so no editor or tool can mangle them. */
const ESC = String.fromCharCode(27);
const CAN = String.fromCharCode(24);

const write = (t: Terminal, d: string): Promise<void> =>
  new Promise((resolve) => t.write(d, resolve));

/**
 * Every parser class a truncated stream can strand us in. A dropped WS chunk
 * can cut anywhere, so all of them are reachable in production.
 */
const TRUNCATIONS: { name: string; bytes: string }[] = [
  { name: "mid-CSI (truecolor SGR, as in the real recording)", bytes: `hi${ESC}[38;2;215` },
  { name: "mid-CSI (single param)", bytes: `hi${ESC}[1` },
  { name: "lone ESC", bytes: `hi${ESC}` },
  { name: "mid-OSC", bytes: `hi${ESC}]0;title` },
  { name: "mid-DCS", bytes: `hi${ESC}Pq` },
  { name: "mid-charset designation", bytes: `hi${ESC}(` },
];

const mkTerm = (cols = 20, rows = 6): Terminal =>
  new Terminal({ cols, rows, allowProposedApi: true });

const cursor = (t: Terminal): [number, number] => [
  t.buffer.active.cursorX,
  t.buffer.active.cursorY,
];

describe("mechanism: Terminal.reset() does not reset the escape-sequence parser", () => {
  it("a fresh terminal writing one space advances the cursor to (1,0)", async () => {
    const t = mkTerm();
    await write(t, " ");
    expect(cursor(t)).toEqual([1, 0]);
    t.dispose();
  });

  it("after a CLEAN stream, reset() + write(' ') also lands at (1,0)", async () => {
    const t = mkTerm();
    await write(t, "hello world");
    t.reset();
    await write(t, " ");
    expect(cursor(t)).toEqual([1, 0]);
    t.dispose();
  });

  it.each(TRUNCATIONS)(
    "SWALLOWS the next write's first byte when the stream ended $name",
    async ({ bytes }) => {
      const t = mkTerm();
      await write(t, bytes);
      t.reset();
      await write(t, " ");
      // The defect: the space is consumed as continuation of the truncated
      // sequence, so the cursor never leaves the origin.
      expect(cursor(t)).toEqual([0, 0]);
      t.dispose();
    },
  );

  it.each(TRUNCATIONS)(
    "recovers when CAN precedes the write — stream ended $name",
    async ({ bytes }) => {
      const t = mkTerm();
      await write(t, bytes);
      t.reset();
      await write(t, `${CAN}${ESC}[H`);
      await write(t, " ");
      expect(cursor(t)).toEqual([1, 0]);
      t.dispose();
    },
  );
});

describe("buildReplaySnapshotEnvelope — parser-resync preamble", () => {
  const rec = {
    version: "v2" as const,
    terminalVersion: "6.0.0",
    cols: 80,
    rows: 24,
    data: "cells here",
  };

  it("prepends CAN + CUP-home at the very START of the payload", () => {
    const env = buildReplaySnapshotEnvelope(rec);
    expect(env.data.startsWith(`${CAN}${ESC}[H`)).toBe(true);
    expect(env.data).toBe(`${CAN}${ESC}[H` + rec.data);
  });

  it("does not double-prepend when the preamble is already present", () => {
    const env = buildReplaySnapshotEnvelope({
      ...rec,
      data: `${CAN}${ESC}[Halready`,
    });
    expect(env.data).toBe(`${CAN}${ESC}[Halready`);
  });

  it("still applies the ?1006h mouse-encoding augmentation (Iterate K)", () => {
    const env = buildReplaySnapshotEnvelope({ ...rec, data: `cells${ESC}[?1000h` });
    expect(env.data.startsWith(`${CAN}${ESC}[H`)).toBe(true);
    expect(env.data.endsWith(`${ESC}[?1006h`)).toBe(true);
  });

  it("is safe-when-redundant: a ground-state terminal renders identically", async () => {
    const body = `${ESC}[2J${ESC}[Hline one\r\nline two`;
    const plain = mkTerm();
    await write(plain, body);
    const withPreamble = mkTerm();
    await write(withPreamble, buildReplaySnapshotEnvelope({ ...rec, data: body }).data);

    const read = (t: Terminal) =>
      Array.from({ length: t.rows }, (_, i) =>
        t.buffer.active.getLine(t.buffer.active.baseY + i)?.translateToString(true) ?? "",
      );
    expect(read(withPreamble)).toEqual(read(plain));
    plain.dispose();
    withPreamble.dispose();
  });
});

/*
 * End-to-end payoff: a client that lost a byte window mid-sequence converges
 * back to the server mirror EXACTLY once the envelope is applied — and does not
 * without the preamble. This is AC-3 + AC-4 in one assertion.
 */
describe("resync converges a holed client back to the server mirror", () => {
  const COLS = 40;
  const ROWS = 8;

  /*
   * A faithful model of what actually corrupts the screen. Sequential line
   * output does NOT reproduce it — a drop there just removes lines and the rest
   * scrolls clean (verified: 0 rows wrong). The corruption needs Claude's
   * CUP-addressed DIFFERENTIAL repaint, where the skipped columns hold
   * different characters in the two histories:
   *
   *   FRAME_1  "aaaaXbbbbXcccc"   <- non-space at the columns FRAME_3 will skip
   *   FRAME_2  "xxxx yyyy zzzz"   <- the DROPPED chunk; spaces at those columns
   *   FRAME_3  "xxxx" CUF "yyyy" CUF "zzzz"   <- writes no space, only CUF hops
   *
   * mirror (saw FRAME_2): skipped cells hold " " -> stay " " -> renders clean.
   * client (missed it)  : skipped cells hold "X" -> stay "X" -> STALE CHARACTER.
   */
  const rowsOf = (text: string) =>
    Array.from({ length: ROWS }, (_, r) => `${ESC}[${r + 1};1H${text}`).join("");

  const FRAME_1 = rowsOf("aaaaXbbbbXcccc");
  const FRAME_2 = rowsOf("xxxx yyyy zzzz");
  const FRAME_3 = Array.from(
    { length: ROWS },
    (_, r) => `${ESC}[${r + 1};1Hxxxx${ESC}[1Cyyyy${ESC}[1Czzzz`,
  ).join("");

  const readGrid = (t: Terminal): string[] =>
    Array.from({ length: t.rows }, (_, i) =>
      t.buffer.active.getLine(t.buffer.active.baseY + i)?.translateToString(true) ?? "",
    );

  /**
   * @param truncateClient append a half-written CSI to the client's stream —
   *        what a real drop leaves behind, and what strands the parser.
   */
  async function buildScenario(truncateClient: boolean) {
    const mirror = new HeadlessMirror({
      taskId: "11111111-2222-3333-4444-555555555555",
      cols: COLS,
      rows: ROWS,
      scrollback: 200,
    });
    // The mirror receives EVERY byte — backpressure drops only on the per-conn
    // WS send, never into the mirror. So the mirror is the truth.
    await mirror.write(FRAME_1 + FRAME_2 + FRAME_3);
    const truth = readGrid(mirror.terminalForTesting as unknown as Terminal);
    const rec2 = {
      version: "v2" as const,
      terminalVersion: "6.0.0",
      cols: COLS,
      rows: ROWS,
      data: await mirror.serializeStable(),
    };

    // The client: FRAME_2 was discarded and never resent.
    const client = mkTerm(COLS, ROWS);
    await write(client, FRAME_1 + FRAME_3);
    if (truncateClient) await write(client, `${ESC}[38;2`);

    mirror.dispose();
    return { truth, rec: rec2, client };
  }

  const countWrong = (a: string[], b: string[]) =>
    a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0);

  it("the drop leaves STALE CHARACTERS the repaint never erases", async () => {
    const { truth, client } = await buildScenario(false);
    // Absolute expectations, both sides — not just "they differ".
    expect(truth[0]).toBe("xxxx yyyy zzzz");
    expect(readGrid(client)[0]).toBe("xxxxXyyyyXzzzz");
    expect(countWrong(truth, readGrid(client))).toBe(ROWS);
    client.dispose();
  });

  it("applying the envelope restores the grid byte-exactly", async () => {
    const { truth, rec: r, client } = await buildScenario(false);
    client.reset();
    await write(client, buildReplaySnapshotEnvelope(r).data);
    expect(readGrid(client)[0]).toBe("xxxx yyyy zzzz");
    expect(countWrong(truth, readGrid(client))).toBe(0);
    client.dispose();
  });

  it("heals even when the drop stranded the parser mid-CSI", async () => {
    const { truth, rec: r, client } = await buildScenario(true);
    client.reset();
    await write(client, buildReplaySnapshotEnvelope(r).data);
    expect(countWrong(truth, readGrid(client))).toBe(0);
    client.dispose();
  });

  it("without the preamble that same restore is NOT byte-exact", async () => {
    const { truth, rec: r, client } = await buildScenario(true);
    client.reset();
    await write(client, r.data); // raw serialize output — no preamble
    expect(countWrong(truth, readGrid(client))).toBeGreaterThan(0);
    client.dispose();
  });
});
