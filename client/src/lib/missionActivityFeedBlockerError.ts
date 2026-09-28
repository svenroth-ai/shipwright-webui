import { excerpt, summarizeBlockerError } from "./missionActivityFeedText";
import type { ActivityCard, ActivityKind, PendingTool } from "./missionActivityFeedTypes";

/** Split out of `missionActivityFeedResolve.ts` (300-line convention) — the
 *  generic "a plain command failed" branch, the one case in that reducer
 *  with no test/subrunner/review bucket of its own. Pure state mutation, no
 *  behavior change. */

/** Attaches `detail`/`detailFull` from a bounded excerpt of raw tool-result
 *  content — the same "set `xFull` only when truncation actually happened"
 *  contract as every other `xFull` field ("nie croppen"). Also used by
 *  `missionActivityFeedResolve.ts` directly for the test-failure and review
 *  branches. */
export function attachDetail(card: ActivityCard, content: string): void {
  card.detail = excerpt(content);
  const full = excerpt(content, Infinity, Infinity);
  if (full.length > card.detail.length) card.detailFull = full;
  else delete card.detailFull;
}

/**
 * A plain command failed outside any of the test/subrunner/review buckets —
 * turns `pending.card` into a `blocker` and records it in
 * `unresolvedBlockers` for a later successful retry to recover.
 */
export function handleGenericBlockerError(
  pending: PendingTool,
  result: { content: string },
  unresolvedBlockers: Map<string, { card: ActivityCard; bucket: ActivityKind }>,
): void {
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
}
