# Iterate Spec: mission-feed-completeness

- **Run ID:** iterate-2026-09-28-mission-feed-completeness
- **Type:** change
- **Complexity:** medium (escalated from Stage-1 `small` after Repo Scout found the report spans 6 distinct root causes across `missionActivityFeed*`, `session-parser.ts`, and the server-side mission-context resolver — genuinely cross-component, not one narrow bug)
- **Status:** implemented

## Goal

Sven reviewed a real, finished iterate session (task `6053b0e9-fd8d-43e6-811d-031c9dab33ba`,
session `8a1e7a70-a4ed-41ec-be1e-83211838ba10`, "Iterate: Fix for 01 [auto]
Codextender launches...", merged as PR #490 / commit `b4c2b853`) in the Mission
tab and found six distinct completeness/correctness defects in the activity
feed and artifact panel, reported with screenshots. The Mission tab must
accurately and completely narrate what a real session did — no fabricated
"failed"/"cut off" framing, no stuck-forever states, no dead-end clicks, and
no session silently missing its whole artifact rail.

## Acceptance Criteria

- [x] AC1 — The feed's "Session started" divider is anchored to the
      transcript's true first parseable event timestamp (not the first
      *surviving* card's timestamp), so a session whose early turns produced
      no cards no longer reports a misleadingly-late start time.
- [x] AC2 — A task whose real session transcript is large enough that its F6
      commit's `Run-ID:` footer falls outside the previous 1 MB tail-recovery
      window still resolves to `scenario: "iterate"` and renders its full
      artifact rail (Requirement/Spec/Tests/Review/Commit), reproduced and
      fixed against the real session referenced above (footer at ~byte
      2.1 MB in a 4.9 MB transcript). Also fixes a second, deeper mechanism
      found during build (see Investigation Notes item 2b): a truncated
      bounded-tail read's own leading line can be a byte-cut JSONL fragment
      even when it is nowhere near the (now 8 MiB) scan cap, and the scanner
      had no way to know a read started mid-file except by its own length.
- [x] AC3 — A `blocker` card synthesized from the harness's own transient
      "auto mode classifier gave no verdict" tool-call error is never rendered
      as a permanent "command failed" / "ended before the blocker was
      resolved" card.
- [x] AC4 — A card with no `text`, `explanation`, `detail`, or `question` and
      no resolved pill (currently only reachable by a `test`-bucket card) is
      dropped, matching the existing drop rule for `implement`/`investigate`/
      `spec` cards.
- [x] AC5 — An ordinary trailing narration turn (e.g. a closing status report)
      no longer renders with the dashed border + gear icon reserved for a real
      system/infra event (context compaction); only `isCompactionMarker`-
      sourced cards get that treatment.
- [x] AC6 — A review-subagent (`code-reviewer`/`doubt-reviewer`) dispatched via
      the harness's real dispatch tool (`Agent`, not `Task` — see Investigation
      Notes item 5) whose completion notification arrives as a
      `queued_command` attachment (not a `"user"`-kind JSONL record) resolves
      out of `"Running…"` into `"done"`/`"failed"`, and its card becomes
      clickable, exactly as one whose notification arrives the other way
      already does.
