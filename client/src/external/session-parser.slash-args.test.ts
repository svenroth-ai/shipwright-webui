/*
 * session-parser.slash-args.test.ts — a slash command that CARRIES ARGUMENTS
 * (FR-01.68 AC2 / AC2b).
 *
 * MEASURED DEFECT. `detectSlashCommand` required the content to END with
 * `</command-name>` and capped it at 200 characters. A real
 * `/shipwright-iterate` invocation ends with `</command-args>` and runs to
 * several hundred characters, so it satisfied NEITHER rule and fell through to
 * `kind: "user"` carrying raw XML.
 *
 * Probe over 202 real transcripts (READ-ONLY, `scratchpad/probe_slash_detect.py`):
 * 124 kickoff events in 123 transcripts, **124 rejected — 100%**, 123 of them on
 * the 200-character cap. Consequences, all shipped:
 *   - `isIterateStart` never fired, so `Markers.iterateKickoff` was false for
 *     EVERY real iterate. The `scenario === "plain" && !m.iterateKickoff`
 *     branch in stage-derivation.ts — its own comment calls it "load-bearing
 *     and NOT a loophole" — has never once run in production.
 *   - `currentIterateEvents` could never find its kickoff boundary and fell
 *     back to the pr-link rule alone.
 *   - `topicFor` returned the first line of raw XML as the session's topic.
 *
 * A separate file rather than an append: session-parser.test.ts is at 885 LOC.
 */

import { describe, it, expect } from "vitest";

import { parseSessionJsonl, type SlashCommandEvent } from "./session-parser";

const REAL_ASK =
  "--autonomous Schau dir das überarbeitete New Task Form an. Sieht soweit " +
  "gut aus. Aber, wenn man More Options aufklappt, gibt es einen Strich, der " +
  "mit dem runden Ecken kollidiert. Der Strich trennt den Titel \"more Options\" " +
  "ab vom unteren Teil.";

function kickoff(args?: string): string {
  const head =
    "<command-message>shipwright-iterate:iterate</command-message>\n" +
    "<command-name>/shipwright-iterate:iterate</command-name>";
  const body = args === undefined ? head : `${head}\n<command-args>${args}</command-args>`;
  return JSON.stringify({ type: "user", message: { content: body } });
}

const first = (jsonl: string) => parseSessionJsonl(jsonl).events[0];

describe("slash command with <command-args> (FR-01.68 AC2b)", () => {
  it("classifies a REAL iterate kickoff as slash-command, not a user message", () => {
    const ev = first(kickoff(REAL_ASK));
    expect(ev.kind).toBe("slash-command");
    expect((ev as SlashCommandEvent).commandName).toBe("/shipwright-iterate:iterate");
  });

  it("carries the arguments — this is where the operator's request lives", () => {
    const ev = first(kickoff(REAL_ASK)) as SlashCommandEvent;
    expect(ev.args).toBe(REAL_ASK);
  });

  it("is not defeated by length — the real payload is far past the old 200 cap", () => {
    const long = "x".repeat(4000);
    const ev = first(kickoff(long)) as SlashCommandEvent;
    expect(ev.kind).toBe("slash-command");
    expect(ev.args).toBe(long);
  });

  it("keeps working for a bare command with no arguments (pre-existing behaviour)", () => {
    const ev = first(kickoff()) as SlashCommandEvent;
    expect(ev.kind).toBe("slash-command");
    expect(ev.commandName).toBe("/shipwright-iterate:iterate");
    expect(ev.args).toBeUndefined();
  });

  it("still refuses MIXED content — a user message is never swallowed", () => {
    // The guard the original strict detector existed for: prose that merely
    // MENTIONS the tags must stay a user message.
    const prose = JSON.stringify({
      type: "user",
      message: {
        content:
          "I was reading about <command-message>foo</command-message> and how " +
          "<command-args>bar</command-args> works, what do you think?",
      },
    });
    expect(first(prose).kind).toBe("user");
  });

  it("still refuses a mismatched name pair (hand-crafted content)", () => {
    const mismatched = JSON.stringify({
      type: "user",
      message: {
        content:
          "<command-message>alpha</command-message>\n" +
          "<command-name>/beta</command-name>\n<command-args>x</command-args>",
      },
    });
    expect(first(mismatched).kind).toBe("user");
  });
});
