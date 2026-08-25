# Mini-Plan: mission-feed-progress-narration

- **Run ID:** iterate-2026-08-25-mission-feed-progress-narration

Scope (final, per Architecture Review round 2 + operator decision, see
iterate spec): content restoration only (`card.explanation`), client-only,
no server changes. This revision incorporates the Internal Plan Review
(3 HIGH findings) and the re-run External LLM Review (revise/revise) — see
the iterate spec's review sections for the full finding list. The design
below is the corrected one; do not reference an earlier revision of this
file.

## 0. The corrected algorithm (read this before the file list)

Two invariants replace the earlier, broken "exactly one tool-use event"
rule:

1. **Turn provenance, not event count.** A card's `explanation` is set
   only when **exactly one assistant turn** contributed to it — tracked by
   a NEW counter incremented once per turn (not once per tool-use event),
   so a single turn issuing several tool calls that coalesce into one card
   still counts as one contributing turn and keeps its explanation. The
   EXISTING `cardEventCounts` (`missionActivityFeed.ts:73/78`) is untouched
   and keeps its own, different job (the label-derived-sentence fallback at
   `:220-225`).
2. **At most one card per turn gets the explanation.** Within one turn's
   tool-use loop, once an explanation has been attached to the first card
   that turn produced, it is not attached again to a second, genuinely
   different card the SAME turn also touches (e.g. a Read landing in
   `investigate` and an Edit landing in `implement`) — prevents duplicating
   one turn's words across sibling cards (External LLM Review, deepseek).

Clearing `explanation` when a SECOND turn later coalesces into an
already-explained card is its own, separate, unconditional pass — run
AFTER `deriveActivityFeed()`'s existing `:220-225` sweep and NOT folded
into it, because that sweep's own `if (card.text !== GENERIC_TEXT[...]) continue`
would skip every card that could ever have an explanation (a card only
gets `text !== GENERIC_TEXT` when it has real prose, which is exactly when
it might have an explanation too) — folding the clear in there makes it a
permanent no-op (Internal Plan Review HIGH finding).

A card mutated to `kind: "blocker"` (`:136`) is cleared explicitly AT that
mutation site, the same way `detail` is already set there — not left to
the turn-provenance sweep, since the recovery path (`:148-152`) pushes a
second command label without touching the per-event counter, so a
count-based guard alone would miss it (Internal Plan Review HIGH finding).

`missionActivityFeedReconcile.ts` clears `explanation` wherever it
rewrites a card's `text` (review-card and latest-test-card overwrites,
`:55-57`, `:79`) — an excerpt from one turn's words must never sit under a
headline reconcile replaced (Internal Plan Review MEDIUM finding).

`card.explanation` renders as **plain text** (`white-space: pre-wrap`),
reusing `.mc-feed-qa-answer`'s existing style verbatim — NOT `MarkdownChunk`.
`card.text` is always a single sanitized line today, so a markdown-rendered
multi-line excerpt would be the first markdown BLOCK content ever shown
inside a feed card, and the feed's CSS supports only inline `p`/`strong`/`code`
there; a heading, list, or a char-cap slice that cuts a fence open would
render unstyled or broken. Plain text needs zero new CSS and makes the
look-and-feel-parity requirement (AC-5) trivially true (Internal Plan
Review HIGH finding).

## 1. Files to create/modify

**Client only — no server files, no Settings, no launcher/actions-substitute
changes.**

- `client/src/lib/proofLines.ts` (edit) — extract the bidi-override filter
  currently inline inside `sanitizeProofText` (lines ~136-140: `0x200e`,
  `0x200f`, `0x202a-0x202e`, `0x2066-0x2069`) into its own exported
  `stripBidiOverrides(s: string): string`; `sanitizeProofText` calls it
  instead of duplicating the check (no behavior change to
  `sanitizeProofText` or its existing callers — verified by its existing
  test suite passing unchanged).
