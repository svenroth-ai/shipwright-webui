/*
 * missionActivityFeedSubrunnerAttachment.test.ts — AC6
 * (iterate-2026-09-28-mission-feed-completeness).
 *
 * A `code-reviewer`/`doubt-reviewer` `Task`/`Agent` dispatch's completion
 * notification can arrive as a `"attachment"`-kind `queued_command` payload
 * instead of a `"user"`-kind `task-notification` record — measured directly
 * against a real captured transcript. Before this fix, `deriveActivityFeed`'s
 * reducer silently dropped every event kind other than
 * `"user"|"task-notification"|"assistant"`, so the notification never reached
 * `resolveSubrunnerNotification` and the card stayed on "Running…" forever
 * (and, per `MissionActivityFeedCard.tsx`'s existing click-gate, unclickable).
 * Split into its own file rather than appended to
 * `missionActivityFeedSubrunner.test.ts` (already at the 300-line convention
 * ceiling).
 */
import { describe, expect, it } from "vitest";
import { deriveSubrunnerNotificationFromAttachment } from "./missionActivityFeedSubrunner";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";

describe("deriveSubrunnerNotificationFromAttachment", () => {
  // Real shape measured directly against a captured transcript
  // (iterate-2026-09-28-mission-feed-completeness): a review-subagent's
  // completion arrives this way, never as a "user"-kind record.
  it("parses a queued_command attachment carrying a real task-notification envelope", () => {
    const attachment = {
      type: "queued_command",
      prompt: "<task-notification>\n<task-id>afa89b37c9209c90d</task-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n<result>Code review: no blocking issues.</result>\n</task-notification>",
    };
    const event = deriveSubrunnerNotificationFromAttachment(attachment);
    expect(event).toEqual({
      kind: "task-notification",
      status: "completed",
      summary: "Agent finished",
      taskId: "afa89b37c9209c90d",
      result: "Code review: no blocking issues.",
    });
  });

  it("returns null for a queue-operation-shaped payload (never reclassified — enqueue time, not delivery)", () => {
    expect(deriveSubrunnerNotificationFromAttachment({ type: "queue-operation", prompt: "<task-notification></task-notification>" })).toBeNull();
  });

  it("returns null when prompt is not a string (e.g. a content-block array)", () => {
    expect(deriveSubrunnerNotificationFromAttachment({ type: "queued_command", prompt: [{ type: "text", text: "hi" }] })).toBeNull();
  });

  it("returns null when prompt is a string but not a task-notification envelope", () => {
    expect(deriveSubrunnerNotificationFromAttachment({ type: "queued_command", prompt: "run the next step" })).toBeNull();
  });

  it("returns null for a malformed/non-object attachment", () => {
    expect(deriveSubrunnerNotificationFromAttachment(null)).toBeNull();
    expect(deriveSubrunnerNotificationFromAttachment("not an object")).toBeNull();
  });
});

// @covers FR-01.66
describe("deriveActivityFeed — a code-reviewer dispatched via the harness's real 'Agent' tool completes via a queued_command attachment", () => {
  // `isReviewTask` only recognizes the tool name `"Task"` (classic CLI
  // convention) — never `"Agent"`, the harness's REAL dispatch tool
  // (`missionActivityFeedSubrunner.ts`'s own doc comment). So a real
  // code-reviewer/doubt-reviewer spawn (always dispatched via `Agent` in
  // this harness) is never routed into the synchronous `review` bucket at
  // all; it becomes a generic `subrunner` card, which is exactly the shape
  // this fixture reproduces.
  it("resolves the subrunner card from running to done via the attachment bridge, not a user-kind record", () => {
    const dispatch = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "code-reviewer", description: "Code review of the auth fix" } }] } });
    const ack = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "Async agent launched successfully. agentId: afa89b37c9209c90d" }] } });
    const attachmentLine = JSON.stringify({
      type: "attachment",
      attachment: {
        type: "queued_command",
        prompt: "<task-notification>\n<task-id>afa89b37c9209c90d</task-id>\n<status>completed</status>\n<summary>Agent \"Code review of the auth fix\" finished</summary>\n<result>No blocking issues found.</result>\n</task-notification>",
      },
    });
    const { events } = parseSessionJsonl([dispatch, ack, attachmentLine].join("\n"));
    const feed = deriveActivityFeed(events, null);
    const card = feed.cards.find((c) => c.kind === "subrunner");
    expect(card).toBeDefined();
    expect(card?.subrunnerId).toBe("afa89b37c9209c90d");
    expect(card?.subrunnerStatus).toBe("done");
    expect(card?.subrunnerReport).toBe("No blocking issues found.");
  });

  it("never resolves a subrunner card from a queue-operation event (bookkeeping only, not a delivery)", () => {
    const dispatch = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "doubt-reviewer", description: "Doubt review" } }] } });
    const ack = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "Async agent launched successfully. agentId: agent-99" }] } });
    const queueOp = JSON.stringify({ type: "queue-operation", operation: "enqueue", content: "<task-notification><task-id>agent-99</task-id><status>completed</status></task-notification>" });
    const { events } = parseSessionJsonl([dispatch, ack, queueOp].join("\n"));
    const feed = deriveActivityFeed(events, null);
    const card = feed.cards.find((c) => c.kind === "subrunner");
    expect(card?.subrunnerStatus).toBe("running");
  });
});
