# Iterate Spec: campaigns-board-lane

- **Run ID:** iterate-2026-06-02-campaigns-board-lane
- **Type:** feature
- **Complexity:** medium (Repo-Scout upgrade from the classifier's "small" — 7 new
  files across both workspaces, new public API, new producer→consumer parsing
  boundary with a resilience requirement)
- **Status:** draft

## Goal

Surface active Shipwright **campaigns** (`<project>/.shipwright/planning/iterate/campaigns/{slug}/`)
as a read-only **Campaigns lane** above the kanban on `TaskBoardPage`, mirroring
the existing Pipelines lane. Each lane card shows the campaign slug, intent, a
`done/total` progress bar, the ordered sub-iterate steps with per-step status
icons, and a **Copy launch (Bx)** affordance that copies
`/shipwright-iterate "<nextPending.specPath>"` to the clipboard. Read + launch
only — the WebUI never writes campaign state.

## Acceptance Criteria

Assertion-shaped so the F0.5 runner can drive them mechanically.

- [ ] **AC-1 (endpoint).** `GET /api/campaigns/:projectId` for a registered
      project with a campaigns dir returns `200 {campaigns: Campaign[]}` matching
      the Data Contract below, using `ProjectManager` path resolution + a
      realpath traversal guard. A registered project with **no** campaigns dir
      (or an empty one) → `200 {campaigns: []}` (NOT 404). Unknown / synthesized
      project id → `404` `{error:"project_not_found"}`; the client maps 404 → `[]`
      (empty list, no crash). Path-traversal (symlinked campaigns dir escaping the
      root) → `403` `{error:"path_traversal_rejected"}`. A single malformed /
      half-written campaign dir is skipped (logged) and MUST NOT fail the whole
      response.
- [ ] **AC-2 (status.json optional).** For a campaign dir whose `campaign.md`
      table row says `Status=pending` but whose `status.json` says
      `status=complete`, the returned step status is `complete` (status.json
      authoritative). For a campaign dir with NO `status.json`, the step status
      equals the `campaign.md` table's `Status` column. Both campaigns appear in
      the response. (Regression-fixtured against the exact `campaign_init.py` /
      `campaign_progress.py` output formats.)
- [ ] **AC-3 (lane visibility).** With ≥1 campaign where `done < total`, the
      `[data-testid="task-board-campaigns-lane"]` element is present on
      `TaskBoardPage`. When every campaign has `done === total` (or the dir is
      empty/missing), the element is absent (no empty wrapper → no layout shift).
- [ ] **AC-4 (progress).** Each card renders the `slug`, the one-line `intent`,
      a `done/total` label + progress bar, and the ordered steps; the first
      non-`complete` step shows the ▶ (next-pending) icon, `complete` steps show
      ✓, all other non-complete steps show ○.
- [ ] **AC-5 (copy launch).** The **Copy launch (Bx)** button for the
      `nextPending` step copies the exact string `/shipwright-iterate
      "<nextPending.specPath>"` via `lib/clipboard.copyText`. When `nextPending`
      is null (all complete) or `nextPending.specPath` is null (spec file
      missing), the button is disabled — never a dead button. (MVP: copy-command,
      not auto-inject — the board has no embedded-terminal pane; the
      LaunchCoordinator is TaskDetail-scoped. See ADR & alternative in mini-plan.)
- [ ] **AC-6 (poll).** `useCampaigns` is configured with a 3 000 ms
      `refetchInterval` (matches `useTriage` family), so a `status.json` flip is
      reflected without a page reload. (`POLL_MS === 3000`; live reflection
      verified at F0.5.)
- [ ] **AC-7 (cross-link).** When the campaign's `campaign.md` frontmatter
      carries `expandsTriage: <trg-id>`, the card renders a link to `/triage`
      labelled with that id; absent → no link.
- [ ] **AC-8 (no Triage coupling).** Nothing campaign-related is imported into
      the Triage page/store/hook. Verified by an import-boundary test that greps
      the triage surface for `campaign` references.

## Spec Impact

