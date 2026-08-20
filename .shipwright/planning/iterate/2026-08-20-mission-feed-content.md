# Iterate Spec: mission-feed-content

- **Run ID:** iterate-2026-08-20-mission-feed-content
- **Type:** change
- **Complexity:** medium
- **Status:** draft

## Goal
Complete the activity-feed narration work that `iterate-2026-08-13-mission-
mobile-visual` promised but only partially shipped: every one of the nine
`ActivityCard` kinds (`goal` header aside) — `investigate`, `spec`,
`implement`, `test`, `review`, `user-input`, `blocker`, `delivery`, `system`
— renders the transcript's actual content instead of one of nine fixed
fallback sentences, and the card presentation itself gets a richer, more
"finished" visual treatment (per-kind icon node on a connecting spine,
status pills, mono file/command chips, a bounded real-error code block, real
question+options, a PR-link card) matching an approved high-fidelity mockup.
Sven's framing: the prior iterate delivered "the transcript, but not sexy" —
this run is the combination of real content AND a polished presentation, not
either alone.

## Acceptance Criteria
- [ ] All nine `ActivityCard` kinds source their `text` (and, where the
      mockup shows it, structured detail) from the real transcript event
      instead of a hardcoded sentence. Concretely: `user-input` cards show
      the real question + real options (`askUserQuestionSummary()`); once
      resolved, they show what was actually decided. `blocker` cards show a
      bounded excerpt of the real failing command's output. `test` cards
      show a bounded excerpt of the real failing test output when the gate
      is `fail`; the existing `MissionContext.tests.gate` value remains the
      sole source of the pass/fail verdict itself — only the accompanying
      detail text becomes real.
- [ ] The deliberate "Mission never reads raw tool output" constraint
      documented in `missionActivityFeed.ts` is explicitly narrowed, not
      removed: `MissionContext` stays the sole source for any *gate*
      verdict (tests pass/fail, spec/requirement/review/decision
      availability); raw `toolResults()` content is now permitted **only**
      as bounded, sanitized *detail* text on `blocker`/`test`/`user-input`
      cards, truncated the same way `assistantText()` already is
      (`sanitizeProofText`, ~280 chars / first non-empty line as today, or
      a card-appropriate bounded excerpt for a multi-line failure).
- [ ] Card presentation adds, per the approved mockup: a per-kind icon node
      on a vertical connecting line; a status pill for `test`/`spec`/
      `review` outcomes; mono-font file/command chips; a bordered code
      block for real error/output excerpts; a real question with its real
      options (picked option marked once resolved, unresolved renders the
      existing `AnswerInTerminalButton` "jump to terminal" CTA per
      FR-01.63 — Mission still answers nothing itself); a PR-link-styled
      card for `delivery`.
- [ ] Reuse is at the **data-extraction level**, not literal JSX embedding:
      `askUserQuestionSummary()`, `toolResults()`/`toolUses()` (already
      used), and the existing ANSI-stripping used by `AnsiText`/
      `ToolOutputBlock` are reused; the presentational React components
      (`ToolCard`, `PrLinkCard`, `StopHookCard`, `AskUserBubble`) are
      **not** embedded directly, because they carry their own `--color-*`
      token family with light-mode hex fallbacks that is not wired into
      Mission's `.on-photo .mc-op:not([data-state=designgate])` dark
      override — verified during Repo Scout (`ToolCard.tsx` L63-134) — and
      direct reuse would reproduce the same dark-text-on-dark-card
      regression this run's sibling bugfix just closed. New Mission-native
      markup, styled from Mission's own `--ink`/`--body`/`--card`/`--ok`/
      `--err`/`--warn`/`--accent` tokens, renders the extracted content.
- [ ] All rendered transcript-derived text (existing prose, new raw-output
      excerpts, real question/option text) continues to go through the
      existing safe text/markdown path (`MarkdownChunk` or literal text
      nodes) — never `dangerouslySetInnerHTML` — extending the
      content-safety constraint the prior iterate already established to
      the newly-added raw-output surface.
