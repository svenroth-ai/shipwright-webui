/*
 * event-log-assemble.test.ts — the pure assembling contract (events-drop-files,
 * issue 978; TS twin of shipwright `shared/scripts/lib/events_read.py`).
 *
 * @covers FR-01.47
 */

import { describe, expect, it } from "vitest";

import {
  absenceBlockers,
  assembleEventLog,
  dropKey,
  instantKey,
  sanitizeKey,
  type EventSource,
} from "./event-log-assemble.js";

const j = (o: Record<string, unknown>): string => JSON.stringify(o);
const legacy = (text: string): EventSource => ({ path: "shipwright_events.jsonl", kind: "legacy", text });
const drop = (name: string, text: string | null): EventSource => ({ path: `.shipwright/events/drops/${name}`, kind: "drop", text });
const archive = (name: string, text: string): EventSource => ({ path: `.shipwright/events/archive/${name}`, kind: "archive", text });

// @covers FR-01.47
describe("assembleEventLog — order", () => {
  it("keeps legacy lines verbatim in FILE order, then extras by (instant, id)", () => {
    const leg = `${j({ id: "L2", ts: "2026-10-02T00:00:00Z" })}\n${j({ id: "L1", ts: "2026-10-01T00:00:00Z" })}\n`;
    const log = assembleEventLog([
      legacy(leg),
      archive("fold-aaaaaaaaaaaa.jsonl", `${j({ id: "b", ts: "2026-10-03T00:00:00Z" })}\n`),
      drop("run-x--00000000--00000000.jsonl", `${j({ id: "a", ts: "2026-10-03T00:00:00Z" })}\n${j({ id: "c", ts: "2026-10-01T00:00:00Z" })}\n`),
    ]);
    // legacy is NOT re-sorted; extras sort by instant, then id ("a" < "b" on the tie)
    expect(log.lines.slice(0, 3)).toEqual(leg.split("\n"));
    expect(log.lines.slice(3).map((l) => JSON.parse(l).id)).toEqual(["c", "a", "b"]);
    expect(log.hasExtraFiles).toBe(true);
  });

  it("orders by parsed INSTANT across offsets and keeps microseconds (no false ties)", () => {
    const log = assembleEventLog([
      drop("k--00000000--00000000.jsonl", [
        j({ id: "z", ts: "2026-10-01T08:00:00+02:00" }), // 06:00Z
        j({ id: "y", ts: "2026-10-01T07:30:00Z" }),
        j({ id: "x", ts: "2026-10-01T07:30:00.000002Z" }),
        j({ id: "w", ts: "2026-10-01T07:30:00.000001Z" }),
        j({ id: "v", ts: "not a date" }), // unparseable sorts first
      ].join("\n")),
    ]);
    expect(log.lines.map((l) => JSON.parse(l).id)).toEqual(["v", "z", "y", "w", "x"]);
  });

  it("treats a NAIVE timestamp as UTC (not local time)", () => {
    expect(instantKey("2026-10-01T07:30:00")).toEqual(instantKey("2026-10-01T07:30:00Z"));
    expect(instantKey("2026-10-01")).toEqual(instantKey("2026-10-01T00:00:00+00:00"));
    expect(instantKey(42)[0]).toBe(-Infinity);
    // impossible dates/times are unparseable (Python fromisoformat rejects them), and a
    // two-digit year is year 50, not 1950
    for (const bad of ["2026-02-30T00:00:00Z", "2026-13-01", "2026-01-01T24:00:00Z", "2026-01-01T10:60:00Z", "2026-01-01T10:00:00+25:00", "0000-01-01"]) {
      expect(instantKey(bad)[0], bad).toBe(-Infinity);
    }
    expect(instantKey("0050-01-01T00:00:00Z")[0]).toBeLessThan(instantKey("1950-01-01T00:00:00Z")[0]);
  });

  it("keeps the caller's file order on a full tie (archive before drops, then name)", () => {
    const e = (id: string) => `${j({ ts: "2026-10-01T00:00:00Z", tag: id })}\n`;
    const log = assembleEventLog([
      archive("fold-a.jsonl", e("arch")),
      drop("a--00000000--00000000.jsonl", e("dropA")),
      drop("b--00000000--00000000.jsonl", e("dropB")),
    ]);
    expect(log.lines.map((l) => JSON.parse(l).tag)).toEqual(["arch", "dropA", "dropB"]);
  });

  it("is the identity on a legacy-only log (no extra files)", () => {
    const text = `${j({ id: "1" })}\n\n  ${j({ id: "2" })}\r\n{torn`;
    const log = assembleEventLog([legacy(text)]);
    expect(log.lines).toEqual(text.split("\n"));
    expect(log.effectiveLines).toBe(log.lines);
    expect(log.hasExtraFiles).toBe(false);
  });
});

