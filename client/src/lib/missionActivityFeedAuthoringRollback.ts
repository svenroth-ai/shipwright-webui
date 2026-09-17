/**
 * Rolls back a FAILED Write/Edit's optimistic `writtenTestFiles` tracker
 * entry, and any same-turn test card that already consumed it before this
 * result was known — split out of `missionActivityFeedResolve.ts`'s own
 * event loop (18th-round bloat-ceiling split, once the accumulated review-
 * catch reasoning here crossed the project's 300-line convention). Pure
 * state mutation, no behavior change.
 *
 * 39th-round catch (glm, low), DECLINED as a KNOWN LIMITATION, pinned by a
 * test in `missionActivityFeedBlockerAndTdd.test.ts`: this module handles the
 * Write-FIRST `tool_use` ordering only. A turn listing `[Bash vitest run
 * foo.test.ts, Write foo.test.ts]` leaves the run un-stamped (no tracker entry
 * exists yet when the Bash card is built) and the Write's entry then survives
 * for a later run of that path to consume. Declined because the un-stamped
 * outcome is the SAFE one — a genuine verification keeping its gate stamp —
 * and because the fix glm sketches ("defer consumption until the whole turn's
 * tool_use set is processed") would restructure the reducer's single forward
 * pass for a shape Claude does not emit: it writes a test before running it.
 * Note this is NOT the tool_RESULT-ordering premise of the 18th/38th rounds;
 * those are results within a turn, which genuinely do arrive out of order.
 */
import { MAX_AUTHORING_TRACK_CARRY, sameTestFilePath, type WrittenTestFileTracker } from "./missionActivityFeedAuthoringTrack";
import { attachCommand } from "./missionActivityFeedText";
import type { ActivityCard, PendingTool, ResolveState } from "./missionActivityFeedTypes";

