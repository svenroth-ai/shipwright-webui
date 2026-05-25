# Sub-Iterate C7 — InboxPage.tsx split

- **Campaign:** 2026-05-25-bloat-cleanup-C-webui
- **Source plan row:** §6.2 C7
- **Risk:** Mittel (full page; filter state + polling + history pagination)
- **Complexity:** medium
- **Surface:** `web` (Playwright)
- **Branch base:** C4's branch (stacked)
- **Type:** refactor (change with classification = none)

## Goal

Split `client/src/pages/InboxPage.tsx` (967 LOC) into a thin page shell (≤250 LOC) + 3 sub-components + 1 data-loading hook: `inbox/PendingSection.tsx`, `inbox/HistorySection.tsx`, `inbox/InboxFilters.tsx`, `inbox/useInboxData.ts`. Behavior preserved.

## Acceptance Criteria

- [ ] (E) New `client/src/pages/inbox/PendingSection.tsx` exists, ≤300 LOC. Renders pending triage items with action buttons. Stable props: `{ items: TriageItem[]; onResolve: (id: string, action: ResolveAction) => Promise<void>; loading: boolean }`.
- [ ] (E) New `client/src/pages/inbox/HistorySection.tsx` exists, ≤300 LOC. Renders historical resolved items with pagination. Stable props: `{ items: TriageItem[]; hasMore: boolean; onLoadMore: () => void; loading: boolean }`.
- [ ] (E) New `client/src/pages/inbox/InboxFilters.tsx` exists, ≤300 LOC. Filter controls (project filter, source filter, date range). Stable props: `{ filters: InboxFilters; onFiltersChange: (f: InboxFilters) => void }`.
- [ ] (E) New `client/src/pages/inbox/useInboxData.ts` exists, ≤300 LOC. TanStack React Query hook returning `{ pending, history, filters, setFilters, loadMoreHistory, ... }`. Sequential polling at 1s cadence per existing pattern; if change of polling cadence is required, document explicitly.
- [ ] (E) `InboxPage.tsx` reduced to ≤250 LOC (page layout + composition only).
- [ ] (E) `shipwright_bloat_baseline.json` entry for `client/src/pages/InboxPage.tsx` REMOVED.
- [ ] (E) RED→GREEN vitest:
  - `PendingSection.test.tsx`: renders item list; resolve-button click calls `onResolve(id, action)`; loading state renders skeleton/spinner.
  - `HistorySection.test.tsx`: hasMore=true renders load-more; click triggers `onLoadMore`; empty state renders placeholder.
  - `InboxFilters.test.tsx`: filter change fires `onFiltersChange` with merged state.
  - `useInboxData.test.ts`: query keys stable; cache invalidation on resolve mutation.
- [ ] (E) Existing E2E spec(s) for inbox flow pass — `cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "Inbox|triage"`.
- [ ] (E) Bloat-check PR-comment ✅ no anti-ratchet AND zero advisory crossings.

## Spec Impact

- **Classification:** none
- **NONE justification:** Internal refactor.

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| `useInboxData` (GET request) | `server/src/external/.../inbox` route | URL query params + JSON response |

Refactor MUST NOT change query-param shape or response-key consumption. Mandatory contract preservation.

`touches_io_boundary` = no (JSON over HTTP — verified by E2E + mocked vitest).

## Verification (F0.5)

- **Surface:** `web`
- **Runner commands:**
  ```bash
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/pages/inbox
  cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "Inbox|triage"
  cmd /c npm.cmd --prefix client run typecheck
  ```
- **Evidence path:** vitest log + playwright-report + surface_verification.json.
- **`tests_run` MUST be ≥ 8.**

## Confidence Calibration

- **Boundaries touched:** GET request query params + response key consumption.
- **Empirical probes run:** (1) vitest with MSW or fetch-mock asserting exact URL params; (2) Playwright E2E creates + resolves a triage item; (3) typecheck.
- **Edge cases NOT probed + why acceptable:** server-side filter logic not re-tested here — C2 covers it.
- **Confidence-pattern check:** runner records.

## External Review + Code Review (ADR-029)

- Step 3.5: **RUN** (medium).
- Step 3.7: **RUN**.

## Hard constraints

- Polling cadence preserved exactly (per CLAUDE.md rule 7 in Architecture rules — no SSE).
- Query-param schema bit-perfect.
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.

---

See [`_cleanup-invariant.md`](./_cleanup-invariant.md) for the cleanup-invariant block.
