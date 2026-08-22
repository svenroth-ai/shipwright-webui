# Iterate Spec: mission-feed-fixes

- **Run ID:** iterate-2026-08-22-mission-feed-fixes
- **Type:** change
- **Complexity:** medium
- **Status:** implemented

## Goal
`iterate-2026-08-20-mission-feed-content` (PR #377) claimed to give all nine
`ActivityCard` kinds real transcript content. A follow-up review of the
merged code against two real screenshots found that claim was only
partially true, plus a separate, more serious defect: the `Delivered` card
can show an **unrelated run's** commit message, because the server-side
run-identity recovery heuristic can latch onto a stray `Run-ID:` footer
quoted later in a long investigative transcript. This run fixes both
classes of defect and drops the GOAL header per Sven's explicit request.

## Acceptance Criteria
- [x] **Test/Review bucket over-matching.** The `test` bucket regex
      (`/test|vitest|playwright|pytest/i`) and the `review` bucket regex
      (`/review/i`) in `missionActivityFeed.ts` currently match the
      substring anywhere in a shell command — `git checkout -- ...
      shipwright_test_results.json` is misclassified as a test command
      (producing a false "awaiting a result"/"Failing" card), and any
      command touching `reviews.json` / `record_review_pass.py` /
      `self-review.json` etc. is misclassified as review work. Both regexes
      are narrowed to match only a real invocation shape (the tool binary
      as the command's own leading token or immediately after a package
      runner prefix — `npx`/`npm run`/`uv run`/`pytest` etc. — not an
      arbitrary substring anywhere in the string).
- [x] **Task-tool over-bucketing.** `tool.name === "Task"` unconditionally
      buckets every subagent spawn as `review`, regardless of what the
      subagent actually does. The Task bucket decision instead inspects the
      subagent's own declared purpose (`input.subagent_type` /
      `input.description`, whichever the transcript actually carries) for
      review-related language, falling back to `implement` when the Task
      call is not review-related.