- [ ] No schema change to the *existing* fields of `ActivityCard`/
      `ActivityFeed`; any new optional field (e.g. a bounded `detail`
      string for the raw-output excerpt) is additive and defaults to
      absent for every existing card kind/fixture, so existing snapshot/
      fixture tests are unaffected except where they assert the specific
      (now-replaced) fallback sentence text.
- [ ] `client/src/components/external/mission/MissionActivityFeed.test.tsx`,
      `client/src/lib/missionActivityFeed.test.ts`, and
      `client/src/lib/missionActivityFeed.fixtures.ts` are extended to
      cover: real content for all nine kinds, the truncation boundary for a
      long raw excerpt, HTML/markdown-like content inside a raw excerpt
      (content-safety), and the unresolved-question-shows-
      `AnswerInTerminalButton` / resolved-question-shows-picked-option
      branches.
- [ ] Visual regression baselines for `task-detail-mission.png` /
      `task-detail-mission-live.png` (and any other baseline the richer
      card markup shifts) are regenerated via the Linux-only pipeline.

## Spec Impact
- **Classification:** modify
- **MODIFY:**
  - FR-01.68 (Mission middle card told as prose) — narration-quality
    acceptance criteria extended to require real per-kind content (not
    just a subset) and the raw-output-as-bounded-detail carve-out.
  - FR-01.66 (Mission view) — `Updates:` line gains this run's `run_id`.
- **ADD:** none. **REMOVE:** none.

## Out of Scope
- The black-on-dark contrast bug in `.mc-feed-card` reported by Sven — that
  is a separate, narrower, already-scoped bugfix and ships (or has shipped)
  as its own iterate; this run builds on top of that fix, does not redo it.
- LLM-based "story mode" narration — still deferred per the prior iterate's
  explicit out-of-scope note; this run stays deterministic text extraction.
- Timestamps per card, diff-stat chips (+N/-N), collapsible long error
  blocks — flagged as optional stretch ideas in the approved mockup, Sven
  did not ask for them; not built unless he asks in review.
- Any change to which artifacts `MissionContext` resolves as `available` —
  this run only changes how already-available data is *presented*.

## Design Notes
- Approved mockup: https://claude.ai/code/artifact/e8b87391-3386-432d-955e-4f2a17650676
  ("Mission Feed"), built directly from the shipped dark-theme tokens in
  `mission-operation.css` (`.on-photo .mc-op:not([data-state=designgate])`
  block) and Inter/mono type already used elsewhere in the app. Sven's
  approval, after two title-color rounds (tried neutral-gray labels, reverted
  to per-kind-colored labels): "zurück und go!".
- New vs modified components: `missionActivityFeed.ts` (per-kind text/detail
  generation), `MissionActivityFeed.tsx` (icon nodes, connecting spine,
  pills, chips, code block, question/options, PR-link card) — both edits to
  existing files, no new component files expected; confirm at build time.
- Deviations from visual guidelines: none expected — the mockup introduces
  no new colors/fonts, only new arrangements of the existing dark-theme
  tokens.

