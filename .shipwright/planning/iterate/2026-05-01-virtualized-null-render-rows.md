# Iterate Spec: virtualized-null-render-rows

- **Run ID:** iterate-20260501-virtualized-null-render-rows
- **Type:** bug
- **Complexity:** medium
- **Status:** draft
- **Affected FRs:** FR-01.02 (Task detail / BubbleTranscript)

## Goal

Eliminate the residual scroll-up flicker on tool-heavy virtualized
transcripts by filtering events that would render null/empty content
out of the list before it reaches the virtualizer. Closes the 4th
attempt at this bug after ADR-062 (kept), ADR-063 (REVERTED) and
ADR-064 (REVERTED) all targeted the wrong layer.

## Data-validated cause (medium confidence on visual fix; high confidence on mechanism)

Instrumented `<VirtualizedBubbleRow>` with a per-row mount-time height
capture. `window.__instr.mountLog` showed many rows mounting at
**~14 px** vs the virtualizer's `FALLBACK_ROW_PX = 96` estimate.

Two sources, both null-returns from the render pipeline that leave the
absolute-positioned wrapper at its 14 px padding height:

1. `user` events that contain *only* `tool_result` blocks AND every
   `tool_use_id` resolves to a tool_use already shown by a `<ToolCard>`
   in the visible window. `renderBubble` returns `null`
   (BubbleTranscript.tsx — user branch).
2. `attachment` events whose payload has no `filename` / `name` field
   (Claude Code emits `bash hook` events as `type: "attachment"`).
   `renderAttachmentCard` returns `null`. The wrapper around it is
   still rendered.

For each such row that enters the overscan window during scroll-up,
the virtualizer's RO measures 14 px, updates its size cache by **−82
px**, and shifts `translateY` of every row above. With the test
session's many bash hook events + many folded user tool_result events,
the cumulative shift produces the user-reported "Er zieht den Code
nach" symptom.

The codebase already documents this exact rule at
`BubbleTranscript.tsx` lines 160-163 (the `file-history-snapshot`
filter): _"null-return risks zero-height rows for the virtualizer per
Gemini's external-review finding"_. The two new null-return paths
added in `iterate-20260423-chat-followups AC-1` silently violated it.

## Acceptance Criteria

- [ ] AC1: A `user` event whose content is `[{ tool_result, … }]` only
  AND every `tool_use_id` is present in `visibleToolUseIds` is
  **excluded from the events array passed to `<VirtualBubbles>`**.
  Other consumers (`resolvedToolUseIds`, `toolResultsById`,
  `allToolUses`) keep using the broader `filtered` scope so context
  derivation (e.g. "this tool_use was answered later") is unchanged.
- [ ] AC2: An `attachment` event without a `filename`/`name` field is
  excluded from the events array passed to `<VirtualBubbles>`. The
  dev-mode `console.warn` is emitted at most once per filter pass
  (currently re-fires on every render).
- [ ] AC3: Both behaviors are covered by jsdom-friendly Vitest tests
  asserting on the filtered array shape — not on visual output.
- [ ] AC4: All `[DEBUG-INSTRUMENTATION 2026-05-01
  virtualized-flicker-investigate]` markers (introduced during this
  iterate's investigation) are removed from
  `BubbleTranscript.tsx`, `MarkdownText.tsx`,
  `SmartViewer/MermaidRenderer.tsx`. `window.__instr` no longer
  exists in the production bundle.
- [ ] AC5: ADR-062's virtualizer config (`getItemKey`,
  `useAnimationFrameWithResizeObserver`, `overscan: 16`) is unchanged.
  No edits to `useAutoScroll`, no edits to `overflow-anchor`, no edits
  to `useTaskTranscript`'s polling cascade. (Carry-over from the
  REVERTED ADR-063 / ADR-064 lessons.)
- [ ] AC6: Visual verification by the user that scroll-up on the test
  task `6cd07bd3-fa44-4ac2-9944-df07a2b59965` no longer shows the
  "Er zieht den Code nach" symptom. **Push to main only after this
  step.**

## Affected FRs

- **FR-01.02 Task detail (3-pane viewer)** — extend the existing AC to
  cover the implementation invariant that null-rendering events do
  not occupy space in the virtualized list. The user-facing behavior
  is unchanged; this codifies the rule the code already partially
  enforces.

## Out of Scope

- Reworking the `attachment` parser to recognise `bash hook` events as
  a distinct kind. The fix here filters them out of the virtualized
  list; classifying them properly is a separate concern (different
  kind, different rendering, would need its own design decision).
- Touching the per-poll re-render cascade. ADR-064's revert is final.
- Touching `overflow-anchor`. ADR-063's revert is final.
- Touching the virtualizer's `FALLBACK_ROW_PX` estimate. Even if the
  filter perfectly excludes 14 px rows, other events still vary from
  ~50 to 1200 px; tuning the estimate is a separate optimisation that
  would need its own data-driven justification.

## Risk-flag override

The complexity classifier flagged `touches_auth` (false positive — no
auth code in scope; the affected files are all pure presentational
React components). The `mandatory_review` enforcement is kept anyway
given the 4-attempt history.

## Design Notes

No design changes. Same UX surface, only behavioral fix to the
implementation invariant. No mockup edits, no design-fidelity work.
