/**
 * Per-turn extraction helpers for `missionActivityFeed.ts`'s reducer: the
 * intro-banner check + prose override for one ASSISTANT turn, and the
 * per-tool bucket-dispatch loop. Split into its own file (bloat-ceiling —
 * the reducer itself has no budget left) rather than folded into
 * `missionActivityFeedText.ts`, which is at the same limit
 * (iterate-2026-09-20-mission-feed-transcript-fidelity). `humanText()` /
 * `buildUserReplyCard()` — the human USER-turn half of this split — live in
 * the sibling `missionActivityFeedHumanReply.ts` (same run, second split
 * once this file re-crossed the limit on its own) and are re-exported below
 * so existing importers of this file are unaffected. */
import { askUserQuestionSummary, assistantText, type AssistantEvent } from "../external/session-parser";
import { classifyToolBucket, containsIterateBanner, reviewerDisplayName, stripIterateBanner } from "./missionActivityFeedClassify";
import { attachCommand, commandDetail, commandLabel, commandLabelFull, proseFromLines } from "./missionActivityFeedText";
import type { ActivityCard, PendingTool } from "./missionActivityFeedTypes";
import type { CardAdder } from "./missionActivityFeedCardFactory";
import { isTestFilePath, sameTestFilePath, testInvocationTargetPath, trackWrittenTestFile, type WrittenTestFileTracker } from "./missionActivityFeedAuthoringTrack";
import type { ArtifactKind, MissionContext } from "./missionContextApi";

export { buildUserReplyCard, humanText } from "./missionActivityFeedHumanReply";

function artifact(context: MissionContext | null, kind: ArtifactKind): boolean {
  return context?.artifacts.some((item) => item.kind === kind && item.state === "available") ?? false;
}

export interface TurnProse {
  isBannerTurn: boolean;
  ownProse: string;
  ownProseFull: string;
  ownProseRest: string;
  ownProseRestFull: string;
}

export interface PendingNarration {
  prose: string;
  proseFull: string;
  proseRest: string;
  proseRestFull: string;
  staleness: number;
  timestamp?: string;
}

/** A still-waiting `pendingNarration` with no later tool-bearing turn left to
 * consume it would otherwise vanish with no card at all — the exact shape of
 * a closing summary (SKILL.md's F12 prints its own text, then the run simply
 * ends). Flushed as its own `system`-kind card (a plain note, no kind
 * label/pill to imply a category it doesn't have) rather than dropped
 * silently (reported: "Schluss ... wird nicht geprintet",
 * iterate-2026-09-20-mission-feed-transcript-fidelity). The caller must push
 * this AFTER `clearMultiTurnExplanations`, not before — that pass would
 * otherwise strip the returned card's `explanation` right back off, since it
 * never ran through `cardTurnCounts` at all. */
export function flushPendingNarration(pendingNarration: PendingNarration | null): ActivityCard | null {
  if (!pendingNarration) return null;
  const { prose, proseFull, proseRest, proseRestFull, timestamp } = pendingNarration;
  return {
    kind: "system",
    text: prose,
    textFull: proseFull.length > prose.length ? proseFull : undefined,
    explanation: proseRest || undefined,
    explanationFull: proseRest && proseRestFull.length > proseRest.length ? proseRestFull : undefined,
    commands: [],
    timestamp,
  };
}

/** One assistant turn's banner status + own words. Checked BEFORE the turn's
 * prose is even extracted, and regardless of whether it also calls a tool —
 * the intro banner does not always land as a pure-narration turn on its own
 * (SKILL.md's very next instruction is a tool call, and a real autonomous
 * turn can combine both). A narrower "pure-narration only" check left the
 * combined shape falling through to plain `extractOwnProse`, which reads a
 * turn's FIRST NON-EMPTY line — the banner's `====` border or its own text
 * line — and hung it on whatever unrelated tool call the turn happened to
 * make, so the real start moment never appeared as its own card either way
 * (reported: "Start des Iterate wird nicht geprintet",
 * iterate-2026-09-20-mission-feed-transcript-fidelity). Only the fixed
 * banner BLOCK itself is stripped before prose extraction runs — not the
 * whole turn's text (external code review catch, medium: an earlier version
 * discarded ALL of a banner turn's prose unconditionally, so a turn that
 * combined the banner with genuine narration lost that narration too, and
 * via the empty-tool-only-card filter could then drop its own tool card
 * entirely). `stripIterateBanner` bounds itself to the banner's own known
 * lines, so real narration before or after the block survives untouched. */
