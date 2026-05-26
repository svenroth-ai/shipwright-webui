# Iterate Spec — Campaign C / C7: InboxPage.tsx split

- **Run-ID:** `iterate-2026-05-26-campaign-C-C7-inbox-page-split`
- **Branch:** `iterate/campaign-C-C7-inbox-page-split`
- **Base:** `origin/main` (ce08c5d) — stacked alongside C6 PR #66, C3 PR #67, C4 PR #68 (no file overlap)
- **Type:** refactor
- **Complexity:** medium
- **Surface:** `web` (vitest + Playwright)
- **Spec-Impact:** **none** — internal refactor, behaviour preserved.

## Goal

Split `client/src/pages/InboxPage.tsx` (967 LOC, grandfathered at limit 300) into a thin page shell (≤250 LOC) + sub-components + a data-loading hook under `client/src/pages/inbox/`. Behaviour preserved exactly. Same testids, same hooks, same query keys, same polling cadence, same DOM tree.

## Spec-vs-reality reconciliation

The campaign sub-iterate spec C7 calls for these slot names: `PendingSection`, `HistorySection`, `InboxFilters`, `useInboxData`. The actual `InboxPage.tsx` source does NOT contain a history view, pagination, or filter controls — it is a single read-only "pending inbox items" surface, grouped by project → session → card. Inventing empty `HistorySection.tsx` + `InboxFilters.tsx` files for slot-name conformance would (a) violate Karpathy principle #2 ("Simplicity First — reject premature abstractions, single-use helpers"), and (b) ratchet new oversize-risk files into the tree for no behavioural reason. The campaign-spec slot-naming was speculative; the actual code splits along these natural seams:

| Spec slot           | Actual concern in source                                                                                            | New file (this iterate)                          |
|---------------------|---------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| `PendingSection`    | The per-project `<details>` group + per-session sub-headers (lines 289-393 in source).                              | `inbox/InboxProjectSection.tsx`                  |
| `HistorySection`    | **N/A** — no history view exists in InboxPage today. Reusing this slot name for the polymorphic card dispatcher.    | `inbox/InboxCard.tsx` (with AskTool + Waiting)   |
| `InboxFilters`      | **N/A** — no filters in InboxPage today. Reusing this slot for the action button + clipboard helpers.               | `inbox/InboxResumeButton.tsx`                    |
| `useInboxData`      | Memoized derivation of session-groups + project-groups + open-count over `useExternalInbox`/`useExternalTasks`/`useProjects`. | `inbox/useInboxData.ts`                          |

The campaign acceptance criteria (E) item #2 ("HistorySection.tsx with pagination") and #3 ("InboxFilters.tsx") are RECONCILED via this divergence note. The campaign's **hard constraints remain in force**:

- LOC limits on every new file (≤300).
- Page shell ≤250 LOC.
- `shipwright_bloat_baseline.json` entry for `client/src/pages/InboxPage.tsx` REMOVED.
- Polling cadence preserved exactly (no SSE — CLAUDE.md rule 7).
- Query-param schema bit-perfect (no `useExternalInbox` rewiring — wrapped only).
- TanStack React Query cache keys stable.
- `anti_ratchet_check.py` NOT touched.

## Acceptance Criteria

- [ ] (E) New `client/src/pages/inbox/InboxProjectSection.tsx`, ≤300 LOC. Renders one project group (`<details open>`) with session sub-groups and inbox cards. Stable props: `{ group: ProjectGroup; tasksById: Map<string, ExternalTask> }`.
- [ ] (E) New `client/src/pages/inbox/InboxCard.tsx`, ≤300 LOC. Polymorphic dispatcher for `ask_tool` / `text_question` / `terminal_prompt` items. Stable props: `{ item: InboxItem; task: ExternalTask | undefined }`. If size pressure hits 300 LOC, sub-split `InboxCard.AskTool.tsx` + `InboxCard.Waiting.tsx`.
- [ ] (E) New `client/src/pages/inbox/InboxResumeButton.tsx`, ≤300 LOC. Brown "Answer" CTA button with clipboard copy of resume command. Stable props: `{ task: ExternalTask; toolUseId: string }`.
- [ ] (E) New `client/src/pages/inbox/useInboxData.ts`, ≤300 LOC. Thin TanStack hook composing `useExternalInbox()` / `useExternalTasks()` / `useProjects()` and returning `{ projectGroups, openCount, isLoading }`. Polling cadence inherited unchanged from the underlying hooks; query keys unchanged.
- [ ] (E) `InboxPage.tsx` reduced to ≤250 LOC — page chrome + composition only.
- [ ] (E) `shipwright_bloat_baseline.json` entry for `client/src/pages/InboxPage.tsx` REMOVED. No new entries added.
- [ ] (E) Existing `client/src/pages/InboxPage.test.tsx` (16 cases) passes unchanged — proves DOM + testids + nav contract preserved.
- [ ] (E) New RED→GREEN vitest cases per the campaign spec, reconciled to actual file shape:
    - `inbox/InboxProjectSection.test.tsx`: renders project label + (N open) count + session sub-headers; chevron-color chip honours project settings; Unassigned bucket uses muted token.
    - `inbox/InboxCard.test.tsx`: `ask_tool` routes to AskToolCard; `text_question` + `terminal_prompt` route to WaitingReplyCard; option chips render display-only; navigation on card click.
    - `inbox/InboxResumeButton.test.tsx`: click calls `useLaunchTask.mutateAsync({taskId, resume: true})`; clipboard receives the platform-appropriate command form; `stopPropagation` on click (no card nav).
    - `inbox/useInboxData.test.ts`: query keys stable across renders (memo stability); recomputes when underlying inbox/tasks/projects change; openCount derivation correct.
