import { askUserQuestionSummary, assistantText, toolUses, type ParsedEvent } from "../external/session-parser";
import type { ArtifactKind, MissionContext } from "./missionContextApi";
import { attachCommand, clean, cleanFull, commandDetail, commandLabel, commandLabelFull, explanationExcerpt, isCompactionMarker } from "./missionActivityFeedText";
import { containsIterateBanner, isReviewInvocation, isReviewTask, isTestInvocation } from "./missionActivityFeedClassify";
import { createCardAdder } from "./missionActivityFeedCardFactory";
import { reconcileArtifactCards } from "./missionActivityFeedReconcile";
import { resolveToolResults, type PendingTool } from "./missionActivityFeedResolve";
import type { ActivityCard, ActivityFeed, ActivityKind } from "./missionActivityFeedTypes";

export type { ActivityCard, ActivityFeed, ActivityKind, ActivityQuestion } from "./missionActivityFeedTypes";

function artifact(context: MissionContext | null, kind: ArtifactKind): boolean {
  return context?.artifacts.some((item) => item.kind === kind && item.state === "available") ?? false;
}

/** `pendingNarration` bridges up to `MAX_PENDING_NARRATION_CARRY - 1`
 * consecutive non-consuming (`test`/`user-input`-only) turns before being
 * dropped instead of carried further (doubt-review catch,
 * iterate-2026-08-27-mission-feed-narration-scroll — see the comment on
 * `pendingNarration` in `deriveActivityFeed`). Set to `4` so a realistic
 * 3-retry test-until-green burst is genuinely bridged, not just 2 of its
 * 3 turns — a second doubt-review pass found the increment-then-check in
 * the same non-consuming turn drops on the Nth turn, not after it, so the
 * bridged count is one less than this constant's raw value. */
const MAX_PENDING_NARRATION_CARRY = 4;