export function extractTurnProse(event: AssistantEvent): TurnProse {
  const lines = assistantText(event).split("\n");
  const isBannerTurn = containsIterateBanner(lines);
  const { ownProse, ownProseFull, ownProseRest, ownProseRestFull } = proseFromLines(stripIterateBanner(lines));
  return { isBannerTurn, ownProse, ownProseFull, ownProseRest, ownProseRestFull };
}

/** The mutable per-derivation maps/arrays `processTurnTools` reads and
 * updates — the same objects `deriveActivityFeed` owns for the lifetime of
 * one derivation, threaded in rather than module state (same contract as
 * `ResolveState` in `missionActivityFeedTypes.ts`). `writtenTestFiles` and
 * `toolCallIndex` are reassigned (immutable-swap arrays / a counter), so the
 * caller must read both back from `TurnToolsOutcome`; every other field is
 * mutated in place (push/set/add) and needs no return. */
export interface TurnToolsState {
  cards: ActivityCard[];
  testCards: ActivityCard[];
  pendingTools: Map<string, PendingTool>;
  awaitingTestResult: Set<ActivityCard>;
  authoringConsumedBy: Map<string, ActivityCard>;
  cardTurnCounts: Map<ActivityCard, number>;
  writtenTestFiles: readonly WrittenTestFileTracker[];
  toolCallIndex: number;
}

export interface TurnToolsOutcome {
  writtenTestFiles: readonly WrittenTestFileTracker[];
  toolCallIndex: number;
  /** Set true when a `test`-bucket card took THIS turn's own words directly
   * — see the caller's `pendingNarration` bookkeeping, which must treat this
   * turn as neither consuming nor replacing an older still-waiting value. */
  ownProseGivenToTestCard: boolean;
  /** Set true when at least one review/spec/investigate/implement card
   * consumed this turn's prose — tells the caller to clear `pendingNarration`
   * rather than let it age. */
  proseConsumedThisTurn: boolean;
}

/** One assistant turn's tool-call loop, extracted verbatim (bloat-ceiling
 * split, iterate-2026-09-20-mission-feed-transcript-fidelity) from
 * `deriveActivityFeed`'s own per-turn `for (const tool of tools)` body — pure
 * state mutation + reassignment via `state`, no behavior change. Every
 * ordering comment below is load-bearing exactly as it was in the reducer:
 * `writtenTestFiles`/`toolCallIndex` are tracked/aged strictly AFTER a tool's
 * own consumption check, never before (moving either shifts the aging window
 * silently — see `missionActivityFeedRestoreAging.test.ts`). */