// Shared by both un-stamp sites below — see their call sites' comments for
// why each fires. `state.failedTestCards` (not `card.detail`'s truthiness —
// 27th-round external review catch, openai, medium: an empty/whitespace-only
// error excerpt made `detail` falsy even on a genuine failure) is the
// reliable "this card's own run already failed" signal here; a still-
// pending card (own result not processed yet) is unaffected — its
// `is_error` branch reads the now-cleared `authoringRun` and sets `status`
// itself, same as the forward-order case.
// 67th (glm, low), NO ACTION by glm's own recommendation ("none required to
// ship"): it notes this replay merge and the forward merge could drift, since
// only the observable outcomes are pinned rather than field-by-field parity.
// Left as-is deliberately — extracting a shared merge body is the remediation
// to reach for IF either site is touched again, not a change to make blind.
function unstampAuthoringRun(card: ActivityCard, state: ResolveState): void {
  card.authoringRun = undefined;
  // 40th-round catch (glm, low), DECLINED as unreachable: glm asks that the
  // merge branch below also purge the spliced card from `failedTestCards` /
  // `restoreValidationPending` / `authoringConsumedBy`, lest a later rollback
  // re-enter this function on a detached card (where `indexOf` returns -1 and
  // `splice(-1, 1)` would delete an unrelated LAST card). Traced: no card can
  // reach this function twice. (a) `failedTestCards` is excluded by the merge
  // branch's own guard — it runs only when `!failedTestCards.has(card)`, so a
  // spliced card is never in that set and can never become `unresolvedTest`
  // via the `else if` below. (b) A card is an `authoringConsumedBy` VALUE
  // under at most ONE key: `missionActivityFeed.ts` gives every test tool_use
  // a fresh `ActivityCard` and consumes the matched tracker entry
  // (`.filter((_, i) => i !== matchIndex)`), so one card consumes one entry.
  // (c) `restoreValidationPending.set(restoreSourceId, consumedCard)` is
  // therefore also one key per card, and its key is the EARLIER write's id
  // while the card's `authoringConsumedBy` key is the LATER write's — never
  // the same id, so the two un-stamp call sites in `rollbackFailedWrite` can
  // never both fire for one card, in one call or across calls (each tool_use
  // yields exactly one tool_result, so each `rollbackFailedWrite` runs once).
  // Falsified empirically: `if (!state.cards.includes(card)) throw` at the
  // top of this function, full suite — 4229 tests, including every rollback
  // ordering 40 rounds of review have constructed, all still GREEN. The 41st
  // round re-checked this trace, could not construct a counterexample, and
  // asked only that the throw ship permanently as a debug assertion —
  // declined in turn: this reducer runs inside the Mission tab's render, so
  // a throw would blank the panel where the argued invariant costs nothing.
  // 30th-round external review catch (glm, low, declined): when this card's
  // OWN result was a success (not in `failedTestCards`), it falls through
  // with `status` left `undefined` rather than explicitly set to "ok" —
  // NOT a special-case bug. `reconcileArtifactCards` already stamps a
  // gate-derived pill only on the LATEST verification test card
  // (`verificationCards.at(-1)`); every other resolved-but-not-latest test
  // card — via this deferred path, the plain forward `is_error`/success
  // branches, and the merge/recovery branch, all in
  // `missionActivityFeedResolve.ts` — ends up `status: undefined` by the
  // same uniform design, and `pillLabel` already treats that as "no pill",
  // never "pending". Setting `"ok"` here specifically would make this ONE
  // path inconsistent with that shared rule, not more correct.
  // 38th-round catch (openai, medium), FIXED — and it RETRACTS this module's
  // 36th-round decline of the same finding. That decline argued the case was
  // unreachable because `tool_result`s preserve `tool_use` ORDER, so a failing
  // Write's result always lands before its Bash card's own. That premise is
  // exactly the one the 18th-round catch (openai, medium) already REJECTED,
  // and this module's own tests pin the reverse ordering as real; openai was
  // right to call the contradiction. Re-probed in the order the earlier
  // decline assumed away — genuine `npm test` failure, then a same-turn
  // `[Write, Bash]` whose results arrive `[bash ok, write error]` — and the
  // bug reproduced: TWO cards, the earlier genuine failure still `err` and
  // this un-stamped success stranded beside it.
  //
  // Why it happens: the Bash card's own SUCCESS branch in
  // `missionActivityFeedResolve.ts` skips the recovery merge while
  // `authoringRun` is still set (12th-round catch: a successful authoring run
  // is not recovery evidence), and by the time this un-stamp runs, that
  // branch is long past. So the merge has to be replayed HERE, against the
  // same `state.unresolvedTest` slot, mirroring what the forward path does.
  if (card.kind === "test" && !state.failedTestCards.has(card) && !state.awaitingTestResult.has(card)) {
    // Neither failed nor still pending ⇒ this card's own result already came
    // back SUCCESSFUL. `awaitingTestResult` is what separates that from "own
    // result not processed yet", which must stay untouched: a pending card's
    // own branch runs later and reads the now-cleared `authoringRun` itself.
    const recovered = state.unresolvedTest;
    if (recovered && recovered !== card) {
      recovered.status = undefined;
      recovered.detail = undefined;
      delete recovered.detailFull;
      // Same `overwrite` rationale as the forward merge: this retry replaces
      // the stale failed attempt as the card's current truth.
      // 58th-round catch (glm, low, "optional"), DECLINED: glm suggests one
      // test asserting this replay and the forward merge produce IDENTICAL
      // merged cards. They are each already pinned by their own behavioral
      // tests, and the two paths reach the merge from DIFFERENT states (this
      // one after an un-stamp), so an equality assertion across them would
      // pin a coincidence rather than a contract.
      //
      // 39th-round catch (glm, low), DECLINED: glm asks that `commandCount`
      // only increment when the label is NEWLY added. That would invert the
      // 24th-round contract it cites — `commandCount` is the TRUE tool-call
      // count precisely BECAUSE `commands` dedupes labels, so two distinct
      // calls sharing one label must count twice. The forward merge in
      // `missionActivityFeedResolve.ts` increments unconditionally for the
      // same reason; suppressing it only here would make this path the odd
      // one out, the exact inconsistency the 30th-round decline rejected.
      // 42nd-round catch (glm, low), DECLINED as falsified: glm reads the
      // `?? label` fallback as writing `commandFullText[label] = label`, which
      // `FeedCommands` would render as a clickable chip whose expansion shows
      // the chip's own text. `attachCommand` already guards that — it stores
      // only `if (full !== label && …)`, so this fallback provably records
      // nothing. Every ordinary creation site passes the same `labelFull ===
      // label` for an un-truncated command and relies on that same guard.
      for (const label of card.commands) {
        attachCommand(recovered, label, card.commandFullText?.[label] ?? label, { overwrite: true });
      }
      // 43rd-round catch (glm, low), ACCEPTED as defence-in-depth: the trace
      // above still holds and no test can falsify these two guards, but
      // `splice(-1, 1)` on a miss would silently delete an UNRELATED last
      // card, and this reducer runs inside render — a mechanical guard beats
      // an argued invariant when it costs two lines and changes no reachable
      // behaviour (glm's own framing, and the third round to raise the class).
      const cardIndex = state.cards.indexOf(card);
      if (cardIndex !== -1) state.cards.splice(cardIndex, 1);
      const testIndex = state.testCards.indexOf(card);
      if (testIndex !== -1) state.testCards.splice(testIndex, 1);
      state.awaitingTestResult.delete(recovered);
      // 43rd-round catch (glm, low), FIXED: `failedTestCards` means "this
      // card's own run failed AND was never recovered", so leaving the merged-
      // into card in it contradicts the recovery that just happened — the
      // `else if` branch below keys on exactly that set and would re-stamp it
      // `err` and re-open `unresolvedTest`. Keeps the two sets in sync.
      state.failedTestCards.delete(recovered);
      // 84th (glm, low), ACCEPTED as defence-in-depth on the SAME principle:
      // round 43 purged the merged-INTO card but left the merged-AWAY one in
      // the set. Inert today (the merge branch runs only when the set does NOT
      // hold `card`, which is the (a) leg of the trace above), so this deletes
      // nothing reachable — it just stops the two sets from depending on that
      // trace staying true, at one line and no behaviour change.
      state.failedTestCards.delete(card);
      state.unresolvedTest = null;
    }
  } else if (card.kind === "test" && state.failedTestCards.has(card)) {
    card.status = "err";
    // Retroactively open the recovery slot too (24th-round external review
    // catch, openai, medium) — the forward-order `is_error` branch in
    // `missionActivityFeedResolve.ts` does this unconditionally on a
    // genuine (non-authoring) failure; this card's own `is_error` branch
    // ran BEFORE this un-stamp (still `authoringRun: true` then) and
    // skipped it, so without this, a later genuine retry's success can
    // never merge back into this card as a recovery. Only when the slot is
    // still EMPTY (26th-round catch, glm, medium): an unconditional
    // overwrite here could clobber a wholly unrelated, still-open genuine
    // failure from elsewhere in the same feed, orphaning ITS recovery.
    if (!state.unresolvedTest) state.unresolvedTest = card;
  }
}

