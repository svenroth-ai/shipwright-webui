import { toolUses, type ParsedEvent } from "../external/session-parser";
import type { MissionContext } from "./missionContextApi";
import { isCompactionMarker } from "./missionActivityFeedText";
import { buildUserReplyCard, extractTurnProse, flushPendingNarration, processTurnTools, type PendingNarration, type TurnToolsState } from "./missionActivityFeedTurn";
import { type WrittenTestFileTracker } from "./missionActivityFeedAuthoringTrack";
import { createCardAdder } from "./missionActivityFeedCardFactory";
import { clearMultiTurnExplanations, reconcileArtifactCards } from "./missionActivityFeedReconcile";
import { resolveToolResults, type PendingTool } from "./missionActivityFeedResolve";
import type { ActivityCard, ActivityFeed, ActivityKind } from "./missionActivityFeedTypes";

export type { ActivityCard, ActivityFeed, ActivityKind, ActivityQuestion } from "./missionActivityFeedTypes";

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
  let pendingNarration: PendingNarration | null = null;
  const add = createCardAdder(cards, cardEventCounts);
  for (const event of events) {
    if (isCompactionMarker(event)) {
      cards.push({ kind: "system", text: "Context automatically compacted.", commands: [], timestamp: event.timestamp });
    }
    if (event.kind === "user") {
      const replyCard = buildUserReplyCard(event);
      if (replyCard) cards.push(replyCard);
      const resolveState = { cards, testCards, pendingTools, unresolvedBlockers, unresolvedTest, awaitingTestResult, writtenTestFiles, authoringConsumedBy, failedWriteToolIds, restoreValidationPending, failedTestCards, toolCallIndex };
      unresolvedTest = resolveToolResults(event, resolveState);
      writtenTestFiles = resolveState.writtenTestFiles;
      continue;
    }
    if (event.kind !== "assistant") continue;
    const { isBannerTurn, ownProse, ownProseFull, ownProseRest, ownProseRestFull } = extractTurnProse(event);
    if (isBannerTurn) {
      // Guarded so a transcript segment that reprints the banner (a resumed
      // or replayed session) doesn't fabricate a SECOND "run started" card
      // (round-6 external review catch, glm, low).
      if (!cards.some((c) => c.kind === "goal")) {
        cards.push({ kind: "goal", text: "Started a /shipwright-iterate run.", commands: [], timestamp: event.timestamp });
      }
      // A run start invalidates anything carried over from before it — else
      // a combined banner+tool turn could let an unrelated EARLIER turn's
      // narration attach to THIS turn's tool card (code review catch, low).
      pendingNarration = null;
    }
    const tools = toolUses(event);
    if (tools.length === 0) {
      // A pure-narration turn — the common real-world shape. Its words are
      // not lost: they wait for the next tool-bearing turn (below), which is
      // where a human reader actually expects them to show up. If this is
      // the transcript's LAST turn and nothing tool-bearing ever follows
      // (a closing summary is exactly this shape), the flush after this loop
      // gives it a card of its own instead of dropping it silently
      // (reported: "Schluss ... wird nicht geprintet", same run as above).
      if (ownProse) pendingNarration = { prose: ownProse, proseFull: ownProseFull, proseRest: ownProseRest, proseRestFull: ownProseRestFull, staleness: 0, timestamp: event.timestamp };
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
    // The per-tool bucket-dispatch branch lives in `processTurnTools`
    // (missionActivityFeedTurn.ts, bloat-ceiling split — this reducer has no
    // spare budget of its own). `state` is the same mutable maps/arrays this
    // derivation already owns; `writtenTestFiles`/`toolCallIndex` are
    // reassigned (immutable-swap contract), so they are read back from the
    // outcome and written back below.
    const turnState: TurnToolsState = { cards, testCards, pendingTools, awaitingTestResult, authoringConsumedBy, cardTurnCounts, writtenTestFiles, toolCallIndex };
    const outcome = processTurnTools(tools, { context, ownProse, ownProseFull, prose, proseFull, proseRest, proseRestFull, timestamp: event.timestamp }, add, turnState);
    writtenTestFiles = outcome.writtenTestFiles;
    toolCallIndex = outcome.toolCallIndex;
    const ownProseGivenToTestCard = outcome.ownProseGivenToTestCard;
    const proseConsumedThisTurn = outcome.proseConsumedThisTurn;
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
      pendingNarration = { prose: ownProse, proseFull: ownProseFull, proseRest: ownProseRest, proseRestFull: ownProseRestFull, staleness: 0, timestamp: event.timestamp };
    } else if (pendingNarration) {
      pendingNarration = pendingNarration.staleness + 1 >= MAX_PENDING_NARRATION_CARRY
        ? null
        : { ...pendingNarration, staleness: pendingNarration.staleness + 1 };
    }
  }

  clearMultiTurnExplanations(cards, cardTurnCounts);
  // Skipped while genuinely still live (round-2 review catch, low): an
  // unconditional flush made trailing narration flash in as a `system` card
  // on one ~1s poll, then vanish into the NEXT tool card's headline on the
  // next real tool call — `null` context (transient initial load) still
  // flushes, so a closing summary is never lost.
  const flushed = context?.runLive === true ? null : flushPendingNarration(pendingNarration);
  if (flushed) cards.push(flushed);

  return reconcileArtifactCards(cards, context, testCards, unresolvedTest, awaitingTestResult);
}