- [ ] (E) F0 typecheck + full client vitest GREEN.
- [ ] (E) F0.5 web-surface verification ≥ 8 tests run (vitest), Playwright run for `inbox-pending|inbox-terminal-prompts|inbox-awaiting-user|inbox-markdown-render` against the live stack if running; otherwise document gap (precedent C3/C4/C6).
- [ ] (E) `tsc --noEmit` clean.

## Affected Boundaries

| Producer                              | Consumer                                                       | Format                       | Probe                          |
|---------------------------------------|----------------------------------------------------------------|------------------------------|--------------------------------|
| `useExternalInbox` (GET)              | `server/src/external/.../inbox` route                          | URL query params + JSON      | unchanged — no rewire          |
| `useExternalTasks` (GET)              | `server/src/external/.../tasks`                                | URL query params + JSON      | unchanged — no rewire          |
| `useProjects` (GET)                   | `server/src/routes/projects`                                   | URL query params + JSON      | unchanged — no rewire          |
| `useLaunchTask.mutateAsync`           | `server/src/external/.../launch`                               | POST JSON                    | unchanged — no rewire          |

`touches_io_boundary` = **no**. The refactor MUST NOT touch the hooks that produce these requests; it ONLY wraps them in `useInboxData`. The contract assertion in `useInboxData.test.ts` calls `useExternalInbox`/`useExternalTasks`/`useProjects` MOCKS and verifies that the wrapper invokes them and returns derived data without changing keys or call shape.

## Verification (F0.5)

- **Surface:** `web`
- **Runner commands:**
  ```bash
  cmd /c npm.cmd --prefix client run typecheck
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/pages/inbox src/pages/InboxPage.test.tsx
  # Playwright against live stack (best-effort, documented gap if stack absent — precedent C3/C4/C6):
  cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "inbox"
  ```
- **Evidence:** vitest log, surface_verification.json, optional playwright-report.
- **`tests_run` ≥ 8.**

## Confidence Calibration

- **Boundaries touched:** none (refactor wraps existing hooks; query keys + URL params unchanged).
- **Empirical probes:**
    1. The full existing `InboxPage.test.tsx` (16 cases) passes unchanged → DOM + testids + click-through contract preserved.
    2. `useInboxData.test.ts` asserts the wrapper does not alter cache-key shape (it doesn't call `queryClient.invalidateQueries` with a new key; it doesn't construct new queries).
    3. `InboxResumeButton.test.tsx` asserts `mutateAsync({ taskId, resume: true })` shape preserved.
- **Edge cases NOT probed:** server-side filter behaviour (C2 covers); embedded-terminal mirror picker capture (C5 covers); Playwright live-stack run is best-effort given known precedent that E2E specs may hardcode `:3847`.
- **Confidence-pattern check:** runner records reviews.confidence_calibration in result.json.

## External Review + Code Review (ADR-029)

- Step 3.5 (External Plan Review): **RAN** (openrouter, both gemini + openai). Findings written to `.shipwright/runs/iterate-2026-05-26-campaign-C-C7-inbox-page-split/external_plan_review.json`. HIGH/MEDIUM findings addressed in the implementation contract below.
- Step 3.7 (Internal Code Review): SKIP (no Agent tool in runner) — `reviews.code.status = "skipped_no_agent_tool"`.
- Step 3.7 (External Code Review `--mode code`): **RUN** before F6 commit.

### Implementation contract (binds all slices below)

The following 8 rules are derived from the HIGH/MEDIUM plan-review findings and are **load-bearing** for the refactor's behaviour-preservation claim:

1. **`useInboxData` useMemo deps unpack `.data`.** Never depend on the full hook return object (TanStack ref-changes wrapper on refetch — gemini HIGH).
2. **`useInboxData` calls underlying hooks with ZERO args.** Matches source verbatim; test asserts each mocked hook called exactly once per render (openai HIGH).
3. **No new wrapper nodes per extracted component.** Each extracted component returns the existing subtree root verbatim (openai MED).
4. **`groupBySession` + `projectGroups` derivation lifted LINE-FOR-LINE** into `useInboxData` — no re-expression, no Map→array sorting changes (openai MED).
5. **`isLoading` mirrors source exactly.** Source uses only `useExternalInbox().isLoading` for the spinner — `useInboxData.isLoading` MUST equal `inboxQuery.isLoading` (openai MED).
6. **`InboxResumeButton` clipboard try/catch + setError preserved verbatim**, plus tests for clipboard-failure and `mutateAsync`-reject (openai MED).
7. **Markdown / plain-text rendering moved INTACT.** `MarkdownText` + `isMarkdown = kind === "text_question"` branching unchanged. XSS regression already covered by existing `InboxPage.test.tsx` cases (openai MED).
8. **`inbox/types.ts` reuses domain types via composition.** `SessionGroup` references `InboxItem[]`; `ProjectGroup` references `Project` — no parallel hand-rolled DTOs (openai MED).

## Hard constraints

- Polling cadence preserved exactly (CLAUDE.md Architecture rule 7 — no SSE).
- Query-param schema bit-perfect — `useInboxData` MUST be a thin wrapper, NOT a re-implementation of the underlying queries.
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.
- DO NOT modify any file outside `.worktrees/campaign-C-C7-inbox-page-split/`.
- 300-LOC cap on every new file; if pressure rises, sub-split inside `inbox/`.

## Spec-Impact justification

Internal refactor. No FR touched. No user-visible behaviour change. No new public API. Bloat-baseline removal (deletion-only) is the sole `shipwright_bloat_baseline.json` mutation.
