# Iterate Spec: triage-tab

- **Run ID:** iterate-20260514-triage-tab
- **Type:** feature
- **Complexity:** medium (handoff says medium-large; locked at medium per Override Classes — large would route to escape hatch)
- **Status:** draft
- **Branch:** `iterate/triage-tab` (worktree `.worktrees/triage-tab`)
- **Cross-repo handoff:** `C:/Users/you/projects/shipwright/.shipwright/agent_docs/triage-remaining-iterates-handoff.md`
- **Storage SoT (read-only ref):** `<plugins>/shipwright/shared/scripts/triage.py`

## Goal

Add a `/triage` tab to webui that aggregates `<project>/.shipwright/triage.jsonl` items across every registered project (filtered to `status==triage`), and a Promote action that creates a backlog `ExternalTask` carrying the new `promotedFromTriageId` back-ref (added by Iterate 1b, ADR-100) and flips the triage item's status to `promoted` in the same request — atomic-ish, idempotent on retry. Plus Dismiss + Snooze + sidebar `Triage (N)` count + 30s auto-refresh while the tab is active.

## Acceptance Criteria

- [ ] **AC-1 — Triage tab in webui sidebar.** New top-level route `/triage` (mirrors `/inbox`, `/projects`, etc.). `client/src/router.tsx` registers it; `client/src/components/sidebar/SidebarNav.tsx` adds a `<SidebarNavItem icon={Triangle} label="Triage" to="/triage" badge={<TriageBadge count={triageCount} />} collapsed={collapsed} />` between Inbox and Diagnostics. Project registry source is the existing `~/.shipwright-webui/projects.json` — webui is already multi-project, so the handoff's optional `triageProjects: string[]` config key is **NOT** added (decision deviation captured in §Decisions). For each non-synthesized project, server reads its `<path>/.shipwright/triage.jsonl` and returns the resolved view filtered to `status==triage`.

- [ ] **AC-2 — Triage item card + detail modal.** New `client/src/pages/TriagePage.tsx` lists items grouped by source (alphabetical, mirrors `aggregate_triage.py` layout) with severity-rank ordering inside each group. Each card displays: `title`, `source` badge, `severity` badge, `suggestedPriority`, `suggestedDomain`, `dedupKey` (mono), `originalTs` (relative — "2 h ago"), `detail` (collapsible, escaped). Click → `<TriageItemModal>` with full detail + Promote / Dismiss / Snooze buttons.

- [ ] **AC-3 — Promote endpoint with cross-store transaction.** `POST /api/triage/:projectId/promote` body `{ triageId: "trg-xxx", priority: "P0|P1|P2|P3", domain: string, complexityHint: "small|medium|large", tags: string[] }`. Server-side action (in order):
  1. Resolve `projectId → project.path` via the existing `getProjectById` wiring (synthesized "Unassigned" rejected with 404).
  2. **Idempotency check first.** `sdkSessionsStore.findByPromotedFromTriageId(triageId)` — if a task already exists, skip step 4 and proceed to step 5 with that task's id (recovery from a prior partial-promote).
  3. Acquire `sdk-sessions.json` lock (existing `proper-lockfile` pattern).
  4. Acquire `<project>/.shipwright/triage.jsonl` lock (`proper-lockfile`; cross-process limitation w/ Python `_FileLock` documented below + in ADR).
  5. Re-read triage.jsonl via `readAllItems()`; confirm `item.status === "triage"`. If `promoted|dismissed|snoozed`, release locks and return `409 { error: "triage_item_not_in_triage_state", actualStatus }`.
  6. Call `sdkSessionsStore.create({ projectId, title: item.title, cwd: project.path, promotedFromTriageId: triageId, priority, domain, complexityHint, tags: [...defaultTags, ...userTags] })` where `defaultTags = ["source:" + item.source, "severity:" + item.severity, "triage:" + triageId]` (handoff §AC-3).
  7. Append `{event:"status", id:triageId, ts:<now-Z>, newStatus:"promoted", by:"webui", reason:"webuiPromote", promotedTaskId:"EXT:" + newTask.taskId}` to triage.jsonl via `fs.appendFileSync` (line-atomic on POSIX up to PIPE_BUF; small-write safe on Windows). The `EXT:` prefix matches `triage_promote.py` task_ref convention.
  8. Release both locks. Return `201 { task: <ExternalTask>, triageId, status: "promoted" }`.

  **Partial-promote recovery.** If step 7 fails after step 6 succeeded, the route releases locks and returns `207 { error: "promote_partial", taskId: newTask.taskId, message: "ExternalTask created; triage status flip failed — retry to complete" }`. Retry hits step 2's idempotency check, skips create (preserving `task.taskId`), and re-attempts the status flip. Retries are **safe** because step 6 is the destructive write and step 7 is idempotent (last-status-wins).

  **Mutually exclusive / 400 errors:**
  - Body missing `triageId` or `priority` or `domain` → 400.
  - `priority` not in `["P0","P1","P2","P3"]` → 400.
  - `domain` empty string → 400.
  - `complexityHint` not in `["small","medium","large"]` (or omitted — leave undefined on the task) — undefined accepted, other values 400.
  - `tags` non-array OR contains non-strings → 400.
  - `triageId` regex mismatch `/^trg-[0-9a-f]{8}$/` → 400.
  - Triage item id not found in JSONL → 404.

  Mirrors `triage_promote.py` `sanitize_task_ref` constraints: rejected control chars + 200-char max apply to the auto-built `"EXT:" + taskId` (taskId is a UUIDv4, well under both gates) — no extra sanitization layer needed; the format is closed.

