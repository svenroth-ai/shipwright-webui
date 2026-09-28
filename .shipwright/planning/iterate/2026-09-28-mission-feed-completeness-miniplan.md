# Mini-Plan: mission-feed-completeness

- **Run ID:** iterate-2026-09-28-mission-feed-completeness

## Files to create/modify

| File | Change |
|---|---|
| `client/src/lib/missionActivityFeedTypes.ts` | edit — add `ActivityFeed.sessionStartTimestamp?: string` |
| `client/src/lib/missionActivityFeed.ts` | edit — compute `sessionStartTimestamp` from the raw `events` array (earliest parseable timestamp), independent of which cards survive |
| `client/src/components/external/mission/MissionActivityFeedCardParts.tsx` | edit — `formatSessionStart` caller moves off `feed.cards[0]` |
| `client/src/components/external/mission/MissionActivityFeed.tsx` | edit — read `feed.sessionStartTimestamp` instead of scanning `feed.cards`; also narrows the `isSystem`/dashed check (AC5) |
| `client/src/lib/missionActivityFeedTurn.ts` | edit — `flushPendingNarration` stops tagging trailing narration as `kind:"system"`; introduce a distinct marker (reuse `"implement"` kind + a `trailing: true`-style flag, or new lightweight kind) |
| `client/src/lib/missionActivityFeedTransientError.ts` | new — `isTransientClassifierError` detector (AC3) |
| `client/src/lib/missionActivityFeedResolve.ts` | edit — skip blocker promotion for a transient classifier error (AC3); for a `test`-bucket card, SPLICE the card out of `cards`/`testCards` at the exact moment the transient rejection is identified rather than filtering at reconcile time (AC4 — see Work Breakdown step 6 for why) |
| `client/src/lib/missionActivityFeedReconcile.ts` | unchanged — the originally-planned reconcile-time filter was tried and reverted (see step 6) |
| `client/src/lib/missionActivityFeedSubrunner.ts` | edit — new `deriveSubrunnerNotificationFromAttachment` bridging function reuses `session-parser.ts`'s existing (unmodified) `extractTaskNotification` against an `attachment.type === "queued_command"` event's `prompt` (AC6; `session-parser.ts` itself is left alone per Internal Plan Review — keeps Mission-only reclassification out of unrelated consumers like `BubbleTranscript`) |
| `client/src/lib/missionActivityFeed.ts` | edit — new reducer branch for `event.kind === "attachment"`, also computes `sessionStartTimestamp` (AC1) |
| `server/src/external/mission-context/routes.ts` | edit — raise `RECOVERY_TAIL_BYTES` from `1024*1024` to `8*1024*1024` (AC2) |
| `server/src/core/mission-context/run-id-recovery.ts` | edit — raise `MAX_SCAN_CHARS` to match; `findRunIdFooter`/`recoverRunIdFromTranscript` gain a `startedMidFile` parameter (found during build, see spec Investigation Notes 2b) |
| `server/src/core/mission-context/resolver-io.ts` | edit — `ResolveRequest` gains optional `transcriptStartedMidFile` |
| `server/src/core/mission-context/resolver.ts`, `resolver-parts.ts` | edit — thread `transcriptStartedMidFile` into `buildRecoveryThunk` |
| `server/src/external/mission-context/wire.ts` | edit — compute `startedMidFile = fromByte > 0` at the true source, return it from `readTranscriptTail` |
| `server/src/external/mission-context/test-harness.ts` | edit — `HarnessOptions.reads[].startedMidFile` test seam |
| various `*.test.ts`/`*.test.tsx` siblings of the above | new/edit — one test per AC, several using the real session JSONL's measured shape as a fixture (AC2, AC6); AC2 additionally gets a full route-level test (`routes.recovery.midfile.test.ts`) per external review finding 2 |
| `client/src/lib/missionActivityFeedTransientTestDrop.ts` | new — bloat-driven split out of `missionActivityFeedResolve.ts` (see step 6): the transient-test-card splice + `authoringConsumedBy`/`restoreValidationPending` purge (code-review + doubt-review catches) |
| `client/src/lib/missionActivityFeedBlockerError.ts` | new — bloat-driven split out of `missionActivityFeedResolve.ts` (see step 6): the pre-existing, untouched generic "plain command failed" blocker branch, moved verbatim to make room |

## Work breakdown

