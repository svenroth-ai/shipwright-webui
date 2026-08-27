/*
 * iterate-2026-08-27-mission-feed-narration-scroll — bug fix coverage.
 *
 * Root cause (F-debug.md Phase 4): in every real `/shipwright-iterate`
 * autonomous session sampled, Claude NEVER combines narration text and a
 * tool_use block in the same JSONL assistant event — narration and the tool
 * calls it explains always land in two separate, consecutive assistant
 * turns. `deriveActivityFeed()`'s card-creation loop ran only `for (const
 * tool of toolUses(event))`, so a text-only turn's already-computed prose
 * was silently discarded: zero real production narration ever reached the
 * feed. This file pins the split-turn shape directly — every other test in
 * `missionActivityFeed.explanation.test.ts` and `missionActivityFeed.test.ts`
 * uses the single-event `turn(text, ...uses)` shape, which never exercised
 * this path.
 */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";

const event = (value: unknown) => JSON.stringify(value);

function turn(text: string | null, ...uses: Array<{ id: string; name: string; input: Record<string, unknown> }>) {
  const content: unknown[] = [];
  if (text !== null) content.push({ type: "text", text });
  for (const use of uses) content.push({ type: "tool_use", id: use.id, name: use.name, input: use.input });
  return event({ type: "assistant", message: { role: "assistant", content } });
}

