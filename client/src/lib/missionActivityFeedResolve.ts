import { toolResults, type UserEvent } from "../external/session-parser";
import { attachCommand, excerpt, resolveQuestionAnswer } from "./missionActivityFeedText";
import type { ActivityCard, ActivityKind } from "./missionActivityFeedTypes";

/** Attaches `detail`/`detailFull` from a bounded excerpt of raw tool-result
 *  content, the same "set `xFull` only when truncation actually happened"
 *  contract as every other `xFull` field (iterate-2026-09-05-mission-feed-
 *  ux-gaps — "nie croppen"). */
function attachDetail(card: ActivityCard, content: string): void {
  card.detail = excerpt(content);
  const full = excerpt(content, Infinity, Infinity);
  if (full.length > card.detail.length) card.detailFull = full;
  else delete card.detailFull;
}

/** A tool_use id awaiting its matching `tool_result` — set when the card is
 *  created (deriveActivityFeed), consumed here once the result arrives. */
export interface PendingTool {
  bucket: ActivityKind;
  card: ActivityCard;
  commandKey: string;
  label: string;
  /** The untruncated counterpart of `label` — carried alongside it so a
   *  recovered/retried command re-attached here can still populate
   *  `commandFullText` via `attachCommand()` (iterate-2026-09-05-mission-
   *  feed-ux-gaps). */
  full: string;
  background: boolean;
}

/** The mutable per-run state `resolveToolResults` reads and updates. Threaded
 *  in (never module-level) — `deriveActivityFeed` owns it for the lifetime of
 *  one derivation and nothing here survives past that call. */
export interface ResolveState {
  cards: ActivityCard[];
  testCards: ActivityCard[];
  pendingTools: Map<string, PendingTool>;
  unresolvedBlockers: Map<string, { card: ActivityCard; bucket: ActivityKind }>;
  unresolvedTest: ActivityCard | null;
  /** Test cards genuinely still awaiting ANY result — a card leaves this set
   *  the moment it gets a real (non-background-ack) outcome, whether that
   *  outcome is failure, success, or a recovery merge. `deriveActivityFeed`
   *  adds every test card here at creation; `reconcileArtifactCards` reads
   *  it to tell "no result yet" apart from "resolved, then recovered" —
   *  both leave `card.status === undefined`, so this can no longer be told
   *  from `card.text` now that resolution never rewrites it
   *  (iterate-2026-09-05-mission-feed-ux-gaps removed every invented test
   *  sentence, including the "…it is awaiting a result." this check used to
   *  regex-match). */
  awaitingTestResult: Set<ActivityCard>;
}

/** Fold one `user` event's `tool_result` blocks into the cards their matching
 *  `tool_use` already created — question resolution, test pass/fail/retry,
 *  and blocker creation/recovery. Extracted verbatim from
 *  `deriveActivityFeed`'s own `user`-event branch (iterate-2026-08-27
 *  bloat-ceiling split) — pure state mutation + reassignment, no behavior
 *  change. Returns the new `unresolvedTest` (the one field the caller must
 *  reassign; everything else mutates `state`'s own maps/arrays in place).
 *  No longer takes a `MissionContext` (iterate-2026-09-05-mission-feed-ux-
 *  gaps): its sole prior use was picking test-recovery sentence wording,
 *  now removed along with every other invented sentence in this bucket. */
export function resolveToolResults(
  event: UserEvent,
  state: ResolveState,
): ActivityCard | null {
  const { cards, testCards, pendingTools, unresolvedBlockers, awaitingTestResult } = state;
  let unresolvedTest = state.unresolvedTest;
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
        pending.card.question.answerFull = resolved.answerFull;
        pending.card.text = "The requested user input was received and work could continue.";
      }
    } else if (pending.bucket === "test") {
      // No standard sentence is invented here any more
      // (iterate-2026-09-05-mission-feed-ux-gaps — the user's own quoted
      // example was literally "This test command completed."): `card.text`
      // stays whatever it was set to at creation (this turn's own words, or
      // empty) through every branch below. The status pill (derived from
      // `card.status`/MissionContext.tests.gate at final reconciliation)
      // and the command chip carry the outcome instead.
      if (result.is_error) {
        pending.card.status = "err";
        attachDetail(pending.card, result.content);
        unresolvedTest = pending.card;
        awaitingTestResult.delete(pending.card);
      } else if (pending.background) {
        // A shell acknowledgement is not proof that the spawned job ended.
        // Keep the card pending until MissionContext records its result —
        // and keep it in `awaitingTestResult` too, for the same reason.
      } else if (unresolvedTest) {
        // A locally-observed successful retry is real recovery evidence for
        // THIS attempt, independent of whether MissionContext.tests.gate has
        // caught up yet — merging it here regardless of `gate` (external
        // review catch, high) closes a duplicate-card leak: leaving
        // `unresolvedTest` set until `gate === "pass"` let the OLD failed
        // card linger in the feed forever whenever the gate stayed
        // fail/unknown. The PILL stays gate-derived either way (the final
        // reconciliation still runs unconditionally).
        unresolvedTest.status = undefined;
        unresolvedTest.detail = undefined;
        delete unresolvedTest.detailFull;
        attachCommand(unresolvedTest, pending.label, pending.full);
        cards.splice(cards.indexOf(pending.card), 1);
        testCards.splice(testCards.indexOf(pending.card), 1);
        awaitingTestResult.delete(unresolvedTest);
        awaitingTestResult.delete(pending.card);
        unresolvedTest = null;
      } else {
        awaitingTestResult.delete(pending.card);
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
      delete pending.card.explanationFull;
      // `add()` coalesces same-kind/text/artifact cards across several
      // tool_use ids (the "many-files-in-a-row" case) — attaching this
      // one command's error excerpt would misattribute it to a card
      // whose `commands` chip list still names other, unrelated,
      // non-erroring commands. Only attach when unambiguous.
      if (pending.card.commands.length === 1) attachDetail(pending.card, result.content);
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
        delete blocker.card.detailFull;
        attachCommand(blocker.card, pending.label, pending.full);
        cards.splice(cards.indexOf(pending.card), 1);
        unresolvedBlockers.delete(pending.commandKey);
      }
    } else if (pending.bucket === "review") {
      // A successful review tool_result carries the actual verdict/findings
      // text — previously discarded entirely (no branch matched it), so the
      // card sat with no detail unless a DURABLE review artifact happened
      // to exist later (missionActivityFeedReconcile.ts); a lighter one-off
      // review (no `record_review_pass.py` call) never got that, leaving
      // the card permanently empty (iterate-2026-09-05-mission-feed-ux-gaps,
      // "External plan review wird angezeigt, aber das resultat nicht").
      attachDetail(pending.card, result.content);
    }
  }
  return unresolvedTest;
}
