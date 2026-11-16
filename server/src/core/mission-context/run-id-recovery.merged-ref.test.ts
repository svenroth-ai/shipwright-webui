/*
 * run-id-recovery.merged-ref.test.ts — a finished run merged on origin/main but NOT
 * pulled into the working tree must still be corroborated, so its session is
 * identified (Mission tab no longer all-pending).
 *
 * @covers FR-01.66
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _clearRecoveryMemo, recoverRunIdFromTranscript } from "./run-id-recovery.js";
import { corroborateRunIdFromMergedRef } from "./run-id-recovery-ref.js";
import { _clearEventIndexCache } from "./iterate-record.js";
import { _clearMergedEventsCache } from "./merged-events.js";
import { footerLine, RUN } from "./run-id-recovery.test.js";

const DROP = `.shipwright/events/drops/${RUN}--aaaaaaaa--bbbbbbbb.jsonl`;
const row = `${JSON.stringify({ v: 1, type: "work_completed", id: "evt-1", adr_id: RUN, ts: "2026-11-15T10:00:00Z", summary: "x" })}\n`;

// @covers FR-01.66
describe("corroborateRunIdFromMergedRef", () => {
  let root = "";
  afterEach(() => {
    _clearEventIndexCache();
    _clearMergedEventsCache();
    _clearRecoveryMemo();
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  function project(): string {
    root = mkdtempSync(join(tmpdir(), "runid-ref-"));
    mkdirSync(join(root, ".shipwright"), { recursive: true });
    return root;
  }
  const withRow = {
    git: async () => `100644 blob oid1\t${DROP}\0`,
    readBlobs: async () => new Map([["oid1", Buffer.from(row, "utf-8")]]),
  };
  const empty = { git: async () => "", readBlobs: async () => new Map<string, Buffer>() };

  it("identifies a run only the merged ref knows, and recovery accepts it", async () => {
    const r = project();
    const t = footerLine(RUN);
    expect(recoverRunIdFromTranscript(r, t, "s1")).toBeNull();
    const ref = await corroborateRunIdFromMergedRef(r, t, "s1", false, withRow);
    expect(ref).toBe(RUN);
    expect(recoverRunIdFromTranscript(r, t, "s1", false, ref)).toBe(RUN);
  });

  it("declines when the merged ref does not know the run", async () => {
    const r = project();
    expect(await corroborateRunIdFromMergedRef(r, footerLine(RUN), "s2", false, empty)).toBeNull();
  });

  it("declines for a transcript without a footer", async () => {
    const r = project();
    expect(await corroborateRunIdFromMergedRef(r, "just chat", "s3", false, withRow)).toBeNull();
  });
});
