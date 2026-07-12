/*
 * snapshot-preserve.test.ts — iterate-2026-07-12-mirror-flush-preserve-gate.
 *
 * Direct unit tests of writeSnapshotPreservingLarger — the ADR-096
 * preservation gate now SHARED by both snapshot write surfaces
 * (finalizeMirrorSnapshot + flushMirrorSnapshot). Exercises every branch
 * against a fake store: skip when substantially smaller, write at/above the
 * 60 % boundary, larger-overwrites, no-existing first-writer, read-throw
 * best-effort fallback, and logger + caller-label wiring.
 *
 * The pty-manager integration (flush preservation regression + rule-21
 * no-dispose + finalize symmetry) lives in
 * pty-manager-flush-preserve.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import {
  writeSnapshotPreservingLarger,
  SNAPSHOT_PRESERVE_THRESHOLD,
  type SnapshotReadWrite,
} from "./snapshot-preserve.js";

const TASK = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface FakeStore extends SnapshotReadWrite {
  writes: Array<{ cols: number; rows: number; data: string }>;
}

function makeFakeStore(
  readImpl: () => Promise<{ data: string } | null>,
): FakeStore {
  const writes: FakeStore["writes"] = [];
  return {
    writes,
    read: readImpl,
    async write(_taskId, payload) {
      writes.push(payload);
    },
  };
}

describe("writeSnapshotPreservingLarger (ADR-096 shared gate)", () => {
  it("threshold constant is 0.6", () => {
    expect(SNAPSHOT_PRESERVE_THRESHOLD).toBe(0.6);
  });

  it("SKIPS the write when new payload is < 60 % of existing", async () => {
    const store = makeFakeStore(async () => ({ data: "x".repeat(1000) }));
    const warns: string[] = [];
    const res = await writeSnapshotPreservingLarger(
      store,
      TASK,
      { cols: 120, rows: 30, data: "y".repeat(500) }, // 500 < 600
      { log: (m) => warns.push(m), caller: "flushMirrorSnapshot" },
    );
    expect(res.skipped).toBe(true);
    expect(store.writes.length).toBe(0);
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("flushMirrorSnapshot");
    expect(warns[0]).toContain("ADR-096");
  });

  it("WRITES when new payload is exactly at the 60 % boundary (not strictly less)", async () => {
    const store = makeFakeStore(async () => ({ data: "x".repeat(1000) }));
    const res = await writeSnapshotPreservingLarger(
      store,
      TASK,
      { cols: 120, rows: 30, data: "y".repeat(600) }, // 600 === 1000*0.6, not < 600
    );
    expect(res.skipped).toBe(false);
    expect(store.writes.length).toBe(1);
    expect(store.writes[0].data).toBe("y".repeat(600));
  });

  it("WRITES when new payload is LARGER than existing (richer overwrites)", async () => {
    const store = makeFakeStore(async () => ({ data: "x".repeat(100) }));
    const res = await writeSnapshotPreservingLarger(store, TASK, {
      cols: 80,
      rows: 24,
      data: "y".repeat(5000),
    });
    expect(res.skipped).toBe(false);
    expect(store.writes.length).toBe(1);
    expect(store.writes[0].data.length).toBe(5000);
  });

  it("WRITES when there is no existing snapshot (read → null, first writer)", async () => {
    const store = makeFakeStore(async () => null);
    const res = await writeSnapshotPreservingLarger(store, TASK, {
      cols: 120,
      rows: 30,
      data: "tiny",
    });
    expect(res.skipped).toBe(false);
    expect(store.writes.length).toBe(1);
  });

  it("WRITES (best-effort) when the existing-snapshot read THROWS + logs", async () => {
    const store = makeFakeStore(async () => {
      throw new Error("simulated parse error");
    });
    const warns: string[] = [];
    const res = await writeSnapshotPreservingLarger(
      store,
      TASK,
      { cols: 120, rows: 30, data: "tiny" },
      { log: (m) => warns.push(m), caller: "finalizeMirrorSnapshot" },
    );
    expect(res.skipped).toBe(false);
    expect(store.writes.length).toBe(1);
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("read failed");
    expect(warns[0]).toContain("finalizeMirrorSnapshot");
  });

  it("defaults to console.warn + a generic caller label when opts omitted", async () => {
    const store = makeFakeStore(async () => ({ data: "x".repeat(1000) }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await writeSnapshotPreservingLarger(store, TASK, {
      cols: 120,
      rows: 30,
      data: "y".repeat(100), // 100 < 600 → skip → default logger fires
    });
    expect(res.skipped).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("writeSnapshotPreservingLarger");
    warnSpy.mockRestore();
  });

  it("does NOT fire the gate when existing is empty (existingLen 0)", async () => {
    const store = makeFakeStore(async () => ({ data: "" }));
    const res = await writeSnapshotPreservingLarger(store, TASK, {
      cols: 120,
      rows: 30,
      data: "", // 0 vs 0 → existingLen not > 0 → write
    });
    expect(res.skipped).toBe(false);
    expect(store.writes.length).toBe(1);
  });
});