- `client/src/lib/missionActivityFeed.ts` (edit) — `ActivityCard` gains
  `explanation?: string`, doc comment distinguishing it from `detail`
  (plain-text assistant prose vs. raw tool/test output, both rendered as
  literal text but from different sources and never conflated). In the
  tool-use loop (~line 169-210):
  - Compute the turn's own lines once: `find` the index of the first
    non-empty line (`findIndex`, never a bare `[0]`/`slice(1)` — a leading
    blank line must not leak into `prose`); `prose` stays exactly what it
    is today (`clean()` of that line); NEW: `proseRest` is
    `lines.slice(firstNonEmptyIdx + 1).join("\n")` (join with `\n`,
    preserving blank lines and structure — never space-joined or filtered,
    External LLM Review deepseek finding) — only computed further when
    `proseRest.trim().length > 0`.
  - A per-event `let explanationAttachedThisTurn = false;` declared once
    per assistant event, before its tool-use loop.
  - In the `review`/`spec`/`investigate`/`implement` branch: after
    `add()` returns `card`, increment a NEW `Map<ActivityCard, number>`
    (`cardTurnCounts`) for that card **only on the first eligible add()
    call this turn** (i.e. only when `!explanationAttachedThisTurn`); if
    `proseRest` is non-empty, set `card.explanation` to the bounded
    excerpt (§2 helper) on that same first call, then set
    `explanationAttachedThisTurn = true`. Never assign an empty string or
    an explicit `undefined` — the property is only ever written when the
    excerpt is non-empty (Internal Plan Review LOW finding).
  - A NEW, separate, unconditional pass over `cards` (after the existing
    `:220-225` sweep, not merged into it): `if (card.explanation && cardTurnCounts.get(card) !== 1) card.explanation = undefined;`.
  - At the blocker mutation site (`:136`): add
    `pending.card.explanation = undefined;` alongside the existing
    `kind`/`text`/`status` mutation.
- `client/src/lib/missionActivityFeedText.ts` (edit) — new
  `explanationExcerpt(content, maxLines = 6, maxChars = 600): string`
  export, modeled on `excerpt()`'s truncation SHAPE but deliberately
  different in three ways: (1) preserves blank lines (no `.filter((line) => line.length > 0)`
  — blank lines are real paragraph breaks in plain-text-rendered prose);
  (2) sanitizes via `stripControl` (preserves `\n`/`\r`/`\t`) + the new
  `stripBidiOverrides` from `proofLines.ts` — NOT `stripAnsi`/`stripControl`
  skipped entirely as an earlier draft proposed, and NOT
  `sanitizeProofText` (which strips tab/CR/LF too, collapses whitespace,
  and single-line-truncates — wrong for multi-line prose); (3) the
  char-cap truncation slices on Unicode code points
  (`Array.from(joined).slice(0, maxChars).join("")`), never a raw UTF-16
  `.slice()`, so an emoji/CJK character at the boundary is never split
  into a lone surrogate (Internal Plan Review LOW finding).
- `client/src/lib/missionActivityFeedReconcile.ts` (edit) — at both sites
  that rewrite a card's `text` (the review-card and latest-test-card
  overwrites, ~lines 55-57 and ~79), also set `card.explanation = undefined`.
- `client/src/components/external/mission/MissionActivityFeed.tsx` (edit)
  — a new block, positioned after the existing `card.text` `MarkdownChunk`
  render and before `card.question`, renders `card.explanation` as plain
  text reusing the EXACT existing `.mc-feed-qa-answer` class/markup shape
  (`white-space: pre-wrap`, no `MarkdownChunk`, no new CSS class). Renders
  nothing at all when `card.explanation` is unset — every other card
  element is untouched.

**Tests**
- `client/src/lib/proofLines.test.ts` (extend) — `stripBidiOverrides()`
  unit coverage (the four code-point ranges); `sanitizeProofText`'s
  existing test suite passes unchanged (regression proof the refactor is
  behavior-preserving).
- `client/src/lib/missionActivityFeedFields.test.ts` (extend — this is the
  REAL existing file for `detail`/excerpt field coverage; an earlier draft
  of this plan wrongly pointed at a nonexistent `missionActivityFeedText.test.ts`,
  Internal Plan Review MEDIUM finding) — `explanationExcerpt()` unit
  coverage: empty input, single-line input (empty result), multi-line
  under both caps, multi-line over the line cap, multi-line over the char
  cap (code-point-safe, with an emoji straddling the boundary), a remainder
  with internal blank lines (preserved), bidi/control characters stripped.