export function processTurnTools(
  tools: readonly { id: string; name: string; input: unknown }[],
  turn: {
    context: MissionContext | null;
    ownProse: string;
    ownProseFull: string;
    prose: string;
    proseFull: string;
    proseRest: string;
    proseRestFull: string;
    timestamp?: string;
  },
  add: CardAdder,
  state: TurnToolsState,
): TurnToolsOutcome {
  const { context, ownProse, ownProseFull, prose, proseFull, proseRest, proseRestFull, timestamp } = turn;
  const { cards, testCards, pendingTools, awaitingTestResult, authoringConsumedBy, cardTurnCounts } = state;
  let writtenTestFiles = state.writtenTestFiles;
  let toolCallIndex = state.toolCallIndex;
  let ownProseGivenToTestCard = false;
  let proseConsumedThisTurn = false;
  // At most ONE card per turn gets this turn's explanation — a turn whose
  // tool calls land in two genuinely different (non-coalescing) cards
  // does not duplicate the same words onto both (External LLM Review,
  // deepseek). Declared once per assistant event/turn.
  let explanationAttachedThisTurn = false;
  // Every DISTINCT card this turn touches must be counted, not only the
  // first (explanation-receiving) one — a card that was this turn's
  // SECOND card (so never got an explanation write here) can still be
  // the FIRST card another, later turn happens to coalesce into, and
  // that later turn's own `!explanationAttachedThisTurn` write would
  // have started `cardTurnCounts` from zero for it, undercounting a
  // genuinely two-turn card down to 1 (External LLM Review, openai HIGH
  // finding — the provenance count and the explanation-attach gate are
  // two different questions and must not share one guard).
  const cardsTouchedThisTurn = new Set<ActivityCard>();
  for (const tool of tools) {
    const input = tool.input as Record<string, unknown> | undefined;
    const shell = typeof input?.command === "string" ? input.command : "";
    const background = input?.run_in_background === true || input?.background === true;
    const bucket = classifyToolBucket(tool.name, input, shell);
    const label = commandLabel(tool.name, tool.input);
    const labelFull = commandLabelFull(tool.name, tool.input);
    const commandKey = `${tool.name}\u0000${commandDetail(tool.input)}`;
    if (bucket === "test") {
      // No standard sentence here either (iterate-2026-09-05-mission-feed-ux-
      // gaps — the user's own quoted example was literally "This test command
      // completed."): only THIS turn's own words, never carried
      // pendingNarration, which must stay free to reach a LATER real turn past
      // this test call (narration-bridging invariant above). The pill + chip
      // carry the outcome; resolveToolResults no longer overwrites this.
      // Deliberately NOT routed through `add()` (32nd-round catch, glm, medium,
      // declined) — a "test" card is always fresh, one per tool_use, so a second
      // run of the SAME file can never coalesce into the first (already-
      // `authoringRun`) card; combined with the consumed tracker entry being
      // removed below, its own lookup finds nothing. 67th (openai, medium),
      // DECLINED as a misread — trace in `…CommandCount.test.ts`.
      const card: ActivityCard = {
        kind: "test",
        text: ownProse,
        commands: [],
        artifact: artifact(context, "tests") ? "tests" : undefined,
        timestamp,
      };
      if (ownProseFull && ownProseFull.length > ownProse.length) card.textFull = ownProseFull;
      // A TDD authoring run when this invocation's own single target
      // (see `testInvocationTargetPath`'s doc comment) plausibly names ANY
      // currently-tracked just-written/edited file — only the matching
      // entry is consumed, so an unrelated tracked file survives for its
      // own later run.
      const target = testInvocationTargetPath(shell);
      const matchIndex = target ? writtenTestFiles.findIndex((entry) => sameTestFilePath(target, entry.path)) : -1;
      if (matchIndex !== -1) {
        card.authoringRun = true;
        authoringConsumedBy.set(writtenTestFiles[matchIndex].sourceToolId, card);
        writtenTestFiles = writtenTestFiles.filter((_, i) => i !== matchIndex);
      }
      attachCommand(card, label, labelFull);
      cards.push(card);
      testCards.push(card);
      awaitingTestResult.add(card);
      pendingTools.set(tool.id, { bucket, card, commandKey, label, full: labelFull, background });
      if (ownProse) ownProseGivenToTestCard = true;
    } else if (bucket === "user-input") {
      const card = add("user-input", "A user decision is needed before work can continue.", label, undefined, false, timestamp, undefined, labelFull);
      // Always set `card.question` — even the `fallback` shape carries a
      // real (if generic) placeholder question. Gating this on
      // `!summary.fallback` (code review catch) silently dropped the
      // terminal CTA for a genuinely unparseable AskUserQuestion payload,
      // since the whole question block — CTA included — renders only when
      // `card.question` is truthy.
      const summary = askUserQuestionSummary(tool.input);
      card.question = { text: summary.question, options: summary.options, resolved: false };
      pendingTools.set(tool.id, { bucket, card, commandKey, label, full: labelFull, background });
    } else {
      // No more generic-bucket-sentence fallback (`GENERIC_TEXT`): the
      // user already sees the tool call in their own terminal, and a
      // templated "The implementation was updated in compact steps."
      // added no information of its own — an empty `text` here means the
      // card renders only its command chip(s)
      // (iterate-2026-09-05-mission-feed-ux-gaps).
      // A review-bucket `Task` whose turn wrote no words of its own still
      // gets a real headline naming which reviewer was spawned, not an
      // empty card carrying only its command chip — otherwise the ONLY
      // visible trace of a reviewer starting was that chip's truncated
      // label, and the feed jumped straight to whatever LATER turn's
      // verdict sentence happened to land on an unrelated card (reported:
      // "steht nichts, dass die Reviewer was starten",
      // iterate-2026-09-20-mission-feed-transcript-fidelity).
      const reviewerSpawn = bucket === "review" && !prose ? reviewerDisplayName(tool.name, input) : null;
      const reviewProse = reviewerSpawn ? `Spawned ${reviewerSpawn} to review the change.` : prose;
      const card = bucket === "review" ? add("review", reviewProse, label, artifact(context, "review") ? "review" : undefined, true, timestamp, reviewerSpawn ? undefined : proseFull, labelFull)
        : bucket === "spec" ? add("spec", prose, label, artifact(context, "spec") ? "spec" : undefined, true, timestamp, proseFull, labelFull)
        : bucket === "investigate" ? add("investigate", prose, label, undefined, true, timestamp, proseFull, labelFull)
        : add("implement", prose, label, undefined, true, timestamp, proseFull, labelFull);
      proseConsumedThisTurn = true;
      if (!cardsTouchedThisTurn.has(card)) {
        cardsTouchedThisTurn.add(card);
        cardTurnCounts.set(card, (cardTurnCounts.get(card) ?? 0) + 1);
      }
      if (!explanationAttachedThisTurn) {
        if (proseRest) {
          card.explanation = proseRest;
          if (proseRestFull && proseRestFull.length > proseRest.length) card.explanationFull = proseRestFull;
        }
        explanationAttachedThisTurn = true;
      }
      // Lets a FAILED Write's optimistic tracker entry be rolled back once
      // its own tool_result is known — see `PendingTool.writtenTestFile` /
      // `.writtenTestFileRestore`'s doc comments. Write-only, matching
      // `trackWrittenTestFile` (28th-round catch, openai, medium): Edit no
      // longer touches the tracker (27th-round fix), so "restoring" on a
      // failed Edit duplicated the still-present original entry.
      const writtenTestFile = tool.name === "Write" && typeof input?.file_path === "string" && isTestFilePath(input.file_path)
        ? input.file_path : undefined;
      const priorEntry = writtenTestFile ? writtenTestFiles.find((entry) => sameTestFilePath(entry.path, writtenTestFile)) : undefined;
      const writtenTestFileRestore = priorEntry ? { path: priorEntry.path, staleness: priorEntry.staleness + 1, sourceToolId: priorEntry.sourceToolId } : undefined;
      pendingTools.set(tool.id, { bucket, card, commandKey, label, full: labelFull, background, writtenTestFile, writtenTestFileRestore, writtenTestFileRestoreAt: toolCallIndex });
    }
    // Track/age AFTER this tool's own consumption check above, so a call
    // that just consumed an entry doesn't also age it (double-counting).
    // 72nd (glm, low), FRAGILITY NOTE, no change: `agedRestore`'s arithmetic
    // assumes exactly this placement - one increment per tool call, after
    // consumption. Moving either line shifts the window silently, and
    // `missionActivityFeedRestoreAging.test.ts` is the guard that catches it.
    writtenTestFiles = trackWrittenTestFile(writtenTestFiles, tool.name, input, tool.id);
    toolCallIndex += 1;
  }
  return { writtenTestFiles, toolCallIndex, ownProseGivenToTestCard, proseConsumedThisTurn };
}
