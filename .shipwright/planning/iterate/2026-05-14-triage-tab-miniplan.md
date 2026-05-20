# Mini-Plan: triage-tab (Iterate 3 of triage inbox campaign)

- **Run ID:** iterate-20260514-triage-tab
- **Spec:** `.shipwright/planning/iterate/2026-05-14-triage-tab.md`
- **Branch:** `iterate/triage-tab` (worktree `.worktrees/triage-tab`)

## Approach

TS port of the triage.jsonl reader (drift-protected by Python parity test); `proper-lockfile` on the JSONL path for write protection (cross-process limitation w/ Python `_FileLock` documented as ADR-101 known limitation); cross-store transaction for Promote (ExternalTask FIRST via store.create, status flip SECOND via appendFileSync) with `findByPromotedFromTriageId` lookup as the idempotent-retry gate. Read endpoints poll at 30s; no FS watcher (SessionWatcher is Claude-JSONL-specific).

## Files

### Server (NEW)

- `server/src/core/triage-store.ts` — TS port of `read_all_items`. Pure functions: `parseTriageLine`, `readAllItems(path: string): TriageItem[]`, `resolveStatus(events): TriageItem`. Tolerant — skips JSONDecodeError lines.
- `server/src/core/triage-write.ts` — atomic status-event append. `appendStatusEvent(jsonlPath: string, event: TriageStatusEvent, lock: LockFn): Promise<void>`.
- `server/src/routes/triage.ts` — Hono routes: `GET /api/triage/:projectId`, `GET /api/triage/counts`, `POST /api/triage/:projectId/promote`, `POST /api/triage/:projectId/dismiss`, `POST /api/triage/:projectId/snooze`. Uses `path-guard.ts` for resolution.
- `server/src/types/triage.ts` — TS types verbatim from triage.py wire shape (`TriageItem`, `TriageStatusEvent`, `TriageStatus`).
- `server/src/core/triage-store.test.ts` — TS read parity + tolerance tests (incl. fixture round-trip vs Python output).
- `server/src/core/sdk-sessions-store.findByPromoted.test.ts` — finder + idempotency.
- `server/src/routes/triage.test.ts` — route integration tests (happy / 409 / 404 / 400 / 207 partial-promote).
- `server/src/test/fixtures/triage.jsonl` — 6-line fixture for parity test (header + 2 appends + 2 status flips + 1 corrupt).
- `server/scripts/dump-triage-resolved.py` — small script that calls Python `read_all_items` on the fixture + dumps JSON; consumed by the parity test (subprocess at test-time only).

### Server (MODIFIED)

- `server/src/core/sdk-sessions-store.ts` — add `findByPromotedFromTriageId(triageId: string): ExternalTask | undefined` (mirror of `findByPhaseTaskId`); extend `create()` arg type with optional `promotedFromTriageId?: string`. ~10 LOC.
- `server/src/index.ts` — wire `app.route("/", createTriageRoutes({ ... }))` after the existing `createExternalRoutes` mount. ~6 LOC. Pass `getProjectById`, `sdkSessionsStore`, and the lock helper.

### Client (NEW)

- `client/src/pages/TriagePage.tsx` — list + detail-modal page, source-grouped, severity-sorted.
- `client/src/components/triage/TriageItemCard.tsx` — single-item card.
- `client/src/components/triage/TriageDetailModal.tsx` — Radix dialog with full detail + action buttons.
- `client/src/components/triage/PromoteModal.tsx` — promote form (priority / domain / complexityHint / tags). Mirror NewIssueModal layout.
- `client/src/components/triage/TriageBadge.tsx` — sidebar badge (orange).
- `client/src/hooks/useTriageItems.ts` — TanStack Query for `GET /api/triage/:projectId` with 30s poll; per-project + flat-all variants.
- `client/src/hooks/useTriageCounts.ts` — TanStack Query for `GET /api/triage/counts` with 30s poll.
- `client/src/hooks/useTriagePromote.ts` — mutation hook (POST /promote); also `useTriageDismiss`, `useTriageSnooze`.
- `client/src/lib/triageApi.ts` — fetch wrappers + types.
- All `*.test.tsx` siblings.

### Client (MODIFIED)

- `client/src/router.tsx` — add `{ path: 'triage', element: <TriagePage /> }`.
- `client/src/components/sidebar/SidebarNav.tsx` — add `<SidebarNavItem icon={Triangle} label="Triage" to="/triage" badge={<TriageBadge count={triageCount} />} ... />` between Inbox and Diagnostics. Take `triageCount` as a new prop OR consume `useTriageCounts` directly.
- `client/src/layouts/MainLayout.tsx` — pass triageCount from `useTriageCounts` to SidebarNav (analogous to how `inboxCount` is passed today).

### Docs