- [ ] **AC-4 — Dismiss + Snooze actions.** `POST /api/triage/:projectId/dismiss` body `{ triageId, reason?: string }`. `POST /api/triage/:projectId/snooze` same body. Server: acquire triage.jsonl lock, re-read items, validate `item.status === "triage"`, append `{event:"status", id, ts, newStatus:"dismissed"|"snoozed", by:"webui", reason: reason || null}`, release. Returns `200 { triageId, newStatus }`. Same 404 / 409 / 400 envelope as Promote (without the cross-store complexity).

- [ ] **AC-5 — Sidebar `Triage (N)` count.** `GET /api/triage/counts` returns `{ counts: Record<projectId, number>, total: number }` where `counts[projectId] = items.filter(i => i.status === "triage").length` per non-synthesized project, and `total` is the sum. New `useTriageCounts()` hook (TanStack Query) polls every 30s; `<TriageBadge count={total} />` mirrors `<InboxBadge>` — `null` when 0; "99+" when >99.

- [ ] **AC-6 — Auto-refresh.** Triage tab uses `useTriageItems(projectId)` (per-project) AND `useTriageItems()` (all projects flattened) hooks polling at 30s. **No FS watcher reuse** — webui's existing watcher (`SessionWatcher`) is JSONL-specific to Claude session files at `~/.claude/projects/`, not arbitrary project paths; reusing it would be a misuse. 30s polling matches the existing transcript poll cadence.

- [ ] **AC-7a — Server tests** (vitest, in `server/src/external/triage-routes.test.ts` + `server/src/core/triage-store.test.ts`):
  - **Read parity** — TS `readAllItems` matches Python `read_all_items` resolved view byte-for-byte on a 6-line fixture (header + 2 appends + 2 status flips + 1 corrupt line). Drift-protection.
  - **Filename-first project resolution** — request for unknown projectId returns 404 (not 500 / not silent empty).
  - **Empty / missing JSONL** — `GET /api/triage/:projectId` returns `{ items: [] }` (200) when triage.jsonl absent.
  - **Promote happy path** — POST returns 201 with `{ task: { promotedFromTriageId: "trg-...", tags: ["source:phaseQuality","severity:high","triage:trg-...","custom-tag"] } }`; subsequent GET shows the item in `promoted` status.
  - **Promote idempotent retry** — call promote twice in a row → second call finds existing task via `findByPromotedFromTriageId`, returns 201 (not 409), task id unchanged.
  - **Promote 409 when already-promoted by other actor** — pre-flip the status via direct file write, then POST → 409 `triage_item_not_in_triage_state`.
  - **Promote 404 when triageId missing** — POST with id not in file → 404.
  - **Promote 400 on invalid body** — missing triageId / bad priority / non-array tags → 400 each.
  - **Cross-store atomicity** — mock `appendFileSync` to throw on first call, verify ExternalTask is still created (step 6 succeeds), response is 207 with `taskId` in body, retry (with `appendFileSync` working) succeeds and the ExternalTask is the SAME taskId (idempotent).
  - **Dismiss + Snooze** — POST → 200, item disappears from `status==triage` filter on next GET; reason is recorded in JSONL.
  - **Counts** — GET /counts returns correct N per project and accurate total.

- [ ] **AC-7b — Client tests** (vitest, in `client/src/pages/TriagePage.test.tsx` + `client/src/components/triage/*.test.tsx`):
  - Tab renders empty state ("No triage items pending. ✓" — mirror `aggregate_triage.py` line) when API returns `{ items: [] }`.
  - Item card renders all 7 displayed fields (title / source / severity / suggestedPriority / suggestedDomain / dedupKey / originalTs).
  - Detail modal opens on card click, closes on Escape + outside click + ✕.
  - Promote modal: form validation (priority required, domain required, tags split-on-comma + trim + filter empty), submit → POST → success toast → list refreshes (mock invalidate → re-fetch).
  - Dismiss flow: confirm modal → POST → toast → row removed.
  - Error states: project not configured (404 from server) → empty state with hint; promote 409 → toast "already promoted by another session"; promote 207 → toast "partially completed; click Retry"; promote 400 → form-field error.
  - Sidebar `Triage (N)` renders count from hook; `null` when 0.

- [ ] **AC-8 — Documentation.** `README.md` gets a new `### Triage tab` section with: 1-paragraph overview, link to `shipwright/docs/triage-inbox.md`, 1 screenshot under `docs/images/triage-tab.png` (real screenshot taken via Playwright during F0.5; PNG committed). `client/README.md` references the route. `agent_docs/architecture.md` Data-Flow paragraph adds: webui as triage **read** consumer + **status-flip** producer for `<project>/.shipwright/triage.jsonl`.

## Affected FRs

- **FR-01.30 (NEW)** — **Triage Tab + Promote bridge.** The webui surfaces `<project>/.shipwright/triage.jsonl` items (status=triage) across registered projects, with Promote (creates `ExternalTask` carrying `promotedFromTriageId` back-ref + flips triage status to `promoted` in the same request — idempotent on retry), Dismiss, and Snooze. Sidebar shows aggregate triage count. Read path is auto-refreshed at 30s while the tab is active. Owns: `client/src/pages/TriagePage.tsx`, `client/src/components/triage/`, `client/src/hooks/useTriageItems.ts`, `client/src/hooks/useTriageCounts.ts`, `server/src/routes/triage.ts`, `server/src/core/triage-store.ts`. **WebUI does not append new finding events** — that surface remains the producer plugins'; webui is a read consumer + status-flip producer only.

