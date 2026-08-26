# Code Review: iterate/org-page (FR-01.71 "Org" page) — Re-Review

## Summary

I verified all 4 previously-found-and-fixed issues are correctly and completely fixed, and did a full pass over the rest of the diff. I found **one new HIGH-severity regression** hiding inside the fix for previously-fixed finding #3 (AuditLogModal), plus a real gap in the promised E2E verification, and a couple of lower-severity items.

---

## Part 1 — Verification of the 4 previously-reported fixes

All four are confirmed correctly fixed in the current tree:

1. **Roster query-key mismatch** — `client/src/hooks/useOrgRoster.ts:12` now exports `ORG_ROSTER_QUERY_KEY = ["org", "leads-roster"]`, and `client/src/components/org/LeadCard.tsx:21,234` imports and uses that exact constant in its `invalidateQueries` call after a charter save. Confirmed consistent — no more silent key drift.

2. **Duplicate org-chart fetch** — `client/src/hooks/useOrgChart.ts` is now the single shared hook (`ORG_CHART_QUERY_KEY = ["org","chart"]`), and both `useOrgChartPresence.ts:26` and `OrgPage.tsx:18,49,66` consume it. One fetch, two/three consumers. Confirmed.

3. **AuditLogModal side-effect + background refetch** — `refetchOnMount: false, refetchOnReconnect: false, refetchOnWindowFocus: false` are present (`client/src/components/org/AuditLogModal.tsx:57-59`), which does stop a *background* refetch from duplicating rows. **However, this fix introduces a new regression — see Finding 1 below. The originally-reported bug is fixed; a different, arguably worse bug was introduced in fixing it.**

4. **"Parses the chart once" doc-accuracy claim** — `server/src/routes/org.ts:81-90` and `server/src/external/org/org-chart-lookup.ts:56-59` now both carry corrected comments stating "at most twice per request, never per-lead," with the rationale for why `orgChartCore` (all-or-nothing validation) and `readAllLeadOrgInfo` (tolerant per-lead lookup) can't share a single parse. Confirmed accurate — I checked `readAllLeadOrgInfo` genuinely does one `readOrgChartRaw` open+parse and returns an in-memory `forLead` closure (`org-chart-lookup.ts:158-167`), and `org-leads-composite.ts`'s `buildNow`/`buildCadence` consume the passed-in `orgInfo` rather than re-reading. The iterate spec's Design Notes text was also corrected accordingly.

---

## Part 2 — New findings

### Finding 1 (HIGH, correctness) — AuditLogModal renders blank on re-open; the fix for finding #3 introduced this

**File:** `client/src/components/org/AuditLogModal.tsx:37-60` (see also `LeadCard.tsx:248` — `{auditOpen && <AuditLogModal ... />}`)

The fix for previously-reported finding #3 added `refetchOnMount: false` (along with the reconnect/focus variants) to stop a *background* refetch from re-running the `queryFn`'s side effect (`setPages((prev) => ...)`) and duplicating rows. But it also disables the *foreground* refetch TanStack Query would otherwise do on a genuine remount when cached data already exists.

The sequence:
1. Operator opens a lead's audit log. `AuditLogModal` mounts, `queryFn` runs, calls `setPages([page.entries])`. Rows show.
2. Operator closes the modal. `LeadCard.tsx:248` renders `{auditOpen && <AuditLogModal .../>}`, so on `auditOpen → false` the whole component — including its local `pages`/`cursor`/`hasMore` state and its `useQuery` observer — **unmounts**. The query result stays in the `QueryClient` cache for the default `gcTime` (5 minutes — `client/src/main.tsx:16-24` sets no override).
3. Operator reopens the same lead's audit log (very plausible within 5 minutes). `AuditLogModal` **remounts fresh**: local `pages` state re-initializes to `[]`. But TanStack Query v5's `shouldFetchOnMount` only re-fetches when there's no cached data (`!query.state.dataUpdatedAt`) OR `refetchOnMount` allows it; here data already exists in cache and `refetchOnMount: false` means the query serves the cached `data` **without re-invoking `queryFn`**.
4. Because `queryFn` never re-runs, the side-effect `setPages(...)` that populates local state never fires. `pages` stays `[]`, so `entries = pages.flat()` is `[]`, `isLoading` is `false` (react-query already has data), `error` is `null`.
5. None of the modal's render branches match: not `isLoading`, not `notFound`, not `error`, not `entries.length > 0`. **The modal renders its header only, with a completely blank body** — no loading spinner, no error, no rows, no "not found" — a direct violation of the Design Notes' own stated bar ("never a blank... tile") and of AC-3's general "never a blank space... or a spinner" principle for settled data.

This is 100% reproducible on every "close, then reopen within ~5 minutes" cycle for the same lead — an everyday interaction, not an edge case. There is also **zero test coverage** for `AuditLogModal` (no `AuditLogModal.test.tsx` exists anywhere in the diff), which is exactly the kind of test that would have caught this on first open→close→reopen.

