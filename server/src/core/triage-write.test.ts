import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
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

import { appendStatusEvent, shouldRouteToOutbox } from "./triage-write.js";
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

describe("triage-write: appendStatusEvent — residence-derived target (outbox contract)", () => {
  let workDir: string;
  let trackedPath: string;
  let outboxPath: string;

  beforeEach(() => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "triage-write-residence-"));
    trackedPath = path.join(workDir, ".shipwright", "triage.jsonl");
    outboxPath = outboxPathFor(trackedPath);
    mkdirSync(path.dirname(trackedPath), { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("writes the status to the OUTBOX when the item's append is outbox-only (no tracked drift)", () => {
    // Background producer appended to the headerless outbox; tracked absent.
    writeFileSync(outboxPath, appendLine("trg-out") + "\n");
    appendStatusEvent({
      jsonlPath: trackedPath,
      triageId: "trg-out",
      newStatus: "dismissed",
      by: "webui",
      reason: "dismiss outbox item",
      promotedTaskId: null,
      now: () => "2026-06-01T12:00:00Z",
    });
    // Status landed in the OUTBOX; tracked store NOT created (no main drift).
    expect(existsSync(trackedPath)).toBe(false);
    const outboxLines = readFileSync(outboxPath, "utf-8").split("\n").filter(Boolean);
    expect(outboxLines).toHaveLength(2); // append + status
    const status = JSON.parse(outboxLines[1]);
    expect(status).toMatchObject({ event: "status", id: "trg-out", newStatus: "dismissed" });
  });

  it("writes the status to TRACKED when the item's append is in tracked", () => {
    writeFileSync(trackedPath, `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-t")}\n`);
    appendStatusEvent({
      jsonlPath: trackedPath,
      triageId: "trg-t",
      newStatus: "promoted",
      by: "webui",
      reason: "webuiPromote",
      promotedTaskId: "EXT:task-1",
      now: () => "2026-06-01T12:00:00Z",
    });
    const trackedLines = readFileSync(trackedPath, "utf-8").split("\n").filter(Boolean);
    expect(trackedLines).toHaveLength(3); // header + append + status
    expect(JSON.parse(trackedLines[2])).toMatchObject({ event: "status", id: "trg-t" });
    // Outbox not created.
    expect(existsSync(outboxPath)).toBe(false);
  });

  it("writes the status to TRACKED (TRACKED-PREFERRED) when the append is in BOTH files", () => {
    writeFileSync(trackedPath, `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine("trg-both")}\n`);
    writeFileSync(outboxPath, appendLine("trg-both") + "\n");
    appendStatusEvent({
      jsonlPath: trackedPath,
      triageId: "trg-both",
      newStatus: "dismissed",
      by: "webui",
      reason: null,
      promotedTaskId: null,
      now: () => "2026-06-01T12:00:00Z",
    });
    // Status appended to TRACKED; outbox untouched (still just its append).
    const trackedLines = readFileSync(trackedPath, "utf-8").split("\n").filter(Boolean);
    expect(trackedLines).toHaveLength(3); // header + append + status
    const outboxLines = readFileSync(outboxPath, "utf-8").split("\n").filter(Boolean);
    expect(outboxLines).toHaveLength(1); // unchanged — append only
  });

  it("writes the status to TRACKED (bootstrapping header) when the id lives in neither file", () => {
    appendStatusEvent({
      jsonlPath: trackedPath,
      triageId: "trg-nowhere",
      newStatus: "dismissed",
      by: "webui",
      reason: null,
      promotedTaskId: null,
      now: () => "2026-06-01T12:00:00Z",
    });
    const trackedLines = readFileSync(trackedPath, "utf-8").split("\n").filter(Boolean);
    expect(trackedLines).toHaveLength(2); // bootstrapped header + status
    expect(JSON.parse(trackedLines[0])).toMatchObject({ schema: "triage" });
    expect(existsSync(outboxPath)).toBe(false);
  });

  it("Boundary Probe — full round trip: dismiss an outbox-only item, union read resolves it dismissed", async () => {
    // Producer wrote an idle-main finding to the headerless outbox; the webui
    // dismisses it. The status must land in the outbox (residence) AND the
    // union reader must resolve the item as dismissed — end-to-end across the
    // new JSONL boundary (touches_io_boundary round-trip).
    const { readAllItems } = await import("./triage-store.js");
    writeFileSync(outboxPath, appendLine("trg-rt") + "\n");
    appendStatusEvent({
      jsonlPath: trackedPath,
      triageId: "trg-rt",
      newStatus: "dismissed",
      by: "webui",
      reason: "round trip",
      promotedTaskId: null,
      now: () => "2026-06-01T12:00:00Z",
    });
    expect(existsSync(trackedPath)).toBe(false); // no main drift
    const [item] = readAllItems(trackedPath);
    expect(item.id).toBe("trg-rt");
    expect(item.status).toBe("dismissed");
    expect(item.statusReason).toBe("round trip");
  });
});

describe("triage-write: appendStatusEvent — idle-main routing (2026-06-12)", () => {
  let workDir: string;
  let trackedPath: string;
  let outboxPath: string;

  function git(args: string[]): void {
    spawnSync("git", ["-C", workDir, ...args], { encoding: "utf-8", shell: false });
  }

  beforeEach(() => {
    _clearCache_TEST_ONLY();
    workDir = mkdtempSync(path.join(tmpdir(), "triage-write-idlemain-"));
    // Real git repo, default branch, WITH an origin remote => idle main.
    git(["init"]);
    git(["config", "user.email", "t@t.t"]);
    git(["config", "user.name", "t"]);
    git(["commit", "--allow-empty", "-m", "init"]);
    git(["branch", "-M", "main"]);
    git(["remote", "add", "origin", path.join(workDir, "origin-throwaway")]);
    trackedPath = path.join(workDir, ".shipwright", "triage.jsonl");
    outboxPath = outboxPathFor(trackedPath);
    mkdirSync(path.dirname(trackedPath), { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("routes a TRACKED-resident item's dismiss to the OUTBOX on idle main (tracked byte-unchanged)", () => {
    // The dismissed item's append lives in the TRACKED store (committed finding).
    writeFileSync(
      trackedPath,
      `{"v":1,"schema":"triage","created":"2026-06-12T00:00:00Z"}\n${appendLine("trg-idle")}\n`,
    );
    const trackedBefore = readFileSync(trackedPath, "utf-8");
    appendStatusEvent({
      jsonlPath: trackedPath,
      triageId: "trg-idle",
      newStatus: "dismissed",
      by: "webui",
      reason: "Implemented",
      promotedTaskId: null,
      now: () => "2026-06-12T12:00:00Z",
    });
    // Status landed in the OUTBOX; tracked store is byte-unchanged (no drift).
    expect(readFileSync(trackedPath, "utf-8")).toBe(trackedBefore);
    const outboxLines = readFileSync(outboxPath, "utf-8").split("\n").filter(Boolean);
    expect(outboxLines).toHaveLength(1);
    expect(JSON.parse(outboxLines[0])).toMatchObject({
      event: "status",
      id: "trg-idle",
      newStatus: "dismissed",
    });
  });

  it("shouldRouteToOutbox: true on origin-backed default branch, false on a non-default branch", () => {
    expect(shouldRouteToOutbox(workDir)).toBe(true);
    git(["checkout", "-b", "iterate/x"]); // worktree/iterate-branch analog
    expect(shouldRouteToOutbox(workDir)).toBe(false);
  });

  it("falls back to TRACKED when the repo has NO origin (no delivery path)", () => {
    const noOrigin = mkdtempSync(path.join(tmpdir(), "triage-write-noorigin-"));
    spawnSync("git", ["-C", noOrigin, "init"], { encoding: "utf-8", shell: false });
    spawnSync("git", ["-C", noOrigin, "branch", "-M", "main"], { encoding: "utf-8", shell: false });
    expect(shouldRouteToOutbox(noOrigin)).toBe(false);
    const tracked = path.join(noOrigin, ".shipwright", "triage.jsonl");
    mkdirSync(path.dirname(tracked), { recursive: true });
    writeFileSync(
      tracked,
      `{"v":1,"schema":"triage","created":"2026-06-12T00:00:00Z"}\n${appendLine("trg-no")}\n`,
    );
    appendStatusEvent({
      jsonlPath: tracked,
      triageId: "trg-no",
      newStatus: "dismissed",
      by: "webui",
      reason: null,
      promotedTaskId: null,
      now: () => "2026-06-12T12:00:00Z",
    });
    const lines = readFileSync(tracked, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3); // header + append + status, all tracked
    expect(existsSync(outboxPathFor(tracked))).toBe(false);
    rmSync(noOrigin, { recursive: true, force: true });
  });
});
