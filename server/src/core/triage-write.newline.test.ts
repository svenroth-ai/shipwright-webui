import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { appendStatusEvent } from "./triage-write.js";
import { readAllItems, _clearCache_TEST_ONLY } from "./triage-store.js";

// Kept OUT of triage-write.test.ts on purpose: that file is bloat-baselined at
// 373 lines (grandfathered), so growing it would ratchet an existing entry and
// the pre-commit anti-ratchet hook would block the commit.

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

function appendLine(id: string): string {
  return JSON.stringify({
    event: "append",
    id,
    ts: "2026-07-18T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    title: `title ${id}`,
    detail: `detail ${id}`,
    dedupKey: `dedup:${id}`,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
  });
}

const HEADER = JSON.stringify({ v: 1, schema: "triage", created: "2026-07-18T07:00:00Z" });

function flip(jsonlPath: string, id: string) {
  appendStatusEvent({
    jsonlPath,
    triageId: id,
    newStatus: "dismissed",
    by: "webui",
    reason: null,
    promotedTaskId: null,
    now: () => "2026-07-18T09:00:00Z",
  });
}

describe("triage-write: newline termination guard", () => {
  let workDir: string;
  let jsonlPath: string;

  beforeEach(() => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "triage-newline-"));
    jsonlPath = path.join(workDir, ".shipwright", "triage.jsonl");
    mkdirSync(path.dirname(jsonlPath), { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  const contents = () => readFileSync(jsonlPath, "utf-8");

  // AC1 — the headline writer fix, scoped to repairing a PRE-EXISTING
  // unterminated tail (no concurrent foreign writer).
  it("does not concatenate onto an unterminated predecessor line", () => {
    // No trailing newline — an interrupted write, an external writer, or an
    // operator edit leaves the file in exactly this state.
    writeFileSync(jsonlPath, HEADER + LF + appendLine("trg-aaaa1111"));

    flip(jsonlPath, "trg-aaaa1111");

    const physical = contents().split(LF).filter(Boolean);
    expect(physical).toHaveLength(3);
    // Every physical line parses on its own — nothing is concatenated.
    for (const line of physical) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // The predecessor record survived intact.
    expect(JSON.parse(physical[1])).toMatchObject({
      event: "append",
      id: "trg-aaaa1111",
    });
    expect(JSON.parse(physical[2])).toMatchObject({
      event: "status",
      id: "trg-aaaa1111",
      newStatus: "dismissed",
    });
  });

  // AC2 — no blank line is injected when the file is already terminated.
  it("injects no blank line when the file already ends with LF", () => {
    writeFileSync(jsonlPath, HEADER + LF + appendLine("trg-bbbb2222") + LF);
    flip(jsonlPath, "trg-bbbb2222");
    expect(contents()).not.toContain(LF + LF);
    expect(contents().split(LF).filter(Boolean)).toHaveLength(3);
  });

  it("injects no blank line when the file ends CRLF (already terminated)", () => {
    // A CRLF-terminated file ends in LF; treating it as unterminated would
    // inject a blank line on every append.
    writeFileSync(jsonlPath, HEADER + CR + LF + appendLine("trg-cccc3333") + CR + LF);
    flip(jsonlPath, "trg-cccc3333");
    expect(contents()).not.toContain(LF + LF);
    const physical = contents().split(LF).filter((l) => l.trim().length > 0);
    expect(physical).toHaveLength(3);
  });

  it("injects no leading newline when bootstrapping a missing file", () => {
    // Header bootstrap writes a terminated line, so the probe must see the file
    // as already terminated and add nothing.
    flip(jsonlPath, "trg-dddd4444");
    expect(contents().startsWith(LF)).toBe(false);
    expect(contents()).not.toContain(LF + LF);
  });

  it("injects no leading newline when the file exists but is zero-byte", () => {
    writeFileSync(jsonlPath, "");
    flip(jsonlPath, "trg-eeee5555");
    expect(contents().startsWith(LF)).toBe(false);
    expect(contents()).not.toContain(LF + LF);
  });

  it("stays correct across repeated appends onto a torn tail", () => {
    writeFileSync(jsonlPath, HEADER + LF + appendLine("trg-ffff6666"));
    flip(jsonlPath, "trg-ffff6666");
    flip(jsonlPath, "trg-ffff6666");
    const physical = contents().split(LF).filter(Boolean);
    expect(physical).toHaveLength(4);
    for (const line of physical) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  // AC1b — the residual risk made visible. The writer probe is a TOCTOU
  // sequence and CANNOT be atomic against the Python writer, which uses a
  // disjoint lock primitive (ADR-101 / ADR-106). A lost race still produces a
  // concatenated line on disk. This pins the guarantee that actually holds:
  // the reader recovery absorbs it, so NO RECORD IS LOST. The two halves
  // compose — which is why the fix has two halves.
  it("loses no record when a lost race still produces a concatenation", () => {
    writeFileSync(
      jsonlPath,
      [HEADER, appendLine("trg-1111aaaa"), appendLine("trg-2222bbbb")].join(LF) + LF,
    );
    // Exactly what a foreign write landing between probe and append yields:
    // two records sharing one physical line.
    const torn = readFileSync(jsonlPath, "utf-8").replace(
      appendLine("trg-1111aaaa") + LF + appendLine("trg-2222bbbb"),
      appendLine("trg-1111aaaa") + appendLine("trg-2222bbbb"),
    );
    writeFileSync(jsonlPath, torn);
    _clearCache_TEST_ONLY();

    const ids = readAllItems(jsonlPath).map((it) => it.id).sort();
    expect(ids).toEqual(["trg-1111aaaa", "trg-2222bbbb"]);
  });
});
