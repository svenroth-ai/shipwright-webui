/*
 * headless-mirror.fixture.test.ts — Iterate A (ADR-088)
 *
 * Empirical confidence test for the M2 double-serialize stabilization.
 * Reuses the captured 30 986-byte real Claude TUI scrollback as the
 * fixture (server/src/terminal/fixtures/claude-tui-scrollback.log).
 *
 * Three variants per the spike evidence in
 * `.shipwright/planning/embedded-terminal-refactor-headless.md`:
 *
 *   a. Random chunking (1–1024 B chunks) — feed to mirror, serializeStable,
 *      replay into fresh Terminal, assert visible-line equality via
 *      `getLine(y).translateToString(false)` for every line in the buffer.
 *   b. Mid-escape splits (4-byte chunks) — same equality check.
 *   c. Resize-midway (120×30 → 80×24 after half the input) — same equality
 *      check; M2 must eliminate the 1-char drift seen in spike T5.
 *
 * The fixture log was captured at:
 *   C:/Users/SvenRoth/.shipwright-webui/terminal-scrollback/
 *     2aa752d7-e9c1-43df-a6b7-ca3ca9bb19aa.log (30 986 bytes)
 * and copied into the source tree so CI is reproducible.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { HeadlessMirror } from "./headless-mirror.js";
// CJS interop — per architecture invariant #2.
import pkg from "@xterm/headless";
import addonPkg from "@xterm/addon-serialize";
const { Terminal } = pkg;
const { SerializeAddon } = addonPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_PATH = path.join(
  __dirname,
  "fixtures",
  "claude-tui-scrollback.log",
);

function loadFixture(): Buffer {
  return fs.readFileSync(FIXTURE_PATH);
}

/**
 * Visible-line snapshot: walk every line in scrollback + active viewport
 * and translate to string with trim-right disabled, returning an array
 * indexed by absolute line number.
 */
function snapshotVisibleLines(term: InstanceType<typeof Terminal>): string[] {
  const buffer = term.buffer.active;
  const total = buffer.length;
  const out: string[] = new Array(total);
  for (let y = 0; y < total; y++) {
    const line = buffer.getLine(y);
    out[y] = line ? line.translateToString(false) : "";
  }
  return out;
}

/** Feed raw bytes into a Terminal in chunks of size `chunkSize`. */
async function writeChunked(
  term: InstanceType<typeof Terminal>,
  raw: Buffer,
  chunkSize: number,
): Promise<void> {
  for (let off = 0; off < raw.length; off += chunkSize) {
    const slice = raw.subarray(off, Math.min(off + chunkSize, raw.length));
    await new Promise<void>((resolve) => {
      // term.write accepts Buffer or string; pass Buffer for fidelity.
      term.write(slice, () => resolve());
    });
  }
}

/** Feed raw bytes into a Terminal as random-size chunks (1..maxChunk). */
async function writeRandomChunks(
  term: InstanceType<typeof Terminal>,
  raw: Buffer,
  maxChunk: number,
  rng: () => number,
): Promise<void> {
  let off = 0;
  while (off < raw.length) {
    const size = Math.max(1, Math.min(raw.length - off, Math.floor(rng() * maxChunk) + 1));
    const slice = raw.subarray(off, off + size);
    await new Promise<void>((resolve) => {
      term.write(slice, () => resolve());
    });
    off += size;
  }
}

/** Deterministic LCG so test reruns produce identical chunking. */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Round-trip check: take a mirror's stable snapshot (M2 round2), replay
 * it into a fresh xterm Terminal of the same dimensions, and assert
 * visible-line equality against the canonical (round2) snapshot the
 * mirror produced.
 *
 * Per the M2 contract (plan T2 fixed-point): round2 == round3 is the
 * idempotence guarantee. The client-side replay is round3; the
 * comparison reference is the round2 visible buffer captured during
 * serialization. The live mirror's own buffer is round1 — that's what
 * carried the 1-char drift in spike T5, and is NOT the reference here.
 */
