/*
 * run-data-join.file.test.ts — file-loading wrappers for the per-run join
 * (A02, campaign webui-wow-usability-2026-07-10). Split from
 * run-data-join.test.ts to keep each test file under the 300-LOC ceiling.
 *
 * Proves the route→wrapper→disk chain + graceful degradation (absent log →
 * empty bundle; unknown/empty runId → null; torn line skipped, never fatal).
 * HEX `adr_id` fixtures — a non-hex id is rejected upstream.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { readRunData, readRunDetail } from "./run-data-join.js";
import { EVENT_FILE } from "./event-log-reader.js";

const j = (o: unknown) => JSON.stringify(o);
const HEX_ADR = "iterate-2026-07-14-abc1234";

describe("readRunData / readRunDetail (file wrappers)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), "rundata-"));
    dirs.push(d);
    return d;
  };
  const write = (root: string, lines: string[]) =>
    writeFileSync(path.join(root, EVENT_FILE), lines.join("\n"), "utf-8");

  it("reads a real on-disk log through the wrapper", () => {
    const root = tmp();
    write(root, [
      j({ type: "work_completed", adr_id: HEX_ADR, tests: { passed: 7, total: 7 }, affected_frs: ["FR-01.47"] }),
    ]);
    const b = readRunData(root);
    expect(b.runCount).toBe(1);
    expect(b.runs[0].affectedFrs).toEqual(["FR-01.47"]);
    expect(b.runs[0].gates?.test).toBe("pass");
  });

  it("absent log → an empty bundle (graceful, never throws)", () => {
    const b = readRunData(tmp());
    expect(b).toEqual({
      runs: [],
      runCount: 0,
      gradeTrend: [],
      pipelinePhaseDurations: [],
      skippedLines: 0,
    });
  });

  it("readRunDetail returns the single run for a known runId", () => {
    const root = tmp();
    write(root, [j({ type: "work_completed", adr_id: HEX_ADR, tests: { passed: 1, total: 1 } })]);
    expect(readRunDetail(root, HEX_ADR)?.runId).toBe(HEX_ADR);
  });

  it("readRunDetail returns null for an unknown runId (the tested miss-case)", () => {
    const root = tmp();
    write(root, [j({ type: "work_completed", adr_id: HEX_ADR })]);
    expect(readRunDetail(root, "iterate-2026-07-14-nomatch0")).toBeNull();
  });

  it("readRunDetail returns null for an empty runId (task has no runId)", () => {
    expect(readRunDetail(tmp(), "")).toBeNull();
  });

  it("join key is task.runId === adr_id: resolves the matching event, never a sibling's facts", () => {
    // Model the documented contract explicitly (spec AC2). A board task carries
    // `runId`; the server joins it to the `work_completed` whose `adr_id`
    // EQUALS it — never a different run's FRs/tests.
    const task = { runId: HEX_ADR };
    const OTHER = "iterate-2026-07-14-def5678";
    const root = tmp();
    write(root, [
      j({ type: "work_completed", adr_id: OTHER, affected_frs: ["FR-99.99"], tests: { passed: 1, total: 2 } }),
      j({ type: "work_completed", adr_id: HEX_ADR, affected_frs: ["FR-01.47"], tests: { passed: 9, total: 9 } }),
    ]);
    const detail = readRunDetail(root, task.runId);
    expect(detail?.runId).toBe(task.runId);
    expect(detail?.affectedFrs).toEqual(["FR-01.47"]);
    expect(detail?.gates?.test).toBe("pass");
    // A task whose runId matches NO event's adr_id degrades to null (miss-case).
    expect(readRunDetail(root, "iterate-2026-07-14-0000000")).toBeNull();
  });

  it("skips torn lines without throwing (skippedLines counted)", () => {
    const root = tmp();
    write(root, ["{ torn", j({ type: "work_completed", adr_id: HEX_ADR })]);
    const b = readRunData(root);
    expect(b.runCount).toBe(1);
    expect(b.skippedLines).toBe(1);
  });
});
