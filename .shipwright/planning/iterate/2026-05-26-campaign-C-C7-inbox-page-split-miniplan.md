# Mini-Plan — C7 InboxPage.tsx split

## Files Changed (planned)

| Status   | File                                                            | LOC est | Concern                                                              |
|----------|-----------------------------------------------------------------|---------|----------------------------------------------------------------------|
| RENAMED  | `client/src/pages/InboxPage.tsx`                                | 967 → ≤250 | Page shell + composition only                                  |
| NEW      | `client/src/pages/inbox/InboxProjectSection.tsx`                | ≤180    | `<details>` per-project group + session sub-headers                  |
| NEW      | `client/src/pages/inbox/InboxCard.tsx`                          | ≤280    | Polymorphic dispatcher + AskToolCard + WaitingReplyCard + PHASE_ICON + inboxItemKey |
| NEW      | `client/src/pages/inbox/InboxResumeButton.tsx`                  | ≤140    | Resume CTA + `pickPlatformCommand` + `writeClipboardModule`          |
| NEW      | `client/src/pages/inbox/useInboxData.ts`                        | ≤140    | Wrapper hook returning `{ projectGroups, openCount, isLoading }`     |
| NEW      | `client/src/pages/inbox/types.ts`                               | ≤40     | `SessionGroup` + `ProjectGroup` types (shared by hook + section)     |
| NEW      | `client/src/pages/inbox/InboxProjectSection.test.tsx`           | ≤180    | RED→GREEN unit                                                       |
| NEW      | `client/src/pages/inbox/InboxCard.test.tsx`                     | ≤220    | RED→GREEN unit                                                       |
| NEW      | `client/src/pages/inbox/InboxResumeButton.test.tsx`             | ≤180    | RED→GREEN unit                                                       |
| NEW      | `client/src/pages/inbox/useInboxData.test.ts`                   | ≤180    | Query-key stability + derivation correctness                         |
| UNCHANGED | `client/src/pages/InboxPage.test.tsx`                          | 655     | Existing 16 cases pass against thin shell                            |
| MODIFIED | `shipwright_bloat_baseline.json`                                | -1 entry | REMOVE `client/src/pages/InboxPage.tsx` entry                        |
| NEW      | `CHANGELOG-unreleased.d/C7-inbox-page-split.md`                 | ~6 lines | Changed-bullet                                                       |
| NEW      | `.shipwright/planning/iterate/2026-05-26-campaign-C-C7-inbox-page-split.md` | spec  | already written |
| NEW      | `.shipwright/planning/iterate/2026-05-26-campaign-C-C7-inbox-page-split-miniplan.md` | this file | self |
| NEW      | `.shipwright/decisions/2026-05-26-inbox-page-split.md`          | ~30 lines | decision-drop (F3)                                              |
| NEW      | `.shipwright/runs/iterate-2026-05-26-campaign-C-C7-inbox-page-split/...` | logs | F0 / F0.5 evidence                                          |

## Slice plan (TDD, RED first)

### Slice 1 — types + useInboxData skeleton
- Add `inbox/types.ts` with `SessionGroup` + `ProjectGroup`.
- Write `inbox/useInboxData.test.ts` (RED):
  - Calls `useExternalInbox` / `useExternalTasks` / `useProjects` (mocked).
  - Returns `{ projectGroups, openCount, isLoading }`.
  - Memo identity stable when underlying data unchanged (`React.useMemo` semantics — same array reference across re-renders with same inputs).
  - `openCount` = sum of items across groups.
  - Unassigned bucket when task missing OR `task.projectId === UNASSIGNED_PROJECT_ID`.
- Implement `inbox/useInboxData.ts`: lift `groupBySession` + `projectGroups` `useMemo`s from page; export with hook-stable contract. → GREEN.

