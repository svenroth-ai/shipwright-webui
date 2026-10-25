/** @covers FR-01.75 — adopt snapshot 1.1 additive profile.source / warnings. */
import { describe, it, expect } from "vitest";
import { readSnapshotProfile } from "./adoptSnapshotProfile";

describe("readSnapshotProfile", () => {
  it("reads the 1.1 additive keys", () => {
    const r = readSnapshotProfile({
      schema_version: "1.1",
      profile: { matched: "my-stack", confidence: 0.9, source: "user", warnings: ["WARNING: x"] },
    });
    expect(r).toEqual({ ok: true, profile: { matched: "my-stack", confidence: 0.9, source: "user", warnings: ["WARNING: x"] } });
  });

  it("keeps a 1.0 snapshot (no source / warnings) readable", () => {
    const r = readSnapshotProfile({ schema_version: "1.0", profile: { matched: "vite-hono", confidence: 1 } });
    expect(r).toEqual({ ok: true, profile: { matched: "vite-hono", confidence: 1, source: null, warnings: [] } });
  });

  it("refuses a newer major and garbage, never half-reads", () => {
    expect(readSnapshotProfile({ schema_version: "2.0", profile: {} }).ok).toBe(false);
    expect(readSnapshotProfile({ profile: { matched: null, warnings: [1, "ok"] } })).toEqual({
      ok: true,
      profile: { matched: null, confidence: null, source: null, warnings: ["ok"] },
    });
    expect(readSnapshotProfile("x").ok).toBe(false);
    expect(readSnapshotProfile({}).ok).toBe(false);
  });
});