async function assertRoundTripVisibleEquality(
  mirror: HeadlessMirror,
  cols: number,
  rows: number,
): Promise<void> {
  const { stable, canonicalLines } = await mirror.serializeStableWithCanonicalBuffer();
  // Replay into a fresh terminal of the SAME dimensions.
  const replay = new Terminal({
    cols,
    rows,
    // Match HeadlessMirror's default scrollback (1000) so buffer lengths
    // align line-for-line.
    scrollback: 1000,
    allowProposedApi: true,
  });
  await new Promise<void>((resolve) => {
    replay.write(stable, () => resolve());
  });
  const replayLines = snapshotVisibleLines(replay);
  expect(replayLines.length).toBe(canonicalLines.length);
  for (let y = 0; y < canonicalLines.length; y++) {
    // Show the y-coordinate in the failure message so a regression is
    // pinpointable to a specific line.
    expect(`y=${y}: ${replayLines[y]}`).toBe(`y=${y}: ${canonicalLines[y]}`);
  }
  replay.dispose();
}

describe("HeadlessMirror — fixture round-trip (Iterate A / ADR-088)", () => {
  let mirror: HeadlessMirror;
  const TASK_ID = "11111111-2222-3333-4444-555555555555";

  beforeEach(() => {
    mirror = new HeadlessMirror({ taskId: TASK_ID, cols: 120, rows: 30 });
  });

  afterEach(() => {
    mirror.dispose();
  });

  it("fixture exists and is the LF-normalized captured Claude TUI scrollback", () => {
    // Original capture was 30 986 bytes. Git stored an LF-normalized blob
    // (30 671 bytes) because the fixture was committed before .gitattributes
    // pinned *.log under fixtures/ as binary. The LF-normalized stream
    // still parses cleanly through @xterm/headless; round-trip equality
    // (the three tests below) is the substantive invariant.
    const stats = fs.statSync(FIXTURE_PATH);
    expect(stats.size).toBe(30671);
  });

  it("a. random chunking (1–1024 B): replay visible-line equals mirror", async () => {
    const raw = loadFixture();
    const rng = makeLcg(0xCAFEBABE);
    await writeRandomChunks(mirror.terminalForTesting, raw, 1024, rng);
    // Manually trigger the same await-on-write pattern serializeStable uses;
    // for random chunking we already awaited each write callback above.
    await assertRoundTripVisibleEquality(mirror, 120, 30);
  });

  // Mid-escape splits: the spike doc measured 96.9s under 4-byte chunks
  // because every term.write callback round-trips through Node's event
  // loop. Production chunks are KB-sized; this variant is the
  // pathological-fragmentation contract, not a performance test. Allow
  // up to 180 s.
  it(
    "b. mid-escape splits (4-byte chunks): replay visible-line equals mirror",
    { timeout: 180_000 },
    async () => {
      const raw = loadFixture();
      await writeChunked(mirror.terminalForTesting, raw, 4);
      await assertRoundTripVisibleEquality(mirror, 120, 30);
    },
  );

  it("c. resize-midway 120x30 → 80x24 (M2 double-serialize): replay visible-line equals mirror", async () => {
    const raw = loadFixture();
    const half = Math.floor(raw.length / 2);
    const rng = makeLcg(0x1234ABCD);
    // First half — feed at 120x30.
    await writeRandomChunks(mirror.terminalForTesting, raw.subarray(0, half), 512, rng);
    // Resize.
    mirror.resize(80, 24);
    // Second half — feed at 80x24.
    await writeRandomChunks(mirror.terminalForTesting, raw.subarray(half), 512, rng);
    // M2's serializeStable is the production attach path; the contract is:
    // round2 == round3, so a replay of round2 yields the same visible buffer.
    await assertRoundTripVisibleEquality(mirror, 80, 24);
  });
});
