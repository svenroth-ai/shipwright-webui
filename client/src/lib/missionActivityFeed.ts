import { askUserQuestionSummary, assistantText, toolResults, toolUses, type ParsedEvent } from "../external/session-parser";
import type { ArtifactKind, MissionContext } from "./missionContextApi";
import { clean, commandDetail, commandLabel, excerpt, explanationExcerpt, isCompactionMarker, resolveQuestionAnswer, sentenceFromLabel } from "./missionActivityFeedText";
import { GENERIC_TEXT, isReviewInvocation, isReviewTask, isTestInvocation } from "./missionActivityFeedClassify";
import { reconcileArtifactCards } from "./missionActivityFeedReconcile";
import type { ActivityCard, ActivityFeed, ActivityKind } from "./missionActivityFeedTypes";

export type { ActivityCard, ActivityFeed, ActivityKind, ActivityQuestion } from "./missionActivityFeedTypes";

function artifact(context: MissionContext | null, kind: ArtifactKind): boolean {
  return context?.artifacts.some((item) => item.kind === kind && item.state === "available") ?? false;
}

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
  const pendingTools = new Map<string, { bucket: ActivityKind; card: ActivityCard; commandKey: string; label: string; background: boolean }>();
  // Real per-card event count — deliberately NOT `commands.length`, which
  // dedupes by label string and can under-count when two distinct events
  // produce the same label (e.g. two identical `Read` calls). A plain Map,
  // not a WeakMap: this only lives for one `deriveActivityFeed()` call, so
  // there is no retention concern a weak reference would address.
  const cardEventCounts = new Map<ActivityCard, number>();
  // How many distinct ASSISTANT TURNS contributed to a card — deliberately
  // separate from `cardEventCounts` above (which counts tool-use EVENTS and
  // stays untouched for its own existing job, the label-derived-sentence
  // fallback below). A card is misattributed only when MORE THAN ONE turn's
  // words land on it; one turn issuing several tool calls that coalesce
  // into a single card is not misattribution and must keep its explanation
  // (iterate-2026-08-25-mission-feed-progress-narration, Internal Plan
  // Review HIGH finding — `cardEventCounts === 1` alone would have wrongly
  // suppressed that common, valuable case).
  const cardTurnCounts = new Map<ActivityCard, number>();
  const add = (kind: ActivityKind, text: string, command: string, artifact?: ArtifactKind, coalesce = true): ActivityCard => {
    const previous = cards[cards.length - 1];
    if (coalesce && previous?.kind === kind && previous.text === text && previous.artifact === artifact) {
      if (!previous.commands.includes(command)) previous.commands.push(command);
      cardEventCounts.set(previous, (cardEventCounts.get(previous) ?? 1) + 1);
      return previous;
    }
    const card: ActivityCard = { kind, text, commands: [command], artifact };
    cards.push(card);
    cardEventCounts.set(card, 1);
    return card;
  };
  for (const event of events) {
    if (isCompactionMarker(event)) {
      cards.push({ kind: "system", text: "Context automatically compacted.", commands: [] });
    }
    if (event.kind === "user") {
      for (const result of toolResults(event)) {
        const pending = pendingTools.get(result.tool_use_id);
        if (!pending) continue;
        pendingTools.delete(result.tool_use_id);
        if (pending.bucket === "user-input") {
          // Only a non-error resolution counts as an actual answer (mini-plan,
          // code review catch): an errored/cancelled prompt sets `resolved`
          // here too would permanently hide `AnswerInTerminalButton` (FR-01.63)
          // even though nothing was actually decided.
          if (pending.card.question && !result.is_error) {
            pending.card.question.resolved = true;
            const resolved = resolveQuestionAnswer(result.content, pending.card.question.options);
            pending.card.question.picked = resolved.picked;
            pending.card.question.answer = resolved.answer;
            pending.card.text = "The requested user input was received and work could continue.";
          }
        } else if (pending.bucket === "test") {
          if (result.is_error) {
            pending.card.text = "This test command needs attention.";
            pending.card.status = "err";
            pending.card.detail = excerpt(result.content);
            unresolvedTest = pending.card;
          } else if (pending.background) {
            // A shell acknowledgement is not proof that the spawned job ended.
            // Keep the card pending until MissionContext records its result.
          } else if (unresolvedTest) {
            // A locally-observed successful retry is real recovery evidence
            // for THIS attempt, independent of whether MissionContext.tests.gate
            // has caught up yet — merging it here regardless of `gate` (external
            // review catch, high) closes a duplicate-card leak: leaving
            // `unresolvedTest` set until `gate === "pass"` let the OLD failed
            // card linger in the feed forever whenever the gate stayed
            // fail/unknown, and let the final reconciliation below attach that
            // lagging gate's status to the NEW card next to text already
            // claiming completion. The PILL stays gate-derived either way (the
            // final reconciliation still runs unconditionally); only this
            // sentence's wording stays conservative about what was RECORDED.
            unresolvedTest.text = context?.tests?.gate === "pass"
              ? "Tests recovered and have a recorded passing result."
              : "This test command completed after an earlier failure.";
            unresolvedTest.status = undefined;
            unresolvedTest.detail = undefined;
            if (!unresolvedTest.commands.includes(pending.label)) unresolvedTest.commands.push(pending.label);
            cards.splice(cards.indexOf(pending.card), 1);
            testCards.splice(testCards.indexOf(pending.card), 1);
            unresolvedTest = null;
          } else {
            pending.card.text = "This test command completed.";
          }
        } else if (result.is_error) {
          pending.card.kind = "blocker";
          pending.card.text = "A command needs attention before work can continue.";
          pending.card.status = "err";
          // A blocker's headline/status/detail all come from THIS error —
          // any explanation excerpted from an earlier, unrelated turn must
          // not survive the mutation (Internal Plan Review HIGH finding:
          // the recovery path below pushes a second command label without
          // touching `cardEventCounts`/`cardTurnCounts`, so a count-based
          // guard alone would miss this transition — clearing at the
          // mutation site itself is unconditional and needs no counter).
          delete pending.card.explanation;
          // `add()` coalesces same-kind/text/artifact cards across several
          // tool_use ids (the "many-files-in-a-row" case) — attaching this
          // one command's error excerpt would misattribute it to a card
          // whose `commands` chip list still names other, unrelated,
          // non-erroring commands. Only attach when unambiguous.
          if (pending.card.commands.length === 1) pending.card.detail = excerpt(result.content);
          unresolvedBlockers.set(pending.commandKey, { card: pending.card, bucket: pending.bucket });
        } else if (unresolvedBlockers.has(pending.commandKey)) {
          const blocker = unresolvedBlockers.get(pending.commandKey)!;
          // A stale blocker's commandKey (tool name + detail string, with no
          // expiry) can coincidentally match a command inside a later,
          // wholly unrelated turn — one of possibly several tool calls that
          // `add()` coalesced into the CURRENT card. Only fold this success
          // into the original blocked card (and discard the current one)
          // when the current card is unambiguously about nothing but this
          // recovered command: otherwise the `cards.splice()` below would
          // destroy that unrelated card's other commands and any
          // `explanation` it carries (found by doubt-review during
          // iterate-2026-08-25-mission-feed-progress-narration — pre-existing
          // gap, out of that iterate's scope).
          if (pending.card.commands.length === 1) {
            blocker.card.kind = blocker.bucket;
            blocker.card.text = "A command error recovered after a successful retry.";
            blocker.card.status = undefined;
            blocker.card.detail = undefined;
            if (!blocker.card.commands.includes(pending.label)) blocker.card.commands.push(pending.label);
            cards.splice(cards.indexOf(pending.card), 1);
            unresolvedBlockers.delete(pending.commandKey);
          }
        }
      }
      continue;
    }
    if (event.kind !== "assistant") continue;
    // A turn's own explanation (when Claude wrote one alongside its tool calls)
    // replaces the generic bucket sentence below — reusing the same raw-JSONL
    // `assistantText()` narrator-transcript.ts already narrates from, so a
    // non-technical reader gets the actual reasoning instead of a templated
    // "was updated in compact steps." Purely deterministic text extraction,
    // never a new LLM call. Empty for the common tool-only turn (no text
    // block at all), which keeps every existing fallback-sentence case —
    // including the many-files-in-a-row coalescing the long-iterate test
    // relies on — byte-identical.
    const assistantLines = assistantText(event).split("\n");
    const firstNonEmptyIdx = assistantLines.findIndex((line) => line.trim().length > 0);
    const prose = clean(firstNonEmptyIdx === -1 ? "" : assistantLines[firstNonEmptyIdx]);
    // The turn's own words BEYOND its headline (`prose`) — never a bare
    // `slice(1)`, which would leak a leading blank line's absence of
    // content back in as if it were the headline (Internal Plan/External
    // LLM Review finding). `join("\n")`, never space-joined or
    // empty-line-filtered like `excerpt()`: this is plain-text-rendered
    // prose, and blank lines are real paragraph breaks in it.
    const proseRestRaw = firstNonEmptyIdx === -1 ? "" : assistantLines.slice(firstNonEmptyIdx + 1).join("\n");
    const proseRest = proseRestRaw.trim().length > 0 ? explanationExcerpt(proseRestRaw) : "";
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
    for (const tool of toolUses(event)) {
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
      const commandKey = `${tool.name}\u0000${commandDetail(tool.input)}`;
      if (bucket === "test") {
        const card: ActivityCard = {
          kind: "test",
          text: "This test command needs attention: it is awaiting a result.",
          commands: [label],
          artifact: artifact(context, "tests") ? "tests" : undefined,
        };
        cards.push(card);
        testCards.push(card);
        pendingTools.set(tool.id, { bucket, card, commandKey, label, background });
      } else if (bucket === "user-input") {
        const card = add("user-input", "A user decision is needed before work can continue.", label, undefined, false);
        // Always set `card.question` — even the `fallback` shape carries a
        // real (if generic) placeholder question. Gating this on
        // `!summary.fallback` (code review catch) silently dropped the
        // terminal CTA for a genuinely unparseable AskUserQuestion payload,
        // since the whole question block — CTA included — renders only when
        // `card.question` is truthy.
        const summary = askUserQuestionSummary(tool.input);
        card.question = { text: summary.question, options: summary.options, resolved: false };
        pendingTools.set(tool.id, { bucket, card, commandKey, label, background });
      } else {
        const card = bucket === "review" ? add("review", prose || GENERIC_TEXT.review, label, artifact(context, "review") ? "review" : undefined)
          : bucket === "spec" ? add("spec", prose || GENERIC_TEXT.spec, label, artifact(context, "spec") ? "spec" : undefined)
          : bucket === "investigate" ? add("investigate", prose || GENERIC_TEXT.investigate, label)
          : add("implement", prose || GENERIC_TEXT.implement, label);
        if (!cardsTouchedThisTurn.has(card)) {
          cardsTouchedThisTurn.add(card);
          cardTurnCounts.set(card, (cardTurnCounts.get(card) ?? 0) + 1);
        }
        if (!explanationAttachedThisTurn) {
          if (proseRest) card.explanation = proseRest;
          explanationAttachedThisTurn = true;
        }
        pendingTools.set(tool.id, { bucket, card, commandKey, label, background });
      }
    }
  }

  // Second-tier, always-available fallback: a card that (a) never got a
  // turn's own prose and (b) ended up representing EXACTLY ONE tool_use
  // event (never coalesced) gets its generic sentence replaced with one
  // derived from that event's own already-computed, already-sanitized
  // label — the same text already shown in its command chip. A coalesced
  // multi-command card keeps the generic sentence unchanged: no single
  // derived sentence can represent several distinct commands.
  for (const card of cards) {
    if (card.kind !== "investigate" && card.kind !== "implement" && card.kind !== "review" && card.kind !== "spec") continue;
    if (card.text !== GENERIC_TEXT[card.kind]) continue;
    if (cardEventCounts.get(card) !== 1) continue;
    card.text = sentenceFromLabel(card.commands[0]);
  }

  // Deliberately its OWN, separate, unconditional pass — NOT folded into
  // the sweep above. That sweep's own `card.text !== GENERIC_TEXT[...]`
  // guard `continue`s past every card that has real prose, which is
  // exactly every card that could ever carry an explanation; folding this
  // clear in there would make it a permanent no-op (Internal Plan Review
  // HIGH finding).
  for (const card of cards) {
    if (card.explanation && cardTurnCounts.get(card) !== 1) delete card.explanation;
  }

  return reconcileArtifactCards(cards, context, testCards, unresolvedTest);
}