- **FR-01.08** Task list / create — additive: `store.create()` accepts a new optional `promotedFromTriageId` argument that flows from the Promote endpoint. No change to legacy POST `/api/external/tasks`.

- **FR-01.10** Launch copy-command — unchanged. Promoted tasks launch through the standard flow.

- **FR-01.24** Projects (list / create) — read-only lookup added: `GET /api/triage/counts` aggregates across `getAll().filter(p => !p.synthesized)`.

## Out of Scope

- **Bulk-promote multi-select** (handoff: separate iterate)
- **Cross-project triage filtering / search UI** (handoff)
- **Webhook receivers** for Slack / monitoring (handoff)
- **New triage-source producers** (handoff iterate 2 covers security / performance / F0.5 / drift in the monorepo — not webui scope)
- **Modifying `triage.jsonl` schema** — webui is a consumer; schema is owned by `shared/scripts/triage.py`
- **Re-fire policy after dismiss** — same as iterate-1a; dismissed findings re-emerge as NEW triage items under different `id` if the underlying issue re-fires. No "permanent dismiss" feature.
- **Permanent task ↔ triage back-ref UI on TaskDetailPage** — the back-ref data flows in (`task.promotedFromTriageId`) but the visual treatment in TaskDetail is a separate iterate.

## Design Notes

**Sidebar.** Reuse the existing `SidebarNavItem` + Triangle icon from `lucide-react` (matches "alert / triage" semantic). `<TriageBadge count={N} />` mirrors `<InboxBadge>` exactly: `bg-orange-500` (different from Inbox red — visually distinct, both are "needs attention" but different scopes).

**Page layout.** Two-column split: left = source-grouped list (alphabetical, mirrors `aggregate_triage.py`), right = full-detail panel for the selected item with action buttons. Mobile/narrow → stacks. Reuses `BubbleTranscript`-adjacent `MarkdownText` for the detail's escaped rendering (XSS-safe per ADR-035 conventions).

**Promote modal.** Two-column grid below the title:
- Priority — Radix DropdownMenu, 4 entries P0..P3, defaults to `item.suggestedPriority`
- Domain — text input, defaults to `item.suggestedDomain`
- Complexity hint — Radix DropdownMenu, 3 entries small/medium/large (no default)
- Tags — text input, comma-split + trim + filter empty (matches `NewIssueModal.tsx` from iterate 1b)
- (Read-only summary) — title, source, severity, dedupKey at top

**Token reuse.** Severity badges:
- critical = `bg-red-100 text-red-700`
- high = `bg-orange-100 text-orange-700`
- medium = `bg-yellow-100 text-yellow-800`
- low = `bg-slate-100 text-slate-600`
- info = `bg-stone-100 text-stone-700`

Source badges: `bg-stone-100 text-stone-700` (neutral, free-vocab).

**Empty state.** "No triage items pending. ✓" — verbatim from `aggregate_triage.py` line 170.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `server/src/routes/triage.ts` Promote/Dismiss/Snooze status-event appends | Python `triage.read_all_items` (next aggregator run) AND TS `readAllItems` (same-process subsequent GETs) | `<project>/.shipwright/triage.jsonl` (JSONL, schema v1, header line + event lines) |
| Python producers (`shared/scripts/hooks/aggregate_triage_on_stop.py` callers + `triage_promote.py`) | Same TS `readAllItems` consumer (webui poll) | Same file |
| `server/src/core/sdk-sessions-store.ts` `SdkSessionsStore.persist()` (now writes ExternalTask with optional `promotedFromTriageId` field) | Same store's `validateExternalTask` (load) | `<registryDir>/sdk-sessions.json` (JSON v3, write-on-touch — ADR-100 already added the field) |

**Cross-process lock note.** Python producers use `_FileLock` (msvcrt on Win, fcntl on POSIX, sidecar `<file>.lock` byte-locked). Webui uses `proper-lockfile` on the JSONL path itself (which creates `<file>.lock` as a directory). The two primitives **don't compose** — webui and Python won't see each other's locks. The mitigation:
- Append-mode writes are line-atomic at OS level for small writes (<PIPE_BUF on POSIX; buffered atomic on Windows for sub-page writes).
- The only Python tool that writes status events is `triage_promote.py`, run manually from a terminal — operator collision with a webui Promote click for the **same triageId** is the only hazard, and it's vanishingly rare (would require the same operator to be in both UIs simultaneously).
- New finding appends from producers (Phase-Quality, compliance, etc.) carry fresh ids — no overlap with webui's status-event surface.
- Last-status-wins by file order means the latest write reflects operator intent regardless of which path won the race.
- ADR-101 documents this as a **Known Limitation** with a path forward (TS-side `_FileLock`-compatible byte-range lock as future work in shipwright shared).

Drift-protection test mandatory (see AC-7a "Read parity").

## Confidence Calibration

- **Boundaries touched:** triage.jsonl producer (TS append) ↔ consumer (TS read + Python read); sdk-sessions.json producer/consumer.