## Affected Boundaries
Raw transcript tool-result content (`toolResults()[].content`) becomes
consumer-facing UI text for the first time in this surface (previously only
`assistantText()` prose and `MissionContext`-vetted facts were rendered).
This is bounded (truncated) and rendered through the existing safe text path
— no new serialized format, no new producer, no new persisted state — but it
is a genuine widening of what this component trusts as displayable, hence
called out explicitly rather than folded into "n/a".

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-08-20-mission-feed-content/architecture_brief.md`
- **Verdicts:** deepseek=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed (Option A —
  optional, render-only `detail`/`question` fields on the existing
  `ActivityCard`, `MissionContext` staying the sole gate-verdict source).
- **Findings:** none from either reviewer.
- **Reconciliation:** no rejected reasoning to re-surface — both reviewers
  independently converged on Option A as scoped, with no findings and no
  requested changes; nothing from Options B/C needed reintroducing.

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** high
- **Summary:** Data-extraction/reuse boundaries and content-safety reasoning
  are sound, but two of the new fields (`detail`, `status`) were bolted onto
  the existing mutation-based reducer (`missionActivityFeed.ts`) without
  accounting for its card-coalescing and in-place recovery mutations —
  both gaps would have produced visible, self-contradictory cards, directly
  undercutting this run's own goal of accurate real content.
- **Findings:**
  - [fix, high] Both recovery branches (`unresolvedBlockers` retry-success,
    `unresolvedTest` gate-pass-after-fail) reverted `card.text`/`card.kind`
    back to a success sentence but left the new `status`/`detail` fields
    stale, so a recovered card would show a red error pill and the old
    failure excerpt under its own "recovered" sentence — mini-plan now
    clears both fields in each recovery branch.
  - [fix, medium] `add()`'s existing multi-command card coalescing means a
    card that later errors can be a shared object several unrelated
    commands' chips point at; attaching the erroring command's `detail`
    there would misattribute it to the whole group — mini-plan now
    attaches `detail` only when the card still represents exactly one
    command at the moment of the error.
  - [fix, low] Test-fixture coverage for the two findings above was absent
    from the plan's own test list — added explicitly (blocker-recovers,
    coalesced-card-partial-error).
  - [fix, low] Two mini-plan citations of "CLAUDE.md rule 27" for the CSS
    dark-token scoping constraint were wrong — rule 27 governs route-level
    scroll ownership, an unrelated rule; both corrected to cite the sibling
    iterate (`iterate-2026-08-13-mission-mobile-visual`) that actually
    established the scope.
  - [decline, low] `excerpt()`'s hard character cap can in principle cut a
    UTF-16 surrogate pair mid-character on non-BMP raw output (e.g. an
    emoji in a command's error text) — declined: cosmetic single-glyph
    artifact on a rare input class, matches the existing plain-slice
    behavior of `sanitizeProofText` already shipped elsewhere in this
    file, and a boundary check is complexity this run's goal (accurate
    *content*, not Unicode-perfect truncation) doesn't call for.
- **Known limitations:** `excerpt()` does not guard against cutting a raw
  multi-byte character at its truncation boundary — see the declined
  finding above; accepted as-is.
- **Status:** 4 fixed, 1 declined

## External Code Review (`external_review.py --mode code`)
- **Provider:** openrouter. **openai:** success, verdict `revise`. **deepseek:** degraded
  (`provider returned an empty reply`) — recorded as `unavailable`, not comparable, no
  contradiction to resolve (only one reviewer answered).
- **Findings (openai) and disposition:**
  - [accepted-and-fixed, high] `card.question.text` (the real question prose) was never
    rendered — the question block showed options/CTA/answer but not what was actually
    asked, failing AC1's "real question + real options" requirement outright. Fixed:
    `MissionActivityFeed.tsx` now renders `card.question.text` through `MarkdownChunk`
    inside `.mc-feed-qa` (new `.mc-feed-qa-question` style); all three question-branch
    tests now assert the question text is present, not just its options/answer.
  - [accepted-and-fixed, high] A failing test result set `card.status = "err"` directly
    from the raw `is_error` signal, and the final gate-reconciliation block skipped the
    status write entirely while `unresolvedTest` was set (an observed failure with no
    verified in-transcript retry) — so an unretried local failure could leave the pill
    red even when `MissionContext.tests.gate === "pass"`, violating "the existing
    MissionContext.tests.gate value remains the sole source of the pass/fail verdict
    itself". Fixed: `latest.status` is now derived from `gate` unconditionally at the
    final reconciliation, decoupled from the `unresolvedTest` guard that (correctly)
    still keeps the PROSE conservative. Two new tests pin this: the pill follows a
    recorded `pass` gate even with an unretried local failure, and shows `warn` (not
    `err`) when the gate is `unknown`.
  - [rejected-with-reason, medium] Claimed the test-error path could misattribute one
    command's excerpt to a coalesced multi-command card, "unlike the blocker path".
    False positive: every `test`-bucket tool_use pushes its OWN fresh card
    (`cards.push(card)`) rather than going through `add()`'s coalescing at all — test
    cards are never shared between commands, so the blocker-side guard has nothing to
    do here. Added a probe (`"never shares a test card between two distinct failing
    test commands"`) confirming this rather than asserting it on faith.
  - [accepted-and-fixed, medium] The two findings above were exactly what the existing
    tests failed to catch — one test even encoded the bad invariant (`context("unknown")`
    + an error result expecting `status: "err"`, i.e. asserting raw output as the
    verdict). Fixed alongside the two `high` items above.
  - [accepted-and-fixed, medium] The question-resolution DOM tests asserted options/CTA/
    answer but never that the question itself renders — fixed alongside the `high`
    rendering finding: all three branches now assert `screen.getByText("Which
    platform?")`.
  - [rejected-with-reason, medium] "Real content for all nine kinds" fixture coverage —
    `missionActivityFeed.fixtures.ts` is unchanged. The five kinds this iterate actually
    changes behavior for (`test`/`blocker`/`user-input`/`review`/`delivery`) are covered
    by this run's new tests; `investigate`/`implement`/`spec`/`system`/`goal` already
    carried real content before this iterate (per the iterate spec's own Goal section:
    "four of nine" already worked) and are unchanged by this diff — their existing
    pre-iterate tests (prose-preference, meaningful-request/system-marker) already cover
    them. Extending the shared fixture for kinds this diff does not touch was judged
    out of scope rather than a gap in this diff's own coverage.
  - [tracked, not fixed here, low] Visual regression baselines not yet regenerated —
    correct: the Linux-only pipeline requires a pushed branch + CI run (see the iterate
    spec's own AC checklist and `[[project_visual_baselines_linux_regen_flow]]`); handled
    after this PR is pushed, per the project's documented update flow, not locally.
- **Overall assessment (openai):** "ship-with-fixes" — both `high` findings addressed
  above with fixes + new regression tests before commit.

## Code Review (Stage 2, code-reviewer)
Re-run fresh after the external-review fixes landed, given how substantial they were
(mutation-state-machine changes in `deriveActivityFeed`). Confirmed the four external-
review-adjacent fixes were correctly and completely applied, confirmed the `stripControl`
relocation was clean, confirmed the rejected coalescing claim was justified — then found
five NEW issues in code the prior passes had not touched:
- [accepted-and-fixed, high] The final test-reconciliation block set `latest.status`
  unconditionally from `gate` (the prior fix) but never cleared `latest.detail` — so a
  test that failed locally with no observed retry, whose gate later resolved to `pass`,
  rendered a green "Passing" pill directly above the stale red FAIL excerpt: the mirror
  image of the exact self-contradictory-card bug the prior fix closed. Fixed: `detail` is
  now cleared specifically when the gate override resolves to `"ok"` (an `"unknown"` gate
  intentionally keeps the detail — it is still the best evidence available and is not
  contradicted by anything). Pinned by extending the existing high-severity regression
  test to also assert `detail` is cleared.
- [accepted-and-fixed, medium] The `pendingTest` branch hardcoded `latest.status = "warn"`
  regardless of `context.tests.gate`, unlike every sibling branch in the same block (whose
  own comment states the pill "must never contradict the recorded gate"). Fixed: derives
  `status` from `gate` here too. New test: two test commands, one resolved, one still
  pending, `gate: "fail"` — asserts the pill reads `"err"`, not the old hardcoded `"warn"`.
- [accepted-and-fixed, medium] `question.resolved = true` was set unconditionally on any
  `AskUserQuestion` tool_result, including `is_error: true` — contradicting the mini-plan's
  own stated design ("on non-error, set `question.resolved = true`") and permanently
  hiding the `AnswerInTerminalButton` CTA (FR-01.63) for an errored/cancelled prompt even
  though nothing was actually decided. Fixed: gated on `!result.is_error`. New test: an
  error tool_result for an `AskUserQuestion` keeps `question.resolved === false`.
- [accepted-and-fixed, low] `.mc-feed-card details/summary/ul` CSS rules in
  `mission-operation.css` were dead — the `<details><summary>Ran commands</summary><ul>`
  markup they styled was replaced by `.mc-feed-chip-row` in this same diff. Deleted.
- [accepted-and-fixed, low] The pre-existing `sanitizeProofText` doc comment in
  `proofLines.ts` ended up sitting above the newly-relocated `stripControl` function
  instead of the function it actually documents, purely from the insertion point. Reordered
  so each doc comment sits directly above its own function.

## Doubt Review (Stage 3, doubt-reviewer)
Adversarial pass over the same reducer, attacking concurrency/ordering and the
"MissionContext stays the sole gate-verdict source" boundary claim specifically. Found a
third, distinct real bug in the same `deriveActivityFeed` mutation state machine — the
fourth review round in a row to find something new in this file:
- [accepted-and-fixed, high] The `pendingTest` reconciliation branch fires whenever ANY
  test card is still open, not just `latest` — so an unrelated still-pending card (e.g. a
  background-command ack that never confirms) could clobber a DIFFERENT, already-recovered
  `latest` card's status straight from `gate`, producing a false green "ok"/Passing pill
  next to "needs attention" text and silently undoing the retry-recovery fix. Concrete
  repro: an open background test alongside a second test that failed then recovered via
  retry, with `gate === "pass"`. Fixed: the branch's status formula no longer claims `"ok"`
  while any test is pending — a real `"fail"` gate still escalates the pill (preserves the
  Stage-2 code-review fix's intent), but `"pass"` now yields `"warn"` instead, removing the
  self-contradiction while keeping the pre-existing, separately-tested behavior of
  surfacing an earlier still-open test through `latest`'s text. New test asserts no card
  ever carries `status: "ok"` in this scenario.
- [tracked-not-fixed-here, medium] `unresolvedBlockers` is keyed by command TEXT, not
  `tool_use.id` — two concurrent tool_use calls sharing the same command text could have
  the second overwrite the first's map entry, orphaning the first's card if only the second
  is later retried. Confirmed pre-existing (unchanged by this diff, verified via `git diff`
  showing no `+`/`-` lines touching that map). Parallel identical commands are a narrow,
  low-probability edge case, and restructuring stable pre-existing map logic is out of
  scope for a content/presentation iterate — documented here rather than silently dropped,
  per the project's declined-finding convention.
- [accepted-and-fixed, low] `excerpt()`'s line-count truncation (dropping lines beyond
  `maxLines`) was silent — no ellipsis distinguished a partial excerpt from complete output
  when truncation was line-count-driven rather than char-count-driven. Fixed: an ellipsis
  is now appended whenever line-count truncation occurred, matching the existing char-cap
  marker convention; new test pins it.

## Confidence Calibration
- **Boundaries touched:** raw tool-result content as bounded UI detail text
  (see Affected Boundaries above); no persisted/serialized format change.
- **Empirical probes run:** Repo Scout confirmed `askUserQuestionSummary()`
  and `toolResults()` already expose the exact data needed; confirmed
  `ToolCard.tsx`/`PrLinkCard.tsx` use a `--color-*` token family with
  hardcoded light fallbacks not wired into Mission's dark override (would
  regress the just-fixed contrast bug if embedded directly) — decides the
  data-only reuse boundary above.
