/*
 * headless-mirror.test.ts — Iterate A (ADR-088) — unit coverage for the
 * hardening fixes from the external plan review (Gemini #3/#4/#5 +
 * OpenAI #4):
 *   - write() returns a Promise resolved after the parser callback fires
 *   - dispose() is idempotent + makes subsequent write/serialize safe
 *   - resize() clamps oversized dimensions (DoS defense)
 *   - serializeStable() awaits in-flight writes before round1 (no
 *     mid-CSI captures)
 *
 * The fixture round-trip test (headless-mirror.fixture.test.ts) covers
 * empirical correctness; this file covers the API contracts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeadlessMirror } from "./headless-mirror.js";

const TASK = "11111111-2222-3333-4444-555555555555";

describe("HeadlessMirror — API contracts", () => {
  let m: HeadlessMirror;

  beforeEach(() => {
    m = new HeadlessMirror({ taskId: TASK, cols: 80, rows: 24 });
  });

  afterEach(() => {
    m.dispose();
  });

  it("write() resolves only after the parser callback fires (strict ordering)", async () => {
    // External code review MEDIUM #5: assert the promise was actually
    // pending across a microtask boundary, not resolved synchronously.
    let resolved = false;
    const p = m.write("hello");
    p.then(() => {
      resolved = true;
    });
    // Yield one microtask. If write() were synchronous, `resolved`
    // would be true here. Per xterm.js parser semantics it's async-ish.
    await Promise.resolve();
    // The promise SHOULD still be pending (parser callback hasn't fired).
    // We can't strictly require this for every chunk size, but for
    // a non-empty string it always is in practice.
    expect(resolved).toBe(false);
    await p;
    expect(resolved).toBe(true);
  });

  it("dispose() is idempotent and makes write/serialize a no-op", async () => {
    m.dispose();
    m.dispose(); // second call must not throw
    // write resolves to undefined without invoking the parser.
    await expect(m.write("after dispose")).resolves.toBeUndefined();
    // serializeStable rejects with a clear message.
    await expect(m.serializeStable()).rejects.toThrow(/disposed/);
  });

  it("resize() clamps oversized dimensions (DoS defense)", () => {
    m.resize(50_000, 50_000);
    expect(m.dimensions.cols).toBeLessThanOrEqual(1000);
    expect(m.dimensions.rows).toBeLessThanOrEqual(500);
  });

  it("resize() rejects non-finite dimensions to safe minimum", () => {
    m.resize(NaN, -5);
    expect(m.dimensions.cols).toBe(1);
    expect(m.dimensions.rows).toBe(1);
  });

  it("constructor clamps oversized initial dimensions", () => {
    const big = new HeadlessMirror({ taskId: TASK, cols: 999_999, rows: 999_999 });
    expect(big.dimensions.cols).toBeLessThanOrEqual(1000);
    expect(big.dimensions.rows).toBeLessThanOrEqual(500);
    big.dispose();
  });

  it("serializeStable() awaits in-flight writes (mid-CSI guard)", async () => {
    // External code review MEDIUM #6: assert the serialized output
    // actually CONTAINS content from the late writes — a broken
    // flushPendingWrites that returned before drain would lose them
    // and visible-line replay would not see "line-19".
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      writes.push(m.write(`line-${i}\r\n`));
    }
    const { stable, canonicalLines } =
      await m.serializeStableWithCanonicalBuffer();
    await Promise.all(writes);
    expect(stable.length).toBeGreaterThan(0);
    // Find a line that contains "line-19" (last write) — proves the
    // flush drained the entire pending queue, not just the first chunk.
    const tailLine = canonicalLines.find((line) => line.includes("line-19"));
    expect(tailLine).toBeDefined();
  });

  it("dispose() forcibly resolves pending writes (no hang)", async () => {
    // External code review HIGH: spawn a pending write, dispose
    // immediately, then call serializeStable on a fresh mirror — the
    // first mirror's flushPendingWrites would hang if dispose() didn't
    // drain the resolver set. We test dispose's effect indirectly:
    // start a write, then dispose, then assert the write's promise
    // resolves (would never settle without the drain).
    const p = m.write("pending");
    m.dispose();
    await expect(Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("hang")), 1000))]))
      .resolves.toBeUndefined();
  });
});
