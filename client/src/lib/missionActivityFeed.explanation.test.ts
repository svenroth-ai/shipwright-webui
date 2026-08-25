/*
 * iterate-2026-08-25-mission-feed-progress-narration — `card.explanation`
 * derivation matrix. Split into its own file rather than extending
 * `missionActivityFeed.test.ts` (already near the project's 300-line
 * convention) or `missionActivityFeedFields.test.ts` (already extended for
 * `explanationExcerpt()`'s own unit coverage) — this file is specifically
 * the turn-provenance/coalescing/reconcile-interaction matrix, a distinct
 * concern from either.
 */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const result = (id: string, isError = false, content = "output") =>
  event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

/** One assistant turn: an optional text block followed by one or more tool_use blocks. */
function turn(text: string | null, ...uses: Array<{ id: string; name: string; input: Record<string, unknown> }>) {
  const content: unknown[] = [];
  if (text !== null) content.push({ type: "text", text });
  for (const use of uses) content.push({ type: "tool_use", id: use.id, name: use.name, input: use.input });
  return event({ type: "assistant", message: { role: "assistant", content } });
}

const context = (gate: "pass" | "fail" | "unknown" = "unknown", reviewAvailable = false): MissionContext => ({
  schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: true, servesFrId: null, sourceRev: "x",
  tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate },
  artifacts: [
    { kind: "spec", label: "Spec", state: "available", summary: null, receipt: null, detail: null },
    { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
    { kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null, detail: null },
    ...(reviewAvailable ? [{ kind: "review" as const, label: "Review", state: "available" as const, summary: null, receipt: null, detail: null }] : []),
  ],
});

