import { describe, expect, it } from "vitest";

import { readBeatEffectAuditCore } from "./beat-effect-audit-read.js";
import type { AuditLinesGuardedResult } from "./audit-log.js";

function line(kind: string, beatId: string): string {
  return JSON.stringify({ ts: new Date().toISOString(), kind, beat_id: beatId });
}

describe("readBeatEffectAuditCore", () => {
  it("finds a beat_effect_not_claimed entry in a single-pass scan and returns ok", () => {
    const readAuditLinesFn = (): AuditLinesGuardedResult => ({
      status: 200,
      linesNewestFirst: [line("beat_effect_not_claimed", "beat-1"), line("beat_started", "beat-2")],
    });
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", readAuditLinesFn }, "lead-a");
    expect(result).toEqual({ status: "ok", unclaimedBeatIds: new Set(["beat-1"]) });
  });

  it("a 404 (no audit.jsonl at all) is a legitimate clear, not unknown", () => {
    const readAuditLinesFn = (): AuditLinesGuardedResult => ({ status: 404, body: { error: "not_found" } });
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", readAuditLinesFn }, "lead-a");
    expect(result).toEqual({ status: "ok", unclaimedBeatIds: new Set() });
  });

  it("a real read failure (not 404) degrades to unknown, never a false clear", () => {
    const readAuditLinesFn = (): AuditLinesGuardedResult => ({
      status: 403,
      body: { error: "symlink_forbidden" },
    });
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", readAuditLinesFn }, "lead-a");
    expect(result).toEqual({ status: "unknown", unclaimedBeatIds: new Set() });
  });

  it("skips a malformed (unparseable) line without failing the whole scan", () => {
    const readAuditLinesFn = (): AuditLinesGuardedResult => ({
      status: 200,
      linesNewestFirst: ["not json", line("beat_effect_not_claimed", "beat-9")],
    });
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", readAuditLinesFn }, "lead-a");
    expect(result).toEqual({ status: "ok", unclaimedBeatIds: new Set(["beat-9"]) });
  });

  it("reads the file exactly once regardless of how many lines it contains (no pagination loop)", () => {
    let calls = 0;
    const manyLines = Array.from({ length: 5000 }, (_, i) => line("beat_started", `beat-${i}`));
    manyLines.push(line("beat_effect_not_claimed", "beat-deep"));
    const readAuditLinesFn = (): AuditLinesGuardedResult => {
      calls += 1;
      return { status: 200, linesNewestFirst: manyLines };
    };
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", readAuditLinesFn }, "lead-a");
    expect(calls).toBe(1);
    expect(result).toEqual({ status: "ok", unclaimedBeatIds: new Set(["beat-deep"]) });
  });
});