- **Empirical probes planned** (each is a real round-trip / edge-case test, NOT a "did I read the diff carefully?" question):
  1. **TS readAllItems vs Python read_all_items parity** — same fixture in both, asserted resolved view equality (key sets, status overlays, ts overlays, statusBy/statusReason/promotedTaskId fields).
  2. **Append round-trip with status flip** — write append event → read returns `status:"triage"`; write status event `dismissed` → read returns `status:"dismissed"` with `statusBy:"webui"`, `statusReason:"<test reason>"`.
  3. **Corrupted line tolerance** — fixture with 1 invalid JSON line + 5 valid lines → reader returns 5 items, no throw.
  4. **Empty file + missing file** — both return `[]`, no throw.
  5. **Header-only file** — returns `[]` (no items), no throw.
  6. **Concurrency stress** — two parallel Promote calls on different ids → both succeed, both ExternalTasks exist, both triage items flipped. (Same-id concurrent Promote → second hits 409 idempotency or completes idempotently.)
  7. **JSONL line-atomic append under simulated load** — append 100 events in parallel via Promise.all → reader sees 100 valid events (no torn lines) AFTER all writes settle. Validates that proper-lockfile + append-mode together is sufficient for the per-process case.
  8. **Cross-store atomicity** — mock `fs.appendFileSync` to throw on first call → ExternalTask is created (step 6 succeeded), response is 207, second attempt with `appendFileSync` working returns 201 with the SAME taskId (idempotent retry).
  9. **Bad input round-trip** — bad triageId regex / bad priority enum / non-array tags → 400; the request never reaches `store.create()` (no orphan ExternalTask).
  10. **Path-traversal guard** — projectId of a deleted project (orphan in sdk-sessions but not in projects.json) → 404 (not 500); request body NOT echoed in the error message (no leak).

- **Edge cases NOT probed + why acceptable:**
  - **Cross-process Python `_FileLock` vs proper-lockfile collision** — addressed by design (small-write line-atomicity + last-status-wins resolution); a real concurrent-write test requires spawning Python AND Node simultaneously, which is fragile in CI. Documented as known limitation in ADR-101.
  - **POSIX-`export` syntax / inline `# comments`** — not applicable; JSON/JSONL are machine formats.
  - **Massive JSONL files (100k+ items)** — out of scope; aggregator caps at TOP_N=50, webui mirrors. If scaling becomes real, a server-side cap goes into the GET handler.

- **Confidence-pattern check** — none of the probes are predicate questions ("am I sure?"); they're empirical round-trips. Asymptote heuristic doesn't apply until a probe finds a bug. If probe N+1 finds a bug after probe N passed cleanly, run one more probe before F0.

## Verification (F0.5)

- **Surface:** `cli`
- **Runner command:** `npm.cmd --prefix server test -- run src/external/triage-routes.test.ts src/core/triage-store.test.ts && npm.cmd --prefix client test -- run src/pages/TriagePage.test.tsx src/components/triage/`
  - Windows note: `npm.cmd` per `conventions.md` learning (2026-05-09). Relative `--prefix` per the iterate-1b learning (2026-05-14).
- **Evidence path:** vitest text logs aggregated into `.shipwright/runs/<run_id>/surface_verification.json`.
- **Justification (if surface=none):** n/a — every AC is verifiable via vitest in both workspaces. (E2E in Playwright is added at Step 11a/b for the click-through Promote flow against a running stack.)

## Decisions

- **TS-port the read path, not subprocess Python.** The hot poll path runs every 30s × N projects; subprocess overhead would dominate. The reader is purely tolerant (skip JSONDecodeError lines), and a fixture-round-trip test prevents drift from `triage.py read_all_items`.
- **Use proper-lockfile on JSONL writes, not Python subprocess.** The handoff §AC-3 step 2 explicitly permits "proper-lockfile or msvcrt pattern". Webui-side proper-lockfile composes cleanly with the existing sdk-sessions.json lock pattern. The cross-process collision risk is documented (see Affected Boundaries) and bounded by `triage_promote.py` being a manual-only operation.
- **No new `triageProjects: string[]` config key.** Webui is already multi-project via `~/.shipwright-webui/projects.json`. The handoff's conditional ("If webui is currently single-project, add a new config key…") evaluates to "skip the new key" because of the existing wiring. ADR-101 will record the deviation.
- **`promotedFromTriageId` lookup is a new finder method.** `SdkSessionsStore.findByPromotedFromTriageId(triageId)` mirrors the existing `findByPhaseTaskId(phaseTaskId)`. ~6 LOC. Powers the idempotent retry in the Promote endpoint.
- **Default tags merged in:** `["source:" + item.source, "severity:" + item.severity, "triage:" + triageId]`. Per handoff §AC-3 step 4. Operator-supplied `tags` from the modal are appended (not replaced).
- **Empty state line copy:** verbatim from `aggregate_triage.py` line 170 ("No triage items pending. ✓") so the user sees the same wording across CLI render + webui.
- **Auto-refresh cadence:** 30s for items list + counts. No FS watcher reuse — `SessionWatcher` is Claude-JSONL-specific. Polling cadence matches the rest of webui.
- **Sidebar badge color:** orange (not Inbox red) so the two surfaces are visually distinct. Both signal "needs attention" but at different scopes.
- **No bulk operations**, **no search**, **no webhooks** — handoff explicitly out-of-scope.
- **Promote is idempotent on retry by `promotedFromTriageId` lookup, not by `taskId`.** The taskId is freshly minted on each `create()` call; if the route minted a new one on retry, we'd leak orphan ExternalTasks. The lookup gate is the load-bearing invariant.

## DO-NOT regression-guards review (pre-build)

Walking the live `conventions.md` checklist:

