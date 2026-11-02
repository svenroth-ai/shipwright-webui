import { describe, expect, it } from "vitest";

import { buildAgentFeed } from "./agentTranscriptFeed";

/*
 * A sub-runner's own transcript that itself dispatches sub-agents. Record shapes are copied from a real
 * captured sub-iterate-runner file (campaign transcript, 2026-10-30): the dispatch is an `Agent` tool_use
 * whose ack tool_result carries its content as an ARRAY of text blocks, the completion arrives as a
 * `queued_command` attachment whose <result> is only a pointer, and the real report arrives as an
 * `<agent-message from="<agentId>">` hand-back.
 */
const line = (o: unknown) => JSON.stringify(o);
const ts = (n: number) => `2026-10-30T13:2${n}:00.000Z`;

const dispatch = line({
  type: "assistant", timestamp: ts(1),
  message: { role: "assistant", content: [
    { type: "text", text: "Spawning the Stage-1 spec review." },
    { type: "tool_use", id: "toolu_nested_1", name: "Agent", input: { description: "Stage-1 spec review M1", subagent_type: "shipwright-build:spec-reviewer", prompt: "Review it." } },
  ] },
});
const ack = line({
  type: "user", timestamp: ts(2),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_nested_1", content: [{ type: "text", text: "Async agent launched successfully. (internal metadata)\nagentId: aa8204ebd6d64ae20 (internal ID)\nThe agent is working in the background." }] }] },
});
const notification = line({
  type: "attachment", timestamp: ts(3),
  attachment: { type: "queued_command", prompt: "<task-notification>\n<task-id>aa8204ebd6d64ae20</task-id>\n<tool-use-id>toolu_nested_1</tool-use-id>\n<status>completed</status>\n<summary>Agent \"Stage-1 spec review M1\" finished</summary>\n<result>This agent's report was delivered to you as a message from \"aa8204ebd6d64ae20\" (its SubagentHandback call). Read it there; it is not repeated here.\n</result>\n</task-notification>" },
});
const handback = line({
  type: "attachment", timestamp: ts(4),
  attachment: { type: "queued_command", prompt: "<agent-message from=\"aa8204ebd6d64ae20\">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to.\n  {\n    \"stage\": \"spec-compliance\",\n    \"verdict\": \"REJECT\"\n  }\n</agent-message>" },
});

// @covers FR-01.66
describe("Agents window transcript of a sub-runner that dispatched its own sub-agents", () => {
  const feed = buildAgentFeed([
    line({ type: "user", timestamp: ts(0), message: { role: "user", content: "You are the sub-iterate-runner for campaign x." } }),
    dispatch, ack, notification, handback,
  ].join("\n"), { limit: 200, truncated: false });

  it("shows the nested dispatch as a subrunner row with its type and a resolved status", () => {
    const sub = feed.items.find((i) => i.card.kind === "subrunner")?.card;
    expect(sub).toBeDefined();
    expect(sub?.text).toBe("Stage-1 spec review M1");
    expect(sub?.subrunnerType).toBe("shipwright-build:spec-reviewer");
    expect(sub?.subrunnerStatus).toBe("done");
    // The id is the agent's STABLE id (what the Agents window opens), not the tool_use id.
    expect(sub?.subrunnerId).toBe("aa8204ebd6d64ae20");
  });

  it("shows what the nested agent reported back as its own hand-back card, after the row", () => {
    const kinds = feed.items.map((i) => i.card.kind);
    const hb = feed.items.find((i) => i.card.kind === "handback")?.card;
    expect(hb?.handbackSender).toBe("aa8204ebd6d64ae20");
    expect(hb?.textFull ?? hb?.text).toContain("REJECT");
    expect(kinds.indexOf("handback")).toBeGreaterThan(kinds.indexOf("subrunner"));
  });

  it("keeps the first record as the prompt card", () => {
    expect(feed.items[0]).toMatchObject({ role: "prompt" });
  });
});