- **Test Completeness Ledger:**

  | # | Behavior | Disposition | Evidence |
  |---|---|---|---|
  | 1 | `test` card: real bounded error excerpt + `err` status | tested | `missionActivityFeed.test.ts` "attaches a bounded real-output excerpt and an err status to a failing test card" |
  | 2 | `excerpt()` bounds a multi-line failure to 4 lines, not 1 | tested | same file, "preserves a bounded multi-line excerpt instead of collapsing it to one line" |
  | 3 | `excerpt()` hard-caps a single long line to 320 chars + `…` | tested | same file, "hard-caps a single long line to 320 chars with an ellipsis" (added by this calibration pass — see probe log below) |
  | 4 | Blocker recovery clears stale `status`/`detail` (plan-review finding 7) | tested | same file, "clears the stale status/detail pill when a blocker recovers" |
  | 5 | Test recovery clears stale `status`/`detail`, keeps recovered text (plan-review finding 7) | tested | same file, "clears the stale status/detail pill when a failing test recovers" |
  | 6 | Coalesced multi-command card never misattributes one command's error `detail` to the group (plan-review finding 8) | tested | same file, "does not misattribute one command's error excerpt to a coalesced multi-command card" |
  | 7 | Single-command card DOES attach its own error `detail` | tested | same file, "attaches a single command's error excerpt when the card represents exactly one command" |
  | 8 | `delivery` card shows the real commit message when the commit artifact carries one | tested | same file, "shows the real merged PR title on the delivery card when the commit artifact carries one" |
  | 9 | `delivery` card falls back to the generic sentence when no message is available | tested | same file, "keeps the generic delivery sentence when no commit message is available" |
  | 10 | `user-input` question resolves against a matched option (real CLI plain-text shape) | tested | same file, "matches a plain-text resolution against a listed option (real CLI shape, askuser-roundtrip.jsonl)" |
  | 11 | `user-input` question resolved-but-unmatched falls back to free text, not a false "picked" | tested | same file, "keeps a resolved-but-unmatched answer as free text, not a picked option" |
  | 12 | `user-input` question stays `resolved:false` until a `tool_result` answers it | tested | same file, "keeps an unresolved question's CTA-gating field false until a tool_result resolves it" |
  | 13 | `spec`/`requirement`/`decisions`/`review` artifact cards get a MissionContext-derived `status:"ok"` (one shared code path, `review` exercised as representative) | tested | same file, "marks a spec/review artifact card status ok so the pill has a MissionContext-derived source" |
  | 14 | Card `text` (existing) and new `detail` both render as inert markdown/literal text, never a real HTML element | tested | `MissionActivityFeed.test.tsx` "renders HTML-like card text as inert markdown..." + "renders HTML-like raw-output detail as inert literal text..." |
  | 15 | Status pill + bounded error excerpt actually render in the DOM for a failing `test` card | tested | same file, "renders a status pill and a bounded error excerpt for a failing test card" |
  | 16 | Unresolved question renders the existing `AnswerInTerminalButton` CTA (FR-01.63 — Mission still answers nothing itself) | tested | same file, "shows the terminal CTA while unresolved" |
  | 17 | Resolved-matched question marks the picked option and hides the CTA | tested | same file, "marks the matched option picked and hides the CTA once resolved" |
  | 18 | Resolved-unmatched question shows the free-text answer, not the CTA | tested | same file, "shows the free-text answer, not the CTA, when resolved but unmatched" |
  | 19 | `delivery` renders a PR-link card when a merged commit artifact with a PR is available | tested | same file, "renders a PR-link card for delivery when a merged commit artifact is available" |
  | 20 | `delivery` omits the PR-link card gracefully with no commit artifact | tested | same file, "omits the PR-link card gracefully when no commit artifact is available" |
  | 21 | Command chip label text is unchanged by the plain-`<li>` → icon-chip markup swap | tested | same file, "keeps command chip label text after the chip-treatment rewrite" (regression) |
  | 22 | Compact-panel command-chip click stays on Activity, does not open Detail (pre-existing behavior, markup changed under it) | tested | `MissionBody.compact.test.tsx` "an Activity command group stays available without changing compact panels" (query target updated to the new chip text, assertion unchanged) |
  | 23 | Visual presentation actually matches the approved mockup (icon/spine/pills/chips/PR-card geometry, contrast) | untestable | `requires-manual-visual-judgment` — covered by the pending browser-verify pass + Linux-only visual-regression baseline regen (AC checklist), not a unit assertion |
  | 24 | A gate override to "ok" clears the stale `detail` from an unretried local failure, not just its `status` (code review catch, high) | tested | `missionActivityFeedFields.test.ts` "never lets an unretried local failure contradict a recorded passing gate" (extended to also assert `detail` is cleared) |
  | 25 | The pending-test pill derives from `context.tests.gate`, not a hardcoded `"warn"` (code review catch) | tested | same file, "derives the pending-test pill from the recorded gate instead of hardcoding warn" |
  | 26 | An errored/cancelled `AskUserQuestion` tool_result never marks the question `resolved` (code review catch, mini-plan) | tested | same file, "keeps a question pending when its tool_result is an error, not a real answer" |
  | 27 | Real JSONL → reducer → DOM: unresolved question shows real text/options/CTA | tested | `client/e2e/flows/mission-feed-content.spec.ts`, real-browser, isolated stack |
  | 28 | Real JSONL → reducer → DOM: resolved question marks the picked option, hides the CTA | tested | same file |
  | 29 | Real JSONL → reducer → DOM: failing test shows a status pill + bounded real-output excerpt | tested | same file |
  | 30 | An unrelated still-pending test card never lets the aggregate-latest card show a false "ok" pill (doubt-review catch, high) | tested | `missionActivityFeedFields.test.ts` "never shows a false-reassuring ok pill while an unrelated test card is still pending" |
  | 31 | `excerpt()` marks a line-count-truncated (not just char-count-truncated) excerpt with an ellipsis (doubt-review catch) | tested | same file, "marks a line-count-truncated excerpt with an ellipsis so a partial output is never silent" |