- **Classification:** add
- **ADD** (new FR appended): `FR-01.33 — Campaigns lane (read + launch)` —
  (FR-01.31 / FR-01.32 already taken by network-profile + move-to-backlog) —
  the WebUI reads campaign progress from the project's
  `.shipwright/planning/iterate/campaigns/` tree and surfaces it as a board lane
  with a copy-launch affordance. New `GET /api/campaigns/:projectId` endpoint.
- **MODIFY:** none
- **REMOVE:** none
- **NONE justification:** n/a (this is an ADD)

## Out of Scope

- Writing / mutating campaign state from the WebUI (init/advance stay owned by
  `campaign_init.py` / `campaign_progress.py`). The lane is **read + launch** only.
- A dedicated all-projects / archived-campaigns tab (possible Phase 2).
- Autonomous campaign execution from the UI.
- Auto-injecting the launch command into an embedded terminal from the board
  (no terminal pane exists there; copy-command is the shipped affordance).

## Design Notes

Visual parity with the Pipelines lane: full-bleed `.page-container` block above
the kanban, `11px` uppercase muted "Campaigns" label, white surface cards
(`--color-surface` / `--color-border` / `--radius-card`). Progress bar uses
`--color-primary`. Step icons: ✓ / ▶ / ○. No new design tokens.

## Affected Boundaries

The campaign on-disk format is a producer→consumer boundary: the Python
producers write it, this TS reader consumes it. Drift = silent mis-render. Guarded
by fixtures that byte-mirror the producer templates (the triage-resolved.json
precedent).

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `campaign_init.py init_campaign` | `core/campaign-store.ts parseCampaignMd` | Markdown frontmatter + `## Intent` + `## Sub-Iterates` table |
| `campaign_init.py` / `campaign_progress.py cmd_update_status` | `core/campaign-store.ts readStatusJson` | `status.json` (`{campaign, branch_strategy, created_at, sub_iterates:[{id,slug,spec_path,status,commit,branch,tests_passed,tests_total}]}`) |

## Confidence Calibration

- **Boundaries touched:** `campaign.md` (frontmatter + `## Intent` + `## Sub-Iterates`
  table) and `status.json`, both produced by `campaign_init.py` /
  `campaign_progress.py`.
- **Empirical probes run (all PASSED):**
  1. Parser fed the **verbatim `campaign_init.py` template** (frontmatter +
     `## Intent` + table) → `campaign-parse.test.ts` asserts campaign/branch_strategy/
     created keys, intent string, and both table rows incl. status column.
  2. No-`status.json` hand-authored campaign → `campaign-store` test derives
     step status from the table column; commit/branch null.
  3. status.json-wins probe: table `pending` + status.json `complete` → step is
     `complete`; `in_progress` also wins over `pending`.
  4. **Torn-read probe:** valid table + half-written `status.json` → falls back
     to the table, no throw, campaign still returned (the 3 s-poll race).
  5. **Isolation probe:** one neither-md-nor-status dir + one valid → only the
     valid campaign returned.
  6. **specPath probe:** file present → exact project-root-relative POSIX path
     (`.shipwright/planning/iterate/campaigns/<slug>/sub-iterates/<id>-<slug>.md`);
     file absent → null; verified through both the store test and the HTTP route
     test (survives the API serialization boundary).
  7. **Containment primitive:** `isWithin` unit-tested directly (root / descendant
     / escape); the dir-level symlink-escape → `path_traversal` is driven by a
     junction in `campaign-paths.test.ts` (auto-skips on non-admin Windows, runs
     on Linux CI).
