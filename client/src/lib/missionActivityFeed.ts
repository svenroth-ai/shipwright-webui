import { askUserQuestionSummary, assistantText, toolUses, type ParsedEvent } from "../external/session-parser";
import type { ArtifactKind, MissionContext } from "./missionContextApi";
import { attachCommand, commandDetail, commandLabel, commandLabelFull, extractOwnProse, isCompactionMarker } from "./missionActivityFeedText";
import { classifyToolBucket, containsIterateBanner } from "./missionActivityFeedClassify";
import { isTestFilePath, sameTestFilePath, testInvocationTargetPath, trackWrittenTestFile, type WrittenTestFileTracker } from "./missionActivityFeedAuthoringTrack";
import { createCardAdder } from "./missionActivityFeedCardFactory";
import { clearMultiTurnExplanations, reconcileArtifactCards } from "./missionActivityFeedReconcile";
import { resolveToolResults, type PendingTool } from "./missionActivityFeedResolve";
import type { ActivityCard, ActivityFeed, ActivityKind } from "./missionActivityFeedTypes";

export type { ActivityCard, ActivityFeed, ActivityKind, ActivityQuestion } from "./missionActivityFeedTypes";

function artifact(context: MissionContext | null, kind: ArtifactKind): boolean {
  return context?.artifacts.some((item) => item.kind === kind && item.state === "available") ?? false;
}

/** `pendingNarration` bridges up to `MAX_PENDING_NARRATION_CARRY - 1`
 * consecutive non-consuming (`test`/`user-input`-only) turns before being
 * dropped instead of carried further (doubt-review catch — see the comment on
 * `pendingNarration` in `deriveActivityFeed`). Set to `4` so a realistic
 * 3-retry test-until-green burst is genuinely bridged — increment-then-check
 * happens in the same turn that drops, so the bridged count is one less. */
const MAX_PENDING_NARRATION_CARRY = 4;

/** Typed-event reducer for the calm Mission activity feed. `MissionContext`
 * stays the SOLE source for any gate verdict — raw `toolResults()` content is
 * permitted only as bounded, sanitized `detail`/`question.answer` text on
 * `blocker`/`test`/`user-input` cards (iterate-2026-08-20-mission-feed-
 * content). Per-card text prefers the turn's own `assistantText()`
 * explanation over the generic bucket sentence when Claude wrote one
 * (iterate-2026-08-13-mission-mobile-visual), rendered through the same safe
 * markdown/text path as the rest of the transcript. A card built from
 * exactly one assistant turn additionally carries that turn's own words
 * beyond its first line in `card.explanation` (iterate-2026-08-25-mission-
 * feed-progress-narration). */