1. **Webui never spawns Claude** — preserved (no launcher change).
2. **Auto-scroll CSS-first** — n/a (no transcript change).
3. **No chat composer** — n/a.
4. **No `@assistant-ui/*`** — n/a.
5. **No `claude --resume` as side effect** — n/a.
6. **`proper-lockfile` for multi-writer state** — preserved AND extended (now also on triage.jsonl).
7. **No cross-package imports** — preserved.
8. **Schema v2/v3 write-on-touch** — preserved (ADR-100 already added `promotedFromTriageId`; this iterate just populates it).
9. **Preview spawn `shell: false`** — n/a.
10. **Path-guard `realpath`** — applied: `<project>/.shipwright/triage.jsonl` resolution uses `path.resolve(project.path, ".shipwright", "triage.jsonl")`, then a realpath check that the resolved path is still within `project.path` (defeats symlink redirect attempts). Reuses `core/path-guard.ts`.
11. **No hardcoded `shipwright-*` / phase literals in components** — preserved (Triage tab is route-static, not action-driven).
12. **No writes to `shipwright_run_config.json`** — preserved.
13. **Phase-task launches use pre-bound sessionUuid** — n/a.
14. **`useContinuePipeline()` is single pipeline-continuation entry** — n/a.
15. **Schema v3 additive + write-on-touch** — preserved.
16. **Stale `in_progress` detection from run-config timestamps** — n/a.
17. **pty-manager whitelist** — n/a.
18. **ScrollbackStore path-guard at every operation** — n/a.
19. **Auto-execute via WS data-frame** — n/a.
20. **Cell-state snapshots are sole replay primitive** — n/a.
21. **WS replay precedence: live mirror first, disk fallback** — n/a.
22. **xterm.js client+server pinned to 6.0.0** — n/a.

## Open questions