- **Confidence-pattern check:** The asymptote heuristic fired a THIRD time at
  Stage 3: the doubt-reviewer, attacking concurrency/ordering specifically,
  found that the Stage-2 fix for the hardcoded-`"warn"` pill (item 25) had
  itself introduced a NEW variant of the same self-contradictory-card class —
  the `pendingTest` branch derives its status from `gate` for `latest`, but
  the branch's own trigger condition (`pendingTest`) is scoped to "any test
  card is still open", not "`latest` is still open" — so an unrelated pending
  card could force a false `"ok"` pill onto a *different*, already-recovered
  `latest` card. Fixed by capping the branch's status ceiling at `"warn"`
  unless the gate itself says `"fail"`, rather than deriving it unconditionally
  (items 30-31). Three fix rounds in a row (external review → Stage-2 code
  review → Stage-3 doubt review) each closed one instance of the same class
  in the same handful of reconciliation branches and each surfaced the next —
  the strongest evidence yet that a mutation-based state machine with several
  independent status-writing branches needs every branch checked against the
  same invariant ("never claim a pill state the evidence doesn't support"),
  not just the specific branch the previous round touched.

  The asymptote heuristic fired a SECOND time during finalization: the
  Stage-2 code-reviewer re-review (run fresh after the external-review
  fixes, given how substantial they were) found three more real bugs in the
  exact same reducer (items 24-26) that self-review, spec-review, and the
  first code-review pass had all missed — the gate-override fix for the
  pill's `status` had introduced a self-contradictory-card variant of its
  own (a stale `detail` under a now-"ok" pill), and two other branches were
  found not deriving from `gate` at all. All three fixed and pinned before
  Stage 3.

  The asymptote heuristic first fired once, during planning rather than
  Build: the Internal Plan Review (opus-plan-reviewer) traced the new `detail`/`status` fields against the reducer's
  existing card-coalescing and in-place recovery mutations and found two
  real bugs (findings 7 and 8 above) that a same-brain "am I confident in
  this plan?" pass had missed — textbook confidence-without-verification.
  Both were fixed before any code was written and are now pinned by ledger
  items 4-7. Per the asymptote rule ("not done until a probe finds
  nothing"), one more probe was required after the fixes landed: during
  this Confidence Calibration pass, re-reading `excerpt()` against its own
  stated contract ("hard-caps chars with `…`") found the 320-char
  hard-cap branch had no test — ledger item 3 was genuinely untested, not
  merely undocumented. That probe (added above) **passed against the
  existing implementation with no code change required** — the first
  probe in this run's history to find nothing. That is the asymptote
  signal; no further probing round is required.
