/*
 * iterate-2026-09-20-mission-feed-transcript-fidelity, review-catch #3:
 * `humanText()` and `buildUserReplyCard()` moved into this file during code
 * review with no unit coverage of their own — only indirectly exercised via
 * `missionActivityFeed.test.ts`'s reducer-level fixtures. Direct coverage
 * for the shape those fixtures don't isolate: a mixed tool_result+text turn,
 * and a tool_result-only turn (the common case — most `user`-role JSONL
 * events carry no human words at all).
 */
import { describe, expect, it } from "vitest";
import type { UserEvent } from "../external/session-parser";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import { buildUserReplyCard, humanText } from "./missionActivityFeedTurn";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const context = (): MissionContext => ({
  schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: true,
  servesFrId: null, sourceRev: "x", tests: null, artifacts: [],
});

function userEvent(content: unknown): UserEvent {
  return parseSessionJsonl(event({ type: "user", message: { role: "user", content } })).events[0] as UserEvent;
}

describe("humanText", () => {
  it("extracts only the real typed text from a turn mixing a tool_result with a text block", () => {
    const e = userEvent([
      { type: "tool_result", tool_use_id: "t1", content: "output", is_error: false },
      { type: "text", text: "Looks good, please continue." },
    ]);
    expect(humanText(e)).toBe("Looks good, please continue.");
  });

  it("returns an empty string for a tool_result-only turn", () => {
    const e = userEvent([{ type: "tool_result", tool_use_id: "t1", content: "output", is_error: false }]);
    expect(humanText(e)).toBe("");
  });

  it("drops a plain-string turn that is actually a harness-injected banner (round-2 code review catch)", () => {
    const e = userEvent("This session is being continued from a previous conversation. Summary below.");
    expect(humanText(e)).toBe("");
  });

  it("extracts real text from the plain-string shape when it is NOT injected noise", () => {
    const e = userEvent("Please also update the docs.");
    expect(humanText(e)).toBe("Please also update the docs.");
  });

  it("extracts real text from the {content: string} object shape userText() also handles", () => {
    const e = userEvent({ content: "Sounds good, go ahead." });
    expect(humanText(e)).toBe("Sounds good, go ahead.");
  });

  it("drops injected noise carried in the {content: string} object shape", () => {
    const e = userEvent({ content: "API Error: 529 overloaded" });
    expect(humanText(e)).toBe("");
  });

  it("strips an embedded <system-reminder> span from otherwise-real typed text instead of only matching a whole-string envelope (round-3 code review catch)", () => {
    const e = userEvent("Please also update the docs.\n\n<system-reminder>Some harness context.</system-reminder>");
    expect(humanText(e)).toBe("Please also update the docs.");
  });

  it("returns an empty string when a block is nothing but a system-reminder plus whitespace", () => {
    const e = userEvent("  <system-reminder>Some harness context.</system-reminder>  ");
    expect(humanText(e)).toBe("");
  });

  it("drops a failed local-command's stderr output, mirroring the already-filtered stdout shape (round-5 external review catch, glm)", () => {
    const e = userEvent("<local-command-stderr>command not found</local-command-stderr>");
    expect(humanText(e)).toBe("");
  });
});

describe("a real /shipwright-iterate invocation never reaches humanText/buildUserReplyCard at all", () => {
  it("is reclassified to kind \"slash-command\" by the parser BEFORE this file ever sees it (round-5 external review catch, glm: investigated a suggestion to add <command-name>/<command-message>/<command-args> to the INJECTED denylist and declined it — this is why)", () => {
    const raw = event({
      type: "user",
      message: {
        role: "user",
        content: "<command-message>shipwright-iterate:iterate</command-message>\n"
          + "<command-name>/shipwright-iterate:iterate</command-name>\n"
          + "<command-args>fix the mission feed</command-args>",
      },
    });
    const parsed = parseSessionJsonl(raw).events[0];
    expect(parsed.kind).toBe("slash-command");
    expect(parsed.kind).not.toBe("user");
  });
});

describe("buildUserReplyCard", () => {
  it("returns null for a tool_result-only turn (no card, not an empty one)", () => {
    const e = userEvent([{ type: "tool_result", tool_use_id: "t1", content: "output", is_error: false }]);
    expect(buildUserReplyCard(e)).toBeNull();
  });
});

describe("deriveActivityFeed — user-reply cards", () => {
  it("produces no user-kind card from a transcript whose only user event is a tool_result", () => {
    const events = parseSessionJsonl(event({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "output", is_error: false }] },
    })).events;
    const feed = deriveActivityFeed(events, context());
    expect(feed.cards.some((card) => card.kind === "user")).toBe(false);
  });
});