1. **AC2 — association-scan window.** Bump `RECOVERY_TAIL_BYTES`/`MAX_SCAN_CHARS` to 8 MiB (kept the existing "still bounded" tests asserting a footer beyond the cap still returns null — the cap stays a cap, not unbounded). Additionally, found while implementing: raising the cap alone does not close the gap for a read that starts mid-file but is itself shorter than the cap (the length-based truncation check can never observe that case) — threaded a `startedMidFile` boolean from `wire.ts`'s own `fromByte > 0` computation through `resolver-io.ts`/`resolver.ts`/`resolver-parts.ts` into `run-id-recovery.ts`. Tests: pure-function coverage in `run-id-recovery-user-lines.test.ts` (byte-cut fragment adopted/declined by the flag), passthrough coverage in `run-id-recovery.corroboration.test.ts`, and a full route-level test in `routes.recovery.midfile.test.ts` per external review finding 2 (proves the wiring reaches the actual HTTP response, not just the unit).
2. **AC6 — subrunner notification parsing.** Root cause was two-layered, only the first half matched the original spec: the reducer never handled an `"attachment"` event at all (fixed via a new bridging function reusing `session-parser.ts`'s existing `extractTaskNotification`, added to `missionActivityFeedSubrunner.ts` rather than `session-parser.ts` itself), AND `isReviewTask` only recognizes tool name `"Task"`, never the harness's real dispatch tool `"Agent"` — found only by debugging a realistic fixture, not from the original investigation notes (which were corrected in the spec). Test (`missionActivityFeedSubrunnerAttachment.test.ts`, split out once the sibling test file crossed 300 lines) uses `name: "Agent"` dispatch, proving a `queued_command` attachment resolves a `subrunner` card to `done`/`failed`. `MissionActivityFeedCard`'s click wiring activates as an existing-gate consequence, no change needed there per Repo Scout.
3. **AC1 — session-start anchoring.** Add `sessionStartTimestamp` to `ActivityFeed`, computed once in `deriveActivityFeed` from `events[0].timestamp` (first entry carrying one), independent of `cards`. Update the divider's consumer. Test: a transcript whose first several turns produce no cards still reports the transcript's true first timestamp.
4. **AC5 — mis-styled trailing narration.** Change `flushPendingNarration`'s produced card's `kind` (or add a discriminating field) so `MissionActivityFeed.tsx`'s dashed/gear check only fires for `isCompactionMarker`-sourced cards. Test: a trailing closing-narration card renders undashed; a real compaction-marker card still renders dashed.
5. **AC3 — stale transient-error blocker cards.** Added `isTransientClassifierError` (new file `missionActivityFeedTransientError.ts` — both `missionActivityFeedText.ts` and `missionActivityFeedResolve.ts` were already exactly at the 300-line convention ceiling) detecting the harness's own fixed "gave no verdict (error)..." signature; such a result never becomes/stays a `blocker` card. Test: a `tool_result` carrying that exact text does not produce a blocker card; a normal command failure still does.
6. **AC4 — textless cards.** The originally-planned approach (extend the reconcile-time wordless-card filter to `test`-bucket cards) was IMPLEMENTED AND REVERTED during build: it also matched a legitimate MERGED recovery card (one that genuinely failed then recovered via retry), which by reconcile time has degraded to the exact same field-shape (`text: ""`, no `detail`, no `status`) as a transient-rejection artifact — reconcile time cannot tell the two apart. Fixed instead in `missionActivityFeedResolve.ts` (now `missionActivityFeedTransientTestDrop.ts`'s `dropTransientTestCard`, split out — see below): the transient-rejection card is SPLICED out of `cards`/`testCards` the instant the rejection is identified, which is unambiguous there and safe specifically because test-bucket cards are never coalesced (unlike other buckets, where multiple tool_use ids can share one card object). Test: a spliced transient card never reaches the final feed; a card that failed for real then recovered on retry is kept (the regression the reconcile-filter approach caused).
   - **Code-review catch (high), found in the review cascade and fixed before commit:** splicing a card out of `cards`/`testCards`/`awaitingTestResult` alone left it still reachable as a VALUE in the pre-existing `state.authoringConsumedBy` map whenever the dropped card was also a TDD authoring run (its target matched a just-`Write`-ten file). A LATER, out-of-order rollback of that backing Write (`rollbackFailedWrite`/`unstampAuthoringRun` in `missionActivityFeedAuthoringRollback.ts` — tool_results do not reliably preserve tool_use order, a fact that module's own 18th/38th-round history already established) could then look the detached card up and misread its "neither failed nor pending" shape as a SUCCESSFUL recovery, clearing an unrelated, still-open genuine test failure's red status. Fixed by also purging the `authoringConsumedBy` entry (and clearing `card.authoringRun`) at splice time, in `dropTransientTestCard`. Regression test in `missionActivityFeedTransientClassifierError.test.ts` mirrors `missionActivityFeedAuthoringRollback.test.ts`'s own "write-first"/"run-first" ordering probe, confirmed to fail without the fix (run-first order) and pass with it.
   - **Doubt-review catch (high), found in the third review pass and fixed before commit:** `authoringConsumedBy` is not the only path into `unstampAuthoringRun` — `state.restoreValidationPending` is a second, deferred one, populated when a same-turn SECOND Write/Edit to the same path fails while its own EARLIER write's fate is still unknown (`missionActivityFeedAuthoringRollback.ts`'s `else` branch, keyed by the earlier write's tool_use id rather than the later one `authoringConsumedBy` uses). A card can remain a value there even after its `authoringConsumedBy` entry was already purged, since the two maps are keyed by different tool_use ids belonging to different writes. Fixed by adding a second purge loop over `restoreValidationPending` inside the same `if (card.authoringRun)` guard in `dropTransientTestCard`. Regression test (three-tool_use `w0`/`w1`/`authoring` fixture, results delivered `w1-error → authoring-transient-reject → w0-error`) confirmed via the same revert-run-restore rigor: fails without the second purge loop (the dropped card's command wrongly resurfaces merged into the unrelated `npm test` failure), passes with it.
   - **Bloat follow-up:** the AC3/AC4 work (plus the high-severity fix above) pushed `missionActivityFeedResolve.ts` from its already-at-ceiling 300 lines to 332+. Split further into `missionActivityFeedTransientTestDrop.ts` (the splice+purge helper) and `missionActivityFeedBlockerError.ts` (the pre-existing, untouched generic "plain command failed" branch — a cohesive, self-contained ~80-line chunk with no AC3/AC4 involvement, extracted purely to make room) — both real file-level splits, not a per-handler slice or comment trim. `missionActivityFeedResolve.ts` ends at 234 lines.
7. **AC7 — verification only.** No code needed: `review-state.ts`/`decision-drops.ts` are driven entirely by `context.artifacts`, which AC2's fix already populates. Verified two ways — the AC2 route-level test (`routes.recovery.midfile.test.ts`) already proves `scenario` resolves to `"iterate"` from a recovered run id, and a direct one-off script run against the REAL reported transcript (`8a1e7a70-…jsonl`) confirmed `findRunIdFooter`/`recoverRunIdFromTranscript` now recover and corroborate the real run id that the old 1 MB cap could not see at all (checked by slicing the same file to the old cap and confirming the footer regex does not match).
8. Self-review, Confidence Calibration + Test Completeness Ledger, review cascade, finalization (F0–F11).

## Test strategy

Per-AC unit/component tests in `client`/`server` Vitest (see table above); no
new E2E spec needed — none of the six fixes changes a user *interaction*
flow, only feed-derivation/classification and one server constant, all
already covered by this project's extensive existing Vitest suite for this
exact module family. `npm run test` (both workspaces) is the F0.5 web
runner command.

## Alternative approach considered (medium — required)

**Alternative for AC2 (rejected): read the whole transcript file for the
"wide" recovery reach-back instead of raising a fixed byte cap.**
Would guarantee finding the footer regardless of file size, and is tempting
given the recovery path already runs rarely (gated by `wideWindows`,
at most once per un-identified task per transcript-growth-tick). **Rejected**
because `wire.ts`'s own contract comment is explicit and reviewed multiple
times already: "never above `RECOVERY_TAIL_BYTES` (so no code path can turn
this into an unbounded read of a multi-MB JSONL)" — an unbounded read
contradicts CLAUDE.md rule 6 (torn-read budget, positional tail reads) in
spirit even outside the hot transcript-polling path, and a maliciously or
accidentally huge JSONL (a runaway tool-output loop) would turn one "rare"
recovery poll into an arbitrarily expensive read with no ceiling. A larger
*but still fixed* cap (8 MiB — ~3x the measured worst case's actual need of
~2.8 MB, and small relative to available memory) keeps the same "belt and
braces, deliberately bounded" contract this module was built around, just
recalibrated against the first real measured shortfall, matching this
repo's own convention of ratcheting numbers from measurement rather than
guesswork (e.g. the 256 KB/512 KB/16 KB caps already documented alongside
similar reasoning in `decision-drops.ts`).
