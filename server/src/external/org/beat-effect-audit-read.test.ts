import { describe, expect, it } from "vitest";

import { readBeatEffectAuditCore } from "./beat-effect-audit-read.js";
import type { AuditLogCoreResult, AuditLogEntry, AuditLogParams } from "./audit-log.js";

const NOW = Date.parse("2026-09-08T06:00:00Z");
const WINDOW_START = NOW - 48 * 60 * 60 * 1000;

function entry(tsOffsetMs: number, kind: string, beatId: string): AuditLogEntry {
  const ts = new Date(NOW - tsOffsetMs).toISOString();
  return { raw: JSON.stringify({ ts, kind, beat_id: beatId }), parsed: { ts, kind, beat_id: beatId } };
}

describe("readBeatEffectAuditCore", () => {
  it("finds a beat_effect_not_claimed entry within a single page and returns ok", () => {
    const auditLogFn = (): AuditLogCoreResult => ({
      status: 200,
      body: {
        entries: [
          entry(1000, "beat_effect_not_claimed", "beat-1"),
          entry(2000, "beat_started", "beat-2"),
        ],
        total: 2,
        nextCursor: null,
      },
    });
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", auditLogFn }, "lead-a", WINDOW_START);
    expect(result).toEqual({ status: "ok", unclaimedBeatIds: new Set(["beat-1"]) });
  });

  it("a 404 (no audit.jsonl at all) is a legitimate clear, not unknown", () => {
    const auditLogFn = (): AuditLogCoreResult => ({ status: 404, body: { error: "not_found" } });
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", auditLogFn }, "lead-a", WINDOW_START);
    expect(result).toEqual({ status: "ok", unclaimedBeatIds: new Set() });
  });

  it("a real read failure (not 404) degrades to unknown, never a false clear", () => {
    const auditLogFn = (): AuditLogCoreResult => ({ status: 403, body: { error: "symlink_forbidden" } });
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", auditLogFn }, "lead-a", WINDOW_START);
    expect(result).toEqual({ status: "unknown" });
  });

  it("skips a malformed (unparseable) line without failing the page", () => {
    const auditLogFn = (): AuditLogCoreResult => ({
      status: 200,
      body: {
        entries: [
          { raw: "not json", parsed: null },
          entry(1000, "beat_effect_not_claimed", "beat-9"),
        ],
        total: 2,
        nextCursor: null,
      },
    });
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", auditLogFn }, "lead-a", WINDOW_START);
    expect(result).toEqual({ status: "ok", unclaimedBeatIds: new Set(["beat-9"]) });
  });

  it("pages with the before cursor until the 48h window start is covered", () => {
    const calls: AuditLogParams[] = [];
    const auditLogFn = (_deps: unknown, params: AuditLogParams): AuditLogCoreResult => {
      calls.push(params);
      if ((params.before ?? 0) === 0) {
        return {
          status: 200,
          body: {
            entries: [entry(1000, "beat_started", "beat-1")],
            total: 400,
            nextCursor: 200,
          },
        };
      }
      return {
        status: 200,
        body: {
          entries: [entry(50 * 60 * 60 * 1000, "beat_effect_not_claimed", "beat-old")],
          total: 400,
          nextCursor: null,
        },
      };
    };
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", auditLogFn }, "lead-a", WINDOW_START);
    expect(calls).toHaveLength(2);
    expect(calls[1].before).toBe(200);
    expect(result).toEqual({ status: "ok", unclaimedBeatIds: new Set(["beat-old"]) });
  });

  it("stops paging as soon as the oldest entry on a page reaches the window start (does not need nextCursor:null)", () => {
    const calls: AuditLogParams[] = [];
    const auditLogFn = (_deps: unknown, params: AuditLogParams): AuditLogCoreResult => {
      calls.push(params);
      return {
        status: 200,
        body: {
          entries: [entry(49 * 60 * 60 * 1000, "beat_started", "beat-1")],
          total: 5000,
          nextCursor: 200, // more pages exist, but the window is already covered
        },
      };
    };
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", auditLogFn }, "lead-a", WINDOW_START);
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("ok");
  });

  it("degrades to unknown after 10 pages without covering the window (bounded cap, never a silent miss)", () => {
    const calls: AuditLogParams[] = [];
    const auditLogFn = (_deps: unknown, params: AuditLogParams): AuditLogCoreResult => {
      calls.push(params);
      const before = params.before ?? 0;
      return {
        status: 200,
        body: {
          entries: [entry(1000, "beat_started", "beat-1")], // always within-window ts — window never covered
          total: 100000,
          nextCursor: before + 200,
        },
      };
    };
    const result = readBeatEffectAuditCore({ leadsRoot: "/leads", auditLogFn }, "lead-a", WINDOW_START);
    expect(calls).toHaveLength(10);
    expect(result).toEqual({ status: "unknown" });
  });
});