/** The earlier write's snapshot brought up to date, or `undefined` when there
 *  is none, its own source write also failed, or the carry window has since
 *  elapsed. `writtenTestFileRestore.staleness` already carries the `+1` for
 *  the capturing tool's own aging tick, so the top-up counts only the calls
 *  AFTER it: `toolCallIndex - capturedAt - 1`. */
function agedRestore(pending: PendingTool, state: ResolveState): WrittenTestFileTracker | undefined {
  const snapshot = pending.writtenTestFileRestore;
  if (!snapshot || state.failedWriteToolIds.has(snapshot.sourceToolId)) return undefined;
  const elapsed = Math.max(0, state.toolCallIndex - (pending.writtenTestFileRestoreAt ?? state.toolCallIndex) - 1);
  const staleness = snapshot.staleness + elapsed;
  return staleness < MAX_AUTHORING_TRACK_CARRY ? { ...snapshot, staleness } : undefined;
}

/** Called once per `tool_result` whose matching `pending.writtenTestFile` is
 *  set AND the result is an error — i.e. a Write/Edit that targeted a test
 *  file but never actually landed. Mutates `state.writtenTestFiles` and,
 *  where applicable, the consumed card's `authoringRun`/`status` in place. */
export function rollbackFailedWrite(pending: PendingTool, toolUseId: string, state: ResolveState): void {
  state.failedWriteToolIds.add(toolUseId);
  // The write never actually landed — undo the optimistic tracker entry.
  // RESTORE (not delete) any entry this path already had, per
  // `writtenTestFileRestore`'s doc comment. Removes ONLY the entry THIS
  // failed write itself created (matched by `sourceToolId`, not just path —
  // 20th-round external review catch, openai, medium): a same-turn SECOND
  // Write/Edit to the same path that SUCCEEDED replaces the first write's
  // tracker entry with its own, so filtering by path alone would delete
  // that still-valid, more-recent entry when the FIRST write's own (already
  // superseded) result later comes back as an error.
  const failedPath = pending.writtenTestFile!;
  const withoutOptimistic = state.writtenTestFiles.filter((entry) => !(entry.sourceToolId === toolUseId && sameTestFilePath(failedPath, entry.path)));
  // This write may itself be the "earlier write" a DIFFERENT, already-
  // processed rollback relied on to preserve some OTHER card's
  // `authoringRun` (23rd-round external review catch, openai, medium: order
  // w1-fails-then-w2-fails — see the deferred `restoreValidationPending.set`
  // below for the reverse order). That reliance assumed this write would
  // succeed; now that it hasn't, undo it retroactively.
  // An entry whose write SUCCEEDS is never deleted (35th-round catch, glm,
  // low) — deliberately, and it is inert rather than leaked. The map is read
  // ONLY here, on the error path, keyed by the erroring `toolUseId`; a
  // tool_use id is unique within a transcript and its result arrives exactly
  // once, so a successful write's entry can never be reached again. It also
  // dies with the derivation (per-pass state, not module-level). Clearing it
  // would mean threading a success path into a failure-only function for
  // zero behavioural change — glm agreed it is not required to ship.
  const pendingValidation = state.restoreValidationPending.get(toolUseId);
  if (pendingValidation) {
    state.restoreValidationPending.delete(toolUseId);
    unstampAuthoringRun(pendingValidation, state);
  }
  // A test card may have ALREADY consumed this entry and stamped itself
  // `authoringRun: true` (all tool_use processing for a turn happens before
  // any of its tool_results, so a same-turn "Write, then targeted Bash run"
  // stamps the Bash card before this Write's own outcome is known — 16th-
  // round catch; tool_results preserve tool_use order, so this runs before
  // the Bash card's own `is_error` branch reads `authoringRun`).
  const consumedCard = state.authoringConsumedBy.get(toolUseId);
  if (consumedCard && pending.writtenTestFileRestore) {
    // This Write/Edit itself never landed, but an EARLIER write to the SAME
    // path still did (`writtenTestFileRestore`) — the file the consumed
    // card actually ran against is that earlier write's content, so the run
    // genuinely was that write's first test and stays stamped
    // `authoringRun: true` (17th-round catch, openai, medium: un-stamping
    // unconditionally lost this earlier-write provenance, so the run
    // wrongly inherited the run-wide Passing/Failing gate stamp) — UNLESS
    // that earlier write has *also* already failed (23rd-round catch,
    // openai, medium: `writtenTestFileRestore` only proves the earlier
    // write was optimistically tracked, never that it actually succeeded;
    // if both same-turn writes to this path failed, the run's target was
    // never freshly authored at all). Not yet known which: defer until
    // that write's own result is processed, above.
    //
    // `pending.writtenTestFileRestore` is deliberately NEVER re-added to
    // `writtenTestFiles` here (24th-round external review catch, glm,
    // medium — re-litigates a 21st-round finding this comment already
    // settled): the tracker entry is SINGLE-USE per the "own FIRST run"
    // wording in the spec — `consumedCard` above proves a run has already
    // claimed it (whether or not that claim survives this rollback), so a
    // SECOND, later targeted run of the same file is genuine
    // re-verification, not also an authoring run. Every successful match
    // elsewhere in this module consumes its entry the same way (see the
    // `.filter((_, i) => i !== matchIndex)` in `missionActivityFeed.ts`).
    state.writtenTestFiles = withoutOptimistic;
    const restoreSourceId = pending.writtenTestFileRestore.sourceToolId;
    // Keyed by `restoreSourceId` alone, never overwritten by a DIFFERENT
    // pending write's own deferred entry (32nd-round external review catch,
    // glm, low, verified unreachable): `trackWrittenTestFile` always REPLACES
    // any bridge-matching tracked entry on every Write, so at most one entry
    // per path "family" exists at a time, and any later Write's own
    // `priorEntry`/`writtenTestFileRestore` can only ever point at the MOST
    // RECENT prior write to it — a strict chain, never two siblings branching
    // off the SAME earlier `restoreSourceId`.
    if (state.failedWriteToolIds.has(restoreSourceId)) unstampAuthoringRun(consumedCard, state);
    else state.restoreValidationPending.set(restoreSourceId, consumedCard);
    return;
  }
  // No card has consumed this entry yet (no test run named this path in
  // this turn) — restore the earlier write's entry so a LATER run can still
  // recognize it, UNLESS that earlier write has *also* already failed
  // (25th-round external review catch, openai, medium: this fallback used
  // to restore `writtenTestFileRestore` unconditionally, even when
  // `failedWriteToolIds` already proved its own source write failed too —
  // same class of bug as the consumedCard branch above, missed here since
  // nothing had consumed the entry yet to trigger that branch).
  // 65th-round catch (openai, medium), FIXED: the snapshot froze at capture
  // time while the LIVE tracker kept aging on every tool call, so any call
  // BATCHED after this Write in the same assistant event (tool_results are all
  // processed after all tool_uses) came back un-counted and the restored entry
  // re-entered the window younger than it really was — past the cap, it could
  // exempt a run the window had already released. Age it by the elapsed calls
  // and drop it once it reaches the cap, exactly as `trackWrittenTestFile` does.
  const restore = agedRestore(pending, state);
  state.writtenTestFiles = restore ? [...withoutOptimistic, restore] : withoutOptimistic;
  // This Write/Edit never landed, so if some card HAD already consumed the
  // entry, its run was never a genuine authoring run — un-stamp it.
  if (consumedCard) unstampAuthoringRun(consumedCard, state);
}
