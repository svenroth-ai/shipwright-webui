/*
 * run-data-join.skipped-boundary.file.test.ts — Boundary Probe (`touches_io_boundary`)
 * for iterate-2026-08-08-tests-total-skip-contract.
 *
 * A real on-disk `shipwright_events.jsonl`, written and read back through the
 * FULL chain (`readRunData` → `event-log-reader` → `tests-gate.ts`), not an
 * in-memory string. Proves the `skipped` field and the `REVERSAL_EPOCH_MS`
 * convention cutover survive an actual disk round-trip, across every scenario
 * a producer can legitimately write.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { readRunData, readRunDetail } from "./run-data-join.js";
import { EVENT_FILE } from "./event-log-reader.js";

const j = (o: unknown) => JSON.stringify(o);

const PRE = "2026-08-01T00:00:00Z"; // before REVERSAL_EPOCH_MS
const POST = "2026-08-08T00:00:01Z"; // after REVERSAL_EPOCH_MS
const AT_EPOCH = "2026-08-08T00:00:00Z"; // exactly at the cutover (post, inclusive)
const JUST_BEFORE_EPOCH = "2026-08-07T23:59:59.999Z"; // one ms before (pre)

describe("Boundary Probe: skipped-carrying tests block, real disk round-trip", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), "rundata-skip-boundary-"));
    dirs.push(d);
    return d;
  };
  const write = (root: string, lines: string[]) =>
    writeFileSync(path.join(root, EVENT_FILE), lines.join("\n"), "utf-8");

  it("skipped absent — unaffected by the reversal on either side of it", () => {
    const root = tmp();
    write(root, [
      j({ type: "work_completed", adr_id: "iterate-2026-08-01-aaa0001", ts: PRE, tests: { passed: 10, total: 10 } }),
      j({ type: "work_completed", adr_id: "iterate-2026-08-08-aaa0002", ts: POST, tests: { passed: 10, total: 10 } }),
    ]);
    const b = readRunData(root);
    expect(b.runs.find((r) => r.runId === "iterate-2026-08-01-aaa0001")?.gates?.test).toBe("pass");
    expect(b.runs.find((r) => r.runId === "iterate-2026-08-08-aaa0002")?.gates?.test).toBe("pass");
  });

  it("skipped: 0 — behaves identically to absent on both sides", () => {
    const root = tmp();
    write(root, [
      j({ type: "work_completed", adr_id: "iterate-2026-08-01-bbb0001", ts: PRE, tests: { passed: 5, total: 5, skipped: 0 } }),
      j({ type: "work_completed", adr_id: "iterate-2026-08-08-bbb0002", ts: POST, tests: { passed: 5, total: 5, skipped: 0 } }),
    ]);
    const b = readRunData(root);
    expect(b.runs.find((r) => r.runId === "iterate-2026-08-01-bbb0001")?.gates?.test).toBe("pass");
    expect(b.runs.find((r) => r.runId === "iterate-2026-08-08-bbb0002")?.gates?.test).toBe("pass");
  });

  it("skipped > 0, POST-reversal, collected total — reads pass (new convention)", () => {
    const root = tmp();
    write(root, [
      j({
        type: "work_completed",
        adr_id: "iterate-2026-08-08-ccc0001",
        ts: POST,
        tests: { passed: 99, total: 100, skipped: 1 },
      }),
    ]);
    const detail = readRunDetail(root, "iterate-2026-08-08-ccc0001");
    expect(detail?.tests).toEqual({ passed: 99, total: 100, skipped: 1 });
    expect(detail?.gates?.test).toBe("pass");
  });

  it("skipped > 0, PRE-reversal, executed total (the real historical shape) — reads pass (old convention)", () => {
    const root = tmp();
    write(root, [
      j({
        type: "work_completed",
        adr_id: "iterate-2026-07-14-ddd0001",
        ts: PRE,
        tests: { passed: 4390, total: 4390, skipped: 1 },
      }),
    ]);
    const detail = readRunDetail(root, "iterate-2026-07-14-ddd0001");
    expect(detail?.gates?.test).toBe("pass");
  });

  it("the SAME numbers read pass POST-reversal and fail PRE-reversal — the epoch, not the numbers, disambiguates", () => {
    const root = tmp();
    write(root, [
      j({ type: "work_completed", adr_id: "iterate-2026-07-14-eee0001", ts: PRE, tests: { passed: 99, total: 100, skipped: 1 } }),
      j({ type: "work_completed", adr_id: "iterate-2026-08-08-eee0002", ts: POST, tests: { passed: 99, total: 100, skipped: 1 } }),
    ]);
    const b = readRunData(root);
    expect(b.runs.find((r) => r.runId === "iterate-2026-07-14-eee0001")?.gates?.test).toBe("fail");
    expect(b.runs.find((r) => r.runId === "iterate-2026-08-08-eee0002")?.gates?.test).toBe("pass");
  });

  it("skipped > 0, POST-reversal, genuine failure — reads fail", () => {
    const root = tmp();
    write(root, [
      j({
        type: "work_completed",
        adr_id: "iterate-2026-08-08-fff0001",
        ts: POST,
        tests: { passed: 97, total: 100, skipped: 1 },
      }),
    ]);
    expect(readRunDetail(root, "iterate-2026-08-08-fff0001")?.gates?.test).toBe("fail");
  });

  it("epoch boundary is inclusive: ts exactly at REVERSAL_EPOCH_MS reads POST; one ms earlier reads PRE", () => {
    const root = tmp();
    write(root, [
      j({ type: "work_completed", adr_id: "iterate-2026-08-08-ggg0001", ts: AT_EPOCH, tests: { passed: 99, total: 100, skipped: 1 } }),
      j({ type: "work_completed", adr_id: "iterate-2026-08-07-ggg0002", ts: JUST_BEFORE_EPOCH, tests: { passed: 99, total: 100, skipped: 1 } }),
    ]);
    const b = readRunData(root);
    expect(b.runs.find((r) => r.runId === "iterate-2026-08-08-ggg0001")?.gates?.test).toBe("pass");
    expect(b.runs.find((r) => r.runId === "iterate-2026-08-07-ggg0002")?.gates?.test).toBe("fail");
  });

  it("skipped is read through raw regardless of which side of the epoch it lands on", () => {
    const root = tmp();
    write(root, [
      j({ type: "work_completed", adr_id: "iterate-2026-08-08-hhh0001", ts: POST, tests: { passed: 8, total: 9, skipped: 1 } }),
    ]);
    expect(readRunDetail(root, "iterate-2026-08-08-hhh0001")?.tests?.skipped).toBe(1);
  });
});
