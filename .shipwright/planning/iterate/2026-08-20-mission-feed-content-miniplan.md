# Mini-Plan: mission-feed-content

- **Run ID:** iterate-2026-08-20-mission-feed-content

**Revised after external plan review** (both reviewers approved the
architecture brief's Option A unanimously; the plan-mode pass returned one
explicit `revise` plus a second review whose prose raised the same findings
but whose verdict line the parser could not extract — treated as `revise`
by content, not by the unparsed tag). Findings folded in below: (1) a
per-kind real-content source matrix, since the draft only spelled out three
of nine kinds explicitly; (2) `excerpt()` redesigned as its own bounded
multi-line truncation, not `sanitizeProofText` re-applied (which would
have collapsed a multi-line failure back to one line — a genuine bug the
review caught); (3) `card.status` added as an explicit `MissionContext`
-derived field rather than left as a build-time "maybe"; (4) the
`user-input` resolution shape redesigned to separate "resolved" from
"matched to a listed option" (the draft's `picked: string | null` would
have kept showing the terminal-CTA on a genuinely-answered-but-unmatched
question — the reviewer's sharpest catch); (5) the `commitArtifact`
prop-threading question resolved now, not deferred (see Component
hierarchy below); (6) a security finding (raw output could carry secrets)
resolved as **not applicable** with a stated reason, not silently dropped —
see Content-safety / disclosure note below.

**Revised again after Internal Plan Review (`opus-plan-reviewer`).** Two
findings changed the plan below, both caught by tracing the new `detail`/
`status` fields against the *existing* mutation-based reducer in
`missionActivityFeed.ts` rather than reading the fields in isolation: (7,
high) the blocker- and test-recovery branches (`deriveActivityFeed()`,
current lines 115-120 and 128-134) revert `card.text`/`card.kind` back to a
success message in place but never cleared the new `status`/`detail` —
a recovered card would keep showing a red error pill and the stale failure
excerpt underneath its own "recovered" sentence. Now fixed by explicitly
clearing both fields in each recovery branch (see the `missionActivityFeed.ts`
bullet below). (8, medium) `add()`'s existing coalescing (shared card object
across consecutive tool_use events with identical kind+text+artifact — the
"many-files-in-a-row" case the current in-code comment already documents)
means a card that later turns into a `blocker` can be the SAME object several
unrelated commands share; attaching `detail` there would show one command's
error excerpt beside other, non-erroring commands' chips. Now fixed by only
attaching `detail` when the erroring card still represents exactly one
command at the moment of the error (`pending.card.commands.length === 1`) —
recovering full per-command attribution would require disabling coalescing
broadly, which risks the existing coalescing-dependent test the in-code
comment calls out, so the narrower guard was preferred. A third, low-severity
finding corrected two wrong "CLAUDE.md rule 27" citations below (rule 27
governs route-level scroll ownership, not CSS token scoping — an unrelated
rule; the citations now point at the sibling iterate that actually
established the dark-token scope). A fourth, low-severity finding
(`excerpt()`'s hard char-cap can in principle cut a UTF-16 surrogate pair
mid-character on non-BMP content such as an emoji in raw tool output) is
**declined**: the resulting rendering artifact is a single wrong glyph in a
rare input class, `sanitizeProofText` (already shipped, reused elsewhere in
this same file) has the identical plain-slice behavior today, and adding a
surrogate-boundary check would be new complexity for a cosmetic edge case
outside this run's goal of correct *content*, not perfect Unicode boundary
handling.

## Per-kind real-content source matrix

