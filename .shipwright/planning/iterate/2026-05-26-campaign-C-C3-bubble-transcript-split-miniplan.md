# Mini-Plan — BubbleTranscript.tsx split (Campaign C, C3)

- **Run-ID:** `iterate-2026-05-26-campaign-C-C3-bubble-transcript-split`
- **Sub-iterate spec:** `.shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C3-bubble-transcript-split.md`
- **Iterate spec:** `.shipwright/planning/iterate/2026-05-26-campaign-C-C3-bubble-transcript-split.md`

## Pre-flight observation

The sub-iterate spec mandates 5 sub-modules under `BubbleTranscript/`. Three of those names collide with existing legacy components (`MarkdownText`, the strip-ansi `ToolOutputBlock`, `useAutoScroll`) that have OTHER consumers across the codebase. To preserve "bit-perfect behavior" AND a thin shell ≤200 LOC, the 5 spec-mandated files are created as new wrappers / extractions:

- `MarkdownChunk.tsx` → wraps existing `MarkdownText` (renames prop `text` → `content`). Legacy file stays — 4 other consumers (`InboxPage`, `SkillCard`, `MarkdownRenderer.tsx`, its own test).
- `AnsiText.tsx` → wraps existing strip-ansi `ToolOutputBlock` (renames `text` prop, kept identical). Legacy file stays — `ToolCard` depends on it.
- `useTranscriptScroll.ts` → wraps existing `useAutoScroll`, allocates its own ref. Legacy file stays — its own dedicated test consumes the lower-level shape.
- `ToolOutputBlock.tsx` (new, distinct from legacy strip-ansi one) → built on `ToolCard`. Takes `{ toolUse, toolResult?, defaultOpen? }` and dispatches AskUser/TodoWrite/TaskList/generic.
- `TranscriptRow.tsx` → new extraction of `BubbleRow` + `renderBubble` + `BubbleHeader` + helpers from BubbleTranscript.tsx.

A 200-LOC shell additionally requires extracting `Toolbar`, `PlainBubbles`, `VirtualBubbles`, `useSystemVisibility`, and the `filters.ts` helper module. None of these add a bloat-baseline entry because every new file is ≤300 LOC pre-merge.

## Work breakdown

### Phase 1 — Tests RED first

Write tests AT THE NEW LOCATIONS, then implement. Per spec:

1. `client/src/components/external/BubbleTranscript/TranscriptRow.test.tsx`
   - user bubble: right-aligned, `data-testid="bubble-user"`, text rendered plain.
   - assistant bubble: left-aligned, `data-testid="bubble-assistant"`, markdown rendered (`<strong>`).
   - system pill: `data-testid="bubble-system"` with subtype label.
2. `client/src/components/external/BubbleTranscript/ToolOutputBlock.test.tsx`
   - collapsed by default — `data-expanded="false"` on `tool-card`.
   - click header → `data-expanded="true"`.
   - `toolResult` undefined → no `tool-card-output` rendered.
   - AskUserQuestion variant → `askuser-pending` testid when unresolved.
3. `client/src/components/external/BubbleTranscript/MarkdownChunk.test.tsx`
   - fenced code block: rendered as `<pre><code class="language-…">`.
   - GFM table: `<table>` element.
   - raw HTML escaped: `<script>` text NOT inserted as element (react-markdown defaults).
4. `client/src/components/external/BubbleTranscript/AnsiText.test.tsx`
   - ANSI escape sequence `[31m` stripped from output text.
   - `isError={true}` flips the colored styling via `data-is-error="true"`.
   - convertEol=false semantics: raw `\n` preserved in the `<pre>`, no CR→LF rewriting.
5. `client/src/components/external/BubbleTranscript/useTranscriptScroll.test.ts`
   - `scrollContainerRef` is a ref object.
   - `isAtBottom` initially true; flips false on programmatic scroll-away dispatch.
   - `scrollToBottom()` resets the flag and sets `scrollTop` to `scrollHeight`.