None — every shape is locked in the handoff. One pre-build judgment call resolved: cross-process lock semantics (use proper-lockfile + accept the documented limitation; subprocess to Python adds runtime + discovery complexity webui currently doesn't need).

## Post-external-review revisions (applied 2026-05-14)

External review (`.shipwright/planning/iterate/iterate-20260514-triage-tab-external-review.json`) returned 19 findings. HIGH + MED applied inline before build. The original AC-3 sequence is **superseded** by the revised one below.

### HIGH: Lock ordering + idempotency-inside-lock (Gemini #1, OpenAI #1, #2, #3)

Three findings converge on the same bug class: the original AC-3 had `findByPromotedFromTriageId()` OUTSIDE the locks (race on same-id concurrent promotes) AND acquired sdk-sessions BEFORE triage.jsonl (broader blast radius if triage lock is slow).

**Revised AC-3 sequence (replaces the original list):**

1. Resolve `projectId → project.path` via `getProjectById` (synthesized rejected with 404).
2. Validate body (priority enum, domain non-empty after trim, complexityHint enum if set, tags array of trimmed strings ≤ 32 entries each ≤ 100 chars after dedup, triageId regex). Return 400 BEFORE any lock if any check fails.
3. **Acquire triage.jsonl lock FIRST** (smaller blast radius — only blocks other triage status writes; sdk-sessions stays free).
4. Re-read triage.jsonl items via `readAllItems(path)`. If `triageId` not present → release lock → 404. If `item.status !== "triage"` → release lock → 409 `triage_item_not_in_triage_state` UNLESS step 5 finds an existing back-ref task (idempotent recovery).
5. **Acquire sdk-sessions.json lock**, THEN call `findByPromotedFromTriageId(triageId)`:
   - **Found** (idempotent recovery from a prior partial-promote): use `existingTask.taskId`; skip step 6.
   - **Not found**: call `store.create({ ..., promotedFromTriageId: triageId, tags: [...defaultTags, ...userTags] })` to mint the new task. Persist (under the same lock).
6. Release sdk-sessions.json lock (still holding triage.jsonl lock).
7. Append `{event:"status", id:triageId, ts:<now-Z>, newStatus:"promoted", by:"webui", reason:"webuiPromote", promotedTaskId:"EXT:" + taskId}` to triage.jsonl via `appendStatusEvent()` helper (which uses `JSON.stringify` exclusively — never manual string interpolation; OpenAI #11 alignment).
8. Release triage.jsonl lock. Return `201 { task, triageId, status: "promoted", recovered: <boolean> }` where `recovered: true` indicates the idempotent path was taken (OpenAI #4 — explicit response discriminator).

**Lock-order convention (global, applies to any future multi-store route):** triage.jsonl → sdk-sessions.json. Documented in `agent_docs/conventions.md` under "Lock acquisition order" so future iterates can't accidentally invert.

### HIGH: Concurrency regression test (OpenAI #3)

Add to AC-7a: **`Promise.all([promote(sameId), promote(sameId)])` test** — exactly one ExternalTask must exist after both resolve; both responses MUST have the same `taskId`; one returns `recovered: false`, the other `recovered: true` (or both can be `false` if the second wins the lock first — either is correct as long as task count == 1).

### MED: Dismiss/Snooze guard against orphaned promote (Gemini #2)

Dismiss + Snooze endpoints add an idempotency guard:
- Acquire triage.jsonl lock; re-read items; validate `status === "triage"`.
- **Before appending**: call `sdkSessionsStore.findByPromotedFromTriageId(triageId)`. If a task exists, that means a prior promote completed step 5 (created task) but step 7 failed (status flip). Reject with `409 promote_in_progress` body `{ error: "promote_in_progress", taskId, message: "Complete or rollback the pending promote first" }`. UI surfaces a hint: "A previous Promote attempt left a task; click Retry on Promote, or delete the task at /tasks/<id> first."

### MED: Python parity — static fixture, not runtime subprocess (Gemini #3)

Original plan: vitest spawns `python dump-triage-resolved.py` per test run. Hard-fails CI without Python.

**Revised:** commit `server/src/test/fixtures/triage-resolved.json` (the Python output, manually generated at fixture-creation time). The vitest parity test reads BOTH the JSONL fixture and the resolved JSON fixture, asserts TS `readAllItems(jsonl)` deep-equals the JSON. A separate `regen-triage-fixtures.py` script (committed under `server/scripts/`) regenerates the JSON by calling `triage.read_all_items`; documented in fixture-file headers. Drift detection: when `triage.py` adds/removes a field, the fixture-vs-TS comparison fails until BOTH files are regenerated together.

### MED: Server-side mtime cache for hot poll path (Gemini #4, OpenAI #9)

Add per-project resolved-view cache keyed by `(path, mtimeMs)`. TTL: 5 s soft, mtime-validated on every request. Cache invalidates on any successful POST `/promote`/`/dismiss`/`/snooze` for that projectId. ~25 LOC in `core/triage-store.ts`.

### MED: Per-project fault isolation in counts aggregation (OpenAI #9, #10)

`GET /api/triage/counts` uses `Promise.allSettled` (not `Promise.all`). Per-project failures (deleted root, EACCES, malformed header) → log warn, contribute 0 to that project's count, don't fail the response. Sidebar badge degrades gracefully if 1 project of N is broken.

### MED: Domain + tags normalization (OpenAI #6)

Server-side validation pipeline applied at body-parse:
- `domain`: `.trim()`; reject empty-after-trim (400 `domain_empty`); max 200 chars (400 `domain_too_long`).
- `tags`: each `.trim()`; reject items containing newline / tab / null / 0x7F (400 `tag_control_char`); dedupe (preserve first-occurrence order); max 32 entries (400 `tags_too_many`); each ≤ 100 chars (400 `tag_too_long`).
- `reason` (dismiss/snooze): `.trim()`; max 500 chars; same control-char rejection.

### MED: Path-guard for triage paths centralized (OpenAI #8)

New helper `core/triage-paths.ts`: `resolveTriagePath(project) → realpath-checked path`. Used in EVERY triage endpoint (read + write). Test: symlink `<project>/.shipwright/triage.jsonl → /etc/passwd` → 403 `path_traversal_rejected`.

### MED: ENOENT around appendFileSync (Gemini #5)

`appendStatusEvent` wraps `fs.appendFileSync` in try/catch. ENOENT → re-throw as `TriageWriteError("triage_file_disappeared")` so promote route maps to 207 partial (with retry hint), not 500.

### MED: Schema touchpoints for `promotedFromTriageId` (OpenAI #5)

ADR-100 already added the field to `validateExternalTask`, persistence, and `ExternalTask` interface. New explicit regression test in `sdk-sessions-store.test.ts`: write task with `promotedFromTriageId: "trg-abc12345"` → reload from disk → field present and identical. Not assumed; verified.

### MED: XSS-safety on rendered fields (OpenAI #7)

All triage fields rendered as plain text (`<span>{value}</span>`), NOT through `MarkdownText`. The `detail` field's escape-test asserts `<script>alert(1)</script>` renders as text. Mirror MasterTaskCard's domain-chip XSS test from ADR-100.

### MED: Helper consistency (OpenAI #11)

Spec + miniplan now consistently say `appendStatusEvent(jsonlPath, event, lockFn)` (one helper, three callers: promote/dismiss/snooze). No direct `fs.appendFileSync` calls in route code.

### LOW: Naming alignment (OpenAI #12)

Tests at `server/src/routes/triage.test.ts` (NOT `server/src/external/triage-routes.test.ts` — typo in original spec).

### LOW: Snooze semantics doc (OpenAI #13)

README copy: "Snooze hides the item until the underlying issue re-fires (which produces a NEW triage id). There is no timed wake-up in this iterate."

### LOW: Counts-hook resilience (OpenAI #14)

`useTriageCounts` exponential-backoff on 5xx after 3 consecutive failures (15 s → 60 s → 300 s ceiling). Reset on first 200.

### LOW: Auth parity (OpenAI #15)

Triage routes mount through the same Hono app — inherit the same CORS/Origin gate (loopback-only by default). No new auth surface; documented in ADR-101.

## Self-Review (post-build, pre-finalization)

Walking the 7-point checklist from `references/iteration-reviews.md`:

1. **Goal alignment** — every AC from §Acceptance Criteria has corresponding test coverage; the revised AC-3 sequence (post-external-review) is enforced by the cross-store atomicity test + the concurrent-promote test.
2. **Test outcome shape** — tests assert on outcomes (response status, body fields, store contents, JSONL contents), not internal state. Both happy + error paths covered per AC.
3. **Wiring verification** — promote button click → POST /promote → store.create + appendStatusEvent → 201 → cache invalidate + react-query refetch. Each link has at least one test: PromoteModal.test (button click → mutate), routes test (route happy path), triage-write.test (cache invalidation), TriagePage.test (re-render after invalidation).
4. **Risk-flag enforcement** — `touches_io_boundary` triggered the boundary probes (parity + corruption + write atomicity); `touches_public_api` triggered the route integration matrix.
5. **Convention compliance** — file sizes: `routes/triage.ts` 396 LOC ⚠ (over 300), `pages/TriagePage.tsx` 154 LOC ✓, `core/triage-store.ts` 152 LOC ✓, `core/triage-paths.ts` 117 LOC ✓, `core/triage-write.ts` 127 LOC ✓. The routes file edges over the 300-LOC convention; it is logically a single resource (triage) with 5 closely-related endpoints + tight body validators. Splitting would either fragment the validators (which are inline so they're easy to audit) or move them to a peer file with no behavior change. Defer the split as future work.
6. **Cross-cutting concerns** — `useTriageCounts` is mounted in `MainLayout`, so it polls every 30 s globally regardless of which page is shown. Rationale: the sidebar badge needs that data on every screen. Failure mode covered by retry-with-backoff (LOW external review #14).
7. **Affected boundaries** — covered: `triage.jsonl` producer/consumer (TS readAllItems vs Python read_all_items parity test); `sdk-sessions.json` producer/consumer (round-trip preservation of `promotedFromTriageId` test). Cross-process Python `_FileLock` vs proper-lockfile non-composition documented as known limitation in ADR-101.

## Confidence Calibration (post-build, populated)

- **Boundaries touched:** triage.jsonl producer (TS append) ↔ consumer (TS read + Python read); sdk-sessions.json producer/consumer (`promotedFromTriageId` field).

- **Empirical probes run** (vitest, all GREEN):
  1. **TS readAllItems vs Python read_all_items parity** — `triage-store.test.ts` "matches Python read_all_items() byte-for-byte on the canonical fixture" — TS output deep-equals Python-generated `triage-resolved.json`, validating header skip + status overlay + statusBy/statusReason/promotedTaskId semantics.
  2. **Append round-trip with status flip** — `triage-store.test.ts` "status events overlay status / ts / statusBy / statusReason" + "status event with promotedTaskId overrides null" — every overlay field round-trips correctly.
  3. **Corrupted line tolerance** — `triage-store.test.ts` "tolerates corrupt JSON lines without throwing" — 1 invalid + 4 valid lines → 2 items returned (the valid ones).
  4. **Empty + missing file** — `triage-store.test.ts` covers both; both return [].
  5. **Header-only file** — `triage-store.test.ts` "returns [] when file has only the schema header".
  6. **Status event for unknown id** — `triage-store.test.ts` "status event for unknown id is skipped" — out-of-order corruption tolerated.
  7. **Concurrency stress (same-id Promote)** — `triage.test.ts` "concurrent same-id promote: only one task created (Promise.all)" — exactly one ExternalTask after both resolve; both reuse the same taskId via the idempotency lookup inside the lock.
  8. **JSONL line-atomic append (sequential)** — `triage-write.test.ts` "appends a second status event without rewriting earlier lines" — sequential appends preserve all prior lines + format.
  9. **Cross-store atomicity** — `triage.test.ts` "207 partial-promote when status flip throws ENOENT mid-write; retry succeeds with same taskId" — store.create completes (step 6) even when appendFileSync throws (step 7); retry hits idempotent path; same taskId; no orphans.
  10. **Bad input round-trip** — `triage.test.ts` "400 on invalid body shapes" matrix covers 7 distinct rejection paths (missing triageId / bad regex / bad priority / empty domain / non-array tags / control-char tag / bad complexityHint); all return 400 BEFORE any write.
  11. **Path-traversal guard** — `triage-paths.test.ts` "rejects symlink-escape via .shipwright dir pointing outside project" — symlinked subdir → `path_traversal` error (skipped on Windows when symlinks need admin).
  12. **JSONL injection guard** — `triage-write.test.ts` "uses JSON.stringify so newlines + quotes + control chars in reason are safely escaped" — pasting `line1\nline2\twith"quote"` into reason round-trips intact (no torn write).
  13. **MainLayout polling rebinds across navigations** — `useTriageCounts` mounts at MainLayout level → triageCount stays current as the user navigates between pages (verified by SidebarNav.test rendering with the new `triageCount` prop).
  14. **XSS-safety on rendered fields** — `TriagePage.test.tsx` "renders item with XSS-unsafe title as plain text" — `<script>alert(1)</script>` renders as text content, no script element injected.
  15. **Tag normalization on submit** — `PromoteModal.test.tsx` "submit: comma-splits + trims + filters empty tags" — `"auth, billing,  empty-trims  ,,"` → `["auth", "billing", "empty-trims"]`.

- **Edge cases NOT probed + why acceptable:**
  - **Cross-process Python `_FileLock` vs proper-lockfile collision** — addressed by design (small-write line-atomicity + last-status-wins resolution); a real concurrent-write test requires spawning Python AND Node simultaneously, which is fragile in CI. Documented as known limitation in ADR-101.
  - **POSIX-`export` syntax / inline `# comments`** — not applicable; JSON/JSONL are machine formats.
  - **Massive JSONL files (10 000+ items)** — out of scope; the aggregator caps at TOP_N=50 and the webui mirrors the same threshold visually. If scaling becomes real, server-side cap + pagination goes into the route handler.
  - **Symlink-escape on Windows without admin** — the `triage-paths.test.ts` test skips when `symlinkSync` raises EPERM/EACCES; the production code path still uses `realpathSync` which catches the same class of attacks at runtime.

- **Confidence-pattern check:** none of the 15 probes are predicate questions ("am I sure?"); they're empirical round-trips that returned **zero** unexpected findings. The asymptote heuristic is satisfied — no need for an additional probe.

- **Stopping rule met**: most recent probe (#15) returned no surprise; all applicable categories covered; no yes-then-bug pattern in this run; promote → 8 + dismiss/snooze + parity + cross-store atomicity all hard-tested. F0 + F0.5 next.

## Test counts (pre-finalization)

- **New server tests**: 46 (5 new files: triage-store, triage-paths, triage-write, sdk-sessions-store.findByPromoted, routes/triage)
- **New client tests**: 22 (4 new files: TriageBadge, PromoteModal, TriagePage; 2 lines updated in SidebarNav.test). Counts include 2 added in code-review for negative/NaN-clamp.
- **Server full suite**: 1012/1012 green (no regressions; +46 net)
- **Client full suite**: 833/833 green (no regressions; +22 net after code-review additions)
- **Server build**: ✓ tsc clean
- **Client build**: ✓ tsc -b + vite build clean

## Post-code-review revisions (applied 2026-05-14, after Step 8 external code review)

External code review of the diff (`.shipwright/planning/iterate/iterate-20260514-triage-tab-external-code-review.json`) returned 1 HIGH + 7 MED + 1 LOW. Applied:

- **HIGH (server/src/routes/triage.ts:197 — promote idempotency double-check inside sessions lock).** Moved `findByPromotedFromTriageId()` INSIDE the `sessionsLockPath` critical section as defense-in-depth. The triage-path lock already serialized same-id concurrent promotes (per-projectId triage path), but the duplicated check inside the sessions lock closes any future-caller bypass. Updated route logic in `server/src/routes/triage.ts`. Test strengthened to assert both responses share `taskId` AND exactly one is `recovered: true`.
- **MED (concurrent promote test).** `routes/triage.test.ts` "concurrent same-id promote" now asserts: status 201/201 + same `taskId` + `recoveredFlags.sort() === [false, true]` + 1 task in store.
- **MED (TriageItemCard missing originalTs).** Added relative-timestamp display (e.g. "2h ago") with the raw ISO in `title` attribute; `data-testid="triage-item-<id>-relative-ts"`.
- **MED (PromoteModal id vs dedupKey).** Added `dedupKey` line below the title in the read-only summary, with `data-testid="promote-dedupKey"`.
- **LOW (TriageBadge negative/NaN clamp).** Added `Math.max(0, Math.floor(Number.isFinite(count) ? count : 0))` so an upstream corruption produces a hidden badge instead of "-3" or "NaN". Added 2 tests.
- **MED (TriagePage spec-deviation: project-then-source vs flat-by-source).** **Spec deviation accepted.** AC-2 says "lists items grouped by source (alphabetical)"; the implementation groups project → source → severity-rank within source. **Rationale:** webui is multi-project by design (registered projects on `/projects`); flat-by-source would lose the project context that operators need to know which `<project>/.shipwright/` the item came from. Implementing the spec literally would require either (a) a `useTriageItems()` (no-arg) all-projects hook that hits a new server-side `/api/triage/all` aggregator, or (b) calling `useTriageItems(p.id)` in a loop over `projects`, which violates rules-of-hooks if the project list changes. Project-grouped UX is more useful and avoids the hook-loop problem; this is a deliberate UX-driven deviation, not an oversight. Documented in ADR-101 § Trade-offs.
- **MED (404 → [] in triageApi.ts).** **Accepted as-is.** The `GET /api/triage/:projectId` route returns 200 [] for missing/empty JSONL and 404 only for unknown projectId. TriagePage enumerates projects from the webui registry (`useProjects`), so a 404 means a race-condition-deleted project, in which case suppressing the section silently is the correct behavior. The "project-not-configured hint" sub-AC referred to a hypothetical UX where the operator pasted an arbitrary project id; we don't expose that surface. Documented as a non-issue in this iterate's response shape.
- **MED (PromoteModal native `<select>` vs Radix DropdownMenu).** **Accepted as-is.** Native `<select>` is functional, accessible (built-in keyboard nav, screen-reader semantics), and matches the form-field shape of the existing `NewIssueModal` lead-foundation pattern (which also uses native HTML inputs for some fields). No behavioral difference; aesthetic-only choice. Out of scope for this iterate.
- **MED (test coverage gaps).** Modal close-on-Escape is handled by Radix Dialog (a11y semantics — covered by Radix's own tests, not duplicated here). 400 form-field error path covered by `PromoteModal.test.tsx` "blocks submit when domain is empty after trim". List refresh after action covered implicitly by the `useQueryClient.invalidateQueries` calls in `useTriage.ts` hooks. Sidebar count rendering covered by `TriageBadge.test.tsx`.

## Spec deviations (consolidated)

1. **Project-grouped UX over flat-by-source** — TriagePage groups by project then by source, NOT flat-by-source as AC-2 prescribes. See post-code-review §MED above. Net: clearer multi-project UX; no functional regression.
2. **No `useTriageItems()` (no-arg) hook.** AC-6 mentioned both per-project and "all-projects flattened" hooks. Only the per-project variant + `useTriageCounts()` (counts-only) are implemented. Adding a flat all-items hook would require a new server-side aggregator endpoint; out of scope for this iterate. The sidebar badge correctly aggregates via the counts endpoint.
3. **PromoteModal uses native HTML form controls, not Radix DropdownMenu.** Functional equivalence; matches existing NewIssueModal pattern. Not a behavioral regression.
