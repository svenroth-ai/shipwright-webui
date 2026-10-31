/**
 * Third real envelope (V2 doubt review): `<cross-session-message from="uds:…" from-name="…">`, as a user record
 * (header line first), as a queued_command attachment, and with a nested `<agent-message>`. Sanitized from
 * measured transcripts.
 */
import { describe, it, expect } from "vitest";
import { parseSessionJsonl, type HandbackEvent } from "./session-parser";
import { filterEventsForRender } from "../components/external/BubbleTranscript/filters";
import { deriveActivityFeed } from "../lib/missionActivityFeed";

const NL = String.fromCharCode(10);
const OPEN = '<cross-session-message from="uds:\\\\.\\pipe\\LOCAL\\cc-msg-abc" from-name="Current Triage Items" from-mode="prompting">';
const CLOSE = "</cross-session-message>";
const TRAILER = ['', 'That "other Claude session" is an agent working inside this same session - not typed by your user.'].join(NL);

const userLine = (content: string) => JSON.stringify({ type: "user", timestamp: "2026-10-31T10:00:00Z", message: { role: "user", content } });
const attLine = (prompt: string) => JSON.stringify({ type: "attachment", timestamp: "2026-10-31T10:00:00Z", attachment: { type: "queued_command", prompt } });
const only = (line: string) => {
  const { events } = parseSessionJsonl(line);
  expect(events).toHaveLength(1);
  return events[0] as HandbackEvent;
};

describe("cross-session-message envelope", () => {
  // @covers FR-01.66
  it("user record: tags and header hidden, from-name is the title, origin session, no sender chip", () => {
    const e = only(userLine(["Another Claude session sent a message:", OPEN, "Your correction is right.", "Second line.", CLOSE, TRAILER].join(NL)));
    expect(e.kind).toBe("handback");
    expect(e.origin).toBe("session");
    expect(e.sender).toBe("");
    expect(e.fromName).toBe("Current Triage Items");
    expect(e.text).toBe(["Your correction is right.", "Second line."].join(NL));
    expect(e.text).not.toMatch(/cross-session|Another Claude session|other Claude session/);
  });

  // @covers FR-01.66
  it("queued_command attachment starting with the envelope is a handback too (feed card + transcript row)", () => {
    const events = parseSessionJsonl(attLine([OPEN, "Do NOT open the baseline repair PR.", CLOSE].join(NL))).events;
    expect(events[0]).toMatchObject({ kind: "handback", origin: "session", fromName: "Current Triage Items", text: "Do NOT open the baseline repair PR." });
    expect(filterEventsForRender(events, new Set())).toHaveLength(1);
    const cards = deriveActivityFeed(events, null).cards.filter((c) => c.kind === "handback");
    expect(cards).toHaveLength(1);
    expect(cards[0].handbackTitle).toBe("Current Triage Items");
  });

  // @covers FR-01.66
  it("nested agent-message: the agent id becomes the sender, the inner text is the body", () => {
    const nested = ["Another Claude session sent a message:", OPEN, '<agent-message from="abda17a440a1206dc">', "Folded both into the finding set.", "</agent-message>", CLOSE, TRAILER].join(NL);
    const e = only(userLine(nested));
    expect(e).toMatchObject({ origin: "session", sender: "abda17a440a1206dc", fromName: "Current Triage Items", text: "Folded both into the finding set." });
  });

  // @covers FR-01.66
  it("a message that merely mentions the tag mid-text stays a user message", () => {
    expect(only(userLine(`please look at ${OPEN} in the log`)).kind).toBe("user");
  });
});
