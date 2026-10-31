/**
 * Folds the feed's bare evidence cards ("Open tests", "Open requirement",
 * "Open decisions", "Open review", "Open commit") into ONE "Run result" item
 * (campaign mission-desktop-style-v2 V2, README row 5). Pure render-time
 * grouping — the derived cards themselves are untouched, so every consumer
 * of `deriveActivityFeed` keeps its contract.
 *
 * A card folds in only when it carries nothing but its evidence link: it has
 * an artifact, no tool commands, no raw output, no question and no
 * explanation. A card with real narration or output stays a normal card with
 * its own link, so no information is lost by grouping.
 */
import type { ActivityCard } from "./missionActivityFeedTypes";

export type ResultArtifact = "tests" | "spec" | "requirement" | "decisions" | "review";

/** Row order of the result card; the commit/phase delivery card always renders last, apart. */
const ROW_ORDER: readonly string[] = ["tests", "spec", "requirement", "decisions", "review"];

export type FeedItem =
  | { type: "card"; card: ActivityCard; index: number }
  | { type: "result"; rows: ActivityCard[]; delivery: ActivityCard | null };

function isEvidenceOnly(card: ActivityCard, isLastDelivery: boolean): boolean {
  if (!card.artifact) return false;
  if (card.commands.length > 0 || card.detail || card.question || card.explanation) return false;
  // Only the LAST delivery is the run result's closing row; an earlier one (e.g. a phase) stays a normal card.
  if (card.kind === "delivery") return isLastDelivery && (card.artifact === "commit" || card.artifact === "phase");
  // A truncated statement (textFull) has no expansion control in a row - keep it a normal card.
  if (card.textFull) return false;
  return (card.kind === "test" || card.kind === "spec" || card.kind === "review") && ROW_ORDER.includes(card.artifact);
}

export function groupRunResult(cards: readonly ActivityCard[]): FeedItem[] {
  const folded = new Set<number>();
  const lastDelivery = cards.map((c) => c.kind).lastIndexOf("delivery");
  cards.forEach((card, i) => { if (isEvidenceOnly(card, i === lastDelivery)) folded.add(i); });
  // Only the LATEST card per artifact (over ALL cards, folded or not) may join the result, and only if it can
  // fold itself: a superseded failing run stays where it happened, and a newer card that carries its own
  // commands/detail keeps the artifact out of the result - never two competing verdicts for one target.
  const latestByArtifact = new Map<string, number>();
  cards.forEach((c, i) => { if (c.artifact && c.kind !== "delivery") latestByArtifact.set(c.artifact, i); });
  for (const i of [...folded]) {
    if (cards[i].kind !== "delivery" && latestByArtifact.get(cards[i].artifact as string) !== i) folded.delete(i);
  }
  if (folded.size === 0) return cards.map((card, index) => ({ type: "card", card, index }));
  const members = [...folded].map((i) => cards[i]);
  const rows = members
    .filter((c) => c.kind !== "delivery")
    .sort((a, b) => ROW_ORDER.indexOf(a.artifact as string) - ROW_ORDER.indexOf(b.artifact as string));
  const delivery = [...members].reverse().find((c) => c.kind === "delivery") ?? null;
  // The group sits where the LAST folded card was, i.e. after the narrative it summarises.
  const anchor = Math.max(...folded);
  const items: FeedItem[] = [];
  cards.forEach((card, index) => {
    if (index === anchor) items.push({ type: "result", rows, delivery });
    else if (!folded.has(index)) items.push({ type: "card", card, index });
  });
  return items;
}

const TITLES: Record<string, string> = { tests: "Tests", spec: "Specification", requirement: "Requirements", decisions: "Decisions", review: "Review", commit: "Commit", phase: "Phase" };
const BUTTONS: Record<string, string> = { tests: "Tests", spec: "Spec", requirement: "Requirement", decisions: "Decision", review: "Review", commit: "Commit", phase: "Phase" };

export function resultRowTitle(artifact: string): string { return TITLES[artifact] ?? artifact; }
export function resultButtonLabel(artifact: string): string { return BUTTONS[artifact] ?? artifact; }