### Phase 2 — Extract & wire

Order (each step keeps the file tree compileable):

a. Create `BubbleTranscript/` directory.
b. Add `MarkdownChunk.tsx` (re-export wrapper).
c. Add `AnsiText.tsx` (re-export wrapper).
d. Add `useTranscriptScroll.ts` (ref-allocator + wrapper).
e. Add `filters.ts` (`filterEventsForRender`, `warnUnknownAttachmentSchemaOnce`, `_resetAttachmentWarnDedupeForTesting`, `SYSTEM_KINDS`, `readNonEmptyString`, `stableEventKey`).
f. Add `useSystemVisibility.ts`.
g. Add `Toolbar.tsx`.
h. Add `TranscriptRow.tsx` (BubbleRow + renderBubble + BubbleHeader + renderAttachmentCard + isTurnBoundary + helpers).
i. Add `ToolOutputBlock.tsx` (ToolUseBubble + AnswerInTerminalButton + clipboard helpers).
j. Add `PlainBubbles.tsx` (PlainBubbles + AttachmentStrip + BubbleGroup + groupConsecutiveAttachments).
k. Add `VirtualBubbles.tsx` (VirtualBubbles + size-cache integration).
l. Rewrite `BubbleTranscript.tsx` shell to import from the new folder. Keep public exports `BubbleTranscript`, `filterEventsForRender`, `_resetAttachmentWarnDedupeForTesting` (re-exports for test back-compat).
m. Remove `BubbleTranscript.tsx` entry from `shipwright_bloat_baseline.json`.

### Phase 3 — Verify

```bash
cmd /c npm.cmd --prefix client run typecheck
cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/external/BubbleTranscript
cd client && cmd /c node_modules\.bin\vitest.cmd run --reporter=verbose
```

Plus full per-file LOC sweep:
```bash
wc -l client/src/components/external/BubbleTranscript.tsx \
      client/src/components/external/BubbleTranscript/*.{ts,tsx}
```

Every entry ≤ its limit (300 source / 300 test / 200 shell). If any exceed → split further BEFORE commit.

### Phase 4 — External code review

```bash
uv run --with openai "{shared_root}/scripts/tools/external_review.py" --mode code \
  --project-root . \
  --run-id "iterate-2026-05-26-campaign-C-C3-bubble-transcript-split" \
  --since origin/main
```

Address HIGH findings BEFORE F6 commit.

### Phase 5 — Finalize

F0 → F1 → F3 → F3a → F4 → F5 → F5b → F6 → F6.5 → F7b → F11 → F12.

## Risk register

- **R1 (HIGH):** A subtle behaviour drift in the renderBubble dispatch chain (e.g. memo-key, ref-identity, callback-identity) breaks the existing 1229-LOC test. Mitigation: run that test suite end-to-end as the last gate before F6.
- **R2 (HIGH):** `useTranscriptScroll` semantic divergence from `useAutoScroll`. Mitigation: hook returns the ref it allocates; under the hood it delegates entirely to `useAutoScroll` with NO change to the underlying ResizeObserver / dep-key logic.
- **R3 (MEDIUM):** A new sub-module crosses 300 LOC pre-merge → cleanup-invariant violation, no advisory crossings allowed. Mitigation: LOC sweep in Phase 3; sub-split further if needed.
- **R4 (MEDIUM):** Public re-exports drift — `BubbleTranscript.test.tsx` imports `filterEventsForRender` and `_resetAttachmentWarnDedupeForTesting` from `./BubbleTranscript`. Mitigation: explicit re-exports from the shell.
- **R5 (LOW):** Mocking shape changes for vitest (e.g. `useLaunchTask` mock in the new ToolOutputBlock test). Mitigation: new tests stub deps with the same patterns the existing test suite uses.
- **R6 (LOW):** E2E transcript flows hardcode `localhost:3847` — Playwright run skipped (C6 precedent). Documented in `surface_verification.json`.
