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

// Minimal self-contained banner block — just the border + the one line
// `containsIterateBanner`/`stripIterateBanner` actually anchor on. Trimmed
// down from an earlier version that also carried a shortened "Usage:" line
// (round-5 fix: `stripIterateBanner`'s surround-line matching moved from
// loose prefixes to EXACT known-line equality against the REAL banner text
// below, so a made-up shortened Usage line no longer matches and would be
// left un-stripped — these tests don't need it to prove what they're
// actually testing).
const BANNER_TEXT = [
  "================================================================================",
  "SHIPWRIGHT-ITERATE: Adaptive Change Lifecycle",
  "================================================================================",
].join("\n");

// Verbatim from SKILL.md "A. Print Intro Banner" — the REAL banner, not the
// truncated 4-line BANNER_TEXT fixture above. Round-4 code review caught that
// every existing test (including the two below that were added to close the
// openai medium #2 finding) only ever exercised the truncated fixture, which
// never reached BANNER_SURROUND_LINE's three `\s+`-prefixed alternatives —
// masking that those alternatives could never match an already-`.trim()`med
// line and left this exact real banner's indented continuation lines
// (the "BUG" Paths continuation, "  ADR:", "  Conventional Commits:")
// un-stripped in production.
const REAL_BANNER_TEXT = [
  "================================================================================",
  "SHIPWRIGHT-ITERATE: Adaptive Change Lifecycle",
  "================================================================================",
  'Usage: /shipwright-iterate --type feature|change|bug [--review-model opus|sonnet|haiku|inherit|fable] [--finalization-model ...] [--plan-review-model ...] "description"',
  "   or: Auto-detected from your prompt (via hook context)",
  "Paths: FEATURE / CHANGE → [interview]→[spec]→[plan]→[approval]→[review]→[design]→build→test→commit",
  "       BUG              → [spec]→reproduce→[plan]→fix→test→commit",
  "Complexity: trivial | small | medium | large (auto-detected, overridable)",
  "In plain words (shared index → docs/guide.md Appendix A):",
  "  ADR: Log of architectural decisions with rationale (why this database, why this pattern)",
  "  Conventional Commits: Standardized commit-message format (`feat:`, `fix:`, etc.) so version history is machine-readable",
  "================================================================================",
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
      turn("Re-reading the config files.", "2026-08-31T09:00:00.000Z", { id: "e1", name: "Read", input: { file_path: "a.ts" } }),
      turn("Re-reading the config files.", "2026-08-31T09:05:00.000Z", { id: "e2", name: "Read", input: { file_path: "b.ts" } }),
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
    // narration. With no real prose to draw on, the card would carry only a
    // command chip and no words of its own — the empty-tool-only-card filter
    // (iterate-2026-09-20-mission-feed-transcript-fidelity) now drops it
    // entirely rather than show a wordless "implement" card.
    const implement = feed.cards.find((c) => c.kind === "implement");
    expect(implement).toBeUndefined();
  });

  it("keeps a combined banner+tool turn's OWN real narration instead of discarding it along with the banner boilerplate (external code review catch, medium)", () => {
    const events = parseSessionJsonl([
      turn(
        `${BANNER_TEXT}\n\nChecking the run config before proceeding.`,
        "2026-08-31T08:00:00.000Z",
        { id: "e1", name: "Bash", input: { command: "cat shipwright_run_config.json" } },
      ),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.cards.find((c) => c.kind === "goal")?.text).toMatch(/shipwright-iterate/i);
    const implement = feed.cards.find((c) => c.kind === "implement");
    expect(implement?.text).toBe("Checking the run config before proceeding.");
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

  it("strips the REAL 12-line banner (verbatim from SKILL.md, not the truncated fixture) down to no leftover prose when the turn carries no other narration (round-4 code review catch, high)", () => {
    const events = parseSessionJsonl([
      turn(REAL_BANNER_TEXT, "2026-08-31T08:00:00.000Z"),
      turn(null, "2026-08-31T08:00:05.000Z", { id: "e1", name: "Bash", input: { command: "cat shipwright_run_config.json" } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.cards.find((c) => c.kind === "goal")?.text).toMatch(/shipwright-iterate/i);
    // Before the round-4 fix, the banner's indented continuation lines (the
    // "BUG" Paths line, "  ADR:", "  Conventional Commits:") were left
    // un-stripped and leaked onto the pendingNarration queue, corrupting the
    // NEXT unrelated tool card's headline with banner boilerplate instead of
    // leaving it wordless (and thus dropped by the empty-tool-only-card
    // filter, same as the truncated-fixture case above).
    const implement = feed.cards.find((c) => c.kind === "implement");
    expect(implement).toBeUndefined();
    const system = feed.cards.find((c) => c.kind === "system");
    expect(system).toBeUndefined();
  });

  it("keeps a combined banner+tool turn's OWN real narration with the REAL 12-line banner, not just the truncated fixture (round-4 code review catch, high)", () => {
    const events = parseSessionJsonl([
      turn(
        `${REAL_BANNER_TEXT}\n\nChecking the run config before proceeding.`,
        "2026-08-31T08:00:00.000Z",
        { id: "e1", name: "Bash", input: { command: "cat shipwright_run_config.json" } },
      ),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.cards.find((c) => c.kind === "goal")?.text).toMatch(/shipwright-iterate/i);
    const implement = feed.cards.find((c) => c.kind === "implement");
    expect(implement?.text).toBe("Checking the run config before proceeding.");
  });

  it("keeps real narration immediately adjacent to the banner (no blank-line separator) even when it happens to start with a word the banner's own surround lines use (round-5 external review catch, both reviewers, medium+low)", () => {
    const events = parseSessionJsonl([
      turn(
        `${REAL_BANNER_TEXT}\nComplexity: this migration needs manual verification before merging.`,
        "2026-08-31T08:00:00.000Z",
        { id: "e1", name: "Bash", input: { command: "cat shipwright_run_config.json" } },
      ),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.cards.find((c) => c.kind === "goal")?.text).toMatch(/shipwright-iterate/i);
    // Before the round-5 fix, BANNER_SURROUND_LINE matched broad prefixes
    // (`Complexity:.*` among them), so this genuine sentence — which merely
    // happens to start with the same word the banner's own line uses — would
    // have been swallowed as if it were banner boilerplate. Exact-line
    // matching against the REAL known banner text fixes this: the sentence
    // differs from the banner's actual "Complexity: trivial | small |
    // medium..." line, so it survives.
    const implement = feed.cards.find((c) => c.kind === "implement");
    expect(implement?.text).toBe("Complexity: this migration needs manual verification before merging.");
  });

  it("does not appear at all when the transcript never printed the banner", () => {
    const events = parseSessionJsonl([
      turn("Just getting started on this change.", "2026-08-31T08:00:00.000Z"),
      turn(null, "2026-08-31T08:00:05.000Z", { id: "e1", name: "Read", input: { file_path: "a.ts" } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.cards.some((c) => c.kind === "goal")).toBe(false);
  });

  it("never fabricates a SECOND goal card when a transcript segment reprints the banner (round-6 external review catch, glm, low)", () => {
    const events = parseSessionJsonl([
      turn(BANNER_TEXT, "2026-08-31T08:00:00.000Z"),
      turn(null, "2026-08-31T08:00:05.000Z", { id: "e1", name: "Bash", input: { command: "echo start" } }),
      // A resumed/replayed segment reprinting the same banner mid-transcript.
      turn(BANNER_TEXT, "2026-08-31T09:00:00.000Z"),
      turn(null, "2026-08-31T09:00:05.000Z", { id: "e2", name: "Bash", input: { command: "echo resumed" } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.cards.filter((c) => c.kind === "goal")).toHaveLength(1);
  });
});
