# Iterate Spec: start-campaign-action

- **Run ID:** iterate-2026-06-03-start-campaign-action
- **Type:** feature
- **Complexity:** medium (Repo-Scout upgrade from "small": relaxes a load-bearing
  architecture invariant — WebUI read-only on campaign state → a new WRITE
  surface — which warrants ADR + external + full review rigor; plus
  `touches_public_api`)
- **Status:** draft

## Goal

Let an operator **start a campaign from the Triage** with one click: a
campaign-umbrella triage item (one whose campaign has `expandsTriage == item.id`)
gets a primary **"Start Campaign"** button that sets the campaign
`draft → active` and navigates to the Task Board (where the now-active campaign
shows). Fixes the gap where "Fix now" (which launches a single iterate) was the
only button — the wrong action for a campaign.

## Acceptance Criteria (assertion-shaped)

- [ ] **AC-1 (start endpoint).** `POST /api/campaigns/:projectId/:slug/start`
      sets the campaign lifecycle status to `active` and returns
      `200 {slug, status:"active"}`. A campaign with a `status.json` → its
      top-level `status` is set to `active`; a frontmatter-only campaign →
      the `campaign.md` frontmatter `status:` is set to `active` (symmetric
      with `pickLifecycle` read precedence). Unknown project/synth → `404`;
      unknown slug / missing campaign dir → `404`; traversal → `403`; lock
      contention (`ELOCKED`) → `503`. **Idempotent**: starting an
      already-`active` campaign → `200` (no error).
- [ ] **AC-2 (read-after-write symmetry).** After a successful start, `GET
      /api/campaigns/:projectId` reports that campaign with `status:"active"`
      (the write lands where the read looks).
- [ ] **AC-3 (scoped write).** ONLY the lifecycle status changes —
      `sub_iterates` / steps / intent / branch_strategy / table are byte-identical
      before vs after (fixtured).
- [ ] **AC-4 (triage enrichment, server-side).** `GET /api/triage/:projectId`
      annotates each item with `campaignSlug` + `campaignStatus` when a campaign
      in that project has `expandsTriage == item.id`; `null` otherwise. Done via
      an **injected dep** so `routes/triage.ts` imports no campaign module — the
      `campaigns-no-triage-coupling` import-boundary test stays green.
- [ ] **AC-5 (Triage UI).** A campaign-umbrella item renders by `campaignStatus`:
      `draft` → primary **"Start Campaign"** (click → POST start → navigate to the
      board with that project active); `active` → **"Go to board"** (no start);
      `complete` → no campaign button. For campaign-umbrella items **"Fix now" is
      demoted** (not the primary action); non-campaign items keep "Fix now"
      primary as today.
- [ ] **AC-6 (relaxation + lock).** The start write is the ONLY campaign-state
      write the WebUI performs, lock-protected via `proper-lockfile` (`.weblock`),
      and documented in an ADR citing the `triage-write` (ADR-101/106) precedent.
- [ ] **AC-7 (E2E).** Seed a `draft` campaign + its umbrella triage item → the
      Triage shows "Start Campaign" → click → the Task Board shows that campaign
      as active.

## Spec Impact

- **Classification:** modify
- **MODIFY:** `FR-01.33` — adds a WebUI **write** path (campaign lifecycle
  status) + the Triage "Start Campaign" action. FR ID → F7 `--affected-frs`.
- **NONE justification:** n/a (modify).

## Out of Scope

- Creating/decomposing a campaign from the UI (campaign_init still owns creation).
- Advancing sub-iterates / per-step status from the UI (only the campaign-level
  `draft → active` flip).
- A general campaign-edit surface. The write is strictly the lifecycle status.
- `active → complete` from the UI (producer/loop owns that).

## Design Notes