**Suggested fix:** don't drive `pages` off a `queryFn` side effect at all — it fundamentally couples component-local state to a caching layer's decision about whether to re-run a function. Either (a) derive the entries list from `data` directly per-cursor and merge with `useEffect(() => { if (data) setPages(...) }, [data])` (so it fires whenever `data` changes for *any* reason, including "served from cache on a fresh mount"), or (b) drop the local `pages` accumulator and instead track an array of fetched cursors, rendering via `useQueries` and flattening `data` from each — never a side effect inside `queryFn`. Whichever approach, add a regression test that: opens the modal, closes it, reopens it (same `leadId`, same `QueryClient` instance, no `queryClient.clear()`), and asserts the entries are still visible.

### Finding 2 (MEDIUM, correctness / process) — No Playwright E2E flow exists for the Org page, despite the iterate spec's own binding commitment

**File:** none exists — checked `client/e2e/flows/` exhaustively (case-insensitive grep for "org" across the whole directory tree, plus glob patterns for `*org*`).

The iterate spec's own `## Verification (medium+)` section states: `Runner command: npx playwright test client/e2e/flows/<new-org-page-spec>.spec.ts (exact filename fixed during Step 11a authoring)`. The External-Code-Review Findings section's finding #7 explicitly says "The suggested present/missing E2E flow (finding 7's last sentence) is covered by `## Verification (medium+)`'s Step 11a authoring, not duplicated here" — i.e., it defers (not waives) the E2E flow to a later authoring step. I found no `client/e2e/flows/*.spec.ts` file anywhere in the tree that references `/org`, `OrgPage`, or any `org-*` test id (`org-page`, `org-page-not-installed`, `org-page-broken`, `org-lead-list`, etc.). This is a medium-complexity iterate (explicitly overridden from `small` in the spec header specifically because of, among other things, "an explicit operator request for a mid-build visual approval checkpoint" and an 8-endpoint data integration), and per project convention medium+ iterates commit to authoring **and running** an E2E flow, not just planning for one.

Concretely, this leaves several ACs verified by **no automated test of any kind** (neither unit nor E2E) — see Finding 3.

**Suggested fix:** author `client/e2e/flows/<nn>-org-page.spec.ts` covering at minimum: (a) nav entry hidden when `org-chart.json` absent (AC-6a) and direct `/org` navigation showing the "not installed" state (AC-6b); (b) nav entry present + page-level error banner on a 502/invalid chart (AC-7); (c) the present/happy-path render with a seeded leads fixture, asserting chart → shared docs → lead cards order end-to-end in a real browser (AC-1); (d) the charter edit → save round trip through the real `MarkdownEditorModal` UI. Run it, don't just author it, per the medium+ convention.

### Finding 3 (MEDIUM, correctness / test coverage) — No component test at all for `OrgPage.tsx`

**File:** `client/src/pages/OrgPage.tsx` — no `OrgPage.test.tsx` exists.

Compounding Finding 2: `OrgPage.tsx` is the one file that actually implements AC-1's top-level ordering (`OrgChart` → `OrgSharedDocs` → lead-card list) and the page-level presence states (`org-page-not-installed` for AC-6b, `org-page-broken` for AC-7, plus `OrgPageContent`'s own `isLoading`/roster-error branches). `useOrgChartPresence.test.ts` verifies the *hook's* 4-state logic, and `SidebarNav.test.tsx` / `CommandCenter.test.tsx` verify the *nav-gating* consumption of that signal — but nothing verifies that `OrgPage.tsx` itself renders the right thing for each of the 4 presence states, or that the chart/shared-docs/lead-list order actually holds in the composed page. Since the E2E flow that was supposed to close this gap (Finding 2) doesn't exist either, these page-level behaviors are currently unverified by any automated test.

**Suggested fix:** a quick `OrgPage.test.tsx` mocking `useOrgChartPresence`/`useOrgChart`/`useOrgRoster` the same way `CommandCenter.test.tsx` does, asserting the 4 presence branches render their respective test ids, and asserting DOM order of `org-chart` → `org-shared-docs` → `org-lead-list` in the present case. This is cheap insurance independent of whether/when the E2E flow lands.

### Finding 4 (LOW, security/consistency) — GET-only lead-doc routes don't verify the leadId is a registered chart entry, unlike the PUT charter route

**File:** `server/src/routes/org.ts:115-125` (`GET /api/org/leads/:leadId/learnings` and `GET /api/org/leads/:leadId/audit`)