- [x] AC7 — Verify (no new mechanism expected): once AC2 lands, the same real
      task's Review and Decisions artifact chips render normally (doubt-review
      row + the pending decision-drop), confirming the "doubt-reviewer /
      decision-drop not linked" complaint was a downstream symptom of AC2's
      root cause, not a separate gap in `review-state.ts`/`decision-drops.ts`
      (both already model exactly this: `doubt` as a `reviews.json`-backed
      row, and a pre-release decision drop as an `available` "not yet
      published" entry). Confirmed directly against the real transcript: the
      old 1 MB cap could not see the footer at all; the fixed recovery path
      finds and corroborates `iterate-2026-09-28-codextender-auto-mode-server`
      (matching `work_completed` event `evt-eaac74c4` in
      `shipwright_events.jsonl`).

## Spec Impact

- **Classification:** modify
- **MODIFY:** `FR-01.66` (Mission view — context-aware artifacts). AC2/AC7 fix
  the association-scan window that starves the whole artifact rail;
  AC1/AC3/AC4/AC5/AC6 fix narration/card-classification completeness and
  correctness. `FR-01.68` (Mission middle card told as prose) is a folded
  `delta` row under `FR-01.66` per the FR taxonomy regrouping, not a
  standalone top-level requirement — `FR-01.66` is the survivor ID cited for
  traceability/finalize-gate purposes (confirmed against
  `.shipwright/planning/01-adopted/spec.md`).
- **ADD:** none
- **REMOVE:** none

## Out of Scope

- Building new artifact-chip machinery for doubt-review/decisions (AC7 is a
  verification step, not new code, unless the server-side investigation at
  build time proves the mechanism itself is also broken).
- Any UI redesign of the Mission tab beyond the six defects above.
- The still-unresolved `mission-feed-*`/`mission-mobile-visual` local
  worktrees found stale on disk during setup (pre-existing, unrelated,
  never merged) — out of scope, not touched.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `session-parser.ts` (`"attachment"` case, `queued_command.prompt`) | `missionActivityFeed.ts` reducer dispatch loop | JSONL event → `ParsedEvent` |
| `wire.ts` `readTranscriptTail` (`RECOVERY_TAIL_BYTES` clamp) | `run-id-recovery.ts` `findRunIdFooter` | raw transcript text (bounded tail) |

`touches_io_boundary` applies to the second row (a producer/consumer pair
across a serialized boundary — the bounded transcript-tail read feeding the
regex-based footer recovery) — Boundary Probe required in Build.

## Confidence Calibration

- **Overall confidence: high.** All 6 reported defects were root-caused
  against real transcript data (not guessed), fixed, and each fix is pinned
  by a test that fails on the pre-fix code and passes on the post-fix code.
  AC2's fix was additionally verified against the *actual* real session JSONL
  that triggered the report (see AC7 above), not just synthetic fixtures.
- **What would lower confidence:** a 7th, still-unreported defect in the same
  family (the report's six were themselves found by one manual UI pass, not
  an exhaustive audit) — this is disclosed under Out of Scope, not fixed
  here.
- **Lowest-confidence individual fix:** AC2's `startedMidFile` threading
  (Investigation Notes 2b) — it changes a 5-file call chain for a mechanism
  that has apparently never fired in production (no bug report traces to it
  specifically; it was found by code-reading the existing truncation-boundary
  fix, not from a symptom). Mitigated by: the change is purely additive
  (optional field, default `false`, existing callers/tests untouched), full
  server suite (4514 tests) is green, and dedicated tests exercise the exact
  byte-cut-fragment scenario both with and without the flag.
- **Verified, not assumed:** that `isReviewTask` really never matches `"Agent"`
  (read the source, confirmed via a real dispatch fixture test) rather than
  trusting the original bug report's framing of "Task dispatches" (which was
  imprecise — see Investigation Notes item 5's correction history).

## Test Completeness Ledger

| AC | Test file(s) | Category | Proves |
|---|---|---|---|
| AC1 | `missionActivityFeedSessionStart.test.ts`, `MissionActivityFeedSessionStart.test.tsx` | unit + component | divider anchors to `feed.sessionStartTimestamp`, computed from raw events, independent of surviving cards; malformed/absent timestamp renders nothing |
| AC2 | `run-id-recovery.test.ts`, `run-id-recovery-user-lines.test.ts`, `run-id-recovery.corroboration.test.ts`, `routes.recovery.midfile.test.ts`, `wire.test.ts` | unit + integration | 8 MiB cap recovers the measured real-world footer distance; `startedMidFile` passthrough at the pure-function, corroboration, AND full route→resolver→recovery-thunk levels; real-transcript check (AC7, same evidence); external-review catch (openai, medium) — `wire.ts`'s own `fromByte`/`startedMidFile` arithmetic, previously untested at any level, now proven directly against a mocked `SessionWatcher` for both a small file and one exceeding `RECOVERY_TAIL_BYTES` |
| AC3 | `missionActivityFeedTransientClassifierError.test.ts` | unit | transient classifier error never promotes/stays a blocker; a genuine command failure still does (negative control); external-review catch (openai, medium) — a transiently-rejected `Write` of a test file rolls back its optimistic tracker entry (previously skipped for any non-test bucket), so a later genuine test run is not misclassified as continuing that write |
| AC4 | `missionActivityFeedTransientClassifierError.test.ts` | unit | a wordless test-bucket card from a spliced transient rejection does not survive into the merged/reconciled feed; a legitimate recovered failure-then-pass card is NOT wrongly dropped (the regression the reconcile-filter approach broke — coverage pre-dates this iterate, `missionActivityFeed.test.ts`'s "requires a verified retry before a failed test episode can recover"); a spliced authoring-run card cannot be resurrected via `authoringConsumedBy` by a later out-of-order Write rollback to falsely "recover" an unrelated genuine failure (code-review catch, high — both result orderings); nor via the second, deferred `restoreValidationPending` path populated by a same-turn second Write to the same path (doubt-review catch, high — three-tool_use W0/W1/authoring reproduction, confirmed to fail without the second purge loop and pass with it) |
| AC5 | `missionActivityFeed.splitTurn.test.ts`, `MissionActivityFeedSessionStart.test.tsx` | unit + component | trailing narration gets `kind:"note"`, not `"system"`; only `isCompactionMarker` cards get the dashed/gear treatment |
| AC6 | `missionActivityFeedSubrunnerAttachment.test.ts`, `missionActivityFeedTransientClassifierError.test.ts` | unit | an `Agent`-dispatched reviewer's `queued_command` attachment notification resolves the subrunner card to done/failed; external-review catch (glm, low — investigation surfaced a deeper bug than reported) — a subrunner dispatch's error ack, transient OR genuine, now actually reaches `applySubrunnerAck`'s existing fail-closed path instead of being pre-empted into a plain `blocker` card by the generic error branch (negative control proves a genuine dispatch failure resolves to `"failed"`, never `"blocker"`) |
| AC7 | `routes.recovery.midfile.test.ts` + manual real-transcript verification (Investigation Notes / AC7 note above) | integration + manual | artifact rail is a pure downstream consequence of AC2's fix, no separate code path needed |

No E2E/Playwright additions — none of the six fixes changes a user
*interaction* flow (per mini-plan's Test strategy), only feed-derivation,
card-classification, or a server-side recovery constant/threading, all
exercised by the existing Vitest suites above.

**F0.5 real-browser regression caught and fixed:** running the existing
relevant Mission-tab Playwright specs (`mission-feed-transcript-fidelity`,
`mission-recovery-schedule`, `mission-run-identity-recovery`,
`mission-subrunner`) surfaced a real failure jsdom-level Vitest could not:
`mission-feed-transcript-fidelity.spec.ts`'s pre-existing "issue #3" test
asserted a trailing-narration card carries `data-kind="system"` — exactly
the styling AC5 intentionally removes. Fixed by updating that assertion to
`data-kind="note"` (the new kind `flushPendingNarration` now emits). All 12
tests across the 4 specs pass; `surface_verification.py` recorded
`exit_code: 0`, `tests_run: 12`.

## Verification (medium+)

- **Surface:** web
- **Runner command:** `npm run test` (client + server Vitest) plus a targeted
  fixture-driven regression test per AC using the real session JSONL's
  measured shape (byte offsets, `attachment`/`queued_command` event shape)
  where reproducing the exact real-world failure matters (AC2, AC6).
- **Evidence path:** `client`/`server` Vitest output; F0.5 web E2E if any
  fix touches rendering behavior Playwright can observe.
- **Justification:** n/a — real startable web surface exists.

## External Plan Review (external_review.py --mode iterate)

- **Provider:** openai (via codex) — verdict `revise`. glm errored locally
  (`openai` python package not installed on this machine) — `unavailable`,
  not a disagreement.
- **Findings, all triaged `fix` and folded into the mini-plan:**
  1. *edge-case, medium* — AC1's "first parseable timestamp" must validate
     the timestamp is actually parseable, not just present, before treating
     it as the session start. → mini-plan step 3 now says "first entry
     carrying one" and the build must guard with a real parse check
     (`!Number.isNaN(Date.parse(...))`), tested with an invalid-then-valid
     timestamp pair.
  2. *dependency, medium* — AC2's test must prove the FULL path (resolver
     scenario → artifact rail), not just the footer-scanner unit in
     isolation, since `readTranscriptTail`'s own clamp is an equally
     necessary part of the fix. → mini-plan step 1 adds a resolver/route-
     level regression test alongside the `run-id-recovery.ts` unit test.
  3. *approach, low* — don't duplicate the transient-error text-match in
     both `missionActivityFeedResolve.ts` and `missionActivityFeedReconcile.ts`;
     classify once at the tool-result boundary. → mini-plan step 5 fix moved
     to `resolve.ts` only; reconcile's "ended before resolved" wording is
     avoided as a natural consequence (the card never enters
     `unresolvedBlockers`), not via a second text match.
- **Resolution:** single-reviewer pass accepted per `external_review.py`'s
  own degraded-mode contract (one opinion is enough to proceed); recorded via
  `mark-review-state.py --review-type iterate`.

## Architecture Review (external_review.py --mode architecture)

- **Provider:** openai (via codex) — verdict `approve`. glm unavailable
  (same local cause as above).
- **Assessment:** six targeted fixes inside existing modules, no new
  standing mechanism, no findings. Raising `RECOVERY_TAIL_BYTES` to 8 MiB
  judged the smallest thing that would do the job; nothing forecloses a
  future change.

## Internal Plan Review (opus-plan-reviewer)

- **Verdict: approve.** Run retrospectively (the sub-step was missed during the
  original medium+ planning pass — a process gap, not a plan defect) against
  the already-implemented, already-tested state.
- **Findings, all low/informational, none blocking:**
  1. *documentation, low* — the mini-plan's files table was stale relative to
     the actual bloat-driven split. **Fixed**: table now lists
     `missionActivityFeedTransientTestDrop.ts` and
     `missionActivityFeedBlockerError.ts` explicitly.
  2. *architecture, low (hardening suggestion, not a live gap)* — the reviewer
     independently re-derived every `Map`/`Record` field in `ResolveState`
     that can hold an `ActivityCard` value (`pendingTools`,
     `unresolvedBlockers`, `authoringConsumedBy`, `restoreValidationPending`)
     and confirmed the two purges already shipped
     (`authoringConsumedBy` + `restoreValidationPending`) are the complete
     set for the current shape — no further fix needed today. Suggested a
     generic invariant test enumerating those fields so a future third
     dangling-reference map can't reopen the same bug class silently.
     **Deferred as a follow-up**, not implemented here: it is forward-looking
     hardening against a hypothetical future map, not a fix for a defect that
     exists in the current diff, and the reviewer explicitly said neither
     finding should hold up merge.
  3. *testing, low* — AC5's visual-styling change is verified only at
     component (jsdom) level, not real-browser/E2E; judged sound given no
     interaction flow changed, flagged for awareness only.
  4. *performance, low* — the 8 MiB cap still goes through the existing
     non-blocking positional-read primitive; not spelled out explicitly in
     the docs but confirmed true by inspection.
  5. *process, informational* — a mini-plan cross-reference to "Internal Plan
     Review" predates this actual first formal pass; noted as a harmless
     forward-reference, no action needed.

## External Code Review (external_review.py --mode code)

Run against the actual committed diff (`git diff HEAD~1 HEAD` off commit
`76efd4e0`), driver `claude` (the real harness; `CODEXTENDER_ACTIVE` was not
set this session). glm verdict **approve**, openai verdict **revise** — not a
contradiction requiring resolution (`external_review.py`'s own check:
adjacent verdicts, comparable). 6 findings total, 3 substantive, 3
convergent/duplicate framings of the same 2 underlying issues.

1. **openai, medium (bug) — FIXED.** `missionActivityFeedResolve.ts`'s
   transient/non-test `continue` ran BEFORE the `writtenTestFile`+`is_error`
   rollback, so a transiently-rejected `Write`/`Edit` of a test file (bucket
   `implement`/`review`/`spec`/`investigate` — a `Write` is never bucket
   `test`) left its optimistic `writtenTestFiles` tracker entry in place even
   though the write never landed, risking a later real test run being
   misclassified as continuing that authoring run. Fixed by moving the
   rollback block before the `continue`. Verified via revert-run-restore: a
   new regression test in `missionActivityFeedTransientClassifierError.test.ts`
   fails without the fix (2 test cards instead of 1) and passes with it.

2. **glm, low (edge-case) — FIXED, and the investigation surfaced a DEEPER,
   more severe bug than the one glm actually described.** glm's stated
   finding was narrow: a transiently-rejected non-test-bucket dispatch (e.g.
   a subrunner `Agent`/`Task` call) is skipped entirely by the same
   `continue`, leaving its card stuck "Running…" forever — the same
   stuck/unclickable symptom class AC6 exists to fix, via a different
   trigger. Exempting the `subrunner` bucket from the `continue` (mirroring
   `test`) was the intended fix, but writing the regression test proved that
   alone did nothing: `resolveToolResults`'s generic `else if
   (result.is_error)` blocker branch matched ANY error for ANY
   not-yet-excluded bucket and ran BEFORE the `subrunner`-bucket branch ever
   got reached, converting even a genuine (non-transient) dispatch failure
   into a plain `blocker` card. This meant `applySubrunnerAck`'s existing
   `isError`->`"failed"` fail-closed path — already covered by direct unit
   tests in `missionActivityFeedSubrunner.test.ts`, and explicitly documented
   as the handler for "a dispatch that failed to launch at all" — was
   UNREACHABLE from the real reducer for every kind of dispatch error, not
   only a transiently-rejected one. Fixed by reordering the `subrunner`
   branch to run before the generic blocker branch (removing the now-dead
   duplicate branch further down). Verified via revert-run-restore with two
   regression tests: a transient-rejection case and a negative-control
   genuine-failure case, both failing without the reorder and passing with
   it; full client suite (483 files / 4400 tests) still green.

3. **openai, medium / glm, low (both pointing at the same mechanism) —
   initially REJECTED with reason, later FIXED FOR REAL after a third,
   independent review pass raised it again (see the F11 local preflight note
   below — superseding this entry's original disposition).** Both reviewers
   questioned whether `run-id-recovery.ts`'s `startedMidFile`-driven
   unconditional drop of the tail read's leading line could discard a
   genuinely COMPLETE line (and, worst case, the very `Run-ID:` footer line)
   whenever the read happened to start exactly on a `\n` boundary.
   Investigated directly against `session-jsonl-io.ts`'s `readTailFromDisk`
   (the real positional-read primitive `wire.ts` calls through
   `SessionWatcher.readChunk`): it performs a RAW byte-offset read
   (`start = Math.min(Math.max(fromByte, 0), size)`, then a straight
   positional read loop) with NO `\n`-boundary snapping anywhere — CLAUDE.md
   Architecture rule 5 ("cut on `\n` boundaries only") describes the ordinary
   streaming transcript reader, not this bounded tail read. `wire.ts`
   computes `fromByte = loc.sizeBytes - budget`, an arbitrary byte-count
   subtraction with no relationship to line boundaries, so it essentially
   never lands exactly after a `\n` in a real transcript (odds on the order
   of 1-in-hundreds-to-thousands, gated by an already-rare degraded/
   reach-back path). At the time this was judged a correct, deliberately
   conservative default given the reader gave no boundary signal either way,
   and plumbing a boundary-peek signal through 4 layers to close a
   near-zero-probability theoretical gap was judged not worth the
   complexity. **That judgment changed** once the SAME concern was raised a
   third time, independently, by the local PR-review preflight (a different
   review instance with no memory of this reasoning) — converging findings
   across independent reviewers are worth fixing rather than re-arguing.
   `wire.ts` now peeks the one byte before its intended tail start instead of
   assuming; see the F11 preflight note below for the actual fix and its
   verification.

4. **glm, medium (test) / openai, medium (test) — both ADDRESSED, one
   pre-existed and one was a genuine gap, now closed.**
   - glm: the AC4 ledger's evidence citation didn't include a case where a
     test invocation genuinely fails (real red) then genuinely retries and
     passes, and glm couldn't find one in the file it reviewed
     (`missionActivityFeedTransientClassifierError.test.ts`, this iterate's
     new file). **Not a real gap** — that coverage already exists, pre-dating
     this iterate and outside the diff glm was scoped to:
     `missionActivityFeed.test.ts`'s `"requires a verified retry before a
     failed test episode can recover"` (confirmed still passing).
   - openai: `routes.recovery.midfile.test.ts` proves the `startedMidFile`
     signal threads correctly through route -> resolver -> recovery (its own
     stated purpose), but injects the flag directly through the test
     harness's `reads:` seam rather than exercising `wire.ts`'s own
     `fromByte`/`startedMidFile` arithmetic against a real `SessionWatcher`.
     Checked: `wire.ts` had ZERO test coverage of any kind before this
     iterate. **Fixed** — new `server/src/external/mission-context/wire.test.ts`
     directly exercises `createWiredMissionContextRouter`'s
     `readTranscriptTail` closure against a mocked `SessionWatcher`, proving
     the `fromByte = size - budget` arithmetic and the `startedMidFile`
     signal for both a small file (byte 0, `false`) and one larger than
     `RECOVERY_TAIL_BYTES` (positive offset, budget clamped into
     `[TRANSCRIPT_TAIL_BYTES, RECOVERY_TAIL_BYTES]`, `true`).

External review pass recorded via `record_review_pass.py` (`external_code`,
completed, 6 findings, disposition summarized above); raw replies preserved
at `.shipwright/planning/iterate/iterate-2026-09-28-mission-feed-completeness/external-code-review-raw.json`.

**F11 local PR-review preflight (`pr_review.py`, separate gate, advisory-only
— never satisfies the required CI check) caught four more findings across
four runs — three real gaps, all FIXED, plus one investigated and REJECTED
with direct empirical evidence rather than argument:**

- **Run 1**: `missionActivityFeedTransientError.ts`'s `isTransientClassifierError`
  matched on the fixed PREFIX alone via `startsWith`, so any content beginning
  with that exact sentence would classify as transient regardless of what
  followed — including, in principle, a genuinely different failure whose own
  output happened to open with it. Tightened to a regex anchoring both the
  prefix AND the fixed suffix that follows the tool name, so only content
  matching the harness's whole known template qualifies. Verified via
  revert-run-restore: a new negative-control test ("shares only the fixed
  prefix, not the fixed suffix") fails without the fix and passes with it;
  full client suite (483 files / 4401 tests) green afterward.
- **Run 2**: this SAME preflight independently re-raised the `startedMidFile`
  boundary concern already investigated and rejected-with-reason above (a
  fresh review pass, with no memory of that reasoning). Raised across two
  independent review instances now, on reflection the theoretical gap was
  worth closing for real rather than re-arguing probability a third time:
  `wire.ts`'s `readTranscriptTail` now reads ONE BYTE BEFORE its intended
  tail start (when that start is not byte 0) and peeks it — `\n` proves the
  intended start is itself a genuine line boundary (`startedMidFile: false`),
  anything else proves a genuine byte cut (`startedMidFile: true`); the
  peeked byte is stripped either way so the returned text keeps its exact
  prior `[target, EOF)` contract. This replaces an assumption with a proof,
  at the cost of one extra byte per recovery-window read. Verified via
  revert-run-restore with a `fromByte`-aware mock (returning different
  content depending on which byte offset was actually requested, so the test
  can tell "peeked" apart from "never looked" — a fixed-content mock cannot):
  the real-line-boundary case fails without the fix (loses a genuinely
  complete footer line) and passes with it; the genuine-byte-cut case is
  unaffected either way (both correctly drop). Full server suite
  (422 files / 4526 tests) green afterward.
- **Run 3**: also flagged the Run 2 fix's own OTHER half from a different
  angle — `run-id-recovery.ts`'s negative-scan memo (`negativeScans`)
  fingerprinted only the transcript TEXT, not the `startedMidFile` flag also
  passed alongside it, even though that flag changes what `findRunIdFooter`
  does with the SAME text. Analysis found this is not reachable through
  today's only real call path (`wire.ts` always threads one read's text and
  its own `startedMidFile` together, one pair per poll, so the two never
  actually diverge for identical content in production) — but the memo
  itself does not encode that invariant, so it would silently break for any
  future caller that reads the same content under a different boundary
  assumption. Fixed defensively rather than re-argued a third time, matching
  the Run 2 disposition: `tailFingerprint` now folds `startedMidFile` into
  the cached key. Verified via revert-run-restore with a same-session,
  same-text, opposite-`startedMidFile` regression test (a corroborated
  byte-cut fragment scanned first with `startedMidFile: true`, finding
  nothing and caching that null, then the identical text and session scanned
  again with `startedMidFile: false`, which must now find the footer instead
  of replaying the stale cached null): fails without the fix, passes with
  it. Full server suite (422 files / 4527 tests) green afterward; the file
  briefly crossed 300 lines and was trimmed back to 299 by condensing the
  new doc comment rather than the pre-existing ones.
- **Run 4**: raised TWO findings against the Run 2 fix.
  (a) REJECTED, with direct evidence: claimed the byte-peek read requests
  only `budget` bytes from `fromByte = target - 1`, so it could omit the
  transcript's true final byte. Traced the real call chain
  (`SessionWatcher.readChunk` -> `readTailFromDisk`): the read always goes
  through to the file's ACTUAL current EOF regardless of `fromByte`
  (`length = size - start`, no length cap ever passed), and `readChunk`
  then trims to the last `\n` found in whatever it read — a boundary fixed
  by the file's own content up to true EOF, not by where the read started.
  Starting one byte earlier can only add to the FRONT of what's read; it
  cannot move that trailing boundary. Proved this empirically rather than
  by argument alone (this reviewer's own template, applied to itself): a
  throwaway script against the real `readTailFromDisk` confirmed
  byte-peeked and non-peeked reads of the same file produce identical
  trailing content, including a genuine final complete line; a permanent
  regression test was then added directly to `session-watcher.test.ts`
  (real disk I/O, no mocks) proving the same thing against the actual
  `SessionWatcher.readChunk` the production code calls, so a future change
  to the trimming logic that broke this would be caught.
  (b) FIXED, real gap: `stripUserTypeLines`'s `lines.length > 1` guard meant
  a proven mid-file read whose ENTIRE window is a single unterminated line
  (one JSONL record bigger than the read budget — an edge case, but not an
  impossible one for a huge tool_result) never had its leading fragment
  dropped at all, even though `startedMidFile` proved it was a byte-cut
  fragment — the exact class the multi-line case already closes. Removed
  the guard; `lines.shift()` on a single-element array correctly yields no
  candidate. Verified via revert-run-restore with a no-newline-at-all
  fixture: fails without the fix, passes with it. Full server suite
  (422 files / 4528 tests) green afterward.

## Investigation Notes (Repo Scout findings, for the record)

Root causes were confirmed by three parallel read-only investigations plus
direct measurement against the real session JSONL and the corresponding
server source:

1. **AC1** — `MissionActivityFeed.tsx` derives `sessionStartLabel` from
   `feed.cards[0].timestamp`, but early noisy/investigate-only turns can
   produce zero surviving cards, so the divider silently reports whatever
   later turn *did* survive as "session started."
2. **AC2** — measured directly: the session JSONL is 4,917,111 bytes; its F6
   commit's `Run-ID: iterate-2026-09-28-codextender-auto-mode-server` footer
   sits at byte offset ~2,125,566 (4 occurrences, lines 837/928/1150/1191 of
   2292). `RECOVERY_TAIL_BYTES = 1024*1024` (`routes.ts:75`) clamps both the
   file-level tail read (`wire.ts`) and the regex scan window
   (`run-id-recovery.ts` `MAX_SCAN_CHARS`) to the last 1 MB — starting at byte
   ~3,868,535, which never reaches the footer. Corroboration
   (`hasRunRecord`) is NOT the problem — both `iterates/<run_id>.json` and a
   `work_completed` event exist on disk for this run; the footer is simply
   never read.
2b. **AC2, found during build** — raising `RECOVERY_TAIL_BYTES`/`MAX_SCAN_CHARS`
   alone leaves a second, narrower gap: `findRunIdFooter`'s own
   `transcript.length > MAX_SCAN_CHARS` truncation check can only ever fire
   when the STRING it was handed is itself larger than the cap. In
   production the caller (`wire.ts`) never hands it such a string — it
   already reads at most its own budget (≤ `RECOVERY_TAIL_BYTES` ==
   `MAX_SCAN_CHARS`) — so a real truncated-at-the-source read is always
   *shorter than or equal to* the cap and the check never observes the
   truncation it exists to detect. A read that started after byte 0 can
   still begin mid-JSONL-record (the exact byte-cut-fragment hazard
   `stripUserTypeLines`'s `dropLeadingPartialLine` already guards, just
   triggered from the wrong signal). Fixed by threading a `startedMidFile`
   boolean computed once, at the true source of knowledge (`wire.ts`:
   `fromByte > 0`), through `resolver-io.ts` → `resolver.ts` →
   `resolver-parts.ts` (`buildRecoveryThunk`) → `run-id-recovery.ts`
   (`recoverRunIdFromTranscript` → `findRunIdFooter`), which now drops the
   leading line whenever `startedMidFile || transcript.length >
   MAX_SCAN_CHARS` — either signal is sufficient, and both compose
   correctly when both fire.
3. **AC3/AC4** — `missionActivityFeedResolve.ts` treats every `is_error`
   tool_result as a genuine blocker with no transient/harness-error
   special-case; `missionActivityFeedReconcile.ts` unconditionally appends
   "ended before resolved" wording once `runLive===false`; the wordless-card
   drop filter exempts `test`-bucket cards from the rule already applied to
   `implement`/`investigate`/`spec`.
4. **AC5** — `missionActivityFeedTurn.ts`'s `flushPendingNarration` tags any
   *positionally trailing, never-consumed* narration turn as `kind:"system"`
   regardless of content; `MissionActivityFeed.tsx` dashes/gear-icons every
   `kind==="system"` card identically to the real `isCompactionMarker` card.
5. **AC6** — measured directly against the session JSONL: the code-review and
   doubt-review dispatches use the harness's REAL subagent-dispatch tool,
   named `Agent` (confirmed in `missionActivityFeedSubrunner.ts`'s own doc
   comment) — never `Task`. `missionActivityFeedClassify.ts`'s `isReviewTask`
   only recognizes `name === "Task"` (`if (name !== "Task") return false;`),
   so an `Agent`-dispatched reviewer is never routed into the synchronous
   `review` bucket at all; `missionActivityFeedTurn.ts`'s dispatch check
   (`isSubrunnerDispatch(tool.name) && !isReviewTask(tool.name, input)`)
   therefore treats it as a plain generic `subrunner` card, correctly waiting
   on an async `task-notification` to resolve it. That notification's
   completion arrives as
   `{"type":"attachment","attachment":{"type":"queued_command","prompt":"<task-notification>...<\/task-notification>"}}`
   (lines ~605/667) plus bookkeeping `"queue-operation"` records — never as a
   `"type":"user"` record, which is the only shape
   `session-parser.ts` currently runs `extractTaskNotification` against.
   `missionActivityFeed.ts`'s reducer loop `continue`s past any event kind
   other than `"user"|"task-notification"|"assistant"`, so the notification
   is silently dropped and `resolveSubrunnerNotification` never runs.
   `MissionActivityFeedCard.tsx` only wires `onSubrunnerClick` once
   `subrunnerStatus !== "running"` — the dead click is a consequence, not an
   independent bug.
6. **AC7** — `review-state.ts` already has a machine-readable `doubt` row
   (via `reviews.json`, since iterate-2026-07-22-mission-review-record) and
   `decision-drops.ts` already surfaces a pending (unnumbered) decision drop
   as `state: "available"` with a "Not yet published in a release" note.
   Both are driven entirely by `context.artifacts`, which is empty whenever
   AC2's root cause fires — so this is very likely the same failure, not a
   third mechanism.
