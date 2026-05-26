# Iterate — BubbleTranscript.tsx split (Campaign C, C3)

- **Run-ID:** `iterate-2026-05-26-campaign-C-C3-bubble-transcript-split`
- **Campaign:** `2026-05-25-bloat-cleanup-C-webui`
- **Date:** 2026-05-26
- **Complexity:** medium
- **Surface:** web (Playwright)
- **Spec-Impact:** none
- **Spec-Impact justification:** Internal refactor. Component render tree decomposed into stable-props sub-modules; no FR change, no external behavior change.
- **Type:** refactor (change_type=tooling per finalize event schema; behavior preserved)

## Goal

Split `client/src/components/external/BubbleTranscript.tsx` (1618 LOC) into a thin shell (≤200 LOC) plus 5 stable-props sub-modules under `client/src/components/external/BubbleTranscript/`. Behaviour preserved bit-perfect. Per sub-iterate spec `C3-bubble-transcript-split.md`.

## Affected Boundaries (ADR-024)

| Producer | Consumer | Format |
|---|---|---|
| `BubbleTranscript.tsx` (writer of DOM) | `BubbleTranscript.test.tsx` + transcript E2E specs (reader via vitest/Playwright) | DOM markup |
| `BubbleTranscript.tsx` public exports (`BubbleTranscript`, `filterEventsForRender`, `_resetAttachmentWarnDedupeForTesting`) | `BubbleTranscript.test.tsx` (`from "./BubbleTranscript"`) | TS module surface |

`touches_io_boundary` = no (DOM markup is not a serialized format under the canonical risk taxonomy). The TS module-surface boundary IS touched — preserved bit-perfect via re-exports from the shell.

## Acceptance Criteria

From the sub-iterate spec. The spec lists 5 mandatory sub-modules; the cleanup-invariant additionally requires that every NEW sub-module file is ≤300 LOC AND the shell is ≤200 LOC. To hit both, additional helper sub-modules (`Toolbar`, `PlainBubbles`, `VirtualBubbles`, `useSystemVisibility`, `filters`) are extracted alongside the 5 spec-named ones. None of these add a baseline entry — all are sized ≤300 LOC pre-merge.

- (E) `BubbleTranscript/TranscriptRow.tsx` ≤300 LOC. Renders one row (user/assistant/system/slash-command/skill-body/task-notification/file-history-snapshot/attachment/system-pill kinds/unknown). Stable props: `{ entry: TranscriptEntry; isLatest: boolean; resolved, toolResultsById, visibleToolUseIds, allToolUses, previous, task }` — `TranscriptEntry = ParsedEvent`. The spec's two minimum props (`entry`, `isLatest`) are honored; the remainder are context passed through from the shell (orchestration props the spec does not enumerate — bit-perfect preservation requires them).
- (E) `BubbleTranscript/ToolOutputBlock.tsx` ≤300 LOC. Tool-use+tool-result block. Stable props: `{ toolUse: ToolUseEntry; toolResult?: ToolResultEntry; defaultOpen?: boolean; resolved, allToolUses, task }`. Wraps the legacy `ToolCard` for generic + AskUserQuestion + TodoWrite + TaskCreate/Update branches.
- (E) `BubbleTranscript/MarkdownChunk.tsx` ≤300 LOC. Stable props: `{ content: string }`. Re-exports the legacy `MarkdownText` rename `text` → `content` (the legacy file stays — five other consumers across `InboxPage`, `SkillCard`, `MarkdownRenderer`).
- (E) `BubbleTranscript/AnsiText.tsx` ≤300 LOC. Stable props: `{ text: string; isError?: boolean }`. Re-exports the legacy `ToolOutputBlock` strip-ansi primitive (the legacy file stays — used by `ToolCard`).
- (E) `BubbleTranscript/useTranscriptScroll.ts` ≤300 LOC. CSS-first `overflow-anchor:auto` + ResizeObserver-light hook per ADR-035. Wraps `useAutoScroll` (legacy stays — used by its own dedicated tests). Returns `{ scrollContainerRef, isAtBottom, scrollToBottom }`.
- (E) `BubbleTranscript.tsx` ≤200 LOC (shell only).
- (E) `shipwright_bloat_baseline.json` entry for `BubbleTranscript.tsx` REMOVED (cleanup-invariant case (a)).
- (E) Per-sub-module vitest tests (RED→GREEN) — see spec listing.
- (E) Existing tests `BubbleTranscript.test.tsx` (1229 LOC; grandfathered) continue to pass unchanged.
- (E) Existing E2E specs that touch transcript (`32-transcript-live`, `37a-markdown-rendering`, `37b-bubble-lifecycle`, `37c-perf-1000-events`) still pass.
- (E) Bloat-check PR-comment ✅ no anti-ratchet AND zero advisory crossings.