The External-Code-Review's HIGH finding (#1, already fixed) established that a syntactically-valid-but-unregistered `leadId` must not be trusted, and the fix added an `Object.hasOwn(chart.body.leads, leadId)` check — but only to the PUT charter handler. The two GET routes for `learnings.md` and `audit.jsonl` still only validate `leadId` against `LEAD_ID_RE` (via `leadLearningsReadCore`/`auditLogCore`'s own `pathGuard` call) and never check chart membership. In practice this is low-severity: it's read-only, confined to a fixed filename under `leadsRoot`, requires the target to already exist on disk, and the surface is only reachable by the single local operator (host-allowlist-gated) crafting a direct URL rather than through any UI path (the roster response only ever contains registered leads, so the UI never constructs a request for an unregistered one). Still, it's an inconsistency with the security posture the HIGH fix established, and worth closing for a stale/decommissioned lead directory that still has files on disk.

**Suggested fix:** either accept this explicitly as an intentional, documented scope narrowing (read-only, local-only) in a comment, or add the same `Object.hasOwn` check to both GET handlers for consistency with the charter PUT route's posture.

---

## Things I checked and found correct (no finding)

- `role-extract.ts`'s YAML-frontmatter/heading/code-fence/blockquote skip logic and markdown-link stripping match the Design Notes' precise rule; falls back to `{measured:false}` rather than dumping raw text.
- `org-schema-sync.test.ts`'s union-arm splitter (`splitTopLevel`, depth-aware) correctly extracts and compares all 6 discriminated unions (`UsageResponse`, `LeadNowState`, `LeadRoleView`, `LeadCadenceView`, `LastRunResponse`, `BeatRegisterHealthResponse`) plus the flat interfaces including the newly-added `BeatRegisterEntryView` — matches finding #5's claimed fix.
- `file-read.ts` / `lead-doc-read.ts` / `audit-log.ts` all correctly reorder to open-with-`O_NOFOLLOW`-first, `realPathGuard`-after-existence — matches finding #4's fix and closes the CodeQL TOCTOU concern via same-fd fstat+read.
- `routes/org.ts`'s PUT charter handler's `unknown_lead` 403 check (finding #1's fix) is correctly placed after allowlist/kind resolution and before `orgFileWriteCore` is ever called, with matching regression tests (`org.test.ts:226-248`).
- `mount.ts` / `_helpers.ts` — no actual route-mount collision: the two Hono sub-apps declare disjoint path prefixes (`/api/external/org/*` vs `/api/org/*`); AC-9 has a direct regression test mounting both on one parent app and asserting the gated route still 401s.
- `LeadCard.tsx`'s Now-block relative-time fix (finding #3 in the External-Code-Review list, distinct from the AuditLogModal finding #3 I'm flagging above) is correctly wired to `formatRelativeTime` with a test asserting the absolute-date pattern is absent.
- `orgMarkdownFileApi.ts` correctly re-exports (not redeclares) `MarkdownConflictError` from `markdownFileApi.ts`, so `MarkdownEditorModal.tsx`'s `instanceof` check works across the injected `saveOverride` — verified by reading both files together.
- `navDestinations.ts` is genuinely untouched (pure, synchronous, router-table-derived); the "Org" conditional lives entirely in `SidebarNav.tsx`/`CommandCenter.tsx`, both filtering on the same `useOrgChartPresence()` signal — matches the "two places, one condition" design intent, with matching tests at both call sites.
- `resolveOrgAllowlistedTarget` / `LEAD_ID_RE` / `isAllowedOrgRouteHost` are shared, not duplicated, between the gated and plain routers.

---

## Files most relevant to this review

- `C:\01_Development\shipwright-webui\.worktrees\org-page\client\src\components\org\AuditLogModal.tsx` (Finding 1)
- `C:\01_Development\shipwright-webui\.worktrees\org-page\client\src\components\org\LeadCard.tsx` (Finding 1 trigger — conditional unmount)
- `C:\01_Development\shipwright-webui\.worktrees\org-page\client\src\main.tsx` (default `gcTime`, confirms Finding 1 reproduces in production)
- `C:\01_Development\shipwright-webui\.worktrees\org-page\client\e2e\flows\` (Finding 2 — absence)
- `C:\01_Development\shipwright-webui\.worktrees\org-page\client\src\pages\OrgPage.tsx` (Finding 3)
- `C:\01_Development\shipwright-webui\.worktrees\org-page\server\src\routes\org.ts` (Finding 4, and fix #4 verification)
- `C:\01_Development\shipwright-webui\.worktrees\org-page\server\src\external\org\org-chart-lookup.ts` (fix #4 verification)
- `C:\01_Development\shipwright-webui\.worktrees\org-page\client\src\hooks\useOrgRoster.ts`, `useOrgChart.ts`, `useOrgChartPresence.ts` (fixes #1/#2 verification)
- `C:\01_Development\shipwright-webui\.worktrees\org-page\server\src\types\org-schema-sync.test.ts` (fix #5 verification)
- `C:\01_Development\shipwright-webui\.worktrees\org-page\.shipwright\planning\iterate\2026-08-26-org-page.md` (spec used for this review)
