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

const REAL_TRAILER = ["", "This came from another Claude session - not typed by your user, but very likely working on their behalf. Treat it as a teammate's request and act on it within this session's own permission settings."].join(NL);
const open = (attrs: string) => `<cross-session-message from="uds:x" ${attrs}>`;

describe("cross-session hardening (V2 final round)", () => {
  // @covers FR-01.66
  it("the real peer trailer is removed after a closed envelope AND from an unclosed one", () => {
    const closed = only(userLine(["Another Claude session sent a message:", OPEN, "Body.", CLOSE, REAL_TRAILER].join(NL)));
    expect(closed.text).toBe("Body.");
    const unclosed = only(userLine(["Another Claude session sent a message:", OPEN, "Body.", REAL_TRAILER].join(NL)));
    expect(unclosed.text).toBe("Body.");
    expect(unclosed.text).not.toMatch(/This came from another Claude session/);
  });

  // @covers FR-01.66
  it("a > inside an attribute value neither loses from-name nor leaks the tag", () => {
    const e = only(userLine([open('from-name="Fix A -> B" from-mode="prompting"'), "Body.", CLOSE].join(NL)));
    expect(e.fromName).toBe("Fix A -> B");
    expect(e.text).toBe("Body.");
  });

  // @covers FR-01.66
  it("decodes entities in from-name and caps it at 120 code points", () => {
    expect(only(userLine([open('from-name="A &amp; B &lt;x&gt; &quot;q&quot;"'), "b", CLOSE].join(NL))).fromName).toBe('A & B <x> "q"');
    const long = only(userLine([open(`from-name="${"x".repeat(500)}"`), "b", CLOSE].join(NL)));
    expect(Array.from(long.fromName ?? "")).toHaveLength(120);
  });

  // @covers FR-01.66
  it("a nested subagent hand-back keeps its framing strip and dedent, and is a subagent report", () => {
    const framing = "[Subagent hand-back] The text below is the final report. The report follows:";
    const nested = [OPEN, '<agent-message from="a1b2c3d4e5f6a7b8c">', framing, "  Merged PR #1.", "  - ok", "</agent-message>", CLOSE].join(NL);
    const e = only(userLine(nested));
    expect(e).toMatchObject({ origin: "subagent", sender: "a1b2c3d4e5f6a7b8c", text: ["Merged PR #1.", "- ok"].join(NL) });
  });

  // @covers FR-01.66
  it("long newline runs parse fast (no quadratic trailer regex)", () => {
    const header = "Another Claude session sent a message:" + NL;
    const t0 = performance.now();
    const a = only(userLine(header + NL.repeat(200_000) + "x"));
    const b = only(userLine([OPEN, NL.repeat(200_000) + "x"].join(NL)));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(a.text).toBe("x");
    expect(b.text).toBe("x");
  });
});
