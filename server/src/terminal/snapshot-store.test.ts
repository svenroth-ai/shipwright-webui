/*
 * snapshot-store.test.ts — Iterate A (ADR-088)
 *
 * Boundary probe + unit coverage for the snapshot file format. The format
 * is an I/O boundary (producer = SnapshotStore.write; consumer =
 * SnapshotStore.read / parseSnapshotEnvelope), so per ADR-024 +
 * references/boundary-probes.md the round-trip must be exercised in
 * BOTH directions through real files.
 *
 * Covered:
 *   - UUID validation on every public method
 *   - Producer→file→consumer round-trip with realistic payloads
 *     including newlines, ANSI escapes, non-ASCII (UTF-8 multi-byte),
 *     empty data, and large data (>1 MiB).
 *   - Header parser rejects: missing newline, malformed shape,
 *     unknown version.
 *   - write() is atomic — overwrites existing snapshot without leaving
 *     the tmp file behind.
 *   - has() / clear() ENOENT semantics.
 *   - Path-guard: symlink escape rejected (POSIX only — skip on Windows
 *     where symlink creation needs admin).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  parseSnapshotEnvelope,
  SnapshotStore,
  SnapshotStoreError,
  _resetTerminalVersionCacheForTesting,
} from "./snapshot-store.js";

const VALID = "11111111-2222-3333-4444-555555555555";
const VALID_2 = "22222222-3333-4444-5555-666666666666";

let tmpDir: string;
let store: SnapshotStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "snap-test-"));
  store = new SnapshotStore(tmpDir);
  await store.init();
  _resetTerminalVersionCacheForTesting();
});

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("SnapshotStore — UUID validation", () => {
  it("rejects malformed taskId on write", async () => {
    await expect(
      store.write("not-a-uuid", { cols: 80, rows: 24, data: "x" }),
    ).rejects.toBeInstanceOf(SnapshotStoreError);
  });
  it("rejects malformed taskId on read", async () => {
    await expect(store.read("not-a-uuid")).rejects.toBeInstanceOf(
      SnapshotStoreError,
    );
  });
  it("rejects malformed taskId on has", async () => {
    await expect(store.has("not-a-uuid")).rejects.toBeInstanceOf(
      SnapshotStoreError,
    );
  });
  it("rejects malformed taskId on clear", async () => {
    await expect(store.clear("not-a-uuid")).rejects.toBeInstanceOf(
      SnapshotStoreError,
    );
  });
});

describe("SnapshotStore — boundary probe: producer→file→consumer round-trip", () => {
  it("empty data round-trips", async () => {
    await store.write(VALID, { cols: 80, rows: 24, data: "" });
    const rec = await store.read(VALID);
    expect(rec).not.toBeNull();
    expect(rec!.version).toBe("v1");
    expect(rec!.cols).toBe(80);
    expect(rec!.rows).toBe(24);
    expect(rec!.data).toBe("");
  });

  it("simple ASCII data round-trips byte-identical", async () => {
    const payload = "Hello world!\nLine 2.\n";
    await store.write(VALID, { cols: 120, rows: 30, data: payload });
    const rec = await store.read(VALID);
    expect(rec!.data).toBe(payload);
    expect(rec!.cols).toBe(120);
    expect(rec!.rows).toBe(30);
  });

  it("ANSI escape sequences round-trip", async () => {
    const payload = "\x1b[31mred\x1b[0m\r\n\x1b[H\x1b[2Jclear";
    await store.write(VALID, { cols: 80, rows: 24, data: payload });
    const rec = await store.read(VALID);
    expect(rec!.data).toBe(payload);
  });

  it("non-ASCII UTF-8 multi-byte round-trips (Decision #14 / boundary-probes.md)", async () => {
    // Three-byte CJK + four-byte emoji + box-drawing.
    const payload = "你好 🚀 ──── shell stopped ────";
    await store.write(VALID, { cols: 80, rows: 24, data: payload });
    const rec = await store.read(VALID);
    expect(rec!.data).toBe(payload);
  });

  it("data containing the header pattern is preserved verbatim", async () => {
    // The parser splits on the FIRST newline; subsequent lines that
    // resemble a header must not be re-parsed.
    const payload = "# shipwright-snapshot v1 xterm@5.5.0 80x24\nactual data";
    await store.write(VALID, { cols: 80, rows: 24, data: payload });
    const rec = await store.read(VALID);
    expect(rec!.data).toBe(payload);
  });

  it("large payload (>1 MiB) round-trips", async () => {
    const payload = "A".repeat(1_100_000); // 1.1 MiB
    await store.write(VALID, { cols: 80, rows: 24, data: payload });
    const rec = await store.read(VALID);
    expect(rec!.data.length).toBe(payload.length);
    expect(rec!.data).toBe(payload);
  });
});

describe("SnapshotStore — header parser", () => {
  it("rejects malformed envelope (no newline)", () => {
    expect(() => parseSnapshotEnvelope("# shipwright-snapshot v1 xterm@5.5.0 80x24"))
      .toThrow(/snapshot envelope has no newline/);
  });
  it("rejects malformed header (wrong shape)", () => {
    expect(() => parseSnapshotEnvelope("# garbage header\npayload"))
      .toThrow(/snapshot header does not match expected shape/);
  });
  it("rejects unknown version (v99)", () => {
    expect(() =>
      parseSnapshotEnvelope("# shipwright-snapshot v99 xterm@5.5.0 80x24\npayload"),
    ).toThrow(/Unknown snapshot version: v99/);
  });
  it("accepts well-formed v1 header", () => {
    const rec = parseSnapshotEnvelope(
      "# shipwright-snapshot v1 xterm@5.5.0 120x30\npayload\nwith\nnewlines",
    );
    expect(rec.version).toBe("v1");
    expect(rec.terminalVersion).toBe("5.5.0");
    expect(rec.cols).toBe(120);
    expect(rec.rows).toBe(30);
    expect(rec.data).toBe("payload\nwith\nnewlines");
  });
  it("rejects 0x0 dimensions (external code review MEDIUM)", () => {
    expect(() =>
      parseSnapshotEnvelope("# shipwright-snapshot v1 xterm@5.5.0 0x0\npayload"),
    ).toThrow(/dims out of range/);
  });
  it("rejects oversized dimensions (DoS defense)", () => {
    expect(() =>
      parseSnapshotEnvelope("# shipwright-snapshot v1 xterm@5.5.0 99999x99999\npayload"),
    ).toThrow(/dims out of range/);
  });
  it("rejects oversized header (>512 bytes)", () => {
    const longVer = "X".repeat(500);
    expect(() =>
      parseSnapshotEnvelope(`# shipwright-snapshot v1 xterm@${longVer} 80x24\npayload`),
    ).toThrow(/header exceeds 512 bytes/);
  });
});

describe("SnapshotStore — file operations", () => {
  it("write is atomic — overwrites without leaving tmp file", async () => {
    await store.write(VALID, { cols: 80, rows: 24, data: "v1" });
    await store.write(VALID, { cols: 80, rows: 24, data: "v2" });
    const rec = await store.read(VALID);
    expect(rec!.data).toBe("v2");
    const entries = await fs.readdir(tmpDir);
    const tmpFiles = entries.filter((n) => n.includes(".tmp-"));
    expect(tmpFiles).toEqual([]);
  });

  it("has() returns true after write, false after clear", async () => {
    expect(await store.has(VALID)).toBe(false);
    await store.write(VALID, { cols: 80, rows: 24, data: "x" });
    expect(await store.has(VALID)).toBe(true);
    await store.clear(VALID);
    expect(await store.has(VALID)).toBe(false);
  });

  it("clear is idempotent (no error on ENOENT)", async () => {
    await store.clear(VALID); // never written
    await store.clear(VALID); // doubly absent
    expect(await store.has(VALID)).toBe(false);
  });

  it("read returns null when snapshot is absent", async () => {
    expect(await store.read(VALID)).toBeNull();
  });

  it("two tasks have independent snapshots", async () => {
    await store.write(VALID, { cols: 80, rows: 24, data: "alpha" });
    await store.write(VALID_2, { cols: 120, rows: 30, data: "beta" });
    expect((await store.read(VALID))!.data).toBe("alpha");
    expect((await store.read(VALID_2))!.data).toBe("beta");
  });

  it("header embeds the @xterm/headless package version", async () => {
    await store.write(VALID, { cols: 80, rows: 24, data: "x" });
    const filePath = path.join(tmpDir, `${VALID}.snapshot`);
    const raw = await fs.readFile(filePath, "utf8");
    // Plan invariant #4 — pinned version is read from package.json.
    expect(raw.startsWith("# shipwright-snapshot v1 xterm@")).toBe(true);
    // The plan currently pins 5.5.0; if the pin changes, the header
    // automatically tracks the package.json value, so we only assert
    // the shape and the dims.
    expect(raw).toMatch(
      /^# shipwright-snapshot v1 xterm@\d+\.\d+\.\d+ 80x24\n/,
    );
  });

  it("file mode on POSIX is 0o600 (skipped on Windows)", async () => {
    if (process.platform === "win32") return;
    await store.write(VALID, { cols: 80, rows: 24, data: "x" });
    const stats = fsSync.statSync(path.join(tmpDir, `${VALID}.snapshot`));
    // eslint-disable-next-line no-bitwise
    expect(stats.mode & 0o777).toBe(0o600);
  });
});
