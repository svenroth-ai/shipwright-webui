/**
 * The second real hand-back shape (V2 doubt review): a `queued_command` ATTACHMENT whose prompt is the envelope.
 * Sanitized from a measured transcript line; must reach the feed AND the bubble transcript as a handback.
 */
import { describe, it, expect } from "vitest";
import { parseSessionJsonl } from "./session-parser";
import { advanceIncrementalParse, EMPTY_INCREMENTAL_PARSE } from "./incremental-session-parse";
import { filterEventsForRender } from "../components/external/BubbleTranscript/filters";
import { deriveActivityFeed } from "../lib/missionActivityFeed";

const NL = String.fromCharCode(10);
const FRAMING = "[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:";
const PROMPT = ['<agent-message from="a0972391f7ab095eb">', FRAMING, "  Reviewed the plan.", "  - one low finding", "</agent-message>"].join(NL);
const attachmentLine = (prompt: unknown, ts = "2026-10-31T10:00:00Z") =>
  JSON.stringify({ type: "attachment", timestamp: ts, attachment: { type: "queued_command", prompt } });
const userLine = (text: string) => JSON.stringify({ type: "user", timestamp: "2026-10-31T10:00:01Z", message: { role: "user", content: text } });

describe("queued_command attachment hand-backs", () => {
  // @covers FR-01.66
  it("parse as a handback event, render in the transcript filter and become one feed card", () => {
    const { events } = parseSessionJsonl(attachmentLine(PROMPT));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "handback", sender: "a0972391f7ab095eb", origin: "subagent", text: ["Reviewed the plan.", "- one low finding"].join(NL) });
    expect(filterEventsForRender(events, new Set())).toHaveLength(1);
    const cards = deriveActivityFeed(events, null).cards.filter((c) => c.kind === "handback");
    expect(cards).toHaveLength(1);
    expect(cards[0].handbackSender).toBe("a0972391f7ab095eb");
  });

  // @covers FR-01.66
  it("accepts a text-block-array prompt like a string prompt", () => {
    const { events } = parseSessionJsonl(attachmentLine([{ type: "text", text: PROMPT }]));
    expect(events[0]).toMatchObject({ kind: "handback", sender: "a0972391f7ab095eb" });
  });

  // @covers FR-01.66
  it("keeps genuinely repeated identical reports (no cross-record dedupe) and incremental == whole parse", () => {
    const first = [userLine(PROMPT), userLine(PROMPT)].join(NL) + NL;
    const second = first + attachmentLine(PROMPT) + NL;
    const whole = parseSessionJsonl(second).events;
    expect(whole.filter((e) => e.kind === "handback")).toHaveLength(3);
    const step = advanceIncrementalParse(advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, first), second);
    expect(step.result.events).toEqual(whole);
  });

  // @covers FR-01.66
  it("leaves other attachments (task-notification prompts, non-string prompts, plain text) untouched", () => {
    const note = attachmentLine("<task-notification><task-id>x</task-id><status>completed</status></task-notification>");
    expect(parseSessionJsonl(note).events[0].kind).toBe("attachment");
    expect(parseSessionJsonl(attachmentLine(42)).events[0].kind).toBe("attachment");
    expect(parseSessionJsonl(attachmentLine("just text")).events[0].kind).toBe("attachment");
  });
});
