import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { appendStatusEvent, TriageWriteError } from "./triage-write.js";
import { _clearCache_TEST_ONLY } from "./triage-store.js";

describe("triage-write: appendStatusEvent", () => {
  let workDir: string;
  let jsonlPath: string;

  beforeEach(() => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "triage-write-"));
    jsonlPath = path.join(workDir, ".shipwright", "triage.jsonl");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("creates parent directory + header when triage.jsonl does not exist", () => {
    appendStatusEvent({
      jsonlPath,
      triageId: "trg-aaaa1111",
      newStatus: "promoted",
      by: "webui",
      reason: "webuiPromote",
      promotedTaskId: "EXT:task-123",
      now: () => "2026-05-14T12:00:00Z",
    });
    const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      v: 1,
      schema: "triage",
    });
    expect(JSON.parse(lines[1])).toEqual({
      event: "status",
      id: "trg-aaaa1111",
      ts: "2026-05-14T12:00:00Z",
      newStatus: "promoted",
      by: "webui",
      reason: "webuiPromote",
      promotedTaskId: "EXT:task-123",
    });
  });

  it("uses JSON.stringify so newlines + quotes + control chars in reason are safely escaped", () => {
    mkdirSync(path.dirname(jsonlPath));
    writeFileSync(
      jsonlPath,
      `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}\n`,
    );
    appendStatusEvent({
      jsonlPath,
      triageId: "trg-bbbb2222",
      newStatus: "dismissed",
      by: "webui",
      reason: 'line1\nline2\twith"quote"and\\backslash',
      promotedTaskId: null,
      now: () => "2026-05-14T13:00:00Z",
    });
    const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2); // header + 1 status event = 2 lines, no torn writes
    const parsed = JSON.parse(lines[1]);
    expect(parsed.reason).toBe('line1\nline2\twith"quote"and\\backslash');
  });

  it("appends a second status event without rewriting earlier lines", () => {
    appendStatusEvent({
      jsonlPath,
      triageId: "trg-x",
      newStatus: "snoozed",
      by: "webui",
      reason: null,
      promotedTaskId: null,
      now: () => "2026-05-14T14:00:00Z",
    });
    appendStatusEvent({
      jsonlPath,
      triageId: "trg-y",
      newStatus: "dismissed",
      by: "webui",
      reason: "noop",
      promotedTaskId: null,
      now: () => "2026-05-14T15:00:00Z",
    });
    const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 events
    expect(JSON.parse(lines[1]).id).toBe("trg-x");
    expect(JSON.parse(lines[2]).id).toBe("trg-y");
  });

  it("invalidates the read cache so a subsequent readAllItems sees the new event", async () => {
    const { readAllItems } = await import("./triage-store.js");
    // Pre-seed the file with header + one append (so the upcoming status
    // event has a target). Status events for unknown ids are dropped, so
    // the append MUST land first.
    mkdirSync(path.dirname(jsonlPath));
    const append = JSON.stringify({
      event: "append",
      id: "trg-cache",
      ts: "2026-05-14T16:00:00Z",
      originalTs: "2026-05-14T16:00:00Z",
      source: "phaseQuality",
      severity: "high",
      kind: "bug",
      title: "X",
      detail: "Y",
      evidencePath: null,
      runId: null,
      commit: null,
      dedupKey: null,
      status: "triage",
      suggestedPriority: "P1",
      suggestedDomain: "engineering",
    });
    writeFileSync(
      jsonlPath,
      `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}\n${append}\n`,
    );
    // Prime the cache so the next read after appendStatusEvent must
    // invalidate to see the change.
    const primed = readAllItems(jsonlPath);
    expect(primed.find((i) => i.id === "trg-cache")?.status).toBe("triage");
    // Append the status flip — must trigger invalidateCacheForPath.
    appendStatusEvent({
      jsonlPath,
      triageId: "trg-cache",
      newStatus: "snoozed",
      by: "webui",
      reason: null,
      promotedTaskId: null,
      now: () => "2026-05-14T16:01:00Z",
    });
    const after = readAllItems(jsonlPath);
    expect(after.find((i) => i.id === "trg-cache")?.status).toBe("snoozed");
  });
});
