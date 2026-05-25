# Sub-Iterate C3 — BubbleTranscript.tsx split

- **Campaign:** 2026-05-25-bloat-cleanup-C-webui
- **Source plan row:** §6.2 C3
- **Risk:** Mittel (transcript rendering is the most-visible read surface; auto-scroll behavior fragile per ADR-035)
- **Complexity:** medium (5 new sub-modules + shell; markdown + ANSI rendering)
- **Surface:** `web` (Playwright)
- **Branch base:** C6's branch (stacked)
- **Type:** refactor (change with classification = none)

## Goal

Split `client/src/components/external/BubbleTranscript.tsx` (1618 LOC) into a thin shell (≤200 LOC) plus 5 sub-modules: `TranscriptRow.tsx`, `ToolOutputBlock.tsx`, `MarkdownChunk.tsx`, `AnsiText.tsx`, `useTranscriptScroll.ts`. Behavior preserved bit-perfect.

## Acceptance Criteria

- [ ] (E) New `client/src/components/external/BubbleTranscript/TranscriptRow.tsx` exists, ≤300 LOC. Renders one transcript row (user/assistant/system bubble). Stable props: `{ entry: TranscriptEntry; isLatest: boolean }`.
- [ ] (E) New `client/src/components/external/BubbleTranscript/ToolOutputBlock.tsx` exists, ≤300 LOC. Renders tool-use + tool-result block (collapsed/expanded). Stable props: `{ toolUse: ToolUseEntry; toolResult?: ToolResultEntry; defaultOpen?: boolean }`.
- [ ] (E) New `client/src/components/external/BubbleTranscript/MarkdownChunk.tsx` exists, ≤300 LOC. Wraps `react-markdown` + `remark-gfm` + `rehype-highlight` per CLAUDE.md rule 4 (no `@assistant-ui/*`). Stable props: `{ content: string }`.
- [ ] (E) New `client/src/components/external/BubbleTranscript/AnsiText.tsx` exists, ≤300 LOC. Wraps `strip-ansi` + colored span rendering for raw terminal output. Stable props: `{ text: string }`.
- [ ] (E) New `client/src/components/external/BubbleTranscript/useTranscriptScroll.ts` exists, ≤300 LOC. The CSS-first `overflow-anchor: auto` + ref-based ResizeObserver-light hook per ADR-035 / memory `project_bug_b_remount_smear_writerace`. Returns `{ scrollContainerRef, isAtBottom, scrollToBottom }`.
- [ ] (E) `BubbleTranscript.tsx` reduced to ≤200 LOC (shell only — loops over entries, threads scroll-hook ref, composes children).
- [ ] (E) `shipwright_bloat_baseline.json` entry for `BubbleTranscript.tsx` REMOVED.
- [ ] (E) RED→GREEN vitest tests for each sub-module:
  - `TranscriptRow.test.tsx`: user vs assistant vs system bubble classes; markdown vs raw text handling.
  - `ToolOutputBlock.test.tsx`: collapsed by default; toggle expands; tool-result missing case renders placeholder.
  - `MarkdownChunk.test.tsx`: fenced code blocks rendered with `rehype-highlight`; GFM tables render; raw HTML escaped per react-markdown defaults.
  - `AnsiText.test.tsx`: ANSI escape sequences stripped to visual spans; `convertEol:false` semantics preserved (memory `project_bug_b_remount_smear_writerace`).
  - `useTranscriptScroll.test.ts`: `isAtBottom` flips on programmatic scroll; ResizeObserver triggers re-anchor.
- [ ] (E) Existing E2E spec(s) for transcript flow still pass — `cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "transcript|BubbleTranscript|polling"`.
- [ ] (E) Bloat-check PR-comment ✅ no anti-ratchet AND zero advisory crossings.

## Spec Impact

- **Classification:** none
- **NONE justification:** Internal refactor. Render-tree split; no FR change.

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| `BubbleTranscript.tsx` (writer of DOM) | E2E spec (reader via Playwright) | DOM markup |

`touches_io_boundary` = no (DOM markup is not a serialized format under the canonical risk taxonomy). Boundary Probe not required, but E2E coverage IS required.

## Verification (F0.5)

- **Surface:** `web`
- **Runner commands:**
  ```bash
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/external/BubbleTranscript
  cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "transcript|BubbleTranscript"
  cmd /c npm.cmd --prefix client run typecheck
  ```
- **Evidence path:** vitest log + `client/playwright-report/index.html` + `.shipwright/runs/<run_id>/surface_verification.json`.
- **`tests_run` MUST be ≥ 10** (5 sub-modules × ≥2 vitest cases each + E2E hits).

## Confidence Calibration

- **Boundaries touched:** DOM (rendering only).
- **Empirical probes run:** (1) per-component vitest; (2) E2E transcript flow; (3) auto-scroll behavior under simulated polling cycles (use vitest + jsdom or a Playwright probe).
- **Edge cases NOT probed + why acceptable:** Pure-CSS auto-scroll behavior in Firefox not probed (we ship for Chromium-Edge per Playwright config); acceptable per memory `feedback_browser_fixes_need_real_browser_smoke`.
- **Confidence-pattern check:** runner records.

## External Review + Code Review (ADR-029)

- Step 3.5: **RUN** (medium).
- Step 3.7: **RUN** via orchestrator-spawned code-reviewer.

## Hard constraints

- DO NOT re-introduce `@assistant-ui/*` packages (CLAUDE.md rule 4).
- DO NOT replace the CSS-first `overflow-anchor` + ref-based hook with `react-scroll-to-bottom` or similar libraries (CLAUDE.md rule 2 under DO-NOT regression guards).
- DO NOT set `convertEol:true` anywhere in the ANSI rendering path (memory `project_bug_b_remount_smear_writerace`).
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.
- Existing committed regression test for `@xterm/headless` convertEol stays untouched.

---

See [`_cleanup-invariant.md`](./_cleanup-invariant.md) for the cleanup-invariant block.