describe("deriveActivityFeed — card.explanation (iterate-2026-08-25-mission-feed-progress-narration)", () => {
  it("(a) sets explanation to the bounded remainder for a solo-turn card with multi-line prose", () => {
    const events = parseSessionJsonl(turn(
      "Checking how the auth guard handles a stale token.\nIt reads the cookie, then falls back to the header.",
      { id: "read1", name: "Read", input: { file_path: "auth.ts" } },
    )).events;
    const card = deriveActivityFeed(events, context()).cards.find((c) => c.kind === "investigate");
    expect(card?.text).toBe("Checking how the auth guard handles a stale token.");
    expect(card?.explanation).toBe("It reads the cookie, then falls back to the header.");
  });

  it("(b) leaves explanation unset for a single-line turn, or a whitespace-only remainder", () => {
    const singleLine = parseSessionJsonl(turn("Checking the auth guard.", { id: "r1", name: "Read", input: { file_path: "auth.ts" } })).events;
    expect(deriveActivityFeed(singleLine, context()).cards.find((c) => c.kind === "investigate")?.explanation).toBeUndefined();

    const blankRest = parseSessionJsonl(turn("Checking the auth guard.\n\n   \n", { id: "r2", name: "Read", input: { file_path: "auth.ts" } })).events;
    expect(deriveActivityFeed(blankRest, context()).cards.find((c) => c.kind === "investigate")?.explanation).toBeUndefined();
  });

  it("(c) clears explanation when a second turn's identical first line coalesces into the same card (non-vacuous)", () => {
    const events = parseSessionJsonl([
      turn("Checking the config loader.\nFirst turn's own detail.", { id: "r1", name: "Read", input: { file_path: "a.ts" } }),
      turn("Checking the config loader.\nA completely different second explanation.", { id: "r2", name: "Read", input: { file_path: "b.ts" } }),
    ].join("\n")).events;
    const cards = deriveActivityFeed(events, context()).cards.filter((c) => c.kind === "investigate");
    expect(cards).toHaveLength(1); // proves the two turns really did coalesce
    expect(cards[0].explanation).toBeUndefined();
  });

  it("(d) keeps explanation when one turn's several tool calls coalesce into one card (the common valuable case)", () => {
    const events = parseSessionJsonl(turn(
      "Reading the three config files.\nEach one configures a different environment.",
      { id: "r1", name: "Read", input: { file_path: "a.ts" } },
      { id: "r2", name: "Read", input: { file_path: "b.ts" } },
      { id: "r3", name: "Read", input: { file_path: "c.ts" } },
    )).events;
    const cards = deriveActivityFeed(events, context()).cards.filter((c) => c.kind === "investigate");
    expect(cards).toHaveLength(1);
    expect(cards[0].explanation).toBe("Each one configures a different environment.");
  });

  it("(e) attaches one turn's explanation to only the first of two genuinely different cards it produces", () => {
    const events = parseSessionJsonl(turn(
      "Reading the config, then fixing the typo it revealed.\nThe rest of the reasoning.",
      { id: "r1", name: "Read", input: { file_path: "a.ts" } },
      { id: "e1", name: "Edit", input: { file_path: "a.ts", old_string: "x", new_string: "y" } },
    )).events;
    const cards = deriveActivityFeed(events, context()).cards;
    const investigate = cards.find((c) => c.kind === "investigate");
    const implement = cards.find((c) => c.kind === "implement");
    expect(investigate?.explanation).toBe("The rest of the reasoning.");
    expect(implement?.explanation).toBeUndefined();
  });

  it("(f) splits prose/explanation at the first non-empty line, even when assistantText starts with blank lines", () => {
    const events = parseSessionJsonl(turn(
      "\n\nChecking the auth guard.\nMore detail follows.",
      { id: "r1", name: "Read", input: { file_path: "auth.ts" } },
    )).events;
    const card = deriveActivityFeed(events, context()).cards.find((c) => c.kind === "investigate");
    expect(card?.text).toBe("Checking the auth guard.");
    expect(card?.explanation).toBe("More detail follows.");
  });

  it("(g) clears explanation when a card mutates to blocker, and keeps it cleared through recovery", () => {
    const events = parseSessionJsonl([
      turn("Pushing the branch.\nThis should be a fast-forward.", { id: "p1", name: "Bash", input: { command: "git push" } }),
      result("p1", true),
    ].join("\n")).events;
    const blocked = deriveActivityFeed(events, context()).cards.find((c) => c.kind === "blocker");
    expect(blocked?.explanation).toBeUndefined();

    const recovered = parseSessionJsonl([
      turn("Pushing the branch.\nThis should be a fast-forward.", { id: "p1", name: "Bash", input: { command: "git push" } }),
      result("p1", true),
      turn(null, { id: "p2", name: "Bash", input: { command: "git push" } }),
      result("p2"),
    ].join("\n")).events;
    const recoveredCard = deriveActivityFeed(recovered, context()).cards.find((c) => /recovered/i.test(c.text));
    expect(recoveredCard?.explanation).toBeUndefined();
  });

  it("(i) counts a turn's SECOND card too (not just its explanation-receiving first), so a later turn coalescing only into that second card still clears it (External LLM Review, openai HIGH finding)", () => {
    const events = parseSessionJsonl([
      // Turn 1: two DIFFERENT cards from one turn — investigate (first,
      // gets the explanation) and implement (second, no explanation this
      // turn, but MUST still be counted as turn-1-touched).
      turn("Fixing the typo revealed by the guard.\nDetail one.",
        { id: "r1", name: "Read", input: { file_path: "a.ts" } },
        { id: "e1", name: "Edit", input: { file_path: "a.ts", old_string: "x", new_string: "y" } },
      ),
      // Turn 2: coalesces ONLY into the implement card (same headline,
      // still the last card) — this must bring its true turn-count to 2
      // and clear the explanation turn 2 tries to attach.
      turn("Fixing the typo revealed by the guard.\nDetail two, from turn two.",
        { id: "e2", name: "Edit", input: { file_path: "b.ts", old_string: "p", new_string: "q" } },
      ),
    ].join("\n")).events;
    const cards = deriveActivityFeed(events, context()).cards;
    const investigate = cards.find((c) => c.kind === "investigate");
    const implementCards = cards.filter((c) => c.kind === "implement");
    expect(implementCards).toHaveLength(1); // proves turn 2 really did coalesce into turn 1's card
    expect(investigate?.explanation).toBe("Detail one."); // untouched by turn 2, stays single-turn
    expect(implementCards[0].explanation).toBeUndefined(); // two turns touched it — must be cleared
  });

  it("(h) clears explanation when reconcileArtifactCards rewrites a review card's text from durable evidence", () => {
    const events = parseSessionJsonl(turn(
      "Reviewing the auth diff.\nLooks correct, no findings.",
      { id: "t1", name: "Task", input: { subagent_type: "code-reviewer", description: "Review the auth diff" } },
    )).events;
    const card = deriveActivityFeed(events, context("unknown", true)).cards.find((c) => c.kind === "review");
    expect(card?.text).toBe("The recorded review evidence is available.");
    expect(card?.explanation).toBeUndefined();
  });
});
