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
      version: "v2",
      terminalVersion: "6.0.0",
      cols: 120,
      rows: 30,
      data: "\x1b[2J\x1b[Hhello",
    });
    expect(env).toEqual({
      type: "replay_snapshot",
      data: "\x1b[2J\x1b[Hhello",
      cols: 120,
      rows: 30,
      terminalVersion: "6.0.0",
    });
  });

  it("preserves the data verbatim including newlines and UTF-8 multi-byte", () => {
    const payload = "line 1\r\n你好 🚀\r\nline 3";
    const env = buildReplaySnapshotEnvelope({
      version: "v2",
      terminalVersion: "6.0.0",
      cols: 80,
      rows: 24,
      data: payload,
    });
    expect(env.data).toBe(payload);
  });

  /*
   * Iterate K follow-up — `@xterm/addon-serialize` 0.19.0 omits the
   * mouseEncoding mode (`?1006h` for SGR). Without it, re-attached
   * sessions get mouse-tracking-ON but in the legacy encoding format
   * that Claude TUI's wheel-event handler does not parse. Symptom:
   * scroll dies after detach+re-attach. We augment the envelope's data
   * tail with `?1006h` whenever a mouse-tracking enter is present and
   * `?1006h` itself is not already in the body.
   */
  it("appends ?1006h when serialized data contains ?1000h (vt200 mouse)", () => {
    const data = "\x1b[2J\x1b[Hhello\x1b[?2004h\x1b[?1004h\x1b[?1000h";
    const env = buildReplaySnapshotEnvelope({
      version: "v2",
      terminalVersion: "6.0.0",
      cols: 120,
      rows: 30,
      data,
    });
    expect(env.data).toBe(data + "\x1b[?1006h");
  });

  it("appends ?1006h for ?1002h (btn-event) and ?1003h (any-event) mouse modes", () => {
    for (const mode of ["1002", "1003", "9"]) {
      const data = `cells\x1b[?${mode}h`;
      const env = buildReplaySnapshotEnvelope({
        version: "v2",
        terminalVersion: "6.0.0",
        cols: 80,
        rows: 24,
        data,
      });
      expect(env.data).toBe(data + "\x1b[?1006h");
    }
  });

  it("does NOT append ?1006h when no mouse-tracking mode is present", () => {
    const data = "\x1b[Hsome cells\x1b[?2004h\x1b[?1004h";
    const env = buildReplaySnapshotEnvelope({
      version: "v2",
      terminalVersion: "6.0.0",
      cols: 80,
      rows: 24,
      data,
    });
    expect(env.data).toBe(data);
    expect(env.data).not.toContain("\x1b[?1006h");
  });

  it("does NOT double-append when ?1006h is already in the body", () => {
    const data = "cells\x1b[?1000h\x1b[?1006h";
    const env = buildReplaySnapshotEnvelope({
      version: "v2",
      terminalVersion: "6.0.0",
      cols: 80,
      rows: 24,
      data,
    });
    // Augmentation guard prevents duplication.
    expect(env.data).toBe(data);
    expect((env.data.match(/\x1b\[\?1006h/g) || []).length).toBe(1);
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
    const rec = await tryReadSnapshot(undefined, VALID, "6.0.0", warnSpy);
    expect(rec).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns null when snapshot is absent (pre-Iterate-B task)", async () => {
    const rec = await tryReadSnapshot(store, VALID, "6.0.0", warnSpy);
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
    const rec = await tryReadSnapshot(throwingStore, VALID, "6.0.0", warnSpy);
    expect(rec).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/snapshot read failed.*disk failure/);
  });

  it("returns null + warns when terminalVersion mismatches expected", async () => {
    // Write a real snapshot through the production path; the header
    // embeds the actual runtime version. Then ask tryReadSnapshot to
    // expect a DIFFERENT version → must return null (no replay history
    // sent; Iterate C / ADR-087 retired the chunked fallback).
    await store.write(VALID, { cols: 80, rows: 24, data: "snapshot data" });
    const rec = await tryReadSnapshot(store, VALID, "999.0.0", warnSpy);
    expect(rec).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /version mismatch.*expected=999\.0\.0.*no replay history will be sent/,
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

  it("returns null + warns when expectedVersion is set but the file's terminalVersion is hostile/malformed (defensive)", async () => {
    // Construct a record with a hostile terminalVersion string and write
    // it via a low-level file write so we bypass the writer's strict embed.
    // The envelope version is v2 (current); the terminalVersion field
    // (after `xterm@`) is the hostile token. After ADR-097 the loader
    // only accepts v2; an unknown-version envelope is rejected at parse
    // time which also produces a null+warn via the read-failed branch.
    const filePath = path.join(tmpDir, `${VALID}.snapshot`);
    await fs.writeFile(
      filePath,
      "# shipwright-snapshot v2 xterm@ATTACKER 80x24\nx",
      { encoding: "utf8" },
    );
    const rec = await tryReadSnapshot(store, VALID, "6.0.0", warnSpy);
    expect(rec).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("returns null + warns when the on-disk envelope is a legacy v1 (ADR-097 regression-guard)", async () => {
    // Pre-upgrade tasks have v1 snapshots on disk. The loader rejects
    // them with SnapshotStoreError("unknown_version", …) → tryReadSnapshot
    // catches that, logs a warn, and returns null so the WS-attach
    // surface emits no replay envelope (blank terminal with live shell —
    // ADR-087 trade-off). This guards against a future regression that
    // silently re-accepts v1 envelopes without an explicit envelope-format
    // review (which would require a fresh M2 fixed-point re-verify).
    const filePath = path.join(tmpDir, `${VALID}.snapshot`);
    await fs.writeFile(
      filePath,
      "# shipwright-snapshot v1 xterm@5.5.0 120x30\nlegacy payload",
      { encoding: "utf8" },
    );
    const rec = await tryReadSnapshot(store, VALID, "6.0.0", warnSpy);
    expect(rec).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /snapshot read failed.*Unknown snapshot version: v1/,
    );
  });
});