- `client/src/lib/missionActivityFeed.test.ts` (extend):
  (a) a solo-turn `investigate`/`spec`/`implement`/`review` card with
  multi-line `assistantText()` → `card.explanation` set to the bounded
  remainder, `card.text` still just the first line;
  (b) same turn but single-line `assistantText()`, or a remainder that is
  whitespace-only → `card.explanation` undefined (never `""`);
  (c) **non-vacuous coalescing test** (Internal Plan Review MEDIUM
  finding: the original description of this test was vacuous — two
  tool-only turns coalesce with no prose either way, so a completely
  broken guard would still pass it) — two turns whose FIRST lines are
  IDENTICAL (so `add()` coalesces them into one card) but whose remainders
  DIFFER → `card.explanation` is undefined on the resulting card, proving
  the turn-provenance clear actually runs;
  (d) one turn, three tool calls, all coalescing into one card (the
  "many-files-in-a-row" case, `:166-168`'s own comment) → `card.explanation`
  IS set (this is the case the old `cardEventCounts === 1` rule would have
  wrongly suppressed — the regression test for the HIGH finding);
  (e) one turn whose tool calls land in two DIFFERENT, non-coalescing
  cards (e.g. investigate + implement) → only the FIRST card gets
  `explanation`, the second does not (External LLM Review deepseek
  finding);
  (f) a turn whose assistantText STARTS with one or more blank lines →
  `prose`/`explanation` split correctly at the first NON-empty line, no
  leak of blank content into either field;
  (g) a card that errors and becomes `kind: "blocker"` → `explanation`
  cleared at the mutation, stays cleared through recovery even though
  `commands.length` becomes 2 without the per-event counter changing (the
  regression test for that HIGH finding);
  (h) a card whose `text` is rewritten by `reconcileArtifactCards` (a
  review card with `artifacts: [{kind: "review", state: "available"}]`,
  or the latest test card) → `explanation` cleared alongside;
  (i) an already-recorded fixture session (proves AC-4 — no toggle
  needed). All existing fixtures must still pass byte-for-byte for
  `card.text`/coalescing/status/`detail` — this iterate only adds a field
  and never changes existing derivation.
- `client/src/components/external/mission/MissionActivityFeed.test.tsx`
  (extend) — a card with `explanation` set renders it as plain text using
  the SAME class/markup as an existing `question.answer` block (AC-3,
  AC-5's styling-reuse assertion); a card WITHOUT `explanation` renders
  byte-identical to today (AC-5's parity assertion) — this component test,
  not the E2E, is where parity is proven (External LLM Review finding: a
  browser screenshot/geometry diff between a populated and unpopulated
  card would fail for the expected reason that the card is taller).
- `client/e2e/flows/mission-feed-explanation.spec.ts` (new, renamed from
  the earlier "progress-narration" name — that mechanism no longer
  exists in this iterate, Internal Plan Review LOW finding) — a fixture
  session JSONL with genuine multi-line assistant prose on a solo-turn
  `implement` card, replayed through the real Mission Activity tab via
  `isolated-stack.mjs`, asserting the rendered card shows both the
  headline AND the explanation text. If no existing captured fixture
  qualifies (a solo-turn narrative card with real multi-line prose),
  author a minimal one through the project's existing session-fixture/replay
  mechanism rather than depending on an incidental session's
  classification (External LLM Review finding) — check first against
  `client/e2e/flows/mission-feed-content.spec.ts`'s existing fixtures for
  overlap before adding a new one.

**Spec**
- `.shipwright/planning/01-adopted/spec.md` — FR-01.66 AC additions
  (written at F1, per finalization order — not now).

## 2. Work Breakdown

1. `proofLines.ts`: extract `stripBidiOverrides()`; confirm
   `sanitizeProofText`'s existing tests still pass unchanged.
2. `missionActivityFeedText.ts`: `explanationExcerpt()` + its unit tests
   in `missionActivityFeedFields.test.ts` (empty / under-cap /
   line-cap-truncated / char-cap-truncated-code-point-safe /
   blank-lines-preserved / control-and-bidi-stripped).
3. `missionActivityFeed.ts`: `ActivityCard.explanation`; turn-provenance
   tracking (`cardTurnCounts`, `explanationAttachedThisTurn`); the
   separate post-processing clear pass; the blocker-mutation-site clear.
   Test matrix (a)-(g)+(i) above.
4. `missionActivityFeedReconcile.ts`: clear `explanation` at both
   text-rewrite sites. Test (h).
5. `MissionActivityFeed.tsx`: render `card.explanation` reusing
   `.mc-feed-qa-answer`'s exact style. Component tests (AC-3, AC-5).
6. Visual-regression check (AC-6): grep `client/e2e/visual/` fixtures for
   a Mission-tab card that would newly qualify; adjust the fixture or plan
   the Linux baseline regen coordination if one is found.
7. E2E: author `mission-feed-explanation.spec.ts` (check
   `mission-feed-content.spec.ts` for a reusable fixture first). Execute
   against the dev stack (mandatory at medium+).

## 3. Component Hierarchy (UI)

`MissionActivityFeed` → each card → `card.text` (`MarkdownChunk`,
unchanged) → **new:** `card.explanation` (plain text, reusing
`.mc-feed-qa-answer`'s style) → `card.question` (unchanged) →
`card.detail` (raw `<pre>`, unchanged). No new component, no new page, no
new CSS class.

## 4. Data Model Changes

`ActivityCard.explanation?: string` (client-only, `client/src/lib/missionActivityFeed.ts`)
— a purely derived, in-memory field computed fresh on every
`deriveActivityFeed()` call from data already in the session JSONL; no
persistence, no schema version, nothing written anywhere, no server type
to mirror.

`proofLines.ts` gains one new exported pure function
(`stripBidiOverrides`); `sanitizeProofText`'s own signature and behavior
are unchanged.

## 5. Test Strategy

Unit coverage: the bidi-filter extraction (regression-proof for
`sanitizeProofText`), the new excerpt helper in isolation, the full
turn-provenance derivation matrix (9 cases, (a)-(i)) in
`missionActivityFeed.test.ts`, the reconcile-clearing cases, and the
render/parity assertions in `MissionActivityFeed.test.tsx`. One new
real-browser E2E spec, authored AND executed (mandatory at medium+), plus
an explicit visual-regression fixture check before Build (AC-6). No
server-side tests at all — nothing server-side changed. No integration/pgTAP
layer. Tier 1 design pass only (no structural UI change, and per AC-3 no
new CSS at all).

## 6. Alternative Approaches (considered and rejected)

**Alternative A — a dedicated LLM summarization call per activity-feed
card** (the mechanism inferred for Codex's desktop app): rejected because
it requires a second, separate API call per card (added latency, a second
cost line), the operator explicitly wanted to avoid a second call, and it
would still need its own opt-in/cost gate for no requested benefit beyond
what reading the already-written text achieves for free.

**Alternative B — build the narration toggle too, alongside content
restoration** (the plan's own shape through two prior revisions): dropped
per Architecture Review round 2 (both external reviewers, independently,
`revise`) and the operator's explicit instruction not to build any
settings/launch-path machinery this iterate. Both reviewers judged the
toggle's permanent cross-launch-path complexity unjustified by evidence
from a single measured session, especially once content restoration (which
needs none of that machinery) addresses the operator's actual, broader
complaint. An operator who still wants narration on a silent turn can
already get it today, with zero code from this iterate, by adding
`--append-system-prompt "<instruction>"` to a custom action's own
`command_template` — the substitution path already supports arbitrary
flags in a custom template. Revisit as its own separate iterate only if
content restoration ships and silent (no-text) turns remain a material
problem.

**Alternative C — render `card.explanation` via `MarkdownChunk`, matching
`card.text`'s path** (the plan's own shape until this revision): rejected
per Internal Plan Review (HIGH) — `card.text` is always single-line today,
so this would be the first markdown BLOCK content ever shown inside a
feed card, and the feed's CSS supports only inline `p`/`strong`/`code`
there; a heading/list/table/blockquote, or a char-cap slice that cuts a
fence open mid-truncation, would render unstyled or broken, directly
violating the operator's explicit look-and-feel-parity requirement. Plain
text via the feed's existing `.mc-feed-qa-answer` pattern needs zero new
CSS and makes that requirement true by construction.

**Alternative D — gate `explanation` on the per-tool-use `cardEventCounts === 1`
guard, reusing the exact mechanism `detail`/the label-sentence fallback
already use** (the plan's own shape until this revision): rejected per
Internal Plan Review (HIGH) — that counter is per EVENT, not per TURN, so
it wrongly suppresses the single most common valuable case: one turn
writing an explanation and then issuing several tool calls that coalesce
into one card (exactly the "many-files-in-a-row" case the reducer's own
existing comment names). Turn-provenance tracking (§0) is a materially
different, correct invariant, not a copy of the existing pattern with a
different field name.
