import { toolResults, type UserEvent } from "../external/session-parser";
import { attachCommand, excerpt, resolveQuestionAnswer, summarizeBlockerError } from "./missionActivityFeedText";
import { rollbackFailedWrite } from "./missionActivityFeedAuthoringRollback";
import type { ActivityCard, ResolveState } from "./missionActivityFeedTypes";

export type { PendingTool, ResolveState } from "./missionActivityFeedTypes";

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
    if (pending.writtenTestFile && result.is_error) {
      // Sync the local `unresolvedTest` copy through `state` around the
      // call: rollback can retroactively OPEN the recovery slot (24th-round
      // external review catch, openai, medium — see `unstampAuthoringRun`'s
      // doc comment) for a card whose own `is_error` branch already ran and
      // skipped it, and that change must reach every later branch in this
      // loop (and the caller, via this function's return value).
      // 52nd-round catch (glm, low), ANSWERED — glm probed this local/`state`
      // copy pair for a divergence and found none, which matches the design:
      // these two lines are the ONLY window in which the two can differ, and
      // they bracket the single call that can mutate the slot. 66th (glm, low)
      // agrees it is correct and asks only whether `state.unresolvedTest`
      // should become the loop's single source of truth. DECLINED as a
      // refactor with no defect behind it: the bracket is two adjacent lines
      // around one call, so the fragility is visible at the point of risk,
      // whereas de-shadowing the local touches every read in this loop.
      state.unresolvedTest = unresolvedTest;
      rollbackFailedWrite(pending, result.tool_use_id, state);
      unresolvedTest = state.unresolvedTest;
    }
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
        // A TDD authoring run's own first (red) attempt must not get the
        // same "Failing" pill/accent a genuine verification failure gets
        // (spec-reviewer catch, iterate-2026-09-16-mission-feed-render-
        // fidelity: the reconcile-level exclusion alone left this, the
        // MOST common real-world trigger — a freshly-written test failing
        // on its first run — completely unguarded). The raw output is
        // still attached below either way; only the status/pill is gated.
        // 69th (glm, low), RECORDED DECISION at glm's own request, not a fix:
        // a failing authoring run therefore shows NO pill, the same as a
        // pending or recovered card, so the redness is only visible on expand.
        // That is the letter and the point of requirement 5 — no misleading
        // "Failing" gate stamp on a step that was never a verification. glm's
        // alternative (a distinct neutral "authoring" pill) invents vocabulary
        // the reported problem never asked for; it is the remediation to reach
        // for IF a user reports the ambiguity, not before.
        pending.card.status = pending.card.authoringRun ? undefined : "err";
        attachDetail(pending.card, result.content);
        // Unconditional (27th-round catch, openai, medium): `card.detail` can
        // legitimately end up empty (a whitespace/ANSI-only error output),
        // so it alone can't tell a retroactive un-stamp "this card's own run
        // failed" apart from "never failed at all".
        state.failedTestCards.add(pending.card);
        // An authoring run's own failure must never open a recovery slot
        // (3rd-round external review catch, openai, medium): the merge
        // branch below reuses `unresolvedTest`'s own card object, so a
        // later genuine success (e.g. "npm test" passing after a targeted
        // "vitest run foo.test.ts" red step) would otherwise be silently
        // folded into THIS card and inherit its `authoringRun: true` —
        // which `reconcileArtifactCards` then excludes from the gate
        // stamp, hiding the genuine Passing result entirely. A genuinely
        // non-authoring failure still opens the slot exactly as before.
        if (!pending.card.authoringRun) unresolvedTest = pending.card;
        awaitingTestResult.delete(pending.card);
      } else if (pending.background) {
        // A shell acknowledgement is not proof that the spawned job ended.
        // Keep the card pending until MissionContext records its result —
        // and keep it in `awaitingTestResult` too, for the same reason.
      } else if (unresolvedTest && !pending.card.authoringRun) {
        // `!pending.card.authoringRun` (12th-round external review catch,
        // openai, medium): a SUCCESSFUL authoring run must never be read as
        // recovery evidence for an earlier, unrelated genuine verification
        // failure — "npm test fails, then a freshly-written test passes" is
        // not the same event and merging them would stamp the authoring run
        // with the earlier failure's gate identity. The authoring card falls
        // through to the plain `awaitingTestResult.delete()` branch instead,
        // staying its own unstamped card while `unresolvedTest` stays open
        // for a later genuine retry to actually resolve.
        //
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
        // Overwrite (doubt-review catch): this recovery is replacing the
        // stale failed attempt with the just-succeeded retry as the card's
        // current truth, so the retry's own full command text must win
        // even if its truncated label happens to collide with the earlier
        // attempt's.
        attachCommand(unresolvedTest, pending.label, pending.full, { overwrite: true });
        cards.splice(cards.indexOf(pending.card), 1);
        testCards.splice(testCards.indexOf(pending.card), 1);
        awaitingTestResult.delete(unresolvedTest);
        awaitingTestResult.delete(pending.card);
        // 49th-round catch (glm, low), DECLINED: glm asks for a
        // `failedTestCards.delete(unresolvedTest)` here, mirroring the 43rd-
        // round rollback-replay merge. It would be a PROVABLE no-op, so no
        // test could falsify it: `failedTestCards` is read at exactly one
        // place (`unstampAuthoringRun`'s merge guard), which only ever runs
        // for a card whose `authoringRun` IS set — while line 95 above only
        // ever makes a card `unresolvedTest` when `!authoringRun`. The
        // recovered card can therefore never reach that guard. The sibling
        // delete is defensive symmetry in a path that already holds the set.
        unresolvedTest = null;
      } else {
        awaitingTestResult.delete(pending.card);
      }
    } else if (result.is_error) {
      pending.card.kind = "blocker";
      // A plain, human explanation of WHAT went wrong — derived from the
      // command's own output (the last non-empty line, which is the real
      // error for a traceback or a typical CLI failure) — never just a
      // static "needs attention" with no information a reader can act on
      // (reported, iterate-2026-09-16-mission-feed-render-fidelity). Falls
      // back to the generic sentence only when the output has nothing
      // usable (e.g. empty stderr).
      // 50th-round catch (glm, low), PINNED as DELIBERATE rather than changed:
      // this REPLACES whatever narration the turn wrote for itself, and the
      // `textFull` delete below discards its long form. The failure is the
      // card's news; the pre-failure prose describes an intent that did not
      // happen, and requirement 4 asks for the plain explanation "up front".
      // Moving it to `explanation` would also re-introduce the 19th-round bug
      // (stale narration resurfacing under the new sentence) one field over.
      const summary = summarizeBlockerError(result.content);
      pending.card.text = summary ? `A command failed: ${summary}` : "A command needs attention before work can continue.";
      // Marks `text` as a synthesized sentence (never a turn's own markdown-
      // authored prose) rather than gating the renderer on `kind ===
      // "blocker"` alone (18th-round external review catch, glm, medium) —
      // an explicit fact set at the exact mutation site, not an implicit
      // invariant a future change to this branch could silently break.
      pending.card.textLiteral = true;
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
      // The card's own `textLiteral` branch happens to never read `textFull`
      // today, but that's an accident of the render branch, not an enforced
      // invariant — clear it here too, mirroring the recovery path below
      // (28th-round external review catch, glm, low), so stale pre-blocker
      // narration can't resurface if that render branch ever changes. The 71st
      // (glm, low) asks whether a `textLiteral` card carrying `textFull` would
      // silently lose its expand toggle: it would, and THIS line plus its twin
      // on the recovery path are why no reducer-built card can be in that
      // state. The 28th round already turned that accident into an enforced
      // fact; nothing further to do.
      delete pending.card.textFull;
      // `add()` coalesces same-kind/text/artifact cards across several
      // tool_use ids (the "many-files-in-a-row" case), so this one command's
      // error excerpt could be misread as belonging to any of the card's
      // other, non-erroring chips. That used to mean withholding the raw
      // output entirely from a coalesced card — 42nd-round catch (openai,
      // medium, spec), FIXED: probed as `Read a.ts` + `Read b.ts` in one turn
      // with only b.ts failing, which derived ONE blocker card with both
      // chips and `detail: undefined`, so requirement 4's disclosure had the
      // command list and no output at all. The excerpt is now ATTRIBUTED
      // instead of withheld: the failing command's own label leads it
      // whenever the card names more than one, which removes exactly the
      // ambiguity the withholding was protecting against.
      //
      // 43rd-round catch (glm, low), DECLINED: glm asks to gate on
      // `commandCount > 1` instead, for a card whose TWO tool calls deduped to
      // ONE label (`commands.length === 1`, `commandCount === 2`). No
      // misattribution is possible there — both calls carry the SAME label, so
      // the single chip on screen already names the failing command exactly,
      // and prefixing would only reprint the chip's own text into its detail.
      // The ambiguity this guards is two DIFFERENT labels, which is precisely
      // `commands.length > 1`.
      // 65th (glm, low), traced and NO ACTION: an empty/whitespace-only error
      // output now SKIPS `attachDetail` where it previously called it and
      // no-op'd - identical outcome (the generic `textLiteral` headline, and
      // with no commands the no-disclosure shape pinned in round 35).
      if (result.content.trim()) {
        // 46th-round catch (glm, low), FIXED: `pending.label` is the chip's
        // TRUNCATED 180-char form, so a long failing command's attribution
        // line was itself cut. `pending.full` is that command untruncated.
        // 81st (glm, low, "cosmetic; no behavioral bug today"), DECLINED: glm
        // is right that `full` is typed `string`, so `??` cannot fire today —
        // but it is a Chesterton fence for the exact refactor glm names, and
        // the truncated label is the CORRECT degradation. Free; kept.
        const attributed = pending.card.commands.length > 1 ? `${pending.full ?? pending.label}\n${result.content}` : result.content;
        attachDetail(pending.card, attributed);
      }
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
        blocker.card.textLiteral = undefined;
        // The new recovery sentence is short and static — any `textFull`
        // from BEFORE this card ever became a blocker (a genuine turn's own
        // long headline) is now stale and unrelated to it (19th-round
        // external review catch, openai, medium: a "Show more" toggle would
        // otherwise resurface that old narration under the new sentence).
        delete blocker.card.textFull;
        blocker.card.status = undefined;
        blocker.card.detail = undefined;
        delete blocker.card.detailFull;
        // Same reasoning as the test-recovery merge above: overwrite so the
        // successful retry's own full text wins over a same-label collision
        // with the earlier failed attempt.
        attachCommand(blocker.card, pending.label, pending.full, { overwrite: true });
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
      // First-wins, not the blocker branch's ambiguity skip (doubt-review
      // catch, corrected after a regression test caught the first attempt):
      // `add()` can coalesce two review-bucket tool calls with no narration
      // between them into ONE card, each carrying its own real findings —
      // unlike a blocker's error excerpt (which is genuinely ambiguous
      // when several unrelated commands share the card), every review
      // result here is equally relevant, so skipping both when there are
      // 2+ commands would just as wrongly discard the FIRST review's
      // detail. Attach only while nothing has been recorded yet.
      if (!pending.card.detail) attachDetail(pending.card, result.content);
    }
  }
  return unresolvedTest;
}
