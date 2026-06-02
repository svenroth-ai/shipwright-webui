# Mini-Plan: campaigns-board-lane

- **Run ID:** iterate-2026-06-02-campaigns-board-lane
- **Complexity:** medium · **Type:** feature
- **Risk flags:** `touches_public_api` (new route → mandatory review). De-facto
  producer/consumer boundary (status.json + campaign.md) → fixture parity tests.

## Files to create / modify

### Server (new)
1. `server/src/core/campaign-paths.ts` *(new)* — `resolveCampaignsDir(project)`:
   realpath project root + traversal guard (mirror of `triage-paths.ts`), resolves
   `<root>/.shipwright/planning/iterate/campaigns`. Returns
   `{ok, absolute, projectRoot, existed}` | `{ok:false, error}`.
2. `server/src/core/campaign-store.ts` *(new)* — `readCampaigns(campaignsDir, projectRoot): Campaign[]`.
   Pure FS read. Lists immediate subdirs; per campaign parses `campaign.md`
   (frontmatter, `## Intent`, `## Sub-Iterates` table) + optional `status.json`;
   merges (status.json authoritative for status/commit/branch, table for
   order/title); derives relative `specPath`, `nextPending`, `done`/`total`.
   Sorted by slug desc. Exports `Campaign` / `CampaignStep` types + pure helpers
   (`parseFrontmatter`, `parseIntent`, `parseSubIteratesTable`, `mergeCampaign`)
   for unit test. NO cache (small files, single active project at 3 s — YAGNI).
3. `server/src/routes/campaigns.ts` *(new)* — `createCampaignsRoutes(deps)`:
   `GET /api/campaigns/:projectId`. 404 unknown/synthesized, 403 traversal, 200
   `{campaigns}` else. Mirror of the `triage.ts` GET handler. ~60 LOC.

### Server (modify)
4. `server/src/index.ts` — import + `app.route("/", createCampaignsRoutes({getProjectById}))`
   next to the triage mount (~line 581). One injected dep (`getProjectById`).

### Client (new)
5. `client/src/lib/campaignsApi.ts` *(new)* — `CAMPAIGNS_API`, `Campaign` /
   `CampaignStep` types, `listCampaigns(projectId)` (404→[]), and a pure
   `selectActiveCampaigns(list)` = `list.filter(c => c.done < c.total)` helper.
   Mirror of `triageApi.ts` (raw `fetch`, no `apiFetch`).
6. `client/src/hooks/useCampaigns.ts` *(new)* — `useCampaigns(projectId, opts)`
   `useQuery`, `POLL_MS = 3_000`, key `["campaigns", projectId]`. Mirror of
   `useTriageItems`.
7. `client/src/components/external/CampaignLaneCard.tsx` *(new)* — presentational
   `{campaign}` card: slug, intent, `done/total` bar, ordered steps (✓/▶/○),
   optional `expandsTriage` `<Link to="/triage">`, Copy-launch(Bx) button →
   `copyText('/shipwright-iterate "<specPath>"')` with transient "Copied" state,
   disabled when no launchable nextPending.

### Client (modify)
8. `client/src/pages/TaskBoardPage.tsx` — `useCampaigns(resolvedProjectId)` +
   `selectActiveCampaigns`; render the `task-board-campaigns-lane` block (label
   "Campaigns" + `CampaignLaneCard` per active campaign) right after the
   Pipelines lane, before the board body.

### Docs (modify — F2, regression guard #11 doc-sync)
9. `.shipwright/agent_docs/architecture.md` — new route + core modules + write/read
   surface note (read-only consumer of the campaigns tree).
10. `.shipwright/agent_docs/component_inventory.md` — `CampaignLaneCard`.

### Tests (new)
- `server/src/core/campaign-store.test.ts` — AC-2 matrix + producer-format
  fixtures + malformed/missing/sort/nextPending/specPath cases.
- `server/src/core/campaign-paths.test.ts` — traversal (symlink), missing dir,
  non-dir root, synthesized.
- `server/src/routes/campaigns.test.ts` — 404 / 200-shape / (403 noted).
- `client/src/lib/campaignsApi.test.ts` — 404→[], 200 parse, error throw,
  `selectActiveCampaigns`.
- `client/src/components/external/CampaignLaneCard.test.tsx` — AC-4/5/7 render +
  copy + disabled + link.
- `client/src/test/campaigns-no-triage-coupling.test.ts` — AC-8 import-boundary.
- `client/e2e/flows/campaigns-board-lane.spec.ts` — F0.5 web surface.

## Work breakdown (sequential, TDD per step)

1. **campaign-paths** — RED test (traversal/missing/non-dir) → implement.
2. **campaign-store** — RED tests (AC-2 matrix, fixtures, helpers) → implement
   parser + merge. This is the boundary probe.