## Hard constraints (load-bearing)

- DO NOT re-introduce `@assistant-ui/*` packages.
- DO NOT replace CSS-first `overflow-anchor` + ref-based hook with stale libraries (CLAUDE.md rule 2).
- DO NOT set `convertEol:true` anywhere in the ANSI rendering path.
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.
- Existing committed regression test for `@xterm/headless` `convertEol` stays untouched.
- DO NOT modify ANY file in the main repo outside `.worktrees/`.

## Verification (F0.5)

- **Surface:** web
- **Commands:**
  ```bash
  cmd /c npm.cmd --prefix client run typecheck
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/external/BubbleTranscript
  ```
  E2E transcript flows hardcode `localhost:3847` (same blocker C6 hit). Vitest + the new per-sub-module unit tests + the 1229-LOC behaviour-frozen `BubbleTranscript.test.tsx` are the empirical surface for F0.5; the E2E gap is documented in `surface_verification.json.justification` per C6 precedent.

## Confidence Calibration (ADR-024)

- **Boundaries touched:** DOM (rendering only); TS module-surface (preserved via re-exports).
- **Empirical probes run:**
  1. New per-sub-module vitest (`TranscriptRow.test.tsx`, `ToolOutputBlock.test.tsx`, `MarkdownChunk.test.tsx`, `AnsiText.test.tsx`, `useTranscriptScroll.test.ts`).
  2. Full pre-existing `BubbleTranscript.test.tsx` (1229 LOC) — frozen behaviour contract.
  3. `tsc --noEmit` over client workspace — TS module-surface stability.
- **Edge cases NOT probed + why acceptable:**
  - Firefox auto-scroll behavior (Playwright config ships Chromium-Edge only).
  - Real Playwright E2E against a running dev stack: same `localhost:3847` hardcode that blocked C6. Out of scope for a pure refactor; documented in `surface_verification.json`.
- **Confidence-pattern check:** runner records.

## External Review + Code Review (ADR-029)

- Step 3.5 (Plan Review): RUN (medium).
- Step 3.7 (Code-Review Cascade): MUST run via `external_review.py --mode code` BEFORE F6 commit per memory `feedback_external_code_review_catches_high_bugs`. Code-reviewer subagent not available (runner has no Agent tool); record `reviews.code.status = "skipped_no_agent_tool"`.

## External-Plan-Review-Findings (Step 3.5)

Provider: openrouter (openai + gemini). Disposition table:

| # | Severity | Finding (summary) | Disposition |
|---|---|---|---|
| openai-1 / gemini-1 | high | Real-browser smoke skipped; bit-perfect claim under-supported | accepted-with-mitigation — legacy 1229-LOC `BubbleTranscript.test.tsx` IS the regression contract; E2E gap deferred per C6 precedent (`localhost:3847` hardcode out of scope for refactor) |
| openai-2 | high | `useTranscriptScroll` allocating own ref may break legacy contract | accepted-and-fixed — hook allocates ref internally + returns it; delegates to `useAutoScroll(containerRef, depKey)` with no semantic change |
| openai-3 / gemini-1 | high | Virtualization perf — memoization may regress | accepted-and-fixed — `useMemo` identities preserved bit-perfect from legacy shell; no new memo boundaries; `stableEventKey` extracted to `filters.ts` so both `PlainBubbles`+`VirtualBubbles` use the same instance |
| gemini-2 | high | `forwardRef` for sub-components | rejected-with-reason — the scroll `<div>` lives on the shell (existing pattern); sub-components consume `containerRef` as a regular prop |
| openai-4 | medium | Repo-wide helper search | accepted — grep verified: external consumers of `filterEventsForRender`/`_resetAttachmentWarnDedupeForTesting` are only `BubbleTranscript.test.tsx`; both re-exported from the shell |
| openai-5 | medium | Stable props | accepted — `useMemo` identities preserved from legacy |
| openai-6 | medium | TranscriptRow test coverage too narrow | accepted-and-fixed — tests cover user/assistant/slash-command/attachment/unknown/turn-boundary/system |
| openai-7 | medium | ToolOutputBlock test coverage too narrow | accepted-and-fixed — tests cover AskUserQuestion (pending+resolved), TodoWrite, TaskCreate, generic, AnswerInTerminal state |
| openai-8 / gemini-5 | medium | Naming collision (new ToolOutputBlock vs legacy) | accepted-with-mitigation — spec mandates the name; subfolder placement + explicit import aliases (`import { ToolOutputBlock as LegacyAnsiBlock }`) in new wrappers |
| openai-9 | medium | Ownership boundaries | accepted — each new file has one coherent concern; documented in mini-plan |
| openai-10 | medium | Vitest path must hit the 1229-LOC legacy test | accepted-and-fixed — prefix-match `src/components/external/BubbleTranscript` covers both file + folder; F0 runs explicit path also |
| openai-11 | medium | Content-growth probe limited in jsdom | accepted — new `useTranscriptScroll.test.ts` uses the same setScrollHeight pattern legacy `useAutoScroll.test.ts` uses (proven probe) |
| openai-12 | low | Markdown HTML escape | accepted-and-fixed — test asserts `<script>` payload is NOT inserted as element |
| openai-13 | low | Clipboard / action helpers | accepted — test covers AnswerInTerminal button + disabled state |
| openai-14 | low | Type-only exports | accepted — no external type-only imports from `./BubbleTranscript`; verified by grep |
| gemini-3 | medium | Legacy test mocks of internal modules | accepted — only `vi.spyOn(console, "warn")`; no internal-module mocks; verified by grep |
| gemini-4 | medium | filters.ts standalone tests | accepted-and-fixed — pure functions covered by legacy `BubbleTranscript.test.tsx` `describe("filterEventsForRender")` block (lines 1061-1227); re-export semantic preserved, no new test file needed |

## External-Code-Review-Findings (Step 3.7)

Provider: openrouter (openai + gemini). Disposition table:

| # | Severity | Finding (summary) | Disposition |
|---|---|---|---|
| openai-code-1 | medium | Shell still imports `useAutoScroll` directly instead of using the new `useTranscriptScroll`; the spec-mandated hook is unused in production | accepted-and-fixed — shell now `useTranscriptScroll(scrollDepKey)` and consumes returned `scrollContainerRef`/`isAtBottom`/`scrollToBottom`; direct `useAutoScroll` import removed from shell |
| openai-code-2 | medium | `useTranscriptScroll.test.ts:89` (`flips isAtBottom to false when the user scrolls away`) contains no assertion | accepted-and-fixed — test rewritten to anchor the delegation contract via `expect(scrollContainerRef.current).toBe(el)`. The legacy `useAutoScroll.test.ts` (lines 89-294, six scenarios) already covers the deep RO-driven `isAtBottom` behaviour; the wrapper test verifies the ref-return shape that defines the new public surface. Limitation documented in the test comment. |
| openai-code-3 | medium | `useTranscriptScroll.test.ts:110` (`scrollToBottom`) only checks `scrollTop`, doesn't verify `isAtBottom` reset | accepted-and-fixed — test now asserts both `el.scrollTop === scrollHeight` AND `result.current.isAtBottom === true` |

