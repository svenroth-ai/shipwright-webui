import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { buildLeadInventoryEntry, buildOrgInventory } from "./org-inventory-composite.js";
import type { AuditLogCoreResult } from "../external/org/audit-log.js";

const VALID_BEAT_ID = "9f1c9e2a-2b1e-4a1e-9c1e-1a2b3c4d5e6f";
const OTHER_BEAT_ID = "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee";
const NOW = new Date("2026-09-08T06:00:00Z");

describe("buildLeadInventoryEntry", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-inventory-fixture-"));
    mkdirSync(path.join(leadsRoot, "lead-a"), { recursive: true });
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function writeRegister(entries: unknown[]) {
    writeFileSync(
      path.join(leadsRoot, "lead-a", "beat-register.json"),
      JSON.stringify({ version: 1, entries }),
      "utf8",
    );
  }

  const noAuditFn = (): AuditLogCoreResult => ({ status: 404, body: { error: "not_found" } });

  it("bounds beats to the 48h window but includes an unparseable startedAt value (fail toward showing)", () => {
    writeRegister([
      { sessionId: "s1", beatId: VALID_BEAT_ID, leadId: "lead-a", pid: 1, startedAt: "2026-09-08T02:00:00Z", closedAt: "2026-09-08T03:00:00Z" },
      { sessionId: "s2", beatId: OTHER_BEAT_ID, leadId: "lead-a", pid: 2, startedAt: "2026-09-01T00:00:00Z", closedAt: "2026-09-01T01:00:00Z" }, // outside window
      { sessionId: "s3", beatId: "cccccccc-cccc-4ccc-9ccc-cccccccccccc", leadId: "lead-a", pid: 3, startedAt: "not-a-date", closedAt: null },
    ]);
    const entry = buildLeadInventoryEntry(
      { leadsRoot, now: () => NOW, auditLogFn: noAuditFn },
      "lead-a",
      undefined,
    );
    expect(entry.totalBeatsInRegister).toBe(3);
    expect(entry.beats.map((b) => b.beatId)).toEqual([VALID_BEAT_ID, "cccccccc-cccc-4ccc-9ccc-cccccccccccc"]);
  });

  it("orders bounded beats startedAt-ascending", () => {
    writeRegister([
      { sessionId: "s1", beatId: OTHER_BEAT_ID, leadId: "lead-a", pid: 1, startedAt: "2026-09-08T04:00:00Z", closedAt: null },
      { sessionId: "s2", beatId: VALID_BEAT_ID, leadId: "lead-a", pid: 2, startedAt: "2026-09-08T01:00:00Z", closedAt: "2026-09-08T02:00:00Z" },
    ]);
    const entry = buildLeadInventoryEntry(
      { leadsRoot, now: () => NOW, auditLogFn: noAuditFn },
      "lead-a",
      undefined,
    );
    expect(entry.beats.map((b) => b.beatId)).toEqual([VALID_BEAT_ID, OTHER_BEAT_ID]);
  });

  it("a beat with a BEAT_ID_RE-refused beatId degrades ONLY that beat's steps to unreadable, never the whole lead", () => {
    writeRegister([
      { sessionId: "s1", beatId: "not-a-uuid", leadId: "lead-a", pid: 1, startedAt: "2026-09-08T02:00:00Z", closedAt: null },
    ]);
    const entry = buildLeadInventoryEntry(
      { leadsRoot, now: () => NOW, auditLogFn: noAuditFn },
      "lead-a",
      undefined,
    );
    expect(entry.beats).toHaveLength(1);
    expect(entry.beats[0].steps).toEqual({ status: "unreadable" });
  });

  it("marks unclaimedEffect found for a beat named in the audit lookup", () => {
    writeRegister([
      { sessionId: "s1", beatId: VALID_BEAT_ID, leadId: "lead-a", pid: 1, startedAt: "2026-09-08T02:00:00Z", closedAt: null },
    ]);
    const auditLogFn = (): AuditLogCoreResult => ({
      status: 200,
      body: {
        entries: [
          {
            raw: "",
            parsed: { ts: "2026-09-08T02:30:00Z", kind: "beat_effect_not_claimed", beat_id: VALID_BEAT_ID },
          },
        ],
        total: 1,
        nextCursor: null,
      },
    });
    const entry = buildLeadInventoryEntry({ leadsRoot, now: () => NOW, auditLogFn }, "lead-a", undefined);
    expect(entry.beats[0].unclaimedEffect).toEqual({ status: "found" });
  });

  it("degrades every bounded beat's unclaimedEffect to unknown when the audit lookup itself degrades", () => {
    writeRegister([
      { sessionId: "s1", beatId: VALID_BEAT_ID, leadId: "lead-a", pid: 1, startedAt: "2026-09-08T02:00:00Z", closedAt: null },
    ]);
    const failingAuditFn = (): AuditLogCoreResult => ({ status: 403, body: { error: "symlink_forbidden" } });
    const entry = buildLeadInventoryEntry(
      { leadsRoot, now: () => NOW, auditLogFn: failingAuditFn },
      "lead-a",
      undefined,
    );
    expect(entry.beats[0].unclaimedEffect).toEqual({ status: "unknown" });
  });

  it("a lead with no register file at all reads as zero beats, not an error", () => {
    const entry = buildLeadInventoryEntry(
      { leadsRoot, now: () => NOW, auditLogFn: noAuditFn },
      "lead-a",
      undefined,
    );
    expect(entry).toEqual({
      leadId: "lead-a",
      totalBeatsInRegister: 0,
      beats: [],
      authority: { measured: false, reason: "not readable at the default charter path" },
    });
  });
});

describe("buildOrgInventory", () => {
  it("keys the response by leadId, one entry per lead", () => {
    const leadsRoot = mkdtempSync(path.join(tmpdir(), "org-inventory-roster-"));
    try {
      mkdirSync(path.join(leadsRoot, "lead-a"), { recursive: true });
      mkdirSync(path.join(leadsRoot, "lead-b"), { recursive: true });
      const auditLogFn = (): AuditLogCoreResult => ({ status: 404, body: { error: "not_found" } });
      const result = buildOrgInventory(
        { leadsRoot, now: () => NOW, auditLogFn },
        [
          { leadId: "lead-a", charterPath: undefined },
          { leadId: "lead-b", charterPath: undefined },
        ],
      );
      expect(Object.keys(result)).toEqual(["lead-a", "lead-b"]);
    } finally {
      rmSync(leadsRoot, { recursive: true, force: true });
    }
  });
});
