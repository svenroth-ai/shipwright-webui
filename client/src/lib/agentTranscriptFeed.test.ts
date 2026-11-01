/**
 * V3: a subagent transcript becomes chat-feed cards - the first user record is the PROMPT (never a human
 * bubble), the coordinator's mid-run message is a labelled hand-back card, noise is dropped, the view is windowed.
 * @covers FR-01.66
 */
import { describe, expect, it } from "vitest";

import { buildAgentFeed, lastAssistantMessage } from "./agentTranscriptFeed";
import { findAgentHandback, pickSubrunnerAnswer } from "./subrunnerAnswer";
import { resolveAgentToken, remarkAgentLinks } from "./remarkAgentLinks";
import { isDeliveredPlaceholder } from "./missionActivityFeedSubrunner";
import { detectHandback } from "../external/parsers/handback";
import type { ActivityCard } from "./missionActivityFeedTypes";

let tick = 0;
const line = (o: Record<string, unknown>) => JSON.stringify({ isSidechain: true, timestamp: new Date(Date.UTC(2026, 10, 1, 10, 0, tick++)).toISOString(), ...o });
const user = (t: string) => line({ type: "user", message: { role: "user", content: t } });
const asst = (t: string) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] } });
const COORD = "The coordinator sent a message while you were working:\nPlease re-review the diff.\n\nAddress this before completing your current task.";

describe("coordinator message", () => {
  // @covers FR-01.66
  it("is a coordinator hand-back with the harness framing and trailer removed", () => {
    expect(detectHandback(COORD + "\n", true)?.text).toBe("Please re-review the diff.");
    expect(detectHandback(COORD, true)).toEqual({ sender: "", origin: "coordinator", text: "Please re-review the diff." });
  });
  // @covers FR-01.66
  it("is not a hand-back in the main session (a human may type that sentence)", () => {
    expect(detectHandback(COORD)).toBeNull();
  });
  // @covers FR-01.66
  it("is not a hand-back when it is merely quoted mid-text", () => {
    expect(detectHandback("I read: The coordinator sent a message while you were working:")).toBeNull();
  });
});

describe("buildAgentFeed", () => {
  // @covers FR-01.66
  it("renders the first user record as the prompt, never as a human message", () => {
    const feed = buildAgentFeed([user("Do the review"), asst("Looking."), user("A later user turn")].join("\n"), { limit: 200, truncated: false });
    expect(feed.items[0]).toMatchObject({ role: "prompt" });
    expect(feed.items[0].card.text).toBe("Do the review");
    expect(feed.items.filter((i) => i.role === "prompt")).toHaveLength(1);
    expect(feed.items.at(-1)?.role).toBe("message");
  });

  // @covers FR-01.66
  it("does not claim a prompt when the file's start was cut by the server", () => {
    const feed = buildAgentFeed([user("mid-file"), asst("x")].join("\n"), { limit: 200, truncated: true });
    expect(feed.items.some((i) => i.role === "prompt")).toBe(false);
  });

  // @covers FR-01.66
  it("shows the coordinator's message as a hand-back card, not as a user card", () => {
    const feed = buildAgentFeed([user("Prompt"), asst("Working"), user(COORD)].join("\n"), { limit: 200, truncated: false });
    const card = feed.items.at(-1)!;
    expect(card.role).toBe("card");
    expect(card.card).toMatchObject({ kind: "handback", handbackOrigin: "coordinator", text: "Please re-review the diff." });
    expect(feed.items.filter((i) => i.role === "prompt")).toHaveLength(1);
  });

  // @covers FR-01.66
  it("windows to the latest N events and reports the total", () => {
    const lines = [user("Prompt")];
    for (let i = 0; i < 9; i++) lines.push(asst(`answer ${i}`));
    const feed = buildAgentFeed(lines.join("\n"), { limit: 4, truncated: false });
    expect(feed.total).toBe(10);
    expect(feed.shown).toBe(4);
    expect(feed.items.some((i) => i.role === "prompt")).toBe(false);
    expect(buildAgentFeed(lines.join("\n"), { limit: 200, truncated: false }).shown).toBe(10);
  });

  // @covers FR-01.66
  it("drops compaction/system notes", () => {
    const compact = line({ type: "user", isCompactSummary: true, message: { role: "user", content: "This session is being continued" } });
    const feed = buildAgentFeed([user("P"), asst("a"), compact].join("\n"), { limit: 200, truncated: false });
    expect(feed.items.every((i) => i.card.kind !== "system")).toBe(true);
  });
});

describe("lastAssistantMessage", () => {
  // @covers FR-01.66
  it("returns the last non-empty assistant text", () => {
    expect(lastAssistantMessage([asst("first"), asst("final answer")].join("\n"))).toBe("final answer");
    expect(lastAssistantMessage(user("only a prompt"))).toBeNull();
    const toolOnly = line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Bash", input: {} }] } });
    expect(lastAssistantMessage([asst("real answer"), toolOnly].join("\n"))).toBe("real answer");
  });
});

