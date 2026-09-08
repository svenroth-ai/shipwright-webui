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
 * The `hasRunRecord` / `recoverRunIdFromTranscript` corroboration suite (the
 * event-log / iterate-record lookup + its memoization) moved to
 * `run-id-recovery.corroboration.test.ts` (CLAUDE.md 300-line rule), which
 * imports `footerLine` / `RUN` back from here — same pattern this file
 * already used to split off `run-id-recovery-user-lines.test.ts`.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { findRunIdFooter, MAX_SCAN_CHARS } from "./run-id-recovery.js";

export const RUN = "iterate-2026-07-20-mission-context-async-git";

/**
 * The footer as it really appears inside a JSONL record (escaped newline).
 * Exported for `run-id-recovery-user-lines.test.ts`
 * (iterate-2026-08-22-mission-feed-fixes) — same fixture shape, split into
 * its own file once this one crossed the project's 300-line convention.
 */
export function footerLine(runId: string): string {
  return `{"text":"fix(mission): something\\n\\nRun-ID: ${runId}\\nCo-Authored-By: Claude <noreply@anthropic.com>"}`;
}

// @covers FR-01.66
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
// @covers FR-01.66
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

/*
 * The line terminator is an ENUMERATED escape set, not "any backslash"
 * (external code review, openai MEDIUM). A prose sentence can end in a
 * backslash too, and accepting it would re-open the quotation case.
 */
// @covers FR-01.66
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