/** Typed-event reducer for the calm Mission activity feed. `MissionContext`
 * stays the SOLE source for any gate verdict (tests pass/fail, artifact
 * availability) — raw `toolResults()` content is permitted only as bounded,
 * sanitized `detail`/`question.answer` text on `blocker`/`test`/`user-input`
 * cards (iterate-2026-08-20-mission-feed-content, narrowing the prior
 * "no raw tool output" constraint). Per-card text prefers the turn's own
 * `assistantText()` explanation over the generic bucket sentence when Claude
 * wrote one (iterate-2026-08-13-mission-mobile-visual) — rendered by the
 * caller through the same safe markdown/text path as the rest of the
 * transcript (`MarkdownChunk` for prose, a literal text node for raw
 * excerpts), never raw HTML, since it is assistant/tool-influenced content.
 * A card built from exactly one assistant turn additionally carries that
 * turn's own words beyond its first line in `card.explanation`
 * (iterate-2026-08-25-mission-feed-progress-narration) — plain text, never
 * markdown, rendered through the same style as an answered question. */
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
  // dedupes by label string and can under-count when two distinct events
  // produce the same label (e.g. two identical `Read` calls). A plain Map,
  // not a WeakMap: this only lives for one `deriveActivityFeed()` call, so
  // there is no retention concern a weak reference would address.
  const cardEventCounts = new Map<ActivityCard, number>();
  // How many distinct ASSISTANT TURNS contributed to a card — deliberately
  // separate from `cardEventCounts` above (which counts tool-use EVENTS). A
  // card is misattributed only when MORE THAN ONE turn's words land on it;
  // one turn issuing several tool calls that coalesce into a single card is
  // not misattribution and must keep its explanation (iterate-2026-08-25-
  // mission-feed-progress-narration, Internal Plan Review HIGH finding —
  // `cardEventCounts === 1` alone would have wrongly suppressed that common,
  // valuable case).
  const cardTurnCounts = new Map<ActivityCard, number>();
  // Test cards genuinely still awaiting ANY result — see `ResolveState.
  // awaitingTestResult`'s doc comment (missionActivityFeedResolve.ts).
  const awaitingTestResult = new Set<ActivityCard>();
  // A real `/shipwright-iterate` autonomous turn NEVER combines narration
  // text and a tool call in the same JSONL event — Claude always splits them
  // into two consecutive assistant events (a pure-narration turn, then a
  // pure-tool-call turn; confirmed 0 combined turns across independent real
  // sessions). The original design assumed they co-occurred, so every
  // narration-only turn's already-computed `prose`/`proseRest` was silently
  // discarded: the card-creation loop below runs only `for (const tool of
  // toolUses(event))`, which iterates zero times for a text-only turn.
  // `pendingNarration` carries one turn's words forward to the VERY NEXT
  // tool-bearing turn, where they attach in practice — cleared the moment
  // they are consumed (or overwritten by a later narration-only turn), so
  // each turn's words can land on at most one card, matching the existing
  // one-turn-per-explanation invariant below.
  //
  // A `test`/`user-input`-only turn never consumes it (neither bucket reads
  // `prose`/`proseRest`), so it survives past one of those to reach a LATER
  // real turn instead of being silently dropped (code review catch,
  // iterate-2026-08-27-mission-feed-narration-scroll). Left wholly unbounded
  // that same survival can misattribute stale words to unrelated later work
  // once several non-consuming turns pile up — e.g. narration, several test
  // retries, then a turn that quietly pivots to something else with no
  // narration of its own (doubt-review catch, same iterate). `staleness`
  // counts consecutive non-consuming turns it has survived; past
  // `MAX_PENDING_NARRATION_CARRY` it is dropped rather than carried
  // further — a card with no narration behind it simply has no headline
  // text (iterate-2026-09-05-mission-feed-ux-gaps), which is preferable to
  // a confident-looking but wrong one. The cap is generous enough for a
  // realistic retry-until-green burst (a handful of `test` turns) or a
  // single clarifying question, not for an open-ended run of unrelated
  // intervening turns.
  let pendingNarration: { prose: string; proseFull: string; proseRest: string; proseRestFull: string; staleness: number } | null = null;
  const add = createCardAdder(cards, cardEventCounts);
  for (const event of events) {
    if (isCompactionMarker(event)) {
      cards.push({ kind: "system", text: "Context automatically compacted.", commands: [], timestamp: event.timestamp });
    }
    if (event.kind === "user") {
      unresolvedTest = resolveToolResults(event, {
        cards, testCards, pendingTools, unresolvedBlockers, unresolvedTest, awaitingTestResult,
      });
      continue;
    }
    if (event.kind !== "assistant") continue;
    // A turn's own explanation (when Claude wrote one alongside its tool calls)
    // replaces the generic bucket sentence below — reusing the same raw-JSONL
    // `assistantText()` narrator-transcript.ts already narrates from, so a
    // non-technical reader gets the actual reasoning instead of a templated
    // "was updated in compact steps." Purely deterministic text extraction,
    // never a new LLM call.
    const assistantLines = assistantText(event).split("\n");
    const firstNonEmptyIdx = assistantLines.findIndex((line) => line.trim().length > 0);
    const ownProse = clean(firstNonEmptyIdx === -1 ? "" : assistantLines[firstNonEmptyIdx]);
    // The untruncated counterpart of `ownProse` — a real turn is very often
    // ONE long paragraph with no internal newline, so this is often the
    // turn's ENTIRE explanation (iterate-2026-09-05-mission-feed-ux-gaps:
    // "nie croppen" — never crop).
    const ownProseFull = firstNonEmptyIdx === -1 ? "" : cleanFull(assistantLines[firstNonEmptyIdx]);
    // The turn's own words BEYOND its headline (`ownProse`) — never a bare
    // `slice(1)`, which would leak a leading blank line's absence of
    // content back in as if it were the headline (Internal Plan/External
    // LLM Review finding). `join("\n")`, never space-joined or
    // empty-line-filtered like `excerpt()`: this is plain-text-rendered
    // prose, and blank lines are real paragraph breaks in it.
    const ownProseRestRaw = firstNonEmptyIdx === -1 ? "" : assistantLines.slice(firstNonEmptyIdx + 1).join("\n");
    const ownProseRest = ownProseRestRaw.trim().length > 0 ? explanationExcerpt(ownProseRestRaw) : "";
    const ownProseRestFull = ownProseRestRaw.trim().length > 0 ? explanationExcerpt(ownProseRestRaw, Infinity, Infinity) : "";

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
      const bucket = tool.name === "AskUserQuestion" ? "user-input"
        : isTestInvocation(shell) ? "test"
        : isReviewInvocation(shell) || isReviewTask(tool.name, input) ? "review"
        : tool.name === "Read" || tool.name === "Grep" || tool.name === "Glob" ? "investigate"
        : /\.shipwright[\\/].*(spec|plan)/i.test(String(input?.file_path ?? "")) ? "spec"
        : "implement";
      const label = commandLabel(tool.name, tool.input);
      const labelFull = commandLabelFull(tool.name, tool.input);
      const commandKey = `${tool.name}\u0000${commandDetail(tool.input)}`;
      if (bucket === "test") {
        // No standard sentence here either (iterate-2026-09-05-mission-
        // feed-ux-gaps — the user's own quoted example was literally "This
        // test command completed."): only THIS turn's own words (never
        // carried pendingNarration, which must stay free to reach a LATER
        // real turn past this test call, per the narration-bridging
        // invariant above), or nothing. The status pill + command chip
        // carry the outcome; resolveToolResults no longer overwrites this
        // with a hardcoded sentence either.
        const card: ActivityCard = {
          kind: "test",
          text: ownProse,
          commands: [],
          artifact: artifact(context, "tests") ? "tests" : undefined,
          timestamp: event.timestamp,
        };
        if (ownProseFull && ownProseFull.length > ownProse.length) card.textFull = ownProseFull;
        attachCommand(card, label, labelFull);
        cards.push(card);
        testCards.push(card);
        awaitingTestResult.add(card);
        pendingTools.set(tool.id, { bucket, card, commandKey, label, full: labelFull, background });
        if (ownProse) proseConsumedThisTurn = true;
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
        pendingTools.set(tool.id, { bucket, card, commandKey, label, full: labelFull, background });
      }
    }
    // Clear only once actually used (an eligible bucket read it this turn),
    // or once superseded by this turn's OWN text — a pure test/user-input
    // turn with no text of its own leaves `pendingNarration` untouched so it
    // still reaches a later real turn. A pure test/user-input turn that DID
    // write its own text becomes the new pending value (most-recent-wins,
    // same as two consecutive narration-only turns). Past
    // `MAX_PENDING_NARRATION_CARRY` consecutive non-consuming turns it is
    // dropped instead of carried further (doubt-review catch — see the
    // comment on `pendingNarration`'s declaration).
    if (proseConsumedThisTurn) {
      pendingNarration = null;
    } else if (ownProse) {
      pendingNarration = { prose: ownProse, proseFull: ownProseFull, proseRest: ownProseRest, proseRestFull: ownProseRestFull, staleness: 0 };
    } else if (pendingNarration) {
      pendingNarration = pendingNarration.staleness + 1 >= MAX_PENDING_NARRATION_CARRY
        ? null
        : { ...pendingNarration, staleness: pendingNarration.staleness + 1 };
    }
  }

  // A card that never got a turn's own prose (`text === ""`, no more
  // `GENERIC_TEXT` fallback — iterate-2026-09-05-mission-feed-ux-gaps)
  // still renders its command chip(s); nothing to clear here for it.
  //
  // This pass clears a stale `explanation` written for a card that turned
  // out to span MORE than one assistant turn — an explanation is only ever
  // exactly one turn's words (see `ActivityCard.explanation`'s doc comment)
  // and a later turn coalescing into the same card must not leave an
  // earlier turn's words looking like they cover the whole card.
  for (const card of cards) {
    if (card.explanation && cardTurnCounts.get(card) !== 1) {
      delete card.explanation;
      delete card.explanationFull;
    }
  }

  return reconcileArtifactCards(cards, context, testCards, unresolvedTest, awaitingTestResult);
}
