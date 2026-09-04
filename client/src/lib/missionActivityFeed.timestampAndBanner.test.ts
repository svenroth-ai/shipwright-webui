/*
 * iterate-2026-08-31-mission-feed-gaps — bug fix coverage for two of the four
 * reported gaps:
 *
 *   (2) ActivityCard carried no timestamp at all, so the feed showed no date
 *       information — this pins that a card's OWN JSONL event timestamp is
 *       now threaded through, set once at creation, never moved by later
 *       coalescing or mutation.
 *   (3) The feed opened on the generic "The implementation was updated in
 *       compact steps." sentence instead of ever showing that an iterate had
 *       started — this pins that the /shipwright-iterate intro banner now
 *       gets its own dedicated "goal" card instead of silently feeding the
 *       narration-carry heuristic.
 */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";

const event = (value: unknown) => JSON.stringify(value);

function turn(
  text: string | null,
  timestamp: string | undefined,
  ...uses: Array<{ id: string; name: string; input: Record<string, unknown> }>
) {
  const content: unknown[] = [];
  if (text !== null) content.push({ type: "text", text });
  for (const use of uses) content.push({ type: "tool_use", id: use.id, name: use.name, input: use.input });
  return event({ type: "assistant", timestamp, message: { role: "assistant", content } });
}

const BANNER_TEXT = [
  "================================================================================",
  "SHIPWRIGHT-ITERATE: Adaptive Change Lifecycle",
  "================================================================================",
  'Usage: /shipwright-iterate --type feature|change|bug "description"',
].join("\n");

describe("deriveActivityFeed — card.timestamp", () => {
  it("sets the timestamp from the creating event, for a tool-bearing (implement) card", () => {
    const events = parseSessionJsonl([
      turn("Updating the config loader.", "2026-08-31T09:15:00.000Z", { id: "e1", name: "Edit", input: { file_path: "a.ts" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "implement");
    expect(card?.timestamp).toBe("2026-08-31T09:15:00.000Z");
  });

  it("keeps the FIRST event's timestamp when a later event coalesces into the same card", () => {
    const events = parseSessionJsonl([
      turn(null, "2026-08-31T09:00:00.000Z", { id: "e1", name: "Read", input: { file_path: "a.ts" } }),
      turn(null, "2026-08-31T09:05:00.000Z", { id: "e2", name: "Read", input: { file_path: "b.ts" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "investigate");
    expect(card?.timestamp).toBe("2026-08-31T09:00:00.000Z");
    expect(card?.commands.length).toBe(2);
  });

  it("is absent when the source event carried no timestamp (older transcripts) — never fabricated", () => {
    const events = parseSessionJsonl([
      turn(null, undefined, { id: "e1", name: "Read", input: { file_path: "a.ts" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "investigate");
    expect(card?.timestamp).toBeUndefined();
  });
});

describe("deriveActivityFeed — /shipwright-iterate intro banner recognition", () => {
  it("gets its OWN goal card instead of silently feeding the next tool-bearing turn's generic sentence", () => {
    const events = parseSessionJsonl([
      turn(BANNER_TEXT, "2026-08-31T08:00:00.000Z"),
      turn(null, "2026-08-31T08:00:05.000Z", { id: "e1", name: "Bash", input: { command: "cat shipwright_run_config.json" } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    const goal = feed.cards.find((c) => c.kind === "goal");
    expect(goal?.text).toMatch(/shipwright-iterate/i);
    expect(goal?.timestamp).toBe("2026-08-31T08:00:00.000Z");
    // The banner turn's OWN narration is boilerplate usage text (a `====`
    // border line), not a real explanation of the next tool call — it must
    // not leak into the implement card's headline as if it were real
    // narration. With no real prose to draw on and no more generic/label-
    // derived fallback (iterate-2026-09-05-mission-feed-ux-gaps), the
    // headline stays empty; the real command still shows in the chip.
    const implement = feed.cards.find((c) => c.kind === "implement");
    expect(implement?.text).not.toMatch(/={5,}/);
    expect(implement?.text).toBe("");
    expect(implement?.commands[0]).toMatch(/cat shipwright_run_config\.json/);
  });

  it("does NOT fire on ordinary prose that merely mentions the banner phrase mid-sentence (external code review, openai MEDIUM)", () => {
    const events = parseSessionJsonl([
      turn("Earlier the SHIPWRIGHT-ITERATE: Adaptive Change Lifecycle banner would have printed here, but this session skipped it.", "2026-08-31T08:00:00.000Z"),
      turn(null, "2026-08-31T08:00:05.000Z", { id: "e1", name: "Read", input: { file_path: "a.ts" } }),
    ].join("\n")).events;
    // The match requires a STANDALONE (trimmed) line, not a substring — this
    // sentence merely quotes the phrase, so no run genuinely started and no
    // goal card should be fabricated.
    const goal = deriveActivityFeed(events, null).cards.find((c) => c.kind === "goal");
    expect(goal).toBeUndefined();
  });

  it("does not appear at all when the transcript never printed the banner", () => {
    const events = parseSessionJsonl([
      turn("Just getting started on this change.", "2026-08-31T08:00:00.000Z"),
      turn(null, "2026-08-31T08:00:05.000Z", { id: "e1", name: "Read", input: { file_path: "a.ts" } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.cards.some((c) => c.kind === "goal")).toBe(false);
  });
});