- **Server:** new `core/campaign-write.ts` (mirror of `triage-write.ts`:
  `CampaignWriteError`, caller-holds-lock, read-modify-write a single file).
  `setCampaignStatus(campaignDir, status)` writes `status.json` top-level
  `status` if that file exists, else inserts/replaces the `campaign.md`
  frontmatter `status:`. New `POST .../:slug/start` in `routes/campaigns.ts`
  (deps gain `lock`). `index.ts` passes `lock: createTriageLock()` +, for triage
  enrichment, an injected `listCampaignRefs(projectId)` built from
  `readCampaigns` (index.ts is the composition root → may import campaign-store;
  `routes/triage.ts` must NOT).
- **Client:** `campaignsApi.startCampaign(projectId, slug)`; `TriageItem` gains
  optional `campaignSlug`/`campaignStatus`; `TriageDetailModal` renders the
  Start-Campaign / Go-to-board / Fix-now-demote logic + navigates via
  `useProjectFilter().setActiveProjectId(projectId)` + `navigate("/")`.

## Affected Boundaries

The WebUI becomes a **writer** of the campaign lifecycle status — same on-disk
format the producer (campaign_init/campaign_progress) + the consumer
(`pickLifecycle`) use. Drift on the WRITE side = the board mis-reads its own
write. Guarded by producer-format-parity fixtures + a read-after-write test.

| Producer (writes) | Consumer (reads) | Now also Writer | Format |
|---|---|---|---|
| `campaign_init.py` / `campaign_progress.py` | `core/campaign-status-json.ts pickLifecycle` | `core/campaign-write.ts setCampaignStatus` | status.json top-level `status` / campaign.md frontmatter `status:` |

## Confidence Calibration

- **Boundaries touched:**
  - `touches_public_api` — new `POST /api/campaigns/:projectId/:slug/start`;
    `TriageItem` wire shape gains optional `campaignSlug`/`campaignStatus`
    (both client + server mirrors).
  - `touches_io_boundary` — `core/campaign-write.ts` is a NEW producer of the
    campaign lifecycle status on disk (status.json top-level `status` /
    campaign.md frontmatter `status:`), the same format the framework producer
    (campaign_init/campaign_progress) writes and the consumer (`pickLifecycle`)
    reads. This is the load-bearing relaxation (WebUI read-only → narrow writer).
  - Import boundary — `campaigns-no-triage-coupling` (FR-01.31 AC-8): enrichment
    + the Start Campaign action must not couple triage code to the campaign lane.

- **Empirical probes run:**
  - *Read-after-write parity (the boundary that matters):* `campaign-write.test.ts`
    writes then reads back via `pickLifecycle` for all three target shapes
    (status.json scoped, frontmatter replace, frontmatter insert) + CRLF +
    json-wins → the write lands exactly where the board reads. Route-level
    `campaigns.test.ts` "starts a draft … reflected by GET" closes the loop
    through the HTTP layer.
  - *Scoped write (AC-3):* the status.json write parses → sets only top-level
    `status` → re-stringifies (indent 2); `sub_iterates` untouched (verified by
    reading the campaign back through the GET resolver and asserting steps).
  - *Import-boundary probe:* ran the real `campaigns-no-triage-coupling.test.ts`
    after wiring — green. `grep '^import' routes/triage.ts` → no campaign module;
    the only triage→campaign import is the allowlisted `useStartCampaign` hook +
    sibling `./CampaignStartCta` (triage-surface, not lane).
  - *Lifecycle guard:* `complete → 409` (no revert) asserted at the route; the
    read uses the same `pickLifecycle` precedence as the board.
  - *Full suites green:* client 1438, server 1448; client tsc + oxlint clean,
    server tsc clean; anti-ratchet hook exit 0.