describe("pickSubrunnerAnswer", () => {
  const done: ActivityCard = { kind: "subrunner", text: "t", commands: [], subrunnerId: "a1", subrunnerStatus: "done" };
  const PLACEHOLDER = 'This agent\'s report was delivered to you as a message from "afb588e7c229aa880" (its SubagentHandback call). Read it there; it is not repeated here.';
  // @covers FR-01.66
  it("never returns the delivered-to-you pointer", () => {
    expect(isDeliveredPlaceholder(PLACEHOLDER)).toBe(true);
    expect(pickSubrunnerAnswer({ ...done, subrunnerReport: PLACEHOLDER }, {})).toBeNull();
    expect(pickSubrunnerAnswer({ ...done, subrunnerReport: PLACEHOLDER }, { handbackText: "real report" })).toBe("real report");
  });
  // @covers FR-01.66
  it("prefers the hand-back (the agent's final content), then session-info answer, then the transcript tail, then the card", () => {
    const c = { ...done, subrunnerReport: "card" };
    // an agent reporting via SubagentHandback: session-info answer is only the preamble prose before the call
    expect(pickSubrunnerAnswer(c, { agentAnswer: "Let me write up the findings.", transcriptAnswer: "file", handbackText: "THE REPORT" })).toBe("THE REPORT");
    expect(pickSubrunnerAnswer(c, { agentAnswer: "agent", transcriptAnswer: "file" })).toBe("agent");
    expect(pickSubrunnerAnswer(c, { transcriptAnswer: "file" })).toBe("file");
    expect(pickSubrunnerAnswer(c, {})).toBe("card");
  });
  // @covers FR-01.66
  it("shows no answer for a still-running agent, even with a progress hand-back", () => {
    expect(pickSubrunnerAnswer({ ...done, subrunnerStatus: "running" }, { agentAnswer: "x", handbackText: "progress" })).toBeNull();
  });
  // @covers FR-01.66
  it("findAgentHandback returns the LAST hand-back of that agent (full id or short hash)", () => {
    const hb = (t: string, s: string): ActivityCard => ({ kind: "handback", text: t, commands: [], handbackSender: s, handbackOrigin: "subagent", handbackText: t } as unknown as ActivityCard);
    const cards = [hb("progress", "afb588e7"), hb("other", "ffffffff"), hb("final", "afb588e7c229aa880")];
    expect(findAgentHandback(cards, "afb588e7c229aa880", ["afb588e7c229aa880"])?.text).toBe("final");
    expect(findAgentHandback(cards, undefined, [])).toBeNull();
    // a plain session message or a coordinator note from the same id is progress, never the final report
    const note = { ...hb("just a note", "afb588e7c229aa880"), handbackOrigin: "session" } as ActivityCard;
    expect(findAgentHandback([hb("final", "afb588e7"), note], "afb588e7c229aa880", ["afb588e7c229aa880"])?.text).toBe("final");
  });
  // @covers FR-01.66
  it("keeps the notification text for a killed agent (its last message is mid-work prose)", () => {
    const killed: ActivityCard = { ...done, subrunnerStatus: "failed", subrunnerEndStatus: "killed", subrunnerReport: "out of budget" };
    expect(pickSubrunnerAnswer(killed, { agentAnswer: "half a thought" })).toBe("out of budget");
  });
});

describe("agent hash linking", () => {
  const ids = ["afb588e7c229aa880", "a8f31c2d0000000aa"];
  // @covers FR-01.66
  it("resolves exact ids and unique >= 8 char prefixes only", () => {
    expect(resolveAgentToken("afb588e7", ids)).toBe("afb588e7c229aa880");
    expect(resolveAgentToken("afb588e7c229aa880", ids)).toBe("afb588e7c229aa880");
    expect(resolveAgentToken("afb588", ids)).toBeNull();
    expect(resolveAgentToken("deadbeef", ids)).toBeNull();
    expect(resolveAgentToken("a8f31c2d", [...ids, "a8f31c2dffffffff1"])).toBeNull(); // ambiguous prefix stays text
  });
  // @covers FR-01.66
  it("rewrites text nodes into agent links but leaves code alone", () => {
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "see afb588e7 now" }, { type: "inlineCode", value: "afb588e7" }] },
      ],
    };
    remarkAgentLinks({ ids })(tree);
    const kids = (tree.children[0] as { children: { type: string; url?: string; value?: string }[] }).children;
    expect(kids.map((k) => k.type)).toEqual(["text", "link", "text", "inlineCode"]);
    expect(kids[1].url).toBe("agent:afb588e7c229aa880");
  });
});