export function deriveActivityFeed(
  events: readonly ParsedEvent[],
  context: MissionContext | null,
): ActivityFeed {
  const cards: ActivityCard[] = [];
  let unresolvedTest: ActivityCard | null = null;
  const testCards: ActivityCard[] = [];
  const unresolvedBlockers = new Map<string, { card: ActivityCard; bucket: ActivityKind }>();
  const pendingTools = new Map<string, PendingTool>();
  // Real per-card event count — deliberately NOT `commands.length`, which
  // dedupes by label and can under-count two events sharing one.
  const cardEventCounts = new Map<ActivityCard, number>();
  // How many distinct ASSISTANT TURNS contributed to a card — deliberately
  // separate from `cardEventCounts` above (which counts tool-use EVENTS). A
  // card is misattributed only when MORE THAN ONE turn's words land on it; one
  // turn issuing several tool calls that coalesce into one card is not
  // misattribution and must keep its explanation (iterate-2026-08-25-mission-
  // feed-progress-narration, Internal Plan Review HIGH finding —
  // `cardEventCounts === 1` alone wrongly suppressed that common case).
  const cardTurnCounts = new Map<ActivityCard, number>();
  // Still awaiting ANY result — see `ResolveState.awaitingTestResult`.
  const awaitingTestResult = new Set<ActivityCard>();
  // Recently `Write`-ten test-file paths — a bounded SET (a TDD burst writes
  // several before running any), each consumed on its own matching test
  // invocation. See `trackWrittenTestFile`.
  let writtenTestFiles: readonly WrittenTestFileTracker[] = [];
  // Monotonic tool-call clock — see `PendingTool.writtenTestFileRestoreAt`.
  let toolCallIndex = 0;
  // Which test CARD (if any) consumed a given Write/Edit's tracker entry,
  // keyed by that Write/Edit's own tool_use id — lets resolve.ts un-stamp
  // `authoringRun` if that SAME Write/Edit's own result later turns out to
  // be an error (see `WrittenTestFileTracker.sourceToolId`'s doc comment).
  const authoringConsumedBy = new Map<string, ActivityCard>();
  // See `ResolveState.failedWriteToolIds`/`.restoreValidationPending`/`.failedTestCards` — mutated in place like `authoringConsumedBy`, no reassignment-back needed.
  const failedWriteToolIds = new Set<string>();
  const restoreValidationPending = new Map<string, ActivityCard>();
  const failedTestCards = new Set<ActivityCard>();
  // A real `/shipwright-iterate` autonomous turn NEVER combines narration
  // text and a tool call in the same JSONL event, so `pendingNarration`
  // carries one narration-only turn's words forward to the VERY NEXT
  // tool-bearing turn — cleared once consumed (or overwritten by a later
  // narration-only turn), so each turn's words land on at most one card. A
  // `test`/`user-input`-only turn never consumes it, so it survives past one
  // to reach a LATER real turn (code review catch) — but left unbounded that
  // survival can misattribute stale words once several pile up (doubt-review
  // catch); `staleness` bounds it via `MAX_PENDING_NARRATION_CARRY` above.
  let pendingNarration: { prose: string; proseFull: string; proseRest: string; proseRestFull: string; staleness: number } | null = null;
  const add = createCardAdder(cards, cardEventCounts);
  for (const event of events) {
    if (isCompactionMarker(event)) {
      cards.push({ kind: "system", text: "Context automatically compacted.", commands: [], timestamp: event.timestamp });
    }
    if (event.kind === "user") {
      const resolveState = { cards, testCards, pendingTools, unresolvedBlockers, unresolvedTest, awaitingTestResult, writtenTestFiles, authoringConsumedBy, failedWriteToolIds, restoreValidationPending, failedTestCards, toolCallIndex };
      unresolvedTest = resolveToolResults(event, resolveState);
      writtenTestFiles = resolveState.writtenTestFiles;
      continue;
    }
    if (event.kind !== "assistant") continue;
    // This turn's own words (when Claude wrote any alongside its tool
    // calls), replacing the generic bucket sentence below when present —
    // see `extractOwnProse`'s doc comment (missionActivityFeedText.ts).
    const { ownProse, ownProseFull, ownProseRest, ownProseRestFull } = extractOwnProse(event);
    const assistantLines = assistantText(event).split("\n");
    const tools = toolUses(event);
    if (tools.length === 0) {
      // A pure-narration turn — the common real-world shape. Its words are
      // not lost: they wait for the next tool-bearing turn (below), which is
      // where a human reader actually expects them to show up.
      //
      // The one exception: the /shipwright-iterate intro banner is exactly
      // this shape (SKILL.md prints it with no tool call), so left to the
      // rule above it never surfaced as its own moment — it just became
      // whatever generic sentence the NEXT tool-bearing turn's bucket picked
      // (iterate-2026-08-31-mission-feed-gaps). Give it its own card instead
      // of relying on the narration-carry heuristic to make it visible.
      const isBannerTurn = containsIterateBanner(assistantLines);
      if (isBannerTurn) {
        cards.push({
          kind: "goal",
          text: "Started a /shipwright-iterate run.",
          commands: [],
          timestamp: event.timestamp,
        });
      }
      // The banner turn's own "prose" is its `====` border line, not real
      // explanatory narration — it must not become the next tool-bearing
      // turn's headline (the goal card above already carries the meaning).
      if (ownProse && !isBannerTurn) pendingNarration = { prose: ownProse, proseFull: ownProseFull, proseRest: ownProseRest, proseRestFull: ownProseRestFull, staleness: 0 };
      continue;
    }
    // This turn called tools. Prefer ITS OWN text when it wrote any (the
    // rarer same-turn shape, still handled byte-identically to before) —
    // otherwise fall back to the immediately preceding pure-narration turn's
    // words, which is the shape a real autonomous session actually produces.
    const prose = ownProse || pendingNarration?.prose || "";
    const proseFull = ownProse ? ownProseFull : (pendingNarration?.proseFull ?? "");
    const proseRest = ownProse ? ownProseRest : (pendingNarration?.proseRest ?? "");
    const proseRestFull = ownProse ? ownProseRestFull : (pendingNarration?.proseRestFull ?? "");
    // Cleared below only once actually consumed — NOT here. A turn whose
    // tools are entirely `test`/`user-input` never reads `prose`/`proseRest`
    // (neither bucket's branch below references them), so nulling
    // unconditionally on any tool-bearing turn silently dropped narration
    // that was headed for a LATER real (review/spec/investigate/implement)
    // turn past an intervening test run or user prompt (code review catch,
    // iterate-2026-08-27-mission-feed-narration-scroll).
    let proseConsumedThisTurn = false;
    // Set instead of `proseConsumedThisTurn` when a test-bucket card takes
    // THIS turn's own words directly (spec-reviewer catch, iterate-2026-09-
    // 05-mission-feed-ux-gaps): a test card is not a "real" (review/spec/
    // investigate/implement) card, so it must not flip this turn into the
    // consuming case below and null out an OLDER, still-waiting
    // `pendingNarration` meant for a genuinely later real turn — that older
    // value must keep aging (staleness+1) exactly as it would if this test
    // turn had written no words of its own at all. It also must not become
    // the NEW `pendingNarration` itself: it already has a home (the test
    // card), and carrying it forward too would let the same sentence show
    // up twice.
    let ownProseGivenToTestCard = false;
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
          timestamp: event.timestamp,
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
        const card = add("user-input", "A user decision is needed before work can continue.", label, undefined, false, event.timestamp, undefined, labelFull);
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
        const card = bucket === "review" ? add("review", prose, label, artifact(context, "review") ? "review" : undefined, true, event.timestamp, proseFull, labelFull)
          : bucket === "spec" ? add("spec", prose, label, artifact(context, "spec") ? "spec" : undefined, true, event.timestamp, proseFull, labelFull)
          : bucket === "investigate" ? add("investigate", prose, label, undefined, true, event.timestamp, proseFull, labelFull)
          : add("implement", prose, label, undefined, true, event.timestamp, proseFull, labelFull);
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
    // Clear only once actually used (an eligible bucket read it this turn),
    // or once superseded by this turn's OWN text — a pure test/user-input
    // turn with no text of its own leaves `pendingNarration` untouched so it
    // still reaches a later real turn. A pure user-input turn that DID write
    // its own text becomes the new pending value (most-recent-wins, same as
    // two consecutive narration-only turns) — a test turn that gave its own
    // words to its OWN card instead (`ownProseGivenToTestCard`) does neither:
    // it must not replace an older still-waiting value (that value's own
    // later real turn hasn't arrived yet) and must not become a new one
    // itself (it already has a home, so carrying it forward would just
    // duplicate it onto whatever card comes next). Past
    // `MAX_PENDING_NARRATION_CARRY` consecutive non-consuming turns it is
    // dropped instead of carried further (doubt-review catch — see the
    // comment on `pendingNarration`'s declaration).
    if (proseConsumedThisTurn) {
      pendingNarration = null;
    } else if (ownProse && !ownProseGivenToTestCard) {
      pendingNarration = { prose: ownProse, proseFull: ownProseFull, proseRest: ownProseRest, proseRestFull: ownProseRestFull, staleness: 0 };
    } else if (pendingNarration) {
      pendingNarration = pendingNarration.staleness + 1 >= MAX_PENDING_NARRATION_CARRY
        ? null
        : { ...pendingNarration, staleness: pendingNarration.staleness + 1 };
    }
  }

  clearMultiTurnExplanations(cards, cardTurnCounts);

  return reconcileArtifactCards(cards, context, testCards, unresolvedTest, awaitingTestResult);
}