// @covers FR-01.47
describe("assembleEventLog — per-file status", () => {
  it("reports ok / corrupt / empty / unreadable, and still returns records around a bad span", () => {
    const log = assembleEventLog([
      legacy(""),
      drop("ok--00000000--00000000.jsonl", `${j({ id: "1" })}\n`),
      drop("bad--00000000--00000000.jsonl", `${j({ id: "2" })}\n{"id": "3", "ts"\n`),
      drop("empty--00000000--00000000.jsonl", "\n\n"),
      drop("gone--00000000--00000000.jsonl", null),
    ]);
    expect(log.files.map((f) => [f.key, f.status, f.records, f.fragments])).toEqual([
      [null, "ok", 0, 0], // a zero-record legacy log is legitimate
      ["ok", "ok", 1, 0],
      ["bad", "corrupt", 1, 1],
      ["empty", "empty", 0, 0],
      ["gone", "unreadable", 0, 0],
    ]);
    expect(log.lines.filter((l) => l === j({ id: "1" }) || l === j({ id: "2" }))).toHaveLength(2);
    // the fragment is carried as its own (undecodable) line at the very end
    expect(log.lines[log.lines.length - 1]).toBe('{"id": "3", "ts"');
  });

  it("absence blockers: a non-ok drop of the run's key or an odd name, or any non-ok archive file", () => {
    const log = assembleEventLog([
      drop("iterate-a--00000000--00000000.jsonl", "{bad"),
      drop("iterate-b--00000000--00000000.jsonl", `${j({ id: "1" })}\n`),
      drop("notes.jsonl", "{bad"),
      archive("fold-x.jsonl", "{bad"),
    ]);
    expect(absenceBlockers(log.files, "iterate-a").map((f) => f.path)).toEqual([
      ".shipwright/events/drops/iterate-a--00000000--00000000.jsonl",
      ".shipwright/events/drops/notes.jsonl",
      ".shipwright/events/archive/fold-x.jsonl",
    ]);
    expect(absenceBlockers(log.files, "iterate-b").map((f) => f.path)).toEqual([
      ".shipwright/events/drops/notes.jsonl",
      ".shipwright/events/archive/fold-x.jsonl",
    ]);
  });

  it("keys: drop name grammar and the writer's sanitizer", () => {
    expect(dropKey("iterate-2026-11-07-x--0a1b2c3d--deadbeef.jsonl")).toBe("iterate-2026-11-07-x");
    expect(dropKey("x--zzzzzzzz--00000000.jsonl")).toBeNull();
    expect(sanitizeKey("a/b c")).toBe("a-b-c");
    expect(sanitizeKey("..x")).toBe("x");
    expect(sanitizeKey("")).toBe("_run");
    expect(sanitizeKey("r".repeat(90))).toHaveLength(80);
  });
});

// @covers FR-01.47
describe("assembleEventLog — duplicate-id rule", () => {
  it("collapses same id + same content (a differing `run` stamp is not content)", () => {
    const a = { id: "e1", ts: "2026-10-01T00:00:00Z", type: "phase_started", nested: { b: 1, a: 2 } };
    const log = assembleEventLog([
      archive("fold-a.jsonl", `${j({ ...a, run: "fold" })}\n`),
      drop("k--00000000--00000000.jsonl", `${j({ type: "phase_started", nested: { a: 2, b: 1 }, ts: a.ts, id: "e1", run: "k" })}\n`),
    ]);
    expect(log.lines).toHaveLength(1);
    expect(log.duplicateIds).toEqual([]);
  });

  it("keeps BOTH on same id + different content and flags the id once", () => {
    const log = assembleEventLog([
      drop("a--00000000--00000000.jsonl", `${j({ id: "e1", ts: "2026-10-01T00:00:00Z", v: 1 })}\n`),
      drop("b--00000000--00000000.jsonl", `${j({ id: "e1", ts: "2026-10-01T00:00:00Z", v: 2 })}\n${j({ id: "e1", ts: "2026-10-01T00:00:00Z", v: 3 })}\n`),
    ]);
    expect(log.lines).toHaveLength(3);
    expect(log.duplicateIds).toEqual(["e1"]);
  });

  it("never deduplicates the legacy file", () => {
    const line = j({ id: "e1", ts: "2026-10-01T00:00:00Z" });
    const log = assembleEventLog([legacy(`${line}\n${line}\n`), drop("a--00000000--00000000.jsonl", `${line}\n`)]);
    expect(log.lines.filter((l) => l === line)).toHaveLength(3);
  });
});

// @covers FR-01.47
describe("assembleEventLog — amendments", () => {
  const wc = (id: string, commit: string) => j({ id, type: "work_completed", adr_id: "iterate-x", ts: "2026-10-01T00:00:00Z", commit });
  const amend = (target: string, fields: unknown, ts = "2026-10-02T00:00:00Z") =>
    j({ id: `am-${ts}`, type: "event_amended", amends: target, fields, ts });

  it("overlays a DROP amendment onto its target (legacy or drop), last in order wins", () => {
    const log = assembleEventLog([
      legacy(`${wc("L", "")}\n`),
      drop("iterate-x--00000000--00000000.jsonl", `${wc("D", "")}\n${amend("D", { commit: "abc" })}\n${amend("L", { commit: "old" })}\n${amend("L", { commit: "new" }, "2026-10-03T00:00:00Z")}\n`),
    ]);
    const byId = new Map(log.effectiveLines.filter(Boolean).map((l) => JSON.parse(l)).map((o) => [o.id, o]));
    expect(byId.get("D").commit).toBe("abc");
    expect(byId.get("L").commit).toBe("new");
    // raw `lines` stay unamended (campaign status reads those)
    expect(log.lines.filter(Boolean).map((l) => JSON.parse(l)).find((o) => o.id === "D").commit).toBe("");
  });

  it("does NOT overlay an amendment that lives in the legacy file (unchanged behaviour)", () => {
    const log = assembleEventLog([
      legacy(`${wc("L", "")}\n${amend("L", { commit: "abc" })}\n`),
      drop("k--00000000--00000000.jsonl", `${j({ id: "other", ts: "2026-10-05T00:00:00Z" })}\n`),
    ]);
    expect(log.effectiveLines).toBe(log.lines);
  });

  it("ignores a non-object `fields` and an amendment without a string target", () => {
    const log = assembleEventLog([
      drop("k--00000000--00000000.jsonl", `${wc("D", "")}\n${amend("D", ["x"])}\n${j({ type: "event_amended", fields: { commit: "z" } })}\n`),
    ]);
    const d = log.effectiveLines.map((l) => JSON.parse(l)).find((o) => o.id === "D");
    expect(d.commit).toBe("");
  });
});