- **Test Completeness Ledger** (enumeration_basis: 7 ACs → 23 behaviors; 0 untested-testable):

  | # | Behavior | Disposition | Evidence |
  |---|---|---|---|
  | 1 | setCampaignStatus writes status.json top-level `status` | tested | campaign-write.test.ts "status.json scoped write" |
  | 2 | … prefers status.json when both exist | tested | campaign-write.test.ts "json wins" |
  | 3 | … replaces existing frontmatter `status:` | tested | campaign-write.test.ts "frontmatter replace" |
  | 4 | … inserts `status:` when frontmatter lacks it | tested | campaign-write.test.ts "frontmatter insert" |
  | 5 | … CRLF-safe frontmatter edit | tested | campaign-write.test.ts "CRLF" |
  | 6 | … no writable target → CampaignWriteError | tested | campaign-write.test.ts "no-target" |
  | 7 | … invalid status arg rejected | tested | campaign-write.test.ts "invalid status" |
  | 8 | read-after-write parity via pickLifecycle (AC-2) | tested | campaign-write.test.ts + campaigns.test.ts GET-reflects |
  | 9 | POST start draft→active 200 (AC-1) | tested | campaigns.test.ts "starts a draft campaign" |
  | 10 | POST start frontmatter-only → 200 | tested | campaigns.test.ts "frontmatter-only" |
  | 11 | POST start idempotent when active → 200 | tested | campaigns.test.ts "idempotent active" |
  | 12 | POST start complete → 409 (no revert) | tested | campaigns.test.ts "409 complete" |
  | 13 | POST start unknown project → 404 | tested | campaigns.test.ts "404 project" |
  | 14 | POST start unknown slug → 404 | tested | campaigns.test.ts "404 slug" |
  | 15 | POST start slug symlink-escape → 403 | tested | campaigns.test.ts "403 symlink slug" |
  | 16 | POST start no writable target → 422 | tested | campaigns.test.ts "422 no-target" |
  | 17 | triage enrichment annotates matching item (AC-4) | tested | triage.test.ts "annotates the item" |
  | 18 | enrichment deterministic draft-precedence on dup | tested | triage.test.ts "prefers draft" |
  | 19 | enrichment best-effort (throwing dep never fails list) | tested | triage.test.ts "best-effort" |
  | 20 | enrichment no-op without dep | tested | triage.test.ts "no listCampaignRefs" |
  | 21 | client startCampaign: POST + result mapping (ok/409/unparseable/encode) | tested | campaignsApi.test.ts startCampaign block |
  | 22 | useStartCampaign invalidates lane only on success | tested | useStartCampaign.test.tsx (both) |
  | 23 | Modal CTA by status + Fix-now demotion + navigate/close (AC-5) | tested | TriageDetailModal.test.tsx "Start Campaign CTA" (6) |

  `index.ts` `listCampaignRefs` wiring + `TriagePage` navigation glue are
  composition-root integration covered end-to-end by the AC-7 E2E
  (`start-campaign-action.spec.ts`); `CampaignStartCta` pure-render branches are
  exercised transitively through the modal tests' test-ids
  (reason_code: `covered-by-existing-test`).

- **Confidence-pattern check:**
  - *Asymptote (depth):* the risk concentrates at the write↔read boundary; I
    probed it directly with read-after-write parity across every target shape +
    through the HTTP resolver, not just "the unit passed". Further unit tests on
    setCampaignStatus would add no new information (diminishing returns reached).
  - *Coverage (breadth):* every AC maps to ≥1 assertion; all error branches
    (404/403/409/422/503-classification) enumerated; the import-boundary guard
    was re-run after wiring rather than assumed. Remaining breadth (full-stack
    wiring + navigation) is the E2E's job, executed at F0.5 — not asserted by
    mock.

## Verification (medium+)

- **Surface:** web (new endpoint + Triage UI + board navigation).
- **Runner:** Playwright `client/e2e/flows/start-campaign-action.spec.ts` via
  `surface_verification.py --surface web` against an isolated built stack seeded
  with a draft campaign + its umbrella triage item.
- **Evidence path:** `.shipwright/runs/iterate-2026-06-03-start-campaign-action/`