- `README.md` — append a `### Triage tab` section (1 paragraph + screenshot link).
- `docs/images/triage-tab.png` — screenshot from F0.5 Playwright run.
- `.shipwright/agent_docs/architecture.md` — Data Flow paragraph extension (read consumer + status-flip producer of triage.jsonl).
- `.shipwright/agent_docs/decision_log.md` — ADR-101 (cross-process lock limitation + TS read port + cross-store transaction shape).
- `CHANGELOG-unreleased.d/Added/iterate-20260514-triage-tab_001.md` — Triage tab + Promote bridge.

## Work breakdown (TDD)

1. **RED — server fixtures + read tests** (45 min)
   - Write `server/src/test/fixtures/triage.jsonl` with the 6-line shape.
   - Write `triage-store.test.ts` with the parity test (subprocess to Python on the same fixture; assert TS output deep-equals Python output).
   - Write `routes/triage.test.ts` skeleton with empty-state / 404 / 400 / promote-happy / promote-idempotent-retry / promote-409-already-promoted / partial-promote / dismiss / snooze / counts. All RED.

2. **GREEN — server implementation** (90 min)
   - `core/triage-store.ts` — implement `readAllItems` to satisfy parity test.
   - `core/triage-write.ts` — implement `appendStatusEvent` with lockfile.
   - Add `findByPromotedFromTriageId` to `sdk-sessions-store.ts`.
   - Extend `create()` arg + persist for `promotedFromTriageId`.
   - `routes/triage.ts` — wire all 5 endpoints.
   - Wire into `index.ts`.

3. **RED — client tests** (45 min)
   - `client/src/lib/triageApi.test.ts` — fetch wrapper unit tests.
   - `TriagePage.test.tsx` — empty / loaded / item-click → modal.
   - `PromoteModal.test.tsx` — form validation, submit flow.
   - `TriageBadge.test.tsx` — render matrix.

4. **GREEN — client implementation** (90 min)
   - Implement page + components + hooks. Use Radix Dialog for the detail/promote modals (mirrors NewIssueModal).
   - Wire into router + sidebar + layout.

5. **F0.5 — Playwright spec** (30 min)
   - `client/e2e/flows/triage-tab.spec.ts`: project setup with a fixture triage.jsonl, navigate to /triage, click first item, click Promote, fill form, submit, assert ExternalTask appears on /tasks (or via API), assert triage.jsonl status flipped, take screenshot for README.

6. **Docs + finalize** (45 min)
   - README section + screenshot copy-in.
   - architecture.md update.
   - ADR-101 via write_decision_log.py.
   - CHANGELOG drop file.
   - F1–F12.

## Test strategy

| Layer | Unit | Integration | E2E |
|---|---|---|---|
| **Read path** (`triage-store.ts`) | tolerance, status resolution, missing/empty file, header-only, parity-with-Python (subprocess fixture round-trip) | n/a | exercised through GET via Playwright |
| **Write path** (`triage-write.ts`) | append-status-event with lock; mock writeFile to throw → caller surfaces 207 | n/a | n/a |
| **Routes** | n/a | full happy/error matrix per AC; cross-store atomicity (mock appendFileSync throw → ExternalTask survives + 207); idempotent retry (call promote twice → 1 task) | promote click-through against running stack |
| **Client** | hook polling, modal validation, badge render | n/a | E2E covers promote flow end-to-end |
| **Drift protection** | TS↔Python parity fixture | n/a | n/a |

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Cross-process lock collision between webui (proper-lockfile) and Python (`_FileLock`) | Documented as known limitation in ADR-101. Mitigation = small-write line-atomicity + last-status-wins resolution. Real-world impact is bounded by `triage_promote.py` being manual-only. |
| Python parity test requires Python on PATH | Test detects + skips with hard-fail in CI (per `silent-skip CI-discipline rule` in conventions.md). Local dev: skip with hint to install via uv. |
| Schema drift if `triage.py` adds new fields | Parity test catches it (TS reader will silently drop new fields → Python will include them → assert fails). Surface via test failure, not silent under-render. |
| Multi-project counts endpoint perf with many projects | Cap concurrent file reads to 10 (Promise.all batched); 30s poll cadence; mtime-based skip-if-unchanged is a future optimization. |
| Cross-tab promote race | Step 5's re-read inside locks catches it → 409. Idempotency check (step 2) handles the recovery case. |

## Alternative considered

Subprocess to Python for status-flip writes (instead of TS append + proper-lockfile). Rejected because:
- Python runtime + uv discovery is fragile when webui server is autostarted on Windows (no shell PATH).
- The handoff explicitly permits "proper-lockfile or msvcrt pattern" — both are acceptable.
- The cross-process collision risk is empirically bounded (see Risks table).
- Adds ~50–100 ms per write (subprocess spawn) on a manual-action path that's already user-tolerant.

## Out of scope (this iterate)

(See spec §Out of Scope; in summary: bulk-promote, search, webhooks, new producers, schema changes, TaskDetail back-ref UI.)
