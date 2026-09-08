/*
 * run-id-recovery.corroboration.test.ts — `hasRunRecord` /
 * `recoverRunIdFromTranscript` (the event-log / iterate-record corroboration
 * step, plus its memoization). Split out of `run-id-recovery.test.ts`
 * (CLAUDE.md 300-line rule), which keeps the pure `findRunIdFooter` parsing
 * describes and the shared `footerLine` / `RUN` fixtures re-used here —
 * same pattern as that file's own split-off sibling,
 * `run-id-recovery-user-lines.test.ts`.
 *
 * @covers FR-01.66
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _clearRecoveryMemo,
  _recoveryScanCount,
  hasRunRecord,
  MAX_SCAN_CHARS,
  recoverRunIdFromTranscript,
} from "./run-id-recovery.js";
import { _clearEventIndexCache } from "./iterate-record.js";
import { footerLine, RUN } from "./run-id-recovery.test.js";

// @covers FR-01.66
describe("hasRunRecord / recoverRunIdFromTranscript — corroboration", () => {
  let root = "";
  afterEach(() => {
    _clearEventIndexCache();
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  function project(events?: string): string {
    root = mkdtempSync(join(tmpdir(), "runid-rec-"));
    mkdirSync(join(root, ".shipwright", "agent_docs", "iterates"), { recursive: true });
    if (events !== undefined) writeFileSync(join(root, "shipwright_events.jsonl"), events, "utf-8");
    return root;
  }

  const workCompleted = (runId: string): string =>
    `${JSON.stringify({ v: 1, type: "work_completed", id: runId, adr_id: runId, ts: "2026-07-20T10:00:00Z", summary: "x" })}\n`;

  it("accepts a run the event log knows", () => {
    const r = project(workCompleted(RUN));
    expect(hasRunRecord(r, RUN)).toBe(true);
    expect(recoverRunIdFromTranscript(r, footerLine(RUN))).toBe(RUN);
  });

  it("accepts a run only the iterate record knows (the log may predate it)", () => {
    const r = project("");
    writeFileSync(
      join(r, ".shipwright", "agent_docs", "iterates", `${RUN}.json`),
      JSON.stringify({ adr: RUN, spec_impact: "none" }),
      "utf-8",
    );
    expect(hasRunRecord(r, RUN)).toBe(true);
  });

  it("REJECTS a run this project has no record of (measured: a cross-repo id)", () => {
    const r = project(workCompleted("iterate-2026-07-20-something-else"));
    expect(hasRunRecord(r, RUN)).toBe(false);
    // …and therefore the recovery declines, leaving the session honest.
    expect(recoverRunIdFromTranscript(r, footerLine(RUN))).toBeNull();
  });

  it("an ABSENT event log is not evidence (no records at all → no recovery)", () => {
    const r = project();
    expect(recoverRunIdFromTranscript(r, footerLine(RUN))).toBeNull();
  });

  it("does not corroborate an id that fails the run_id grammar", () => {
    const r = project(workCompleted("../../etc/passwd"));
    expect(hasRunRecord(r, "../../etc/passwd")).toBe(false);
  });

  /*
   * Corroboration must be an EXACT match on a parsed run-id field, never a
   * substring of free text (external plan review, openai MEDIUM #7) — otherwise
   * a crafted summary line would turn a mention into a durable association.
   */
  it("is NOT satisfied by the id merely appearing inside an event's prose", () => {
    const r = project(
      `${JSON.stringify({
        v: 1,
        type: "work_completed",
        id: "iterate-2026-07-20-unrelated",
        adr_id: "iterate-2026-07-20-unrelated",
        ts: "2026-07-20T10:00:00Z",
        summary: `follow-up to ${RUN} which is only mentioned here`,
      })}\n`,
    );
    expect(hasRunRecord(r, RUN)).toBe(false);
  });

  it("is NOT satisfied by an id that only PREFIXES a recorded run", () => {
    const r = project(workCompleted(`${RUN}-follow-up`));
    expect(hasRunRecord(r, RUN)).toBe(false);
  });

  /*
   * The negative memo caches only "no marker in this text" — a textual fact.
   * A candidate that failed corroboration must be re-checked, because Finalize
   * can write the record after the session's transcript stopped growing.
   */
  it("re-checks the records for an uncorroborated candidate (memo is textual only)", () => {
    const r = project("");
    _clearRecoveryMemo();
    const transcript = footerLine(RUN);
    expect(recoverRunIdFromTranscript(r, transcript, "session-1")).toBeNull();

    // The run finalizes: the record appears while the transcript is unchanged.
    writeFileSync(join(r, "shipwright_events.jsonl"), workCompleted(RUN), "utf-8");
    _clearEventIndexCache();
    expect(recoverRunIdFromTranscript(r, transcript, "session-1")).toBe(RUN);
  });

  /*
   * The memo is observed through a SCAN COUNTER, not through the answer.
   * Asserting "null again" would pass with or without the memo — a test that
   * cannot fail, which is the exact shape this codebase keeps shipping.
   */
  it("memoizes a marker-FREE transcript so a plain session stops re-scanning", () => {
    const r = project(workCompleted(RUN));
    _clearRecoveryMemo();
    const plain = '{"text":"nothing here"}';

    expect(recoverRunIdFromTranscript(r, plain, "session-2")).toBeNull();
    expect(_recoveryScanCount()).toBe(1);
    expect(recoverRunIdFromTranscript(r, plain, "session-2")).toBeNull();
    expect(_recoveryScanCount()).toBe(1); // memo HIT — no second scan
  });

  it("re-scans once the transcript GROWS (the real-world change signal)", () => {
    const r = project(workCompleted(RUN));
    _clearRecoveryMemo();
    const plain = '{"text":"nothing here"}';
    expect(recoverRunIdFromTranscript(r, plain, "session-3")).toBeNull();
    expect(recoverRunIdFromTranscript(r, `${plain}\n${footerLine(RUN)}`, "session-3")).toBe(RUN);
  });

  /*
   * THE BOUNDED-TAIL CASE (external code review, openai MEDIUM). Past 1 MB the
   * tail is always exactly `MAX_SCAN_CHARS` long while its content slides — and
   * the footer arrives BY sliding in. A memo keyed on length alone would freeze
   * every large session at "no marker" forever, and the first version of this
   * very test asserted that broken behaviour as if it were the contract.
   */
  it("still recovers when a SAME-LENGTH saturated tail slides the footer in", () => {
    const r = project(workCompleted(RUN));
    _clearRecoveryMemo();
    const footer = footerLine(RUN);
    const pad = (n: number): string => "x".repeat(n);

    const before = pad(MAX_SCAN_CHARS);
    const after = `${pad(MAX_SCAN_CHARS - footer.length - 1)}\n${footer}`;
    expect(after.length).toBe(before.length); // the sliding window, same size

    expect(recoverRunIdFromTranscript(r, before, "session-big")).toBeNull();
    expect(recoverRunIdFromTranscript(r, after, "session-big")).toBe(RUN);
  });

  it("keeps the memo PER SESSION — one plain session cannot silence another", () => {
    const r = project(workCompleted(RUN));
    _clearRecoveryMemo();
    const plain = '{"text":"nothing here"}';
    expect(recoverRunIdFromTranscript(r, plain, "session-a")).toBeNull();
    expect(recoverRunIdFromTranscript(r, plain, "session-b")).toBeNull();
    expect(_recoveryScanCount()).toBe(2); // a second SESSION is scanned, not memoized
  });
});
