/*
 * iterate-2026-08-22-mission-feed-fixes — the root cause of the wrong-identity
 * Delivered card: `findRunIdFooter()` used to treat every `Run-ID:`
 * occurrence in the transcript as equally authoritative and keep the LAST
 * one. A footer quoted inside a `"type":"user"` JSONL record (a
 * `tool_result`, e.g. from `git log`/`cat`/`grep`, or a genuine human-typed
 * prompt) is investigation content being read back, not this session's own
 * claim of identity, and must not win over — or in the marker-free case, be
 * adopted in place of — a footer on an assistant-authored line.
 *
 * Split out of `run-id-recovery.test.ts` once that file crossed the
 * project's 300-line convention; shares its `footerLine()` fixture helper.
 *
 * @covers FR-01.66
 */
import { describe, expect, it } from "vitest";
import { findRunIdFooter, MAX_SCAN_CHARS } from "./run-id-recovery.js";
import { footerLine } from "./run-id-recovery.test.js";

describe("findRunIdFooter — \"type\":\"user\" lines are excluded", () => {
  const OLD = "iterate-2026-07-01-some-older-run";
  const NEW = "iterate-2026-08-20-mission-feed-content";

  it("ignores a footer quoted inside a tool_result (git log/cat/grep output)", () => {
    const line = `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"commit abc\\n\\nRun-ID: ${OLD}\\n"}]}}`;
    expect(findRunIdFooter(line)).toBeNull();
  });

  it("still finds the real footer on an assistant-authored line when a user-typed line also quotes an older one", () => {
    const investigative = `{"type":"user","message":{"role":"user","content":"earlier this session referenced Run-ID: ${OLD}\\n"}}`;
    const real = footerLine(NEW).replace('{"text"', '{"type":"assistant","text"');
    expect(findRunIdFooter(`${investigative}\n${real}`)).toBe(NEW);
  });

  it("falls through to null when the only surviving marker was inside a user-type line", () => {
    const onlyInUserLine = `{"type":"user","message":{"role":"user","content":"Run-ID: ${OLD}\\n"}}`;
    expect(findRunIdFooter(onlyInUserLine)).toBeNull();
  });

  it("does not require the exclusion to change the terminator/grammar checks — a footer surviving the filter is still validated the same way", () => {
    const stillRejected = `{"type":"assistant","text":"Run-ID: iterate-\\n"}`;
    expect(findRunIdFooter(stillRejected)).toBeNull();
  });

  /*
   * Internal code review (medium) — a naive whole-line SUBSTRING match for
   * `"type":"user"` would wrongly exclude an assistant line whose own TEXT
   * happens to contain that literal substring as DATA (e.g. narrating or
   * writing a JSON/JSONL fixture — exactly what this file's own test lines
   * look like). The exclusion parses each line's real top-level `type`
   * field instead, so an escaped occurrence inside a string value never
   * collides with the line's actual JSONL role.
   */
  it("does not false-exclude an assistant line whose own text merely contains the literal substring \"type\":\"user\"", () => {
    const line = `{"type":"assistant","text":"Note: a record looks like {\\"type\\":\\"user\\"}\\n\\nRun-ID: ${NEW}\\n"}`;
    expect(findRunIdFooter(line)).toBe(NEW);
  });

  it("keeps a line that fails to parse as JSON (truncated/malformed) rather than guessing it away", () => {
    // Not valid JSON at all — a plain-text tail fragment, the shape the
    // existing tail-boundary probes already exercise for the outer scan.
    const malformed = `some unparseable tail\nRun-ID: ${NEW}\n`;
    expect(findRunIdFooter(malformed)).toBe(NEW);
  });
});

/*
 * External code review (high) — `findRunIdFooter` slices the transcript to
 * its final MAX_SCAN_CHARS BEFORE the `"type":"user"` exclusion ever runs.
 * When that byte cut lands inside a large `"type":"user"` record (a big
 * tool_result is exactly the shape likely to be cut), the record's own
 * `"type"` field is sliced away along with the rest of the line before the
 * cut, so the surviving fragment fails to parse as JSON — and the "never
 * guess on malformed content" posture then KEEPS it, defeating the
 * exclusion for the very record this fix exists to exclude. The fix drops
 * the tail's leading line outright whenever truncation occurred, since
 * that is the one line that can be a byte-cut fragment.
 */
describe("findRunIdFooter — the truncation boundary cannot smuggle a tool_result footer past the exclusion", () => {
  const OLD = "iterate-2026-07-01-some-older-run";
  const NEW = "iterate-2026-08-20-mission-feed-content";

  it("does not adopt a footer left dangling in a tool_result fragment whose own \"type\" was sliced away by the tail window", () => {
    // A huge tool_result record whose leading `{"type":"user",...` prefix
    // ends up entirely BEFORE the retained MAX_SCAN_CHARS window — only the
    // tail end of its single JSONL line (still containing the quoted
    // Run-ID) survives the slice, landing as the tail's own first line, real
    // newline-terminated exactly as a genuine JSONL record would be.
    const hugeUserPrefix = "x".repeat(MAX_SCAN_CHARS);
    const userLineTail = `,"content":"padding\\n\\nRun-ID: ${OLD}\\n"}]}}`;
    const transcript = `${hugeUserPrefix}${userLineTail}\n`;
    expect(findRunIdFooter(transcript)).toBeNull();
  });

  it("still finds a real footer on a later, COMPLETE line after the truncated leading fragment is dropped", () => {
    const hugeUserPrefix = "x".repeat(MAX_SCAN_CHARS);
    const userLineTail = `,"content":"padding\\n\\nRun-ID: ${OLD}\\n"}]}}`;
    const real = footerLine(NEW).replace('{"text"', '{"type":"assistant","text"');
    const transcript = `${hugeUserPrefix}${userLineTail}\n${real}`;
    expect(findRunIdFooter(transcript)).toBe(NEW);
  });

  it("does not drop anything when the transcript is not actually truncated", () => {
    // Same shape, but short enough that no slicing happens — the leading
    // line is a real, complete line and must NOT be unconditionally dropped.
    const line = `{"type":"user","message":{"content":"Run-ID: ${OLD}\\n"}}`;
    const real = footerLine(NEW).replace('{"text"', '{"type":"assistant","text"');
    expect(findRunIdFooter(`${line}\n${real}`)).toBe(NEW);
  });
});