describe("deriveActivityFeed — split narration/tool turns (real-world session shape)", () => {
  it("attaches a preceding pure-narration turn's words to the very next tool-bearing turn's card", () => {
    const events = parseSessionJsonl([
      turn("Checking how the auth guard handles a stale token.\nIt reads the cookie, then falls back to the header."),
      turn(null, { id: "r1", name: "Read", input: { file_path: "auth.ts" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "investigate");
    expect(card?.text).toBe("Checking how the auth guard handles a stale token.");
    expect(card?.explanation).toBe("It reads the cookie, then falls back to the header.");
  });

  it("a narration-only turn followed by TWO tool-only turns attaches only to the first — the second falls back to generic text, not stale narration", () => {
    const events = parseSessionJsonl([
      turn("Auditing the login flow for a session-fixation gap."),
      turn(null, { id: "r1", name: "Read", input: { file_path: "login.ts" } }),
      turn(null, { id: "w1", name: "Write", input: { file_path: "login.ts", content: "x" } }),
    ].join("\n")).events;
    const cards = deriveActivityFeed(events, null).cards;
    const investigate = cards.find((c) => c.kind === "investigate");
    const implement = cards.find((c) => c.kind === "implement");
    expect(investigate?.text).toBe("Auditing the login flow for a session-fixation gap.");
    // Not stale narration leaking from the first turn, and not the generic
    // bucket sentence either — this card represents exactly one uncoalesced
    // tool_use event, so the existing label-derived-sentence fallback
    // (`sentenceFromLabel`) fires, same as it would for any card with no
    // prose of its own at all.
    expect(implement?.text).toBe("Write login.ts.");
  });

  it("two consecutive narration-only turns: the SECOND (most recent) turn's words win, not the first", () => {
    const events = parseSessionJsonl([
      turn("First thought: maybe the cookie is stale."),
      turn("Actually the real cause is the CSRF token."),
      turn(null, { id: "r1", name: "Read", input: { file_path: "auth.ts" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "investigate");
    expect(card?.text).toBe("Actually the real cause is the CSRF token.");
  });

  it("a turn's own text (the rarer same-event shape) still wins over any pending narration from an earlier turn", () => {
    const events = parseSessionJsonl([
      turn("This should never appear — superseded by the tool-bearing turn's own text."),
      turn("Reading the config loader directly.", { id: "r1", name: "Read", input: { file_path: "config.ts" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "investigate");
    expect(card?.text).toBe("Reading the config loader directly.");
  });

  it("narration survives an intervening test-only turn and still reaches the next real (investigate/implement) turn", () => {
    const events = parseSessionJsonl([
      turn("Let's confirm this is broken by rerunning the tests first."),
      turn(null, { id: "t1", name: "Bash", input: { command: "npm test" } }),
      turn(null, { id: "r1", name: "Read", input: { file_path: "auth.ts" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "investigate");
    expect(card?.text).toBe("Let's confirm this is broken by rerunning the tests first.");
  });

  it("narration survives an intervening AskUserQuestion-only turn and still reaches the next real turn", () => {
    const events = parseSessionJsonl([
      turn("Before continuing, I need to check which approach you prefer."),
      turn(null, { id: "q1", name: "AskUserQuestion", input: { questions: [{ question: "Which approach?", header: "Approach", options: [{ label: "A" }, { label: "B" }] }] } }),
      turn(null, { id: "w1", name: "Write", input: { file_path: "login.ts", content: "x" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "implement");
    expect(card?.text).toBe("Before continuing, I need to check which approach you prefer.");
  });

  it("narration survives two consecutive non-consuming test-only turns (a realistic retry burst)", () => {
    const events = parseSessionJsonl([
      turn("Rerunning the suite to see if the flake reproduces."),
      turn(null, { id: "t1", name: "Bash", input: { command: "npm test" } }),
      turn(null, { id: "t2", name: "Bash", input: { command: "npm test" } }),
      turn(null, { id: "r1", name: "Read", input: { file_path: "flaky.test.ts" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "investigate");
    expect(card?.text).toBe("Rerunning the suite to see if the flake reproduces.");
  });

  it("narration survives THREE consecutive non-consuming test-only turns — a realistic 3-retry test-until-green burst (second doubt-review catch: the raw constant bridges one fewer turn than its own value)", () => {
    const events = parseSessionJsonl([
      turn("Rerunning the suite three times to rule out a flake before digging deeper."),
      turn(null, { id: "t1", name: "Bash", input: { command: "npm test" } }),
      turn(null, { id: "t2", name: "Bash", input: { command: "npm test" } }),
      turn(null, { id: "t3", name: "Bash", input: { command: "npm test" } }),
      turn(null, { id: "r1", name: "Read", input: { file_path: "flaky.test.ts" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "investigate");
    expect(card?.text).toBe("Rerunning the suite three times to rule out a flake before digging deeper.");
  });

  it("narration is DROPPED, not misattributed, once it has outlived the bridgeable number of non-consuming turns — an unrelated later turn does not inherit stale words (doubt-review catch)", () => {
    const events = parseSessionJsonl([
      turn("Investigating the race condition in the scheduler."),
      turn(null, { id: "t1", name: "Bash", input: { command: "npm test" } }),
      turn(null, { id: "t2", name: "Bash", input: { command: "npm test" } }),
      turn(null, { id: "t3", name: "Bash", input: { command: "npm test" } }),
      turn(null, { id: "t4", name: "Bash", input: { command: "npm test" } }),
      // No narration of its own — an unrelated pivot, the scenario the cap defends against.
      turn(null, { id: "w1", name: "Write", input: { file_path: "emailTemplate.ts", content: "x" } }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, null).cards.find((c) => c.kind === "implement");
    expect(card?.text).not.toBe("Investigating the race condition in the scheduler.");
    // Falls back to the existing label-derived sentence, same as any card with no prose at all.
    expect(card?.text).toBe("Write emailTemplate.ts.");
  });

  it("trailing narration with no following tool call is dropped, not crashed on or leaked onto an unrelated later card", () => {
    const events = parseSessionJsonl([
      turn(null, { id: "r1", name: "Read", input: { file_path: "auth.ts" } }),
      turn("Wrapping up — no further action needed."),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    // The trailing narration produces no second card and does not overwrite
    // this one — label-derived fallback, same as any card with no prose.
    expect(feed.cards).toHaveLength(1);
    expect(feed.cards[0].text).toBe("Read auth.ts.");
  });
});
