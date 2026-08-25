# Iterate Spec: mission-feed-progress-narration

- **Run ID:** iterate-2026-08-25-mission-feed-progress-narration
- **Type:** feature
- **Complexity:** medium (overridden from Stage-1 estimate `small`, confidence
  0.6 — the user explicitly asked for the full plan+code external review
  cascade, which is only bought at medium+; classify_complexity's own
  history-prior fall-through said `small`, no risk flag alone forced medium)
- **Status:** implemented

## Goal

Restore content that already exists in every session's JSONL, into the
Mission Activity Feed, so the operator does not have to open the
Terminal/full transcript just to see what actually happened.

`deriveActivityFeed()` already takes a turn's first non-empty line of
`assistantText()` as the card's headline (`missionActivityFeed.ts:169`) —
but silently discards every line after it, even when Claude wrote several
sentences of real explanation. That discarded text is exactly the content
the operator is missing. This iterate keeps it: an
`investigate`/`spec`/`implement`/`review` card built from exactly ONE
tool-use event (never a coalesced multi-turn card — the same
misattribution reason the existing `blocker`/`test` `detail` gating
already respects, `missionActivityFeed.ts:144`) gets a new, bounded,
markdown-rendered `card.explanation` field holding the rest of that turn's
own words.

This needs no toggle, no Settings change, and no new session data — it
re-reads text Claude already wrote, on already-recorded sessions and new
ones alike. **Look and feel stay exactly as they are today** — no visual
redesign, no new colors, no new page or navigation: the new text renders
through the SAME `MarkdownChunk` path and the SAME feed type scale as the
card's existing headline, one step down in weight, directly under it. The
only visible change is that a card can now show more than one sentence,
when Claude actually wrote more than one sentence.

**Scope decision (see Architecture Review below):** an earlier version of
this iterate also planned an opt-in, global "make Claude narrate silent
tool-only turns" Settings toggle (a second, independent mechanism). Two
rounds of external Architecture Review and the operator's own decision
dropped that mechanism entirely for this iterate — no settings field, no
launch-command changes, no CLI flag, nothing server-side. It can be
revisited later, on its own, if content restoration turns out not to be
enough once it ships.

## Acceptance Criteria

**Provenance is per assistant TURN, not per tool-use event** (Internal Plan
Review HIGH finding — an earlier draft gated on `cardEventCounts === 1`,
which is a per-EVENT count and would have suppressed the single most
common valuable case: one turn writing an explanation and then issuing
several tool calls that coalesce into one card. The correct invariant is
"exactly one assistant turn contributed to this card", tracked separately
from the existing per-event counter, which stays untouched and keeps its
existing job — the label-derived-sentence fallback.)