### Slice 2 — InboxResumeButton extraction
- Move `InboxResumeButton` + `pickPlatformCommand` + `writeClipboardModule` to `inbox/InboxResumeButton.tsx`.
- Write `inbox/InboxResumeButton.test.tsx` (RED): mock `useLaunchTask`, assert `mutateAsync({ taskId, resume: true })`, assert clipboard receives platform-appropriate command, assert `e.stopPropagation` prevents card nav.
- Implement → GREEN.

### Slice 3 — InboxCard extraction (largest)
- Move `InboxCard` + `AskToolCard` + `WaitingReplyCard` + `PHASE_ICON` + `KNOWN_PHASES` + `inboxItemKey` + `MAX_BODY_PREVIEW_PX` to `inbox/InboxCard.tsx`. Import the new `InboxResumeButton`.
- Write `inbox/InboxCard.test.tsx` (RED): `ask_tool` → AskToolCard branch; `text_question` → WaitingReplyCard markdown; `terminal_prompt` → WaitingReplyCard escaped-plain; option-chip display-only assertion; nav-on-click.
- Implement → GREEN. **Size sanity check** — if `InboxCard.tsx` > 300 LOC, sub-split: `InboxCard.tsx` keeps dispatcher + PHASE_ICON + inboxItemKey; `InboxCard.AskTool.tsx` + `InboxCard.Waiting.tsx` host the two card variants. Decision based on actual line count post-extraction.

### Slice 4 — InboxProjectSection extraction
- Move `ProjectSection` + `resolveProjectName` to `inbox/InboxProjectSection.tsx`. Import `InboxCard`.
- Write `inbox/InboxProjectSection.test.tsx` (RED): renders project label, (N open) count, chevron-color chip with project setting; Unassigned bucket uses muted token; sessions render under group.
- Implement → GREEN.

### Slice 5 — page shell shrink
- `InboxPage.tsx` reduced to: imports + `useInboxData()` call + JSX shell (header + body container + map over `projectGroups` calling `<InboxProjectSection />`).
- Run full `InboxPage.test.tsx` — must remain GREEN (load-bearing contract).
- `wc -l client/src/pages/InboxPage.tsx` must be ≤ 250.

### Slice 6 — bloat baseline cleanup + finalization
- Remove `client/src/pages/InboxPage.tsx` entry from `shipwright_bloat_baseline.json`.
- F0 typecheck + full client vitest.
- F0.5 surface_verification.py (web).
- F3 decision-drop, F4 changelog drop, F5 test-results, F5b finalize_iterate, F6 commit, F11 push + PR.

## Risk register

- **R1 — InboxCard.tsx > 300 LOC.** Source has ~400 LOC for the two card variants combined. Mitigation: pre-budgeted sub-split (Slice 3 decision-point). Acceptance criteria explicitly allow `InboxCard.AskTool.tsx` + `InboxCard.Waiting.tsx`.
- **R2 — useInboxData breaks query-key stability.** Mitigation: hook is a THIN wrapper — it doesn't call `useQuery` itself, only `useMemo` over already-fetched data. Cache-key surface is identical because the underlying hooks are unchanged.
- **R3 — Existing testids stripped.** Mitigation: existing 16 vitest cases AND 4 Playwright specs guard load-bearing testids. The whole point of Slice 5 keeping `InboxPage.test.tsx` GREEN is regression coverage.
- **R4 — `data-testid-legacy` lost on inner spans.** The legacy hidden `<span data-testid="inbox-item-...">` and `<span data-testid="inbox-copy-resume-...">` markers MUST stay — InboxPage.test.tsx asserts them.
- **R5 — TanStack React Query mutation cache invalidation drift.** Mitigation: `useLaunchTask` is NOT re-implemented — only imported by `InboxResumeButton`.

## Out of scope

- Adding history pagination or filters (campaign-spec slot names HistorySection/InboxFilters are reconciled in the iterate-spec).
- Touching `useExternalInbox` / `useExternalTasks` / `useProjects` source.
- Touching the server inbox route.
- Touching `anti_ratchet_check.py` (CLAUDE.md hard constraint).
- Modifying any file outside `.worktrees/campaign-C-C7-inbox-page-split/`.
