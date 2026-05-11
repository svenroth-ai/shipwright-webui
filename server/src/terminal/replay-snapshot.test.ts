/*
 * replay-snapshot.test.ts — Iterate B / ADR-089.
 *
 * Unit coverage for the snapshot-replay version gate + envelope builder.
 *
 * Coverage:
 *   - Envelope shape matches the wire contract (type / data / cols /
 *     rows / terminalVersion).
 *   - tryReadSnapshot:
 *       - returns null when store is undefined (legacy / disabled).
 *       - returns null when snapshot is absent.
 *       - returns null + warns when read throws.
 *       - returns null + warns when version mismatches.
 *       - returns the record when version matches.
 *       - returns the record when expectedVersion is unset (test fixture).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildReplaySnapshotEnvelope,
  tryReadSnapshot,
} from "./replay-snapshot.js";
import {
  SnapshotStore,
  _resetTerminalVersionCacheForTesting,
} from "./snapshot-store.js";

const VALID = "11111111-2222-3333-4444-555555555555";

describe("buildReplaySnapshotEnvelope", () => {
  it("produces the wire-shape envelope", () => {
    const env = buildReplaySnapshotEnvelope({
      version: "v1",
      terminalVersion: "5.5.0",
      cols: 120,
      rows: 30,
      data: "\x1b[2J\x1b[Hhello",
    });
    expect(env).toEqual({
      type: "replay_snapshot",
      data: "\x1b[2J\x1b[Hhello",
      cols: 120,
      rows: 30,
      terminalVersion: "5.5.0",
    });
  });

  it("preserves the data verbatim including newlines and UTF-8 multi-byte", () => {
    const payload = "line 1\r\n你好 🚀\r\nline 3";
    const env = buildReplaySnapshotEnvelope({
      version: "v1",
      terminalVersion: "5.5.0",
      cols: 80,
      rows: 24,
      data: payload,
    });
    expect(env.data).toBe(payload);
  });
});

describe("tryReadSnapshot", () => {
  let tmpDir: string;
  let store: SnapshotStore;
  let warnSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rsnap-test-"));
    store = new SnapshotStore(tmpDir);
    await store.init();
    _resetTerminalVersionCacheForTesting();
    warnSpy = vi.fn();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("returns null when store is undefined", async () => {
    const rec = await tryReadSnapshot(undefined, VALID, "5.5.0", warnSpy);
    expect(rec).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns null when snapshot is absent (pre-Iterate-B task)", async () => {
    const rec = await tryReadSnapshot(store, VALID, "5.5.0", warnSpy);
    expect(rec).toBeNull();
    // ENOENT is not an error condition — no warning expected.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns null + warns when store.read throws", async () => {
    const throwingStore = {
      read: async () => {
        throw new Error("disk failure");
      },
    } as unknown as SnapshotStore;
    const rec = await tryReadSnapshot(throwingStore, VALID, "5.5.0", warnSpy);
    expect(rec).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/snapshot read failed.*disk failure/);
  });

  it("returns null + warns when terminalVersion mismatches expected", async () => {
    // Write a real snapshot through the production path; the header
    // embeds the actual runtime version. Then ask tryReadSnapshot to
    // expect a DIFFERENT version → must fall back.
    await store.write(VALID, { cols: 80, rows: 24, data: "snapshot data" });
    const rec = await tryReadSnapshot(store, VALID, "999.0.0", warnSpy);
    expect(rec).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /version mismatch.*expected=999\.0\.0.*falling back to chunked replay/,
    );
  });

  it("returns the record when version matches the runtime", async () => {
    await store.write(VALID, { cols: 80, rows: 24, data: "snapshot data" });
    // First read with no expected version → returns the record + its
    // runtime version, which we then use to gate the second read.
    const probe = await tryReadSnapshot(store, VALID, undefined, warnSpy);
    expect(probe).not.toBeNull();
    const rec = await tryReadSnapshot(
      store,
      VALID,
      probe!.terminalVersion,
      warnSpy,
    );
    expect(rec).not.toBeNull();
    expect(rec!.data).toBe("snapshot data");
    expect(rec!.cols).toBe(80);
    expect(rec!.rows).toBe(24);
    // No warning emitted on the success path.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns the record when expectedVersion is unset (any-version accept)", async () => {
    await store.write(VALID, { cols: 80, rows: 24, data: "any-version-ok" });
    const rec = await tryReadSnapshot(store, VALID, undefined, warnSpy);
    expect(rec).not.toBeNull();
    expect(rec!.data).toBe("any-version-ok");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns null + warns when expectedVersion is set but the file's version is empty/malformed (defensive)", async () => {
    // Construct a record with a hostile version string and write it via
    // a low-level file write so we bypass the writer's strict embed.
    const filePath = path.join(tmpDir, `${VALID}.snapshot`);
    await fs.writeFile(
      filePath,
      "# shipwright-snapshot v1 xterm@ATTACKER 80x24\nx",
      { encoding: "utf8" },
    );
    const rec = await tryReadSnapshot(store, VALID, "5.5.0", warnSpy);
    expect(rec).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