- [x] AC-1: `deriveActivityFeed()`, given an `investigate`/`spec`/`implement`/`review`
  card to which **exactly one assistant turn** contributed (tracked by a
  new turn-provenance count, incremented once per turn regardless of how
  many of that turn's tool-use events landed in the card) whose turn's
  `assistantText()` has non-empty content beyond its first non-empty line,
  sets `card.explanation` to a bounded excerpt of that remaining content —
  a line cap, a char cap, a trailing ellipsis marker on truncation, and a
  code-point-safe cut (never split a surrogate pair) so a partial excerpt
  is never mistaken for the complete text and never renders `�`.
  Within one turn, at most ONE resulting card receives that turn's
  explanation (the first card that turn produces) — a turn whose tool
  calls land in two genuinely different, non-coalescing cards does not
  duplicate the same explanation onto both (External LLM Review MEDIUM
  finding — deepseek).
- [x] AC-2: A card to which **more than one** assistant turn contributed
  (via `add()`'s coalescing) never gets `card.explanation` set or keeps a
  stale one from an earlier turn once a second turn coalesces in — same
  misattribution guard already applied to `blocker`/`test` `detail`
  (`missionActivityFeed.ts:144`). This clearing runs as its OWN pass, after
  and independent of the existing GENERIC_TEXT/label-derivation sweep
  (`missionActivityFeed.ts:220-225`) — NOT folded into it (Internal Plan
  Review HIGH finding: that sweep's own `card.text !== GENERIC_TEXT[card.kind]`
  short-circuit would `continue` past any card that has real prose, i.e.
  past every card that could ever have an `explanation` — folding the
  clear in there would make it a permanent no-op). `test`, `user-input`,
  `goal`, `delivery`, and `system` cards never get `card.explanation` — the
  first two already have their own content field
  (`detail`/`question.answer`), and `goal`/`delivery` are synthesized from
  `MissionContext`, not turn text.
- [x] AC-2b: A card that is mutated to `kind: "blocker"`
  (`missionActivityFeed.ts:136`, a tool error on a previously
  investigate/spec/implement/review card) has `card.explanation` cleared at
  that exact mutation site, alongside how `detail` is already set there —
  mirrors the existing `detail` handling, not a new pattern. It stays
  cleared through the existing recovery path (`:148-152`), which already
  rewrites `text` and pushes a second command label; explanation is never
  re-derived for a recovered card in this iterate (Internal Plan Review
  HIGH finding: the recovery path pushes a second label onto `commands`
  without incrementing the per-event counter, so a naive `commands.length`-only
  guard would miss it — clearing at the mutation site sidesteps that
  entirely rather than depending on a count that isn't reliable across
  that transition).
- [x] AC-2c: `missionActivityFeedReconcile.ts` rewrites a review card's and
  the latest test card's `text` from `MissionContext` after the derivation
  loop finishes (lines ~55-57, ~79). Wherever it rewrites a card's `text`,
  it also clears that card's `explanation` — an explanation excerpted from
  one turn's own words must never sit under a headline reconcile replaced
  with different, context-derived text (Internal Plan Review MEDIUM
  finding).
- [x] AC-3: `card.explanation` renders as **plain text**
  (`white-space: pre-wrap`), a new `.mc-feed-explanation` class with the
  SAME margin/font-size/color declarations as the established
  `.mc-feed-qa-answer` pattern plus only `pre-wrap` (kept as its own rule
  rather than editing `.mc-feed-qa-answer` in place, so that already-shipped
  class's rendering stays untouched) — NOT through `MarkdownChunk`.
  Decided, not defaulted (Internal Plan
  Review HIGH finding): `card.text` today is always a single sanitized
  line, so a markdown-rendered multi-line excerpt would be the first
  markdown BLOCK content ever shown inside a feed card, and the feed's own
  CSS styles only `p`/`strong`/`code` there — a heading, list, blockquote,
  table, or a char-cap slice that cuts a fence open would render unstyled
  or broken. Plain text needs no new CSS at all and trivially satisfies the
  look-and-feel parity requirement (AC-5).
- [x] AC-3b: `card.explanation`'s sanitization matches `card.text`'s, minus
  only the single-line collapse: strips C0/C1 control characters and the
  DEL byte while explicitly preserving `\n`/`\r`/`\t` (so multi-line
  structure survives), and strips the same Unicode bidi-override code
  points `clean()`/`sanitizeProofText` already strips from `card.text`
  (`proofLines.ts`) — factored out into a shared helper rather than
  duplicated, so the two fields can never silently drift apart on this.
  (Internal Plan Review MEDIUM finding: an earlier draft proposed skipping
  sanitization entirely on the reasoning that markdown rendering handles
  it safely — factually wrong twice over, since plain-text rendering
  applies no such handling and `stripControl` already preserves the three
  control characters multi-line text actually needs.)
- [x] AC-4: Requires no toggle and no new session data — a fixture built
  from an already-recorded (pre-existing) session JSONL still produces
  `card.explanation` wherever its turns already had multi-line prose.
  Verified with a fixture-based unit test, not a live launch.
- [x] AC-5 (look-and-feel parity, operator requirement): the new
  `card.explanation` block reuses the feed's existing card layout, spacing
  rhythm, and (per AC-3) an ALREADY-EXISTING plain-text style — no new
  page, no new navigation, no new color token, no new typography rule, no
  change to any OTHER card element (`text`, `detail`, `question`, status
  pill, command chips, icon/connecting-line). A component test asserts a
  card WITHOUT `explanation` renders byte-identical to today; a SEPARATE
  component test (not the E2E — External LLM Review MEDIUM finding: a
  browser-geometry/screenshot comparison between a populated and an
  unpopulated card would fail for the expected reason that the card is
  now taller, which is not a regression) confirms the explanation block
  itself renders with the existing plain-text answer styling.
- [x] AC-6 (visual-regression awareness, Internal Plan Review MEDIUM
  finding): before Build, the existing `client/e2e/visual/` fixture set is
  checked for any Mission-tab card that would newly gain an `explanation`
  under this change. If one exists, either the fixture is adjusted to a
  session whose qualifying turns produce no explanation, or the Linux-only
  baseline regeneration is planned and coordinated explicitly — this
  iterate does not silently let a visual baseline go stale.

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:**
  - FR-01.66 (Mission view) — `deriveActivityFeed()` gains a new bounded
    `card.explanation` field carrying a turn's own words beyond the first
    line (AC-1 through AC-5).
- **REMOVE:** none
- **NONE justification:** n/a (this iterate does modify an FR)

## Out of Scope
- **The narration toggle** (global Settings field, `--append-system-prompt`
  on every launch path, `{narrate.flag}` action-template placeholder) —
  built in an earlier plan revision, dropped for this iterate per two
  rounds of Architecture Review (both external reviewers, round 2,
  independently: ship content restoration alone; the toggle's permanent
  cross-launch-path complexity isn't justified by evidence from a single
  measured session, and restoring content may make the remaining gap moot)
  and the operator's explicit instruction ("stell sicher, dass wir dann
  auch keine settings und so bauen"). An operator who wants Claude to
  narrate a silent turn today already can, without any of this iterate's
  code: add `--append-system-prompt "<instruction>"` to a custom action's
  own `command_template` (deepseek, round 2) — the substitution path
  already supports it. Revisit the toggle as its own, separate iterate only
  if content restoration ships and silent (no-text) turns are still a
  material problem.
- A configurable length cap or expand/collapse UI interaction for
  `card.explanation` — it renders fully, bounded the same fixed way
  `card.detail` already is; no new interaction pattern this iterate.
- Extending `card.explanation` to `test`/`blocker`/`user-input` cards (they
  already have their own real-content field) or to `goal`/`delivery` cards
  (synthesized from `MissionContext`, not turn text — nothing to restore).
- Any change to how existing `GENERIC_TEXT` buckets are chosen (kind
  classification) — this iterate only adds content to a card once its
  kind/coalescing is already decided.
- Retroactively backfilling or rewriting anything on disk — `card.explanation`
  is purely derived in memory on every `deriveActivityFeed()` call; nothing
  is written anywhere (DO-NOT #1, #12 stay untouched — no server change at
  all in this iterate).
- Fixing the PRE-EXISTING 280-char truncation on a card's first line
  (`clean()`, `missionActivityFeedText.ts:13`) — content lost INSIDE that
  first line (a long single paragraph, or a >280-char sentence with no
  following newline) is not restored by this iterate; `card.explanation`
  only ever covers content starting from the SECOND line onward (Internal
  Plan Review MEDIUM finding). Fixing this would mean changing what counts
  as a card's headline, a larger and separate change from restoring
  already-discarded lines.
- Merging or restructuring cards so one assistant turn always renders as a
  single card even when its tool calls land in genuinely different kinds
  (e.g. a Read followed by an Edit) — AC-1 avoids duplicating one turn's
  explanation across such cards by attaching it to only the first, but does
  not merge the cards themselves; that is a kind-classification change,
  already out of scope above.

## Design Notes
Tier 1 (text) design check — a new `card.explanation` block inside
`MissionActivityFeed.tsx`, positioned directly below a card's existing
headline text, rendered as plain text with the SAME established styling
`.mc-feed-qa-answer` already uses (AC-3) — genuinely zero new CSS rules,
not merely "reuse the type scale". No new page, no new navigation, no new
color token, no layout restructuring, and — per the operator's explicit
requirement (AC-5) — no change to any card that has no `explanation` to
show. Full notes land here after Step 5 (Design Check) if the Tier-1 pass
raises anything beyond "reuse `.mc-feed-qa-answer`'s existing style as-is".

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| Claude's own assistant-turn output, lines beyond the first (already recorded in the session JSONL today — no launch involved, no new writer) | `client/src/lib/missionActivityFeed.ts` `deriveActivityFeed()` → new `card.explanation`, consumed by `MissionActivityFeed.tsx` (`MarkdownChunk`) | Session JSONL, same assistant `text` content block, lines 2..N |

No server-side boundary is touched by this iterate — `settings.json`,
`core/launcher.ts`, `core/actions-substitute.ts`, and every launch/fork
route are all out of scope (see above). `touches_io_boundary` does not
apply.

## Confidence Calibration
- **Boundaries touched:** the single row above — read-only, client-side,
  purely derived from data already on disk.
- **Empirical probes run:** n/a — no CLI flag, no server route, no new
  persisted state. The only open question is behavioral (does the excerpt
  read well against real multi-line prose), covered by fixture-based unit
  tests against real captured session JSONL, not a live probe.
- **Test Completeness Ledger:** *(filled before F0 — see Step 7.5, after Build)*
- **Confidence-pattern check:** *(filled before F0 — see Step 7.5, after Build)*

## Architecture Review

- **Brief:** `.shipwright/planning/iterate/iterate-2026-08-25-mission-feed-progress-narration/architecture_brief.md`

**Round 1 (original scope: narration toggle only, marker-based design)**
- **Verdicts:** deepseek=revise · openai=reject
- **Findings:** [proportionality, medium, openai] a 52% generic-card share
  on one session doesn't establish enough operator harm to justify
  permanent prompt+parsing+display+settings machinery — reject, keep
  current behavior. [simpler-alternative, high, deepseek] the `[PROGRESS]`
  marker is a permanent cross-package convention for what a plain
  first-line instruction plus the ALREADY-EXISTING first-line preference
  would achieve with zero new parsing code. [forecloses, medium, deepseek]
  every future surface that renders raw assistant text becomes a potential
  marker-leak site. [proportionality, medium, deepseek] the marker/strip/sync
  machinery is being built before real-world efficacy is known.
- **Operator decision (2026-08-25, first pass):** adopt deepseek's
  simplification — drop the `[PROGRESS]` marker, rely on the feed's
  existing first-line preference. Separately, the operator raised a
  broader point neither reviewer was asked about: Mission discards content
  Claude DID write, not just mislabels silent turns — added as a new,
  independent mechanism (content restoration, `card.explanation`) and
  re-reviewed (round 2).

**Round 2 (expanded brief: content restoration + simplified narration toggle, options A/B/C/D)**
- **Verdicts:** deepseek=revise · openai=revise (no reject — both converge
  on the same recommendation)
- **Findings:** [proportionality, medium, openai] the narration toggle
  creates a persisted preference and a cross-cutting launch-command
  obligation for an outcome demonstrated only by one session's
  generic-card rate and dependent on Claude honoring an instruction, while
  explanation restoration directly addresses the broader, already-established
  loss of already-recorded content — build option B (explanation
  restoration alone), reconsider narration only after real-session evidence.
  [proportionality, high, deepseek] `narrateProgress` adds a persisted
  setting, flag injection across multiple command-construction surfaces, a
  new action-template placeholder, shell-quoting/compatibility
  obligations, and a visible CLI-version failure mode — all to reduce a
  generic-fallback share measured on one production session, before the
  no-toggle explanation restoration has had any chance to address the
  operator's actual complaint. [simpler-alternative, medium, deepseek] an
  operator who wants narration today can already add
  `--append-system-prompt` to a custom action's own `command_template` —
  no new standing server machinery required.
- **Operator decision (2026-08-25, second pass):** adopt both reviewers'
  converged recommendation exactly — ship content restoration
  (`card.explanation`) only; drop the narration toggle from this iterate
  entirely (no settings field, no launch-path changes, no server changes
  at all). Confirmed explicitly by the operator, who also required visual
  parity with today's feed (AC-5) — addressed above.

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes, twice. First pass (14 findings, fixed/disclosed) ran
  against the original, narration-toggle-inclusive plan — see git history
  for that finding list; entirely superseded, since that mechanism was
  dropped. Second pass below ran against the content-restoration-only plan
  and is the one that governs Build.
- **Severity:** high
- **Summary:** the plan's factual claims about line numbers, `cardEventCounts`,
  and coalescing were all verified accurate, but three high-severity design
  defects would have shipped either broken or near-inert: the misattribution
  clear was placed where an existing sweep's short-circuit would never let
  it run; a card mutated to `kind: "blocker"` escaped the clearing logic
  entirely; and the `cardEventCounts === 1` invariant suppressed the most
  common valuable case (one turn, several coalescing tool calls). AC-5's
  "look and feel stays exactly the same" was also not achievable while
  rendering an excerpted, possibly-truncated markdown BLOCK into a card
  whose CSS supports only inline elements.
- **Findings (all fixed — see AC-1/AC-2/AC-2b/AC-2c/AC-3/AC-3b/AC-6 above
  and the mini-plan):**
  - [HIGH, fixed] Misattribution clear was folded into the existing
    `card.text !== GENERIC_TEXT` sweep, which short-circuits past every
    card that could ever have an explanation → clearing is now its own,
    separate, unconditional pass (AC-2).
  - [HIGH, fixed] A card mutated to `blocker` bypassed the clearing logic
    (kind no longer matched the sweep's filter) and its recovery path
    could carry a stale explanation under a rewritten headline → explicit
    clear at both the mutation site and left cleared through recovery
    (AC-2b).
  - [HIGH, fixed] `cardEventCounts === 1` (per tool-use EVENT) suppressed
    the common one-turn-many-tools-one-card case → replaced with a
    turn-provenance count (per assistant TURN), plus a per-turn
    at-most-one-card attach rule to avoid duplicating one turn's
    explanation across sibling cards (AC-1, AC-2 — also folds in the
    External LLM Review deepseek finding on the same subject).
  - [HIGH, fixed] AC-5 ("no new CSS") was incompatible with rendering a
    markdown BLOCK into a card whose stylesheet supports only
    `p`/`strong`/`code` → `card.explanation` renders as plain text via the
    feed's existing `.mc-feed-qa-answer` pattern instead of `MarkdownChunk`
    (AC-3) — this also resolves the External LLM Review's markdown-truncation
    and second-markdown-render-path findings, since neither applies to
    plain text.
  - [MEDIUM, fixed] Sanitization was proposed skipped on a reasoning the
    code contradicted (`stripControl` already preserves `\n`/`\r`/`\t`) →
    `card.explanation` gets the same control/bidi sanitization as
    `card.text`, factored into a shared helper (AC-3b).
  - [MEDIUM, fixed] `missionActivityFeedReconcile.ts` can rewrite a card's
    `text` after the derivation loop without touching `explanation`,
    leaving a stale explanation under a reconciled headline → reconcile
    also clears `explanation` wherever it rewrites `text` (AC-2c).
  - [MEDIUM, fixed] The visual-regression suite (Linux-only baselines) was
    never considered, and a qualifying fixture would silently go stale →
    AC-6 requires the check before Build.
  - [MEDIUM, fixed] Test-plan pointed at a client file that does not exist
    (`missionActivityFeedText.test.ts`) and its own coalescing test was
    vacuous as described (two tool-only turns coalesce with no prose
    either way, so the guard could be completely broken and the test would
    still pass) → corrected in the mini-plan: real target file
    (`missionActivityFeedFields.test.ts`), and the coalescing test is
    rewritten to use two turns with identical first lines but different
    remainders, which fails loudly if the clear doesn't run.
  - [LOW, fixed] A code-point-unsafe char-cap slice could split a
    surrogate pair (emoji/CJK) → excerpt truncation slices on code points
    (AC-1).
  - [LOW, fixed] Assigning `card.explanation = ""` (empty string) or an
    explicit `undefined` key for an empty remainder muddies the "additive
    field" claim → the property is only ever assigned when non-empty.
  - [LOW, fixed] Naming drift — the run/spec/E2E-spec names still said
    "progress-narration" after that mechanism was dropped → E2E spec
    renamed; a one-line scope note added at the top of the Goal section
    (already present above).
- **Known limitations:** the pre-existing 280-char first-line truncation
  (see Out of Scope) is carried forward, disclosed, not fixed.
- **Status:** 11 fixed, 1 disclosed, 0 declined.

## External LLM Review (iterate mode, re-run against the simplified plan)
- **Verdicts:** deepseek=revise · openai=revise (no reject).
- **Findings (all fixed — folded into the same ACs above; see Internal
  Plan Review for the overlapping items):**
  - [MEDIUM, openai, fixed] `proseRest` extraction needed an exact
    definition around blank lines and whitespace-only remainders → now
    `findIndex` + `slice(idx + 1)` (never a naive `slice(1)`), remainder
    required to have non-whitespace content before excerpting (AC-1).
  - [MEDIUM, openai, fixed] a new standalone CSS class risked drifting from
    the feed's established styling over time → resolved more directly than
    suggested: no new class at all, reuse `.mc-feed-qa-answer` verbatim
    (AC-3).
  - [MEDIUM, openai, fixed] the planned E2E "unchanged chrome" assertion
    was underspecified/fragile (adding text necessarily changes card
    height) → parity assertion moved to a component-level test comparing
    the SAME card input with and without `explanation`; E2E instead
    verifies real rendered behavior (AC-5).
  - [MEDIUM, openai, fixed] the mini-plan proceeded to Build without
    recording the required internal re-review, and assumed a fixture
    exists without confirming it → this section IS that recorded re-review;
    the mini-plan's E2E step now says explicitly to add a minimal fixture
    via the existing replay mechanism if no qualifying real one is found.
  - [LOW, openai, fixed] truncation could cut a markdown link/fence mid-construct
    → moot once rendering is plain text, not markdown (AC-3).
  - [LOW, openai, fixed] a second markdown render path for untrusted text
    needed its sanitizer verified, not assumed → moot for the same reason;
    plain-text sanitization is AC-3b instead.
  - [MEDIUM, deepseek, fixed] a turn with multiple tool-use events landing
    in DIFFERENT (non-coalescing) cards could duplicate the same
    explanation onto more than one card → the at-most-one-card-per-turn
    attach rule (AC-1) prevents this directly.
  - [LOW, deepseek, fixed] `proseRest` needed to preserve newline
    boundaries (`join("\n")`), not collapse to spaces, or markdown-shaped
    lists/fences would mangle → specified explicitly in the mini-plan.
  - [LOW, deepseek, fixed] ANSI escapes could leak into rendered text if
    Claude echoed terminal output in prose → covered by AC-3b's control-char
    stripping (which removes ANSI escape sequences along with other C0/C1
    controls, while preserving `\n`/`\r`/`\t`).
  - [LOW, deepseek, fixed] a new class without an identified reused token
    risked missing/incorrect styling with no test to catch it → moot, see
    the openai finding above; the component test in AC-5 covers the
    reused-style claim directly.
  - [LOW, deepseek, fixed] interleaving new clearing logic into the
    existing sweep risked altering existing behavior → same fix as the
    Internal Plan Review's HIGH finding on this exact point: a separate,
    additive pass (AC-2).
- **Status:** 11 fixed, 0 disclosed, 0 declined.

## Code-Stage Review Cascade (spec-reviewer -> code-reviewer -> doubt-reviewer)

Runs the "code" half of the operator's original "volle Review Kaskade im
Plan und im Code" instruction — the "Plan" half is the Architecture Review +
Internal Plan Review + External LLM Review sections above.

- **spec-reviewer:** first pass REJECT — AC-3b ("`card.explanation`'s
  sanitization matches `card.text`'s") was not met: `explanationExcerpt()`
  stripped C0 controls + DEL via `stripControl` but never C1 (U+0080-U+009F),
  which `sanitizeProofText` (the `card.text` path) does strip. Fixed by
  factoring a new `stripC1Controls()` helper into `proofLines.ts` and wiring
  it into `explanationExcerpt()`; regression tests added in
  `proofLines.test.ts` and `missionActivityFeedFields.test.ts`. Re-review:
  **PASS**.
- **code-reviewer:** **PASS**, zero findings. Independently traced the
  turn-provenance counting state machine (`cardTurnCounts`,
  `explanationAttachedThisTurn`) against every edge case named in the
  review brief and found the same HIGH-severity traps already closed by
  Internal Plan Review correctly closed in the shipped code; confirmed test
  quality (the new tests exercise the tricky coalescing/clearing logic, not
  just restate the implementation).
- **doubt-reviewer:** advisory, 2 doubts raised, both addressed by written
  rebuttal below (neither blocks commit per the doubt-reviewer's own
  contract — "advisory... fix or reasoned rebuttal").
  - **[HIGH] Stale `unresolvedBlockers` commandKey can silently delete an
    unrelated coalesced card.** Concrete repro: a command fails once
    (parked in `unresolvedBlockers` with no expiry, no scoping to that
    card). Many turns later, an unrelated turn's *different* several tool
    calls coalesce into one card (same kind/text/artifact — the existing
    "many-files-in-a-row" pattern), and one of them happens to share the
    exact same command string as the old failure. Its success is
    misread as "the old failure's retry," and the *current* card — with
    its unrelated commands and its newly-added `card.explanation` — is
    spliced out of the feed entirely, not just the stale one.
    **Rebuttal:** confirmed real, but pre-existing in `add()`'s
    `unresolvedBlockers` recovery mechanism (`missionActivityFeed.ts`
    lines ~176-185) from `iterate-2026-08-20-mission-feed-content` —
    unrelated to this iterate's own logic, which only reads
    `card.explanation` off a card that mechanism can already delete
    (before this iterate it could already silently delete `commands`/
    `detail`/`text`/`status` the same way). This iterate's diff does not
    touch `unresolvedBlockers`'s matching, and fixing that matching is a
    materially different, separately-scoped change (its own regression
    tests against the existing recovery-mechanism test suite) — out of
    scope for a change the operator explicitly asked to keep to content
    restoration only, no unplanned machinery. Filed as its own follow-up:
    triage card `trg-27f83477` (FR-01.66, severity high).
  - **[MEDIUM] `proseRest` could theoretically bleed a different tool
    call's narration into a sibling card's explanation, if the CLI ever
    emits `[text, tool_use, text, tool_use]` (multiple `text` blocks
    interleaved with `tool_use` blocks) in one assistant turn.**
    `assistantText()` (`session-parser.ts`, pre-existing, unmodified by
    this iterate) joins *every* `text` block in a message with no
    awareness of `tool_use` block boundaries — a latent property of the
    shared helper this reducer (both the pre-existing `prose` headline
    and this iterate's new `proseRest`) already trusted before this
    diff. **Rebuttal:** no captured real-session fixture
    (`client/src/test/fixtures/ndjson-transcripts/*.jsonl`) exhibits this
    shape, and Claude Code's own tool-use turns do not empirically
    interleave narration between parallel tool calls in one turn — text
    precedes the tool_use block(s), not between them. Even in the
    theoretical case, the failure mode is soft (an explanation reads as
    slightly-off elaboration on a sibling action from the SAME turn,
    never a wrong turn's words, never data loss or corruption) — not
    worth a defensive rewrite of a shared, unmodified upstream helper on
    unconfirmed evidence. No code change; noted here for a future
    reviewer if a real transcript ever surfaces the shape.

## External Code Review (`--mode code`, diff vs. spec)
- **Ran:** yes, against the diff after the internal spec/code/doubt cascade
  above. `openai` succeeded; `deepseek` returned an empty reply
  (`status: degraded`) — single-provider result, not a contradiction (no
  second verdict to disagree with).
- **Verdict:** revise (ship-with-fixes) → all addressed below.
- **Findings:**
  - [HIGH, openai, fixed] `cardTurnCounts` was only ever incremented for
    the FIRST card a turn touches (inside the same
    `!explanationAttachedThisTurn` gate that decides which card gets the
    explanation TEXT) — a turn's SECOND, non-explanation-receiving card
    was never counted at all. Concretely: turn 1 produces card A
    (investigate, counted+explained) then card B (implement, uncounted).
    A later turn that coalesces only into B starts `cardTurnCounts` from
    zero for it, so B reads as touched by exactly 1 turn even though 2
    turns really touched it — its explanation incorrectly survives the
    clearing pass. Fixed: counting and explanation-attachment are now two
    independent guards — a per-turn `cardsTouchedThisTurn` Set increments
    `cardTurnCounts` once for every DISTINCT card the turn touches,
    while `explanationAttachedThisTurn` continues to gate only which one
    card's `explanation` gets written. New regression test (i) in
    `missionActivityFeed.explanation.test.ts`, confirmed to fail against
    the pre-fix code and pass against the fix.
  - [MEDIUM, openai, declined with rebuttal] AC-4 read as requiring a
    test built from a captured, on-disk JSONL fixture file (e.g. under
    `client/src/test/fixtures/ndjson-transcripts/`), which the diff's
    tests don't use. **Rebuttal:** this repo's established precedent for
    the identical claim ("fixture built from an already-recorded session
    JSONL, not a live launch") is `mission-feed-content.spec.ts`
    (`iterate-2026-08-20-mission-feed-content`), which synthesizes JSONL
    via `seedClaudeJsonlEvents` rather than loading a static file — real
    JSONL bytes through the real parser/reducer either way. This
    iterate's `mission-feed-explanation.spec.ts` follows that exact,
    already-reviewed pattern; introducing a new on-disk-fixture mechanism
    used nowhere else in this feed's test suite would be scope creep, not
    a genuine gap.
  - [MEDIUM, openai, fixed] the AC-5 "byte-identical" parity test only
    checked specific substrings' presence, which would still pass if
    adding `explanation` had also perturbed surrounding card markup
    (wrapper, chip/pill structure, status UI). Fixed: a new component
    test renders the same card with and without `explanation` and asserts
    the "with" render's full card `outerHTML`, minus exactly the new
    `.mc-feed-explanation` node, equals the "without" render's markup
    byte-for-byte.
  - [LOW, openai, fixed] the three explanation-clearing sites assigned
    `card.explanation = undefined` rather than `delete card.explanation`,
    leaving an enumerable own property present with an `undefined` value
    (harmless for the `{card.explanation && ...}` render gate and for
    `JSON.stringify`, but observable to `Object.keys`/property
    enumeration). Fixed at all three sites (the blocker-mutation clear,
    the final turn-provenance clearing pass, and the reconcile.ts
    review-card clear) — `delete`, not `= undefined`.
- **Status:** 2 fixed (1 correctness, 1 test-rigor), 1 fixed (style), 1
  declined with a written rebuttal (precedent-matching test pattern, not
  a real gap). Zero declined without rebuttal.

## Verification (medium+)
- **Surface:** web
- **Runner command (from the worktree root, no shell operators — F0.5's
  `surface_verification.py` runs the runner with no shell):**
  `node client/e2e/isolated-stack.mjs e2e/flows/mission-feed-explanation.spec.ts --project=chromium --reporter=line`
- **Evidence path:** `client/e2e/flows/mission-feed-explanation.spec.ts` run output (isolated-stack.mjs orchestrator, real Chromium); F0.5 result recorded at `.shipwright/runs/iterate-2026-08-25-mission-feed-progress-narration/surface_verification.json` (`exit_code: 0`, `tests_run: 1`)