- **Test Completeness Ledger** (testable ⇒ tested; 0 untested-testable):

  | # | Testable behavior | Disposition | Evidence |
  |---|---|---|---|
  | 1 | AC-1 endpoint: 404 unknown/synth, 403 traversal, 200 shape, 200 `[]` for no-dir | tested | `routes/campaigns.test.ts` (4 cases) PASSED |
  | 2 | AC-2 status.json authoritative / absent→table / wins | tested | `campaign-store.test.ts` AC-2a/b/c PASSED |
  | 3 | AC-3 lane shows iff `done<total`; hidden when all-complete/empty | tested | `campaignsApi.test.ts selectActiveCampaigns` + `CampaignLaneCard.test.tsx` PASSED |
  | 4 | AC-4 slug/intent/done-total/ordered steps/next-pending icon | tested | `CampaignLaneCard.test.tsx` (render + next-pending) PASSED |
  | 5 | AC-5 copies `/shipwright-iterate "<specPath>"`; disabled when no launchable step | tested | `CampaignLaneCard.test.tsx` (copy + 2 disabled) PASSED |
  | 6 | AC-6 3 s poll contract | tested | `useCampaigns.test.tsx` (`POLL_MS===3000` + fetch + disabled) PASSED; live flip → E2E (F0.5) |
  | 7 | AC-7 triage cross-link iff `expandsTriage` set | tested | `CampaignLaneCard.test.tsx` PASSED |
  | 8 | AC-8 no triage→campaign import coupling | tested | `campaigns-no-triage-coupling.test.ts` PASSED |
  | 9 | Producer-format parse (frontmatter/intent/table, alignment colons) | tested | `campaign-parse.test.ts` (9 cases) PASSED |
  | 10 | Torn `status.json` / malformed-campaign isolation | tested | `campaign-store.test.ts` (2 cases) PASSED |
  | 11 | specPath relative+POSIX / null-when-missing / symlink-containment | tested | `campaign-store.test.ts` + `campaign-paths.test.ts` (`isWithin` + junction) PASSED |
  | 12 | Sort slug-desc; status.json-only campaign; nextPending null when all complete | tested | `campaign-store.test.ts` (3 cases) PASSED |
  | 13 | AC-3 + AC-6 end-to-end against a live stack (lane renders, progress, copy button) | tested | E2E `campaigns-board-lane.spec.ts` (executed at F0.5) |

- **Confidence-pattern check:** asymptote — after the first green pass I added the
  torn-read + isolation + symlink-containment probes rather than declaring "looks
  right"; the per-step specPath quote/control-char rejection bug (the `[ -]`
  regex that nulled every hyphenated path) was caught by re-reading, not by
  trusting the green typecheck. Coverage — all 13 rows `tested`; 0
  untested-testable; the only Windows-skipping branch (FS junction) is backed by
  the cross-platform `isWithin` unit test.

## Verification (medium+)

- **Surface:** web (new lane on `TaskBoardPage`; backend route consumed by the UI).
- **Runner command:** Playwright spec `client/e2e/flows/campaigns-board-lane.spec.ts`
  executed via `shared/scripts/surface_verification.py --surface web` against an
  isolated stack (temp `USERPROFILE`, `SHIPWRIGHT_NETWORK_PROFILE=local`,
  `127.0.0.1`-pinned), seeded with a fixture project that has a campaigns dir.
- **Evidence path:** `.shipwright/planning/iterate/iterate-2026-06-02-campaigns-board-lane-f05/`

## Data Contract (response shape)

```jsonc
{
  "campaigns": [{
    "slug": "2026-06-02-hook-consolidation",
    "intent": "Collapse hook fan-out → phase-aware dispatchers",
    "branchStrategy": "stacked",       // from frontmatter/status.json, or null
    "expandsTriage": "trg-721b1765",   // from frontmatter, or null
    "steps": [
      { "id": "B0", "slug": "phase-resolver-contract",
        "title": "Fail-open phase resolver",
        "status": "complete",          // pending|in_progress|complete|failed|escalated
        "specPath": ".shipwright/planning/iterate/campaigns/<slug>/sub-iterates/B0-phase-resolver-contract.md",
        "commit": "abc123", "branch": "iterate/..." }
    ],
    "done": 1, "total": 7,
    "nextPending": { "id": "B1", "specPath": ".shipwright/.../B1-....md" }
  }]
}
```

- `specPath` is **project-root-relative**, forward-slash, only present when the
  `sub-iterates/<id>-<slug>.md` file exists on disk (else `null`).
- `nextPending` = first step whose status ≠ `complete` (null when all complete).
- Campaigns sorted by `slug` descending (date-prefixed slugs → newest first).
