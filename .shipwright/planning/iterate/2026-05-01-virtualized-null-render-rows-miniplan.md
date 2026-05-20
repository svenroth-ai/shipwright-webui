# Mini-Plan: virtualized-null-render-rows

- **Run ID:** iterate-20260501-virtualized-null-render-rows
- **Approach:** filter-pipeline narrowing

## Files to change

| File | Change |
|---|---|
| `client/src/components/external/BubbleTranscript.tsx` | (1) Add `visibleForRender` derivation between `visibleToolUseIds` and `<VirtualBubbles>` invocation. (2) Pass `visibleForRender` to BOTH branches (`<PlainBubbles>` and `<VirtualBubbles>`) — the same null-render predicates are wrong for both, fixing them only for the virtualized branch would leave plain mode rendering empty 14 px placeholder rows under the threshold. (3) Remove the `[DEBUG-INSTRUMENTATION]` instrumentation block (singleton, helpers, mount-time capture). (4) Keep the `null` returns in `renderBubble` as defense-in-depth. |
| `client/src/components/external/MarkdownText.tsx` | Remove `__instrBumpMarkdownRender` import and call. |
| `client/src/components/external/SmartViewer/MermaidRenderer.tsx` | Remove `__instrBumpMermaidRender` import and call. |
| `client/src/components/external/__tests__/BubbleTranscript.test.tsx` (new) | Vitest + jsdom assertions on the filter behavior (AC1, AC2). Drives the regression. |
| `.shipwright/planning/01-adopted/spec.md` | Extend FR-01.02 ACs with the null-render-row invariant. |
| `.shipwright/agent_docs/decision_log.md` | ADR-065. |

## Test strategy

### TDD red (before fix)

Two failing tests in `__tests__/BubbleTranscript.test.tsx`:

1. **AC1 — `user` events with all-folded tool_results are filtered out.**
   Build a `ParsedEvent[]` where event[0] is an `assistant` containing
   one `tool_use{id: "tu-1"}` and event[1] is a `user` with content
   `[{tool_result, tool_use_id: "tu-1", …}]` only. Render
   `<BubbleTranscript content={...}/>` (with parsed content), assert
   the DOM contains exactly **one** `[data-testid^="bubble-"]`
   element — the assistant — and **zero** elements with
   `data-testid="bubble-tool-result"`. The current impl will fail
   because the wrapper still renders empty.

2. **AC2 — `attachment` events with no filename are filtered out.**
   Build an `attachment` event whose payload has only `{type, hookName,
   command}` (no filename). Render and assert the DOM contains zero
   `[data-testid="bubble-attachment"]` elements AND the
   `console.warn` for "Dropping attachment" is called at most once
   per render pass (1 vs the current N).

Both tests fail on `main` head + the iterate branch as-is, pass after
the fix. (The current behavior renders empty wrapper divs — they
don't contain those `data-testid` markers because the *bubble itself*
returned null, but they still exist as 14 px wrappers; the test
asserts on the bubble testids, which are reliable.)

### TDD green (after fix)

Both tests pass. Existing tests in
`client/src/components/external/__tests__/` continue to pass —
specifically, the snapshot/render tests for tool_use folding (AC-1
suppression) must still show "tool_result is folded into the
ToolCard". The fix is the same suppression, just relocated upstream.

### Full suite

`npx vitest run` from `client/`. No server-side changes ⇒ server tests
unaffected.

### E2E

Spec 35 (`35-no-chat-panel.spec.ts`) and other transcript E2E specs
should continue to pass. No new E2E spec — the data-validated
invariant lives at the unit level; visual flicker is untestable
without a real browser per `conventions.md` learning.

## Alternative considered (rejected)

**Set wrapper `padding: 0` when `BubbleRow` returns null.** This makes
the empty row 0 px instead of 14 px, but the row is still in the
virtualizer's index list and still consumes a measurement cycle. The
filter approach removes the entire row from the virtualizer's view of
the list; the index list shrinks, the cumulative `translateY` math is
correct from the start, no per-mount measurement is needed. Cleaner.

## Build branch

`iterate/virtualized-null-render-rows` (already created from
`origin/main`).

## Migration / data plan

None. Pure UI behavior change. No schema, no API, no on-disk format.
