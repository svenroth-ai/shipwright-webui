/*
 * iterate-2026-09-16-mission-feed-render-fidelity — split out of
 * `missionActivityFeedBlockerAndTdd.test.ts` (17th-round, re-crossed the
 * project's 300-line convention) to cover a blocker card's plain-English
 * explanation, derived from the failing command's own output rather than a
 * static sentence. TDD-authoring-run exclusion stays in the sibling file.
 */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import { summarizeBlockerError } from "./missionActivityFeedText";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const resultWithContent = (id: string, content: string, isError = false) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

const context = (gate: "pass" | "fail" | "unknown", live = true): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: live, servesFrId: null, sourceRev: "x", tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate }, artifacts: [
  { kind: "spec", label: "Spec", state: "available", summary: null, receipt: null, detail: null },
  { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
  { kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null, detail: null },
] });

describe("deriveActivityFeed — blocker explanation is derived, not static", () => {
  it("derives a plain one-line blocker explanation from the command's own output instead of a static sentence (reported: raw traceback with no explanation)", () => {
    const traceback = "Traceback (most recent call last):\n  File \"<stdin>\", line 21\nTypeError: amend_triage_item() got an unexpected keyword argument 'to_outbox'";
    const events = parseSessionJsonl([
      tool("blocked", "Bash", { command: "python -c '...'" }),
      resultWithContent("blocked", traceback, true),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const card = feed.cards.find((card) => card.kind === "blocker");
    expect(card?.text).toBe("A command failed: TypeError: amend_triage_item() got an unexpected keyword argument 'to_outbox'");
  });

  // 18th-round external code review catch (glm, medium): the renderer now
  // gates literal (non-markdown) rendering on `card.textLiteral`, not
  // `card.kind === "blocker"` — this reducer must actually set that flag
  // whenever it synthesizes a blocker's headline.
  it("marks a blocker's derived headline as textLiteral", () => {
    const events = parseSessionJsonl([
      tool("blocked", "Bash", { command: "python -c '...'" }),
      resultWithContent("blocked", "TypeError: boom", true),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const card = feed.cards.find((card) => card.kind === "blocker");
    expect(card?.textLiteral).toBe(true);
  });

  // Same catch: the recovery path (a blocker's command later succeeds on
  // retry) reverts `kind` back to its original bucket and rewrites `text`
  // to a static, no-markdown sentence — `textLiteral` must not survive
  // stale onto that non-blocker card.
  it("clears textLiteral when a blocker recovers after a successful retry", () => {
    const events = parseSessionJsonl([
      tool("cmd", "Bash", { command: "python -c '...'" }),
      resultWithContent("cmd", "TypeError: boom", true),
      tool("cmd2", "Bash", { command: "python -c '...'" }),
      resultWithContent("cmd2", "ok", false),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const recovered = feed.cards.find((card) => card.text === "A command error recovered after a successful retry.");
    expect(recovered?.textLiteral).toBeUndefined();
  });

  // 19th-round external code review catch (openai, medium): a card's
  // `textFull` (a genuine turn's own long headline, from BEFORE this card
  // ever became a blocker) survived the recovery mutation untouched — the
  // short static recovery sentence would then get a "Show more" toggle that
  // resurfaced that unrelated old narration.
  it("clears a stale textFull left over from before a blocker recovers", () => {
    const longText = "A".repeat(400);
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "text", text: longText },
        { type: "tool_use", id: "cmd", name: "Bash", input: { command: "python -c '...'" } },
      ] } }),
      resultWithContent("cmd", "TypeError: boom", true),
      tool("cmd2", "Bash", { command: "python -c '...'" }),
      resultWithContent("cmd2", "ok", false),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const recovered = feed.cards.find((card) => card.text === "A command error recovered after a successful retry.");
    expect(recovered?.textFull).toBeUndefined();
  });

  // 59th-round catch (glm, medium), DECLINED as FALSIFIED - and pinned here,
  // which is the alternative glm itself offered. glm claims a retry re-attach
  // inflates a BLOCKER's count into "Show details (2 commands)" over one chip.
  // Probed with the real reducer, both arms: retry-then-FAIL-AGAIN yields TWO
  // separate blocker cards (commands 1 / commandCount 1 each - no inflation
  // anywhere), and retry-then-SUCCEED merges into a card that is no longer a
  // blocker at all. The surviving 1-chip/count-2 card below is the 24th-round
  // CONTRACT, not a defect: two real tool calls happened, and their labels
  // deduped. Only-increment-when-newly-pushed would reverse that round.
  it("counts a failed command and its successful retry as two calls on the one recovered card, with a single deduped chip", () => {
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Bash", input: { command: "npm run build" } }] } }),
      resultWithContent("a", "boom", true),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "b", name: "Bash", input: { command: "npm run build" } }] } }),
      resultWithContent("b", "ok", false),
    ].join("\n")).events;
    const cards = deriveActivityFeed(events, context("unknown")).cards;
    expect(cards.filter((card) => card.kind === "blocker")).toHaveLength(0);
    const recovered = cards.find((card) => card.commands.length > 0);
    expect(recovered?.commands).toEqual(["Bash: npm run build"]);
    expect(recovered?.commandCount).toBe(2);
  });

  // 28th-round external code review catch (glm, low): the SAME stale-
  // `textFull` problem the recovery path above already guards against, but
  // at the FORWARD transition into a blocker — a card's own long headline
  // (from before it became a blocker) must not survive under the new
  // synthesized `textLiteral` sentence either.
  // 49th-round catch (glm, low), ANSWERED: glm asks that the reducer's tests
  // assert the `textLiteral` ⇒ no-`textFull` invariant, since the render
  // branch silently drops the toggle. These two tests ARE that assertion, one
  // per mutation site (missionActivityFeedResolve.ts:169 forward, :221
  // recovery) — removing either `delete` turns them red.
  it("clears a stale textFull when a card first becomes a blocker", () => {
    const longText = "A".repeat(400);
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "text", text: longText },
        { type: "tool_use", id: "cmd", name: "Bash", input: { command: "python -c '...'" } },
      ] } }),
      resultWithContent("cmd", "TypeError: boom", true),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const blocker = feed.cards.find((card) => card.kind === "blocker");
    expect(blocker?.textFull).toBeUndefined();
  });

  it("falls back to a generic blocker sentence when the command's output has no usable line", () => {
    const events = parseSessionJsonl([
      tool("blocked", "Bash", { command: "some-cmd" }),
      resultWithContent("blocked", "   \n  ", true),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const card = feed.cards.find((card) => card.kind === "blocker");
    expect(card?.text).toBe("A command needs attention before work can continue.");
  });

  // External code review catch: no prior test covered the maxLen truncation
  // path (sanitizeProofText caps at 200 chars by default).
  it("bounds a long error-ish line at maxLen", () => {
    const longLine = `TypeError: ${"x".repeat(300)}`;
    const summary = summarizeBlockerError(`Traceback (most recent call last):\n${longLine}`);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.startsWith("TypeError:")).toBe(true);
  });

  // 46th-round catch (glm, low), FIXED: `*`/`_`/`#`/`~` are content, not
  // banner padding - stripping them mangled a real error line. Falsify by
  // putting them back into CHROME_PAD.
  it("leaves asterisk/hash/underscore runs alone - they are content, not banner padding", () => {
    expect(summarizeBlockerError("***important***: check config failed")).toBe("***important***: check config failed");
    expect(summarizeBlockerError("### fatal: bad object")).toBe("### fatal: bad object");
  });

  // External code review catch: pytest's own banner-chrome summary line
  // should not surface as-is with its `====` padding.
  it("strips banner-chrome padding around a real error-ish summary line", () => {
    const summary = summarizeBlockerError("collecting tests\n==== 1 failed, 3 passed in 0.5s ====");
    expect(summary).toBe("1 failed, 3 passed in 0.5s");
  });

  // 10th-round external code review catch (openai, medium): npm's own
  // "ERR!"-prefixed failure lines matched none of the prior markers, so
  // typical npm output fell through to the unhelpful trailing "complete log
  // of this run" pointer line instead of the actual failure reason.
  it("picks npm's own failure-reason line over its trailing 'complete log' pointer line", () => {
    const npmOutput = [
      "npm ERR! code E404",
      "npm ERR! 404 Not Found - GET https://registry.npmjs.org/foo",
      "npm ERR! 404  'foo@1.0.0' is not in this registry.",
      "npm ERR! A complete log of this run can be found in: /home/user/.npm/_logs/1234-debug.log",
    ].join("\n");
    expect(summarizeBlockerError(npmOutput)).toBe("npm ERR! 404 'foo@1.0.0' is not in this registry.");
  });

  // 28th-round external code review catch (glm, low): the marker-based
  // reverse search landed on an earlier stack-frame line merely CONTAINING
  // "error" as a substring (a file path) when the traceback's true last
  // line — the actual raised exception — has no marker word at all.
  it("prefers a traceback's true last line over an earlier stack-frame line that merely contains 'error' as a substring", () => {
    const traceback = [
      "Traceback (most recent call last):",
      '  File "/app/errors.py", line 21, in <module>',
      "    raise StopIteration",
      "StopIteration",
    ].join("\n");
    expect(summarizeBlockerError(traceback)).toBe("StopIteration");
  });

  // 36th-round external code review catch (glm, low): the 28th-round branch
  // above took the last line of the whole CONTENT, not of the TRACEBACK, so
  // trailing interpreter/cleanup chatter after the exception won the summary.
  it("prefers a traceback's raised exception over trailing cleanup output after it", () => {
    const traceback = [
      "Traceback (most recent call last):",
      '  File "x.py", line 1, in <module>',
      "    boom()",
      "ValueError: the real cause",
      "",
      "Exception ignored in atexit callback",
      "cleanup: removing temp dir /tmp/xyz",
    ].join("\n");
    expect(summarizeBlockerError(traceback)).toBe("ValueError: the real cause");
  });

  // 37th-round catch (glm, low): the 36th-round reverse search also matched a
  // trailing bare capitalized word, which — being later — beat the exception.
  it("ignores a trailing bare capitalized word after the traceback", () => {
    const traceback = [
      "Traceback (most recent call last):",
      '  File "x.py", line 1, in <module>',
      "ValueError: the real cause",
      "Done",
    ].join("\n");
    expect(summarizeBlockerError(traceback)).toBe("ValueError: the real cause");
  });

  // Same 37th-round fix, its other half: anchoring on the LAST stack frame is
  // what keeps forward-first-match correct for a CHAINED traceback.
  it("reports the FINAL exception of a chained traceback, not the first", () => {
    const traceback = [
      "Traceback (most recent call last):",
      '  File "a.py", line 1, in <module>',
      "KeyError: 'missing'",
      "",
      "During handling of the above exception, another exception occurred:",
      "",
      "Traceback (most recent call last):",
      '  File "b.py", line 9, in handler',
      "RuntimeError: could not recover",
    ].join("\n");
    expect(summarizeBlockerError(traceback)).toBe("RuntimeError: could not recover");
  });

  // 45th-round catch (glm, low), FIXED: nothing pinned what the headline LOOKS
  // like at the 200-char boundary - only that it fit. `sanitizeProofText`
  // keeps 199 chars and appends U+2026, so an over-long error line is visibly
  // truncated rather than silently cut mid-token. Falsify by raising `maxLen`.
  it("marks an over-long error line as truncated with an ellipsis, at exactly maxLen", () => {
    const summary = summarizeBlockerError(`Error: ${"x".repeat(400)}`);
    expect(summary).toHaveLength(200);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.startsWith("Error: xxx")).toBe(true);
  });

  // 41st-round catch (glm, low), DECLINED — this pins the ACCEPTED limitation
  // and the no-op proof (see `summarizeBlockerError`'s own comment). A
  // lowercase exception name matches nothing in `PY_EXCEPTION_LINE`, so the
  // fallback decides, and trailing cleanup wins. glm's proposed
  // `lines.slice(lastFrame + 1).at(-1)` changes nothing: run this case with
  // either spelling and the expectation below holds unchanged.
  it("degrades to the last line when a traceback's exception name is lowercase", () => {
    const traceback = [
      "Traceback (most recent call last):",
      '  File "a.py", line 1, in <module>',
      "myError: lowercase but real",
      "cleanup: removing temp dir /tmp/xyz",
    ].join("\n");
    expect(summarizeBlockerError(traceback)).toBe("cleanup: removing temp dir /tmp/xyz");
  });

  // 77th-round catch (glm, low), FIXED: a SUCCESS-shaped counter matched
  // ERROR_MARKER, so a failed build ending in a tally announced "0 errors" as
  // the plain-language explanation — the misleading summary requirement 4
  // exists to prevent. Falsify by dropping the `ZERO_COUNT_LINE` clause in
  // `missionActivityFeedText.ts`; the first case then returns the tally line.
  it("never picks a zero-count tally as the explanation, but still picks a non-zero one", () => {
    expect(summarizeBlockerError("tsc: Build failed with exit code 2\n0 errors, 3 warnings")).toBe(
      "tsc: Build failed with exit code 2",
    );
    expect(summarizeBlockerError("some noise\nerror: 0\ncleanup done")).toBe("cleanup done");
    expect(summarizeBlockerError("some noise\nerrors: 0, warnings: 3\ncleanup done")).toBe("cleanup done");
    // 78th-round catch (glm, low), FIXED: the zero must END its clause, so a
    // real error whose zero counts something ELSE is NOT suppressed. Falsify
    // by restoring the `\b` spelling of the second `ZERO_COUNT_LINE` arm.
    expect(summarizeBlockerError("start\nERROR: 0 files matched, aborting\ndone")).toBe(
      "ERROR: 0 files matched, aborting",
    );
    expect(summarizeBlockerError("tsc: Build failed\n1 error, 3 warnings")).toBe("1 error, 3 warnings");
    expect(summarizeBlockerError("tsc: Build failed\n10 errors, 3 warnings")).toBe("10 errors, 3 warnings");
  });
});
