/*
 * run-id-recovery.test.ts — the third identification source.
 *
 * Every REJECTION case here is a real string measured in the operator's own
 * transcripts on 2026-07-21, not an invented adversarial input. The two that
 * matter most:
 *   - `Run-ID: iterate-` (a template mention) and `Run-ID: security-…` — a
 *     permissive grammar accepted both, and both pass `isSafeRunId`;
 *   - `→ decision_log.md (ADR via Run-ID: iterate-2026-06-14-repair-claude-json)`
 *     in a session that is NOT an iterate — the case the line-terminated rule
 *     exists for.
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
  findRunIdFooter,
  hasRunRecord,
  MAX_SCAN_CHARS,
  recoverRunIdFromTranscript,
} from "./run-id-recovery.js";
import { _clearEventIndexCache } from "./iterate-record.js";

const RUN = "iterate-2026-07-20-mission-context-async-git";

/** The footer as it really appears inside a JSONL record (escaped newline). */
function footerLine(runId: string): string {
  return `{"text":"fix(mission): something\\n\\nRun-ID: ${runId}\\nCo-Authored-By: Claude <noreply@anthropic.com>"}`;
}

describe("findRunIdFooter — what counts as the session's own run id", () => {
  it("finds the footer written as a JSON-escaped commit message", () => {
    expect(findRunIdFooter(footerLine(RUN))).toBe(RUN);
  });

  it("finds it when the id ends the JSON string (`…run-id\\\" 2>&1`)", () => {
    const line = `{"command":"git commit -m \\"chore: x\\n\\nRun-ID: ${RUN}\\" 2>&1"}`;
    expect(findRunIdFooter(line)).toBe(RUN);
  });

  it("takes the LAST footer — a long session runs more than one iterate", () => {
    const first = "iterate-2026-07-19-events-reader-recovery";
    expect(findRunIdFooter(`${footerLine(first)}\n${footerLine(RUN)}`)).toBe(RUN);
  });

  // --- the measured false positives ----------------------------------------

  it("REJECTS an inline prose mention (measured: the decision-log citation)", () => {
    const prose =
      '{"text":"…→ decision_log.md (ADR via Run-ID: iterate-2026-06-14-repair-claude-json)"}';
    expect(findRunIdFooter(prose)).toBeNull();
  });

  it("REJECTS a template mention with no real id (`Run-ID: iterate-`)", () => {
    expect(findRunIdFooter('{"text":"Run-ID: iterate-\\n"}')).toBeNull();
  });

  it("REJECTS a non-iterate id family (measured: `Run-ID: security-…`)", () => {
    expect(findRunIdFooter('{"text":"Run-ID: security-2026-07-18-scan\\n"}')).toBeNull();
  });

  it("REJECTS a shape that is not `iterate-<date>-<slug>`", () => {
    expect(findRunIdFooter('{"text":"Run-ID: iterate-20260720-nodashes\\n"}')).toBeNull();
    expect(findRunIdFooter('{"text":"Run-ID: run-2026-07-20-pipeline\\n"}')).toBeNull();
  });

  it("REJECTS a traversal attempt even though the date shape matches", () => {
    expect(findRunIdFooter('{"text":"Run-ID: iterate-2026-07-20-..\\\\..\\\\etc\\n"}')).toBeNull();
    expect(findRunIdFooter('{"text":"Run-ID: iterate-2026-07-20-a..b\\n"}')).toBeNull();
  });

  it("returns null for an empty / marker-free transcript — never a guess", () => {
    expect(findRunIdFooter("")).toBeNull();
    expect(findRunIdFooter('{"text":"just a normal conversation about specs"}')).toBeNull();
  });

  it("scans a bounded window even if handed a huge string", () => {
    const buried = `${footerLine(RUN)}\n${"x".repeat(MAX_SCAN_CHARS + 4096)}`;
    expect(findRunIdFooter(buried)).toBeNull();
  });
});

/*
 * BOUNDARY PROBES (external plan review, openai MEDIUM #5). The input is a
 * BYTE TAIL of a file written by another process on Windows: it starts
 * mid-record, may carry CRLF, may end without a newline, and may begin with a
 * broken UTF-8 sequence. Each of those is probed rather than assumed.
 */
describe("findRunIdFooter — tail-boundary probes", () => {
  it("accepts a CRLF footer", () => {
    expect(findRunIdFooter(`Run-ID: ${RUN}\r\nCo-Authored-By: Claude\r\n`)).toBe(RUN);
  });

  it("accepts a footer that ends at EOF with no trailing newline", () => {
    expect(findRunIdFooter(`some text\nRun-ID: ${RUN}`)).toBe(RUN);
  });

  it("accepts a footer with trailing spaces before the line end", () => {
    expect(findRunIdFooter(`Run-ID: ${RUN}   \nnext`)).toBe(RUN);
  });

  it("ignores a marker CUT by the window boundary (no half-id is ever adopted)", () => {
    // The tail begins mid-token: the `Run-ID:` prefix was left behind, so there
    // is nothing to match and — critically — no truncated id to invent.
    const cut = `2026-07-20-mission-context-async-git\nCo-Authored-By: Claude\n`;
    expect(findRunIdFooter(cut)).toBeNull();
  });

  it("survives a broken UTF-8 lead byte at the head of the window", () => {
    // What `Buffer.toString('utf-8')` produces when the tail starts mid-sequence.
    const head = Buffer.from([0x9d, 0x8e]).toString("utf-8");
    expect(findRunIdFooter(`${head}garbage\nRun-ID: ${RUN}\n`)).toBe(RUN);
  });

  it("does not match a marker glued to more text on the same line", () => {
    expect(findRunIdFooter(`Run-ID: ${RUN} (superseded)\n`)).toBeNull();
  });
});

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

/*
 * The line terminator is an ENUMERATED escape set, not "any backslash"
 * (external code review, openai MEDIUM). A prose sentence can end in a
 * backslash too, and accepting it would re-open the quotation case.
 */
describe("findRunIdFooter — the terminator set is exact", () => {
  const RUN2 = "iterate-2026-07-20-real-run";

  it("REJECTS a backslash that is not a newline/quote escape", () => {
    expect(findRunIdFooter(`{"text":"Run-ID: ${RUN2}\\)"}`)).toBeNull();
    expect(findRunIdFooter(`{"text":"Run-ID: ${RUN2}\\t more"}`)).toBeNull();
  });

  it("still accepts the three real terminators", () => {
    expect(findRunIdFooter(`{"text":"Run-ID: ${RUN2}\n"}`)).toBe(RUN2);
    expect(findRunIdFooter(`{"text":"Run-ID: ${RUN2}\r\n"}`)).toBe(RUN2);
    expect(findRunIdFooter(`{"cmd":"... Run-ID: ${RUN2}\\" 2>&1"}`)).toBe(RUN2);
  });
});