| Kind | `text` source | New in this run |
|---|---|---|
| `investigate` | `assistantText()` prose if present, else existing fallback sentence | No — already shipped (iterate-2026-08-13-mission-mobile-visual) |
| `spec` | same as above | No — already shipped |
| `implement` | same as above | No — already shipped |
| `review` | same as above | No — already shipped |
| `test` | existing lead-in sentence (accurate, stays fixed) | `detail`: real bounded output excerpt when the resolving tool_result is an error, or when `MissionContext.tests.gate === "fail"` at render time (whichever is available — see AC below); `status` from `MissionContext.tests.gate` |
| `user-input` | short fixed lead-in ("A decision is needed:") — the `question` block carries the real content | `question.text`/`question.options` from `askUserQuestionSummary()`; `question.resolved`/`picked`/`answer` from the resolving tool_result |
| `blocker` | existing lead-in sentence (stays fixed) | `detail`: real bounded output excerpt from the erroring tool_result |
| `delivery` | **changed**: real PR title (`commit` artifact's `message`) + merge state, e.g. `Merged as "{message}".`, falling back to the existing fixed sentence when the commit artifact or its detail is absent | Yes — this was still a fixed sentence in the draft; now sourced from `context.artifacts` (commit kind) |
| `system` (compaction marker) | `"Context automatically compacted."` | No — this is already the literal real event, not a placeholder; no change |

## Files to create/modify

- `client/src/lib/missionActivityFeed.ts` — edit:
  - `ActivityCard` gains three additive, optional fields:
    `detail?: string` (bounded raw-output excerpt), `status?: "ok" | "err"
    | "warn"` (pill state, derived from `MissionContext` — never from
    string-matching `card.text`), and
    `question?: { text: string; options: string[]; resolved: boolean;
    picked?: string; answer?: string }` (real AskUserQuestion content —
    `resolved` separates "genuinely still pending" from "answered", so the
    unresolved-CTA never renders once the transcript shows a resolution,
    even when the answer text doesn't match a listed option verbatim). No
    existing field changes shape; every existing fixture keeps compiling
    with these fields simply absent.
  - `client/src/components/external/ToolOutputBlock.tsx` — edit: export its
    already-existing `stripControl` alongside the already-imported
    `stripAnsi`, so `missionActivityFeed.ts` can reuse the exact same
    control-sequence stripping the transcript already relies on instead of
    a second implementation.
  - New helper `excerpt(content: string, maxLines = 4, maxChars = 320):
    string` in `missionActivityFeed.ts` — its OWN bounded truncation, not
    `sanitizeProofText` (which single-line-truncates and would collapse a
    multi-line failure back to one line, defeating the point — caught by
    external review): `stripControl(stripAnsi(content))` → split on `\n` →
    drop blank/whitespace-only lines → take up to `maxLines` → join with
    `\n` → hard-cap at `maxChars` with a trailing `…` marker if cut. Empty
    result (blank/missing content) returns `""` and the caller omits the
    code block rather than rendering an empty one. Applied to
    `result.content` at the three sites below — never the whole content.
  - `bucket === "user-input"` (tool_use time): call
    `askUserQuestionSummary(tool.input)` and set
    `card.question = {text, options, resolved: false}`. Unresolved
    rendering (the existing `AnswerInTerminalButton` "jump to terminal"
    CTA, FR-01.63) is now driven by `question.resolved === false` instead
    of "tool_result not yet seen" — same underlying event, clearer signal
    for the component.
  - tool_result resolution for `user-input`: on non-error, set
    `question.resolved = true`. First probe the actual shape of
    `result.content` for a real `AskUserQuestion` resolution against a
    captured fixture (work-breakdown step 1, before writing the matching
    logic — the external review flagged this as unverified, not just
    "confirm at build time"). If it is plain text: normalize whitespace/
    case and match against `question.options`; a match sets `picked`, no
    match sets `answer = excerpt(result.content)`. If it is structured
    (e.g. JSON), extract the decision field explicitly instead of
    string-matching raw JSON. Either way, a resolved question NEVER
    renders `AnswerInTerminalButton` again — `resolved` alone gates that,
    independent of whether `picked` or `answer` ended up set.
  - tool_result resolution for `blocker` (the `result.is_error` branch,
    current line ~124): keep `card.text = "A command needs attention before
    work can continue."` as the lead-in (it is accurate, not the whole
    problem), set `card.status = "err"`, and add
    `card.detail = excerpt(result.content)` — but **only when
    `pending.card.commands.length === 1`** at that moment. `add()`
    coalesces consecutive same-kind/text/artifact cards into one shared
    object across several tool_use ids (the existing "many-files-in-a-row"
    case); attaching one command's error excerpt to a card whose
    `commands` chip list still names other, unrelated, non-erroring
    commands would misattribute it (internal plan review, finding 8,
    medium). A coalesced multi-command card that errors still flips to
    `blocker` with `status = "err"` and its accurate lead-in sentence —
    it just carries no `detail` code block, exactly like the existing
    "no raw excerpt available" case already accepted for `test` below.
  - **Recovery clearing (internal plan review, finding 7, high):** both
    existing recovery branches revert `card.text`/`card.kind` back to a
    success message in place but must now also clear the new fields, or a
    recovered card keeps showing a stale error pill/excerpt underneath its
    own "recovered" sentence:
    - blocker recovery (current line ~130, the
      `unresolvedBlockers.has(pending.commandKey)` branch): alongside the
      existing `blocker.card.kind = blocker.bucket; blocker.card.text =
      "A command error recovered after a successful retry.";`, add
      `blocker.card.status = undefined; blocker.card.detail = undefined;`.
    - test recovery (current line ~115, the `unresolvedTest &&
      context?.tests?.gate === "pass"` branch): alongside the existing
      `unresolvedTest.text = "Tests recovered and have a recorded passing
      result.";`, add `unresolvedTest.status = "ok"; unresolvedTest.detail
      = undefined;`.
    - New fixtures/tests (work-breakdown step 2, folded into the red-then-
      green pass): a blocker that errors (gets `status:"err"`, a `detail`
      excerpt) then recovers on retry — assert the recovered card has
      neither; a coalesced two-command card (identical fallback sentence,
      no per-call prose) where only one command errors — assert the
      rendered card shows the accurate lead-in and `status:"err"` but no
      `detail` block.
  - `test` card: `card.status` is set from `context?.tests?.gate`
    (`"pass"→"ok"`, `"fail"→"err"`, `"unknown"→"warn"`) at the same call
    sites that already write the gate-derived `text` today — this is a
    read of the *same* already-consumed `MissionContext` value, not a new
    dependency. `card.detail` is attached from the erroring tool_result's
    `result.content` at the pending-error branch (current line ~109, the
    test-bucket `result.is_error` branch) — test cards are never coalesced
    (each tool_use pushes its own card via `testCards`/`cards.push`, no
    `add()` call), so no attribution guard is needed here unlike `blocker`
    above. That same branch also sets `card.status = "err"`, matching the
    recovery-clearing note above: if the test later recovers, the recovery
    branch clears both `status` and `detail` rather than leaving a stale
    error pill under a "recovered" sentence. Additionally, if the
    card that ends up representing the FINAL gate state is `fail` but
    never went through that branch (e.g. `MissionContext` resolved fail
    after the transcript's own retries look like they recovered), the
    latest test card still gets `status = "err"` from the gate but may
    have no `detail` — acceptable and tested explicitly (AC below), since
    `MissionContext` is the one true verdict source and a missing raw
    excerpt is never treated as a missing verdict.
  - `delivery` card: `card.text` becomes `Merged as "{commit.message}".`
    (or the equivalent phrase for the pipeline-phase `finished` path) when
    the `commit` artifact and its `detail.message` are available; falls
    back to the existing fixed sentence otherwise (missing artifact,
    missing detail, or non-iterate scenario). `card.artifact` stays
    `"commit"`/`"phase"` as today — no PR-link chrome is added to
    `missionActivityFeed.ts` itself, that lives in the component (below),
    reading the SAME resolved `commit` artifact via the new prop.
  - **Explicitly unchanged:** every `MissionContext`-sourced gate/verdict
    string (`context?.tests?.gate`, artifact `available` checks, the
    `finished`/`outcome` derivation) — this run only adds `detail`/
    `question`/`status` alongside the existing vetted text, never replaces
    the gate source. `status` is always DERIVED from the same
    `MissionContext` fields the existing text already reads, never a new
    independent signal.
  - **Content-safety / disclosure note (external review, both reviewers,
    medium):** raw tool-output text can in principle contain a token or
    path. This codebase has an existing, externally-reviewed precedent for
    NOT pattern-redacting this class of content — `StopHookCard.tsx`
    L23, "no additional redaction applies (external-review LOW-12)" — for
    the same reason it applies here: Mission and the embedded Terminal are
    the same single-user, same-page, same-auth-boundary surface (this is
    a local app, not multi-tenant), so there is no new audience being
    exposed to. Reviewed and closed as **not applicable** rather than
    silently dropped; control-CHARACTER stripping (not secret redaction)
    is still applied via the reused `stripControl`/`stripAnsi` pair above,
    which is a rendering-correctness concern, not a disclosure one.
- `client/src/components/external/mission/MissionActivityFeed.tsx` — edit:
  full rewrite of the per-card markup to the approved mockup's structure —
  icon-node + connecting-spine timeline, per-kind icon (inline SVG, one
  small consistent set: magnifier/investigate, document/spec, pencil/
  implement, circle-alert or circle-check/test, shield/review, chat/
  user-input, alert-triangle/blocker, git-merge/delivery, gear/system),
  status pill reading `card.status` directly (no heuristics — resolved in
  the data layer above), file/command chips (existing `card.commands` list
  gets an icon-tagged chip treatment replacing the plain `<li>`), a
  bordered code block rendering `card.detail` as a literal text node
  inside a `<pre>` (not `MarkdownChunk` — external review preferred literal
  text for raw output specifically, since Markdown parsing of arbitrary
  terminal output can itself mis-render; `MarkdownChunk` stays for
  `card.text`, which is prose), the question block rendering
  `card.question` (options as pills; `picked` highlighted with a check
  icon; unmatched-but-resolved shows `answer` as plain text instead of a
  picked pill; `resolved === false` falls through to the existing
  `AnswerInTerminalButton`), and a PR-link-styled block for `delivery`
  cards sourced from the `commit` artifact's `{prNumber, prUrl, message,
  merge}` detail via a new **required** `commitArtifact: CommitArtifact |
  null` prop (resolved now, not deferred — see Component hierarchy below);
  when `null` or `detail` is absent, the delivery card renders its text
  only, no PR-link block (graceful, not an error state).
  **Preserve existing affordances (external review, low):** the rewrite
  keeps the existing `onArtifactClick` wiring, the artifact-link
  accessible name, and command-chip content unchanged in behavior — add
  focused assertions for artifact-link `href`/accessible name and the
  `AnswerInTerminalButton`'s existing action, not just new-markup
  snapshots, so the rewrite can't silently drop them.
  **Content-safety constraint (carried forward from the prior iterate):**
  `card.detail`, `card.question.text`/`options`/`answer` are assistant/
  tool/user-influenced content exactly like `card.text` — render through
  `MarkdownChunk` (prose) or a literal `<pre>`/text node (raw excerpt/
  answer) only, never `dangerouslySetInnerHTML`; extend the existing
  HTML-like-content rendering test to cover `detail` and `question.text`/
  `question.answer`.
- `client/src/styles/mission-operation.css` — edit: add the mockup's new
  classes (`.mc-feed-node`/spine, `.mc-feed-chip`, `.mc-feed-pill`,
  `.mc-feed-code`, `.mc-feed-qa`) as **pure additions inside the existing
  `.on-photo .mc-op:not([data-state=designgate])` dark scope** (the token
  scope `iterate-2026-08-13-mission-mobile-visual` established for this
  surface still applies — corrected citation, internal plan review finding
  9, low: this is not CLAUDE.md rule 27, which governs route-level scroll
  ownership, an unrelated rule) —
  reuse `--ink`/`--body`/`--muted`/`--card`/`--ok`/`--err`/`--warn`/
  `--accent`/`--line` tokens exactly as the mockup does; no new colors.
- `client/src/lib/missionActivityFeed.fixtures.ts` — edit: extend/add
  fixtures covering a resolved question with a matched option, a resolved
  question with an unmatched free-form answer, a still-pending question, a
  blocker with multi-line error output, a long output needing truncation,
  a `delivery` card with and without a resolved commit artifact, HTML-like
  content inside a raw excerpt/answer, a blocker that errors then recovers
  on retry (asserting `status`/`detail` are cleared, not stale — internal
  plan review finding 7), and a coalesced multi-command card where only one
  command errors (asserting no `detail` misattribution to the other
  commands' chips — internal plan review finding 8).
- `client/src/lib/missionActivityFeed.test.ts` /
  `client/src/components/external/mission/MissionActivityFeed.test.tsx` —
  edit: new-content assertions per kind (against the source matrix above),
  truncation boundary (multi-line preserved, not collapsed to one line),
  content-safety (HTML-like `detail`/`question.text`/`answer` renders
  inert), pending-shows-`AnswerInTerminalButton` vs resolved-matched-shows-
  picked-pill vs resolved-unmatched-shows-answer-text (three branches, not
  two), and the preserved-affordance assertions above.
- `.shipwright/agent_docs/architecture.md` — edit: `MissionBody.tsx` gains
  a new prop (`commitArtifact`) threaded to `MissionActivityFeed` — this is
  a genuine new data-flow edge (doc-sync, CLAUDE.md rule 11), documented
  regardless of whether it crosses the "structural impact" bar on its own.
- `.shipwright/planning/01-adopted/spec.md` — edit: FR-01.68 AC extended
  per Spec Impact above.

## Work breakdown (sequential)
1. **Probe first, then implement:** capture (or locate an existing) real
   `AskUserQuestion` tool_use + its resolving tool_result from a JSONL
   transcript and confirm `result.content`'s actual shape (plain text vs.
   structured) before writing the matching logic — the external review
   flagged this as an unverified assumption, not a build-time detail to
   wave past. This determines whether the "no option matched" branch needs
   JSON-field extraction or plain-text normalization.
2. `missionActivityFeed.ts` data layer: export `stripControl` from
   `ToolOutputBlock.tsx`, add `excerpt()`, `detail`/`status`/`question`
   fields, the three tool-result call sites (using the probe result from
   step 1), the single-command attribution guard on the blocker branch,
   the status/detail clearing on both recovery branches, and the
   `delivery` real-PR-title text — test: `missionActivityFeed.test.ts`
   extended first (red), then green.
3. `MissionBody.tsx`: thread `commitArtifact` (already computed in scope
   today for the right-panel `commit` detail view — see Component
   hierarchy) into both `<MissionActivityFeed>` call sites.
4. `MissionActivityFeed.tsx` presentation rewrite against the approved
   mockup, wired to the new fields — test:
   `MissionActivityFeed.test.tsx` extended for real content per kind +
   content-safety + the three question branches + preserved affordances
   (red → green); visual regression baseline regen last, after markup is
   final.
5. `mission-operation.css` additions (pure additions inside the existing
   dark scope) alongside step 4, since the two are visually inseparable to
   verify.
6. Fixtures + doc-sync (architecture.md, spec.md FR-01.68) + Confidence
   Calibration / Test Completeness Ledger in the iterate spec.
7. Full test suite, browser verify against the real dev stack (both an
   in-progress task with a pending question and a completed task with a
   resolved delivery card — surface_verification requires this at
   medium), visual regression regen, review cascade, F0–F12.

## Component hierarchy (touched)
```
MissionBody                     (already computes
│                                 context?.artifacts.find(a=>a.kind==="commit")
│                                 in scope today, for the right-panel detail
│                                 view — reused, not newly fetched)
└── MissionActivityFeed         (NEW required prop: commitArtifact)
    ├── (rewritten card markup — icons/spine/pills/chips/code-block/
    │    question-block/PR-link-block)
    └── missionActivityFeed.ts  (deriveActivityFeed — new detail/status/
                                  question fields, unchanged gate-sourcing)
```

## Data model changes
Additive only: `ActivityCard.detail?: string`, `ActivityCard.status?: "ok"
| "err" | "warn"`, `ActivityCard.question?: {text: string; options:
string[]; resolved: boolean; picked?: string; answer?: string}`; one new
required component prop `MissionActivityFeed.commitArtifact: CommitArtifact
| null`. No persisted/serialized format changes — all of the above is
derived/threaded client-side per render from the live transcript and
already-fetched `MissionContext`, never written anywhere.

## Test strategy
- Unit/component (Vitest, full suite per `touches_shared_infra`):
  `missionActivityFeed.test.ts`, `MissionActivityFeed.test.tsx` — incl. the
  multi-line-excerpt-not-collapsed regression test (the bug the external
  review caught in the original `sanitizeProofText` reuse) and the
  three-branch question-resolution matrix.
- Visual regression: `task-detail-mission.png` / `task-detail-mission-
  live.png` baselines regenerated (Linux-only pipeline).
- Browser verify (medium, UI): real dev-stack check per AC's pending-
  question and resolved-delivery states.
- E2E: extend the existing Mission-tab flow spec(s) if a real per-kind
  assertion is cheap to add there; author+run required at medium
  (`references/design-and-testing.md`).

## Alternative approach (considered, rejected)
**Alternative:** keep literal BubbleTranscript components
(`ToolCard`/`PrLinkCard`/`AskUserBubble`) embedded directly inside the
Mission card, wrapping them in a new CSS scope that redefines their
`--color-*` token family to the Mission dark values.
**Rejected because:** `ToolCard`/`PrLinkCard` mix token-based colors with
hardcoded light hex *fallbacks* (`var(--color-text, #1a1a1a)`) — a second,
independent token family alongside Mission's own `--ink`/`--body`/`--card`
family. Bridging it means either (a) defining a parallel `--color-*` alias
block inside the Mission dark scope (two token families to keep in sync
forever, exactly the kind of drift the sibling iterate's single-scope
discipline exists to prevent), or (b) editing the shared BubbleTranscript
components to consume Mission's tokens instead, which risks the *actual*
Transcript-pane-successor use of those exact components (still exercised
by the migrated component-level tests from the prior iterate) regressing
in the opposite direction. Extracting only the data (already pure, already
exported) and rendering with Mission-native markup — as the approved
mockup does — avoids both failure modes and matches how `MarkdownChunk`
reuse already works today (content-extraction/safe-rendering only, no
foreign chrome).