3. **campaigns route** — RED test (404/200) → implement + mount in index.ts.
4. **campaignsApi + useCampaigns** — RED test (404→[], parse, selectActive) → implement.
5. **CampaignLaneCard** — RED test (render/copy/disabled/link) → implement.
6. **TaskBoardPage wiring** — add lane; AC-3 verified at component+E2E level.
7. **no-triage-coupling** test (AC-8).
8. **Docs** (architecture.md, component_inventory.md) — satisfy doc-sync.
9. **E2E** author + execute (F0.5).

## Test strategy

- Server: real temp dirs (`mkdtempSync`) seeded with producer-format files;
  pure-helper unit tests for the parser; route test with injected `getProjectById`.
- Client: `vi.mock` the api + `lib/clipboard`; RTL render; `vitest`.
- Boundary: fixtures byte-mirror `campaign_init.py` output (cite it in the test).
- E2E: isolated stack (temp USERPROFILE, local network profile, 127.0.0.1) with a
  seeded fixture project + campaign dir; assert lane + progress + copy button.

## External review — integrated findings (openrouter: openai + gemini)

Marker: `iterate-2026-06-02-campaigns-board-lane-review-state.json` (status completed).

**HIGH — must implement:**
- (openai #6) **Per-step `specPath` containment guard.** Realpath each
  `sub-iterates/<id>-<slug>.md` candidate and confirm it stays under the real
  project root before returning a `specPath`; symlink-escape → `null`. Tests:
  symlinked spec file → null.
- (gemini #2 / openai #2) **Torn-read + per-campaign failure isolation.** The 3 s
  poll will eventually read a half-written `status.json`/`campaign.md`. Each
  campaign dir is parsed under its own try/catch: a parse failure on `status.json`
  falls back to the `campaign.md` table; a dir with nothing parseable is skipped
  (warn-logged). One bad campaign never hides the others / never 500s the route.
  Tests: malformed campaign + valid campaign → valid still returned; invalid
  `status.json` + valid table → table-derived.

**MEDIUM — implement:**
- (openai #1) Missing/empty campaigns dir → `200 {campaigns: []}`; 404 reserved
  for unknown/synthesized ids; 403 for traversal. (readCampaigns returns `[]` for a
  non-existent dir; route never 404s on `existed:false`.)
- (openai #5 / gemini #3) `specPath` POSIX-normalized (`/`) on Windows AND
  rejected → `null` if it contains `"`, control chars, or newline (no malformed
  shell command from the copy button). Tests: Windows backslash → `/`; quote in
  name → null.
- (openai #3) `nextPending` = first step status ≠ `complete` — intentional for
  sequential/stacked campaigns (the step the campaign is blocked on, incl. a
  `failed`/`escalated` step that needs a re-run). Pinned by explicit
  failed/escalated tests + code comment. Per-step status text shown so non-pending
  states are legible.
- (openai #11 / gemini #5) `total === 0` → progress bar guarded (no divide-by-zero),
  `done < total` hides it client-side; a subdir with neither `campaign.md` nor
  `status.json` is skipped server-side (no 0-step ghost campaign).
- (openai #9) Sort slug-desc documented as a date-prefix assumption; mixed-format
  slug fixture test.

**Noted / rejected (documented in ADR):**
- (gemini #1 / openai #8) Server-side completed-filter / shallow-read optimization:
  AC-1 mandates returning ALL campaigns and counts are tiny (a handful of small
  files) — full list kept; Phase-2 optimization if it ever matters.
- (gemini #4) Initial-fetch lane pop-in: identical to the existing Pipelines lane
  (also appears after its query resolves) — no skeleton (YAGNI). "No layout shift"
  in AC-3 = the empty-data steady state, not the first-paint pop-in.
- (openai #10) Triage deep-link: use `/triage?...` if the page already supports it,
  else a plain `/triage` MVP link (the umbrella item lives there).
- (openai #12) Raw `fetch` (mirroring `triageApi.ts`) is the correct precedent for
  a sibling `/api/*` endpoint; loopback-only, no auth headers.

## Alternative approach (considered, rejected)

**Reuse the Continue-Pipeline auto-inject launch path** (`useContinuePipeline` →
`createTask` + `launchTask` + `dispatchAutoLaunch`) so the ▶ button drops the
command straight into an embedded terminal.

*Rejected because:* that path is structurally bound to run-config `phase_tasks`
(pre-bound `sessionUuid`, `phaseTaskRef`, `awaiting_launch` gating, prerequisite
checks). Campaigns are NOT phase_tasks — they have no run-config entry and no
pre-bound session. Adapting it would mean minting synthetic tasks + a new launch
branch + sdk-sessions writes, which violates the "read + launch only / no UI
writes" scope and re-platforms a load-bearing path (regression guards #13/#14).
The `LaunchCoordinator` is also TaskDetail-scoped; the board has no terminal pane
to inject into. The proposal explicitly sanctions the **copy-command MVP** as the
non-dead-button fallback — it reuses `lib/clipboard.copyText`, ships zero new
write surface, and keeps Architecture rule 1 (WebUI never spawns Claude) intact.
Recorded in the iterate ADR.
