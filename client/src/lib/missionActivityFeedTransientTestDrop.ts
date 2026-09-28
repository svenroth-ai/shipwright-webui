import type { ActivityCard, PendingTool, ResolveState } from "./missionActivityFeedTypes";

/**
 * Splices a `test`-bucket card out of the feed entirely because its own
 * `tool_result` was the harness's transient auto-mode-classifier rejection —
 * the tool never actually ran, so the card can never honestly represent
 * pass/fail (iterate-2026-09-28-mission-feed-completeness, AC3/AC4). Split
 * out of `missionActivityFeedResolve.ts` (300-line convention) once the
 * `authoringConsumedBy` purge below was added.
 *
 * Safe to splice unconditionally (unlike the generic blocker/coalesced path):
 * a `test` card is always fresh, one per `tool_use`, never shared with a
 * sibling command (see the call site's own doc comment).
 *
 * Code-review catch (high): a spliced AUTHORING run's card is still a VALUE
 * in `state.authoringConsumedBy` (set 1:1 with `authoringRun: true` at
 * creation in `missionActivityFeedTurn.ts`). Left in place, a LATER
 * out-of-order rollback of its backing Write
 * (`rollbackFailedWrite`/`unstampAuthoringRun` in
 * `missionActivityFeedAuthoringRollback.ts`) can still look this detached
 * card up and misread its "neither failed nor pending" shape as a
 * SUCCESSFUL recovery — able to clear an unrelated, still-open
 * `unresolvedTest` failure's red status. Purging the entry here makes that
 * later rollback behave exactly as if this run had never consumed the
 * tracker slot at all (the "no card has consumed this entry yet" branch),
 * matching AC3/AC4's intent that a transient rejection is a pure no-op.
 *
 * Doubt-review catch (high): `authoringConsumedBy` is not the ONLY path into
 * `unstampAuthoringRun` — `state.restoreValidationPending` is a SECOND,
 * deferred one, populated whenever a same-turn SECOND write to the same
 * path fails while its own earlier write's fate is still unknown
 * (`missionActivityFeedAuthoringRollback.ts`'s `else` branch, keyed by the
 * EARLIER write's tool_use id rather than the later one `authoringConsumedBy`
 * uses). A card can be a value in `restoreValidationPending` independently
 * of whether it is still in `authoringConsumedBy` at drop time (that entry
 * may already have been consumed/reassigned by the Write's own rollback), so
 * purging only `authoringConsumedBy` leaves this second door open to the
 * exact same false-recovery misread. Both maps hold the SAME card as a
 * value under at most one key each while `authoringRun` is still true, so
 * both purges live behind the one `if (card.authoringRun)` guard.
 */
export function dropTransientTestCard(pending: PendingTool, state: ResolveState): void {
  const card: ActivityCard = pending.card;
  const idx = state.cards.indexOf(card);
  if (idx !== -1) state.cards.splice(idx, 1);
  const testIdx = state.testCards.indexOf(card);
  if (testIdx !== -1) state.testCards.splice(testIdx, 1);
  state.awaitingTestResult.delete(card);
  if (card.authoringRun) {
    for (const [writeToolId, consumed] of state.authoringConsumedBy) {
      if (consumed === card) {
        state.authoringConsumedBy.delete(writeToolId);
        break;
      }
    }
    for (const [restoreSourceId, consumed] of state.restoreValidationPending) {
      if (consumed === card) {
        state.restoreValidationPending.delete(restoreSourceId);
        break;
      }
    }
    card.authoringRun = undefined;
  }
}
