/*
 * missionActivityFeedSessionStart.test.ts — AC1
 * (iterate-2026-09-28-mission-feed-completeness).
 *
 * `ActivityFeed.sessionStartTimestamp` is computed from the RAW transcript
 * events, independent of which cards survive derivation — before this fix,
 * the "Session started" divider derived its time from `feed.cards[0]`, so a
 * session whose early turns produced no surviving card (e.g. pure
 * investigate/read-only turns, filtered away with no narration of their
 * own) silently reported a later, wrong start time (reported: "Start ist
 * abgeschnitten").
 */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";

const event = (value: unknown) => JSON.stringify(value);

describe("deriveActivityFeed — sessionStartTimestamp (AC1)", () => {
  it("is the transcript's true first timestamp even when the earliest turns produce no surviving card", () => {
    const events = parseSessionJsonl([
      // A pure-narration turn with no tool call and no banner is carried as
      // `pendingNarration` and never becomes its own card unless nothing
      // later ever consumes it — here a later real tool call DOES consume
      // it, so this turn's own card never independently exists; its
      // timestamp must still be the reported session start.
      event({ type: "assistant", timestamp: "2026-09-28T08:00:00.000Z", message: { content: [{ type: "text", text: "Looking into the report." }] } }),
      event({ type: "assistant", timestamp: "2026-09-28T08:00:05.000Z", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }] } }),
      event({ type: "user", timestamp: "2026-09-28T08:00:06.000Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "file contents" }] } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.sessionStartTimestamp).toBe("2026-09-28T08:00:00.000Z");
    // The first card's own timestamp is genuinely LATER — this is exactly
    // the bug: `feed.cards[0]` alone would report the wrong start time.
    expect(feed.cards[0]?.timestamp).not.toBe(feed.sessionStartTimestamp);
  });

  it("skips a malformed leading timestamp in favor of a later genuinely valid one", () => {
    const events = parseSessionJsonl([
      event({ type: "assistant", timestamp: "not-a-real-date", message: { content: [{ type: "text", text: "garbled" }] } }),
      event({ type: "assistant", timestamp: "2026-09-28T09:00:00.000Z", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.sessionStartTimestamp).toBe("2026-09-28T09:00:00.000Z");
  });

  it("is undefined when no event in the transcript carries any timestamp", () => {
    const events = parseSessionJsonl([event({ type: "user", message: { role: "user", content: "hi" } })].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.sessionStartTimestamp).toBeUndefined();
  });
});
