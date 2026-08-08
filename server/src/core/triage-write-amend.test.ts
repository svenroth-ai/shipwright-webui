/*
 * triage-write-amend.test.ts — appendAmendEvent coverage, split out as its
 * OWN file rather than appended to triage-write.test.ts: that file is
 * already grandfathered at the 300-line bloat baseline (current: 373), and
 * the project's extraction-over-growth convention says a new module's tests
 * get a new file rather than pushing an already-over-ceiling file higher.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { appendAmendEvent } from "./triage-write.js";
import { _clearCache_TEST_ONLY } from "./triage-store.js";
import { outboxPathFor } from "./triage-paths.js";

function appendLine(id: string): string {
  return JSON.stringify({
    event: "append",
    id,
    ts: "2026-06-01T08:00:00Z",
    originalTs: "2026-06-01T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title: `title ${id}`,
    detail: `detail ${id}`,
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: `dedup:${id}`,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
  });
}

describe("triage-write: appendAmendEvent", () => {
  let workDir: string;
  let jsonlPath: string;

  beforeEach(() => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "triage-write-amend-"));
    jsonlPath = path.join(workDir, ".shipwright", "triage.jsonl");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("appends an amend event carrying only the supplied fields", () => {
    mkdirSync(path.dirname(jsonlPath));
    writeFileSync(
      jsonlPath,
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-a")}\n`,
    );
    appendAmendEvent({
      jsonlPath,
      triageId: "trg-a",
      by: "sven",
      title: "Corrected title",
      now: () => "2026-08-08T10:00:00Z",
    });
    const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3); // header + append + amend
    expect(JSON.parse(lines[2])).toEqual({
      event: "amend",
      id: "trg-a",
      ts: "2026-08-08T10:00:00Z",
      by: "sven",
      title: "Corrected title",
    });
  });

  it("carries multiple fields on one amend event (title + detail + severity)", () => {
    mkdirSync(path.dirname(jsonlPath));
    writeFileSync(
      jsonlPath,
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-b")}\n`,
    );
    appendAmendEvent({
      jsonlPath,
      triageId: "trg-b",
      by: "sven",
      title: "New title",
      detail: "New detail",
      severity: "critical",
      now: () => "2026-08-08T10:05:00Z",
    });
    const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
    expect(JSON.parse(lines[2])).toEqual({
      event: "amend",
      id: "trg-b",
      ts: "2026-08-08T10:05:00Z",
      by: "sven",
      title: "New title",
      detail: "New detail",
      severity: "critical",
    });
  });

  it("creates parent directory + header when triage.jsonl does not exist", () => {
    appendAmendEvent({
      jsonlPath,
      triageId: "trg-new",
      by: "sven",
      detail: "d",
      now: () => "2026-08-08T10:00:00Z",
    });
    const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2); // bootstrapped header + amend
    expect(JSON.parse(lines[0])).toMatchObject({ v: 1, schema: "triage" });
  });

  it("uses JSON.stringify so control chars in detail are safely escaped", () => {
    mkdirSync(path.dirname(jsonlPath));
    writeFileSync(
      jsonlPath,
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-esc")}\n`,
    );
    appendAmendEvent({
      jsonlPath,
      triageId: "trg-esc",
      by: "sven",
      detail: 'line1\nline2\twith"quote"and\\backslash',
      now: () => "2026-08-08T10:00:00Z",
    });
    const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
    expect(JSON.parse(lines[2]).detail).toBe('line1\nline2\twith"quote"and\\backslash');
  });

  it("invalidates the read cache so a subsequent readAllItems sees the amend", async () => {
    const { readAllItems } = await import("./triage-store.js");
    mkdirSync(path.dirname(jsonlPath));
    writeFileSync(
      jsonlPath,
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-cache")}\n`,
    );
    const primed = readAllItems(jsonlPath);
    expect(primed.find((i) => i.id === "trg-cache")?.title).toBe("title trg-cache");
    appendAmendEvent({
      jsonlPath,
      triageId: "trg-cache",
      by: "sven",
      title: "Amended title",
      now: () => "2026-08-08T10:00:00Z",
    });
    const after = readAllItems(jsonlPath);
    const item = after.find((i) => i.id === "trg-cache");
    expect(item?.title).toBe("Amended title");
    expect(item?.amendedBy).toBe("sven");
    expect(item?.amendedAt).toBe("2026-08-08T10:00:00Z");
  });
});

describe("triage-write: appendAmendEvent — residence-derived target (outbox contract)", () => {
  let workDir: string;
  let trackedPath: string;
  let outboxPath: string;

  beforeEach(() => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "triage-write-amend-residence-"));
    trackedPath = path.join(workDir, ".shipwright", "triage.jsonl");
    outboxPath = outboxPathFor(trackedPath);
    mkdirSync(path.dirname(trackedPath), { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("writes the amend to the OUTBOX when the item's append is outbox-only", () => {
    writeFileSync(outboxPath, appendLine("trg-out") + "\n");
    appendAmendEvent({
      jsonlPath: trackedPath,
      triageId: "trg-out",
      by: "sven",
      title: "Fixed",
      now: () => "2026-08-08T12:00:00Z",
    });
    expect(existsSync(trackedPath)).toBe(false);
    const outboxLines = readFileSync(outboxPath, "utf-8").split("\n").filter(Boolean);
    expect(outboxLines).toHaveLength(2); // append + amend
    expect(JSON.parse(outboxLines[1])).toMatchObject({ event: "amend", id: "trg-out" });
  });

  it("writes the amend to TRACKED when the item's append is in tracked", () => {
    writeFileSync(
      trackedPath,
      `{"v":1,"schema":"triage","created":"2026-08-08T00:00:00Z"}\n${appendLine("trg-t")}\n`,
    );
    appendAmendEvent({
      jsonlPath: trackedPath,
      triageId: "trg-t",
      by: "sven",
      severity: "low",
      now: () => "2026-08-08T12:00:00Z",
    });
    const trackedLines = readFileSync(trackedPath, "utf-8").split("\n").filter(Boolean);
    expect(trackedLines).toHaveLength(3); // header + append + amend
    expect(existsSync(outboxPath)).toBe(false);
  });
});