- [x] **Sparse real-content fallback.** `investigate`/`implement`/`review`/
      `spec` cards only show real content when the assistant turn happens
      to carry narrated prose alongside the tool call — the common case
      (tool-only turns) still falls back to one of four fixed sentences,
      which is why the prior iterate's own claim did not hold up. Each of
      these four kinds gains a **second-tier**, always-available fallback
      derived from the tool's own input (file path, command, glob/grep
      pattern), applied to any card that ends up representing **exactly
      one command** — e.g. "Read foo.ts." instead of "The existing
      behaviour was examined before changes were made." A card that
      coalesces several commands together (the existing "many-files-in-a-
      row" behavior, unchanged) keeps the generic sentence, since no
      single derived sentence can represent several distinct commands; the
      fully-generic sentence also remains the last resort when the one
      command has no derivable field at all.
- [x] **Wrong-identity Delivered card (root cause fix).**
      `run-id-recovery.ts`'s `findRunIdFooter()` treats every `Run-ID: <id>`
      occurrence anywhere in the transcript as equally authoritative and
      keeps the LAST one. A footer that appears inside a `"type":"user"`
      JSONL record — which wraps both `tool_result` output (`git log`,
      `cat`, `grep`, a file `Read`) and genuine human-typed prompts, and
      is never how a footer is legitimately authored either way — is
      investigation content, not this session's own claim of identity,
      and must not compete with — or override — a footer that appears on
      an assistant-authored line (a `git commit` tool_use, or the
      assistant's own narration). The scan excludes every `"type":"user"`
      line; a transcript with no surviving occurrence falls through to the
      existing "no marker" behavior (session stays unidentified) rather
      than accepting a read-only quotation. Known, disclosed limitation
      (documented in-code, not closed by this run): an assistant narrating
      an older footer in prose can still be picked as "last surviving
      line" — closing that needs deeper structural parsing this design
      deliberately avoids.
- [x] **GOAL header removed.** The `<header className="mc-feed-pinned">`
      block's "Goal" label + `feed.goal` text is removed from
      `MissionActivityFeed.tsx`; the `outcome` line stays (e.g. "In
      progress" / "Completed run"). `ActivityFeed.goal`, the `explicitGoal`
      parameter of `deriveActivityFeed()`, and the now-unused
      `meaningfulRequest()` helper (plus its private `iterateArgs`/
      `ignored`/`valueFlags` helpers, if nothing else uses them) are removed
      rather than left dead. Callers (`useMissionLive.ts`) are updated.
- [x] No change to `MissionContext` remaining the sole source for any *gate*
      verdict (tests pass/fail, artifact availability) — every fix above
      touches only bucket classification and fallback *text*, never a
      status/pill value.
- [x] Existing tests in `missionActivityFeed.test.ts`,
      `missionActivityFeedFields.test.ts`, and
      `MissionActivityFeed.test.tsx` that assert `.goal` or the fixed
      fallback sentences are updated to match; new tests cover each fix
      above (see Test Completeness Ledger, populated during Confidence
      Calibration).

## Spec Impact
- **Classification:** modify
- **MODIFY:**
  - FR-01.66 (Mission view) — `Updates:` line gains this run's `run_id`;
    the underlying claim behind FR-01.68's fold ("all nine kinds show real
    content") is corrected to actually hold for the four kinds this run
    touches, and the Delivered card's identity-resolution defect is closed.
- **ADD:** none. **REMOVE:** none.

## Out of Scope
- Any change to how `MissionContext` itself resolves artifact availability
  or the test gate — this run only touches transcript-derived bucket
  classification, fallback text, and transcript-derived *identity*
  recovery.
- A durable, write-time identity association (e.g. writing
  `task.missionContext` at F6 commit time) as an alternative to
  transcript-scraping — bigger architectural change, not needed once the
  scan is correctly scoped to mutating-action occurrences; flagged for a
  future iterate if the scoped fix still proves insufficient in practice.
- Re-litigating `test`/`review` bucket *priority* (i.e. which bucket wins
  when a command could plausibly match more than one) — only the
  over-matching within each existing regex is fixed.
- Visual/presentational changes — this is a content-correctness and
  identity-correctness fix, not a redesign.

## Design Notes
- No new component files expected; both client fixes stay inside
  `missionActivityFeed.ts` / `missionActivityFeedText.ts` /
  `MissionActivityFeed.tsx`. The server fix stays inside
  `run-id-recovery.ts` (plus whatever caller passes it the transcript,
  confirmed at build time).
- No visual-guideline deviation — the GOAL header removal is a subtraction
  from existing markup using existing tokens; no new colors/fonts.

## Affected Boundaries
`run-id-recovery.ts` reads the SAME already-untrusted transcript data
(§5.1) it always has — this run does not widen what is trusted, it
*narrows* which occurrences within that same untrusted text are treated as
evidence. No new producer, no new persisted state, no schema change.

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** high
- **Summary:** Client-side text/classification fixes (§1, §2, §5) were
  directionally sound; §3's original per-tool-derived fallback design
  would have broken the reducer's own card-coalescing invariant (a
  900-`Read`-call regression fixture), and §4's original design (scope the
  scan to a Bash `git commit` tool_use's own `command` field) required
  JSON structure the function does not parse, contradicted how the
  existing test suite represents the footer, and risked silently
  regressing legitimate short sessions to "unidentified".
- **Findings:**
  - [fix, high] §3 backfills tool-derived text only post-hoc, only onto
    cards that still carry the generic sentence AND represent exactly one
    command — coalescing behavior for the 900-call fixture is unchanged.
  - [fix, high] §4 switched from "must be inside a `command` field" to "
    exclude only `tool_result`-bearing (`"type":"user"`) lines, scan
    everything else" — purely textual, no JSON parsing added, compatible
    with every existing `footerLine()`-shaped test, and no longer misses a
    footer authored via assistant narration rather than literally inside
    the `command` string.
  - [fix, medium] §1's review bucket keeps a narrow binary/script-name
    match for this project's own real review CLIs
    (`record_review_pass.py`, `external_review.py`) instead of retiring
    command-based review matching entirely.
  - [fix, medium] §1's npm test-form list now prefix-matches `npm run
    test*`, covering `npm run test:e2e` and similar colon-suffixed
    scripts, not just the bare `npm run test` form.
  - [fix, low] §5 also drops the now-dead `.mc-feed-label` CSS rule and
    the stale `task?.description` entry in `useMissionLive.ts`'s
    `useMemo` dependency array.
- **Known limitations:** none remaining — both `high` findings were fixed
  before Build, not discovered during it.
- **Status:** 6 fixed

## External Plan Review (`external_review.py --mode iterate`)
- **Provider:** openrouter. **openai:** success, verdict `revise`.
  **deepseek:** degraded (`provider returned an empty reply`) — recorded
  as `unavailable`, not comparable, no contradiction to resolve (only one
  reviewer answered).
- **Findings and disposition:** six integrated (fix), one disclosed as a
  known limitation, one rejected — see the mini-plan's "Revised after
  External LLM Review" section for the full findings-to-fix mapping
  (quote-aware command splitting in §1; both `subagent_type`/`description`
  checked with a word-boundary review-token match in §2; a real
  per-card event-count map replacing the under-counting
  `commands.length` check in §3, plus reusing `commandLabel()`'s exact
  redacted text; a precisely-worded `"type":"user"` exclusion (not just
  "tool_result") in §4, plus a documented known-limitation for
  assistant-narrated old footers; a widened removal-safety grep in §5).
  The "Updates: line" finding was rejected as a misreading of the Spec
  Impact section's standard compliance boilerplate (verbatim precedent
  from the prior sibling iterate), not a Mission-view UI requirement.
- **Overall assessment:** `revise` — all six actionable findings folded
  into the mini-plan/spec before Build.

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-08-22-mission-feed-fixes/architecture_brief.md`
- **Verdicts:** deepseek=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed — narrow
  the existing classifiers, derive single-command fallback text
  post-coalescing, and have the run-ID scan ignore `"type":"user"` lines.
  No new standing mechanism.
- **Findings:** none from either reviewer.
- **Reconciliation:** no rejected reasoning to re-surface — both
  reviewers independently converged on the proposed approach with no
  findings and no requested changes.

## Confidence Calibration
No `touches_io_boundary` flag fired (no new producer/consumer pair —
`run-id-recovery.ts` reads the same JSONL shape it always has; only which
already-parsed lines are excluded from the existing regex scan changed), so
the 8-category boundary-probe checklist does not apply. Ran three targeted
adversarial probes instead of asking "am I confident?":
- **Probe 1 (§1 quote tracker):** an apostrophe inside a double-quoted
  commit message (`git commit -m "fix: don't test in the message" &&
  vitest run`) could plausibly break `splitTopLevelArgs`'s quote-state
  machine if it toggled on ANY quote char regardless of which one opened
  the current quote. **Finding: none** — verified the tracker only closes
  on the SAME quote character that opened it, so the apostrophe is
  correctly ignored; `isTestInvocation` returned `true` (finds the real
  `vitest run`) and, with the `&&`-chain removed, `false` (no false
  positive on the apostrophe-quoted "test" substring).
- **Probe 2 (§4 false-positive exclusion):** an assistant-authored line
  whose own TEXT happens to contain the literal substring `"type":"user"`
  (e.g. narrating a sample JSONL record) could plausibly be
  mis-excluded by the new line-based filter even though the LINE's own
  `"type"` field is `"assistant"`. **Finding: none** — the substring
  appears JSON-escaped (`\"type\":\"user\"`) inside the text field, which
  does not match the unescaped `"type"\s*:\s*"user"` pattern; the real
  footer on that same line was still found.
- **Probe 3 (§4 × CRLF):** combining the new exclusion with a
  CRLF-terminated transcript (a Windows JSONL tail) — does the `\r?\n`
  split still correctly separate an excluded `"type":"user"` line from a
  surviving assistant footer line under CRLF? **Finding: none** — the
  real footer was still recovered.
- **Asymptote:** all three probes returned no finding — the round did not
  need a fourth (condition 4 in the decision rule triggers only after a
  yes-then-bug in THIS run; none occurred).

### Test Completeness Ledger
| Behavior | Category | Disposition | Evidence |
|---|---|---|---|
| Quote-aware test/review invocation split (chain separators inside quoted args) | unit | tested | `missionActivityFeedClassify.test.ts` (quoted-`&&` cases) |
| Test-bucket over-matching (file path substring) | unit | tested | `missionActivityFeedClassify.test.ts` |
| Review-bucket over-matching (file path substring) | unit | tested | `missionActivityFeedClassify.test.ts` |
| npm test/t/run-test* prefix forms | unit | tested | `missionActivityFeedClassify.test.ts` |
| Task subagent_type/description review classification (incl. word-boundary "preview" exclusion) | unit | tested | `missionActivityFeedClassify.test.ts` |
| Single-command label-derived fallback text | unit | tested | `missionActivityFeed.test.ts` (solo Read/TodoWrite cases) |
| Coalesced multi-command card keeps generic sentence (event-count map, not `commands.length`) | unit | tested | `missionActivityFeed.test.ts` (same-label two-event case) |
| Token-like argument renders identically in chip and promoted sentence | unit | tested | `missionActivityFeed.test.ts` |
| `"type":"user"` line exclusion in `findRunIdFooter` (tool_result + human prompt) | unit | tested | `run-id-recovery-user-lines.test.ts` |
| Real footer on assistant line survives when an older footer is quoted in a user-type line | unit | tested | `run-id-recovery-user-lines.test.ts` |
| Marker-free fallthrough when the only marker was inside a user-type line | unit | tested | `run-id-recovery-user-lines.test.ts` |
| Terminator/grammar checks unaffected by the new exclusion | unit | tested | `run-id-recovery-user-lines.test.ts` |
| GOAL header removed from rendered markup | unit | tested | `MissionActivityFeed.test.tsx` (`mission-feed-outcome` testid replaces `mission-feed-goal`) |
| `ActivityFeed.goal` / `explicitGoal` / `meaningfulRequest()` removed without dead references | integration | tested | repo-wide grep (`.goal`, `explicitGoal`, `deriveActivityFeed(`) + `tsc --noEmit`, both clean |
| Apostrophe-in-quoted-arg does not break the quote-state machine | unit | tested | Confidence Calibration Probe 1 (folded into `missionActivityFeedClassify.test.ts`'s existing quoted-separator case; same code path) |
| Escaped-JSON substring inside assistant text does not false-positive the `"type":"user"` exclusion | unit | tested | Confidence Calibration Probe 2 (ad hoc — not a permanent regression test; the mechanism it probes, escaped vs. unescaped `"type"`, is a structural property of JSON escaping, not project-specific behavior likely to regress) |
| CRLF transcript × new exclusion interaction | unit | tested | Confidence Calibration Probe 3 (ad hoc, same rationale as Probe 2) |

## External-Code-Review-Findings

`external_review.py --mode code`, provider openrouter, models openai + deepseek. Both verdicts `revise`, no contradiction (agreed within one step). 7 findings reported across the two models; one is a duplicate (escaped-quote handling, flagged independently by both) and one was already moot by the time the reviewers' diff snapshot was taken (superseded by an earlier internal-code-review fix in the same run). Every surviving finding was fixed; none rejected.

| # | Reviewer | Severity | File | Finding | Disposition |
|---|---|---|---|---|---|
| 1 | openai | high | `run-id-recovery.ts:109` | The `"type":"user"` exclusion runs on the transcript tail, but the tail is cut to `MAX_SCAN_CHARS` *before* the exclusion runs — a cut landing inside a large `tool_result` record slices away that record's own `"type"` field, so the fragment fails to parse and the "never guess on malformed content" posture keeps it, letting a quoted older Run-ID win. | **Accepted and fixed.** `stripUserTypeLines()` now takes a `dropLeadingPartialLine` flag; `findRunIdFooter` passes `true` whenever the transcript was actually truncated, unconditionally dropping the tail's leading line (the one line that can be a byte-cut fragment). Regression: `run-id-recovery-user-lines.test.ts`, new describe block "the truncation boundary cannot smuggle a tool_result footer past the exclusion" (3 tests). |
| 2 | openai | medium | `run-id-recovery.ts:92` | `USER_TYPE_LINE` was described as searching for `"type":"user"` anywhere in the record rather than the outer type field, risking false-exclusion of an assistant line carrying a nested `{"type":"user"}` as data. | **Rejected — already fixed, stale by the time this review ran.** This is the exact defect an earlier *internal* code-review pass (this same run, before the external cascade) already closed: `isUserTypeLine()` uses a real `JSON.parse` on the whole line and reads only the parsed object's top-level `type` field, never a substring scan. The external reviewer's diff snapshot predates that fix landing. Re-verified current source (`run-id-recovery.ts:95-102`) uses `JSON.parse`, and `run-id-recovery-user-lines.test.ts` carries the matching regression ("does not false-exclude an assistant line whose own text merely contains the literal substring"). No further change made. |
| 3 | openai | medium | `missionActivityFeedClassify.ts:23-42` | The quote-aware splitter didn't handle backslash-escaped quotes inside a double-quoted argument — an escaped `\"` closed the tracked quote state early, causing a real chained command after it (e.g. `&& vitest run`) to be misread as still-quoted and missed. | **Accepted and fixed** (same fix as #6). `splitTopLevel` now special-cases `\` immediately followed by a character while inside a double-quoted string, consuming both without toggling quote state. Regression: `missionActivityFeedClassify.test.ts`, two escaped-quote cases. |
| 4 | openai | low | `missionActivityFeed.test.ts:182-214` | The new single-command fallback tests covered only `investigate` (Read) and `implement` (TodoWrite), not `review` or `spec` — an implementation that omitted either kind from the post-coalescing backfill would still pass. | **Accepted and fixed.** Added a solo-`Task` (review-classified) fixture and a solo-`Write`-to-`.shipwright/planning/...`-path (spec-classified) fixture to `missionActivityFeed.test.ts`, each asserting the derived sentence (not the generic fallback text). |
| 5 | deepseek | medium | `missionActivityFeedClassify.ts:55` (`invocationTarget`) | `python record_review_pass.py` wasn't recognized as a review invocation — only `uv run`, `npx`, etc. were treated as runner prefixes, so a bare `python`/`python3` prefix left the script name unresolved. | **Accepted and fixed.** `invocationTarget` now also resolves a bare `python`/`python3` prefix to its next token. Regression: `missionActivityFeedClassify.test.ts` ("matches a review script invoked via a bare python/python3 prefix"). |
| 6 | deepseek | low | `missionActivityFeedClassify.ts:28` (`splitTopLevel`) | Same escaped-quote gap as #3, reported independently. | **Accepted and fixed** — see #3; one fix addresses both reports. |
| 7 | deepseek | low | `missionActivityFeedClassify.test.ts` | No test exercised `python record_review_pass.py` classifying as `review`. | **Accepted and fixed** — covered by the same test added for #5. |

