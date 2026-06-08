---
run_id: iterate-2026-06-08-campaign-attached-run-guard
intent: change
complexity: medium
spec_impact: MODIFY
risk_flags: [touches_io_boundary, touches_public_api]
date: 2026-06-08
---

# Iterate: Campaign attached-run guard + double-launch prevention

## Problem (observed 2026-06-08)

Campaign `2026-06-08-triage-outbox-delivery` was launched autonomous
(orchestrator session `079ad1b5` prepping D1). The Campaigns-lane board
sat at **0/4 with BOTH launch buttons live**. Two distinct gaps:

1. **Double-launch footgun.** `CampaignLaneCard`'s `Launch (Cx)` +
   `Launch autonomous` (and the triage `Start Campaign` CTA) have NO
   "a run is already attached" guard — they only disable when there is
   no launchable step / no project. A second click while an autonomous
   orchestrator is already attached spawns a SECOND orchestrator on the
   same campaign → racing worktrees/commits + corrupted `status.json`.

2. **No in-progress feedback.** The autonomous loop
   (`campaign-mode.md` step 3g) calls `campaign_progress update-status`
   only with `--status complete`; it never marks the running sub-iterate
   `in_progress` in `status.json`. The card CAN render `in_progress`
   (already wired) but nothing writes it, so the board reads `done/total
   = 0/N` for the whole build — visually identical to "not started" —
   then jumps to 1/N.

## Producer/consumer split (hard boundary)

- **(a) producer-side** — making the autonomous loop write `in_progress`
  to `status.json` — edits `campaign-mode.md` + `campaign_progress.py`,
  which live in the **shipwright monorepo**, NOT this webui repo. It is
  OUT of this PR. Tracked via a triage follow-up appended to
  `.shipwright/triage.jsonl` (user choice 2026-06-08).
- **(b) consumer-side (THIS iterate)** — the webui detects an attached
  run on its own and guards the launch CTAs.

## Key finding — the webui already has a TODAY signal

`autonomous_loop.py cmd_next` sets `units[].status = "in_progress"` (and
`started_at`) in `<project>/.shipwright/loop_state.json` the instant it
picks up a sub-iterate; `cmd_record` clears it to a terminal status. So a
live orchestrator IS observable from disk **without any monorepo change**.
Each unit's `spec_path` embeds `…/campaigns/<slug>/sub-iterates/…`, so the
running unit joins to its campaign slug.

## Approach (Option A — loop_state ∪ status.json in_progress)

`attachedRun(campaign) = loopHasLiveUnitFor(slug)  // loop_state.json, today
                         || steps.some(s => s.status === "in_progress")  // status.json, after producer fix (a)`

- **New server module** `core/campaign-loop-state.ts`:
  `readLoopAttachments(projectRoot, nowMs): Set<string>` — tolerant
  read+parse of `<projectRoot>/.shipwright/loop_state.json`; returns the
  set of campaign slugs that have a **live, non-stale** `in_progress`
  unit. Guards: `kind === "sub_iterate"` only; torn/missing/garbage →
  empty set; per-unit `spec_path` → slug via the `campaigns/<slug>/`
  segment (normalises `\\` and `/`).
- **Stale-guard.** A unit whose `started_at` is older than
  `SHIPWRIGHT_CAMPAIGN_ATTACH_STALE_MS` (default 6 h) is treated as a
  dead loop (not attached) — prevents a crashed orchestrator
  (dies between `next` and `record`) from disabling the buttons forever.
  Missing/unparseable `started_at` on an `in_progress` unit → treated as
  attached (conservative; bounded by the next `init` reconcile).
- **`Campaign.attachedRun?: boolean`** added to BOTH mirrors
  (`server/src/core/campaign-store.ts`, `client/src/lib/campaignsApi.ts`),
  optional for deploy-skew safety; the route always populates it.
- **Route** `GET /api/campaigns/:projectId` composes:
  `attachedRun = loopSlugs.has(slug) || steps.some(in_progress)`.
- **Client gate.** `CampaignStepLaunchButton`, `CampaignAutonomousLaunchButton`
  disable + relabel ("Run attached") with an explanatory tooltip when
  `campaign.attachedRun`. The triage `Start Campaign` CTA is ALREADY
  guarded (it only renders for `draft`/`null`; once `active` it becomes
  "Go to board"; server is idempotent + 409 on complete) — verified, no
  change needed there beyond a regression test.

## Out of scope / non-goals (YAGNI)

- No producer change (monorepo). No persisting `campaignSlug` on the
  task. No richer `attachedRun` shape than a boolean (the card already
  renders the in_progress step + next-marker for unit context).
- The sub-second init→first-`next` window (orchestrator live, no unit
  in_progress yet) is NOT covered — covering it via pending-unit
  detection would block a legitimately strict-stopped campaign's relaunch
  for the whole stale window. Documented, accepted.

## Affected Boundaries

| Boundary | Direction | Producer | Consumer (this change) |
|---|---|---|---|
| `<project>/.shipwright/loop_state.json` | READ (new) | `shared/scripts/lib/autonomous_loop.py` (init/next/record) | `core/campaign-loop-state.ts` |
| `GET /api/campaigns/:projectId` response | READ (extended) | `routes/campaigns.ts` | `lib/campaignsApi.ts` → `useCampaigns` → card |
| `campaigns/<slug>/status.json` step status | READ (existing) | `campaign_progress.py` | `core/campaign-store.ts` |

## Acceptance Criteria

- **AC-1** `readLoopAttachments` returns the campaign slug when
  loop_state has a `sub_iterate` unit `in_progress` whose `spec_path`
  is under `campaigns/<slug>/` (handles `\\` and `/` separators).
- **AC-2** Returns ∅ when: file missing; JSON torn/garbage;
  `kind !== "sub_iterate"`; no `in_progress` unit; unit `in_progress`
  but `started_at` older than the stale window.
- **AC-3** `GET /api/campaigns` sets `attachedRun = true` for a campaign
  with a live loop unit, OR with a `status.json` step `in_progress`;
  `false` otherwise. Torn loop_state never 500s the route (→ false).
- **AC-4** `CampaignAutonomousLaunchButton` is disabled + relabeled
  ("Run attached") with tooltip when `attachedRun`; the dialog cannot be
  opened. Unaffected when `attachedRun` is false/undefined.
- **AC-5** `CampaignStepLaunchButton` is disabled + relabeled when
  `attachedRun`; direct-launch + dialog paths both blocked.
- **AC-6** Triage `Start Campaign` CTA regression: stays "Go to board"
  for `active` (never a second start while running).
- **AC-7** A triage follow-up for producer fix (a) is appended to
  `.shipwright/triage.jsonl` and ships in the PR.

## Confidence Calibration
- **Boundaries touched:** `<project>/.shipwright/loop_state.json` (new READ;
  schema verified against `autonomous_loop.py` init/next/record),
  `GET /api/campaigns` response (+optional `attachedRun`), `status.json` step
  status (existing read), the two `/launch` branches (+`409
  campaign_run_already_attached`).
- **Empirical probes run:**
  - Read the LIVE on-disk `loop_state.json` (the 2026-05-25 bloat-cleanup-C
    loop): confirmed single project-root file, `kind:"sub_iterate"`, units with
    Windows-backslash `spec_path` embedding `campaigns/<slug>/` → drove the
    backslash-aware slug-join.
  - Read `autonomous_loop.py` `cmd_next` (sets `status:"in_progress"` +
    `started_at`) and `cmd_record` (clears to terminal) → confirmed
    `in_progress` is the reliable "live now" signal and the crash-leaves-stale
    failure mode (→ stale-window).
  - True end-to-end: isolated worktree stack + a seeded `loop_state.json`
    (in_progress, `status.json` still `pending`) → the real route returned
    `attachedRun:true` and both buttons rendered disabled (E2E, 1 passed).
  - Independent adversarial review flagged the client-only guard (HIGH) → added
    server-side `409` enforcement + a stale-no-block test; external `--mode
    code` (openrouter) on the full diff found no production bug, only
    test-coverage tightening (tooltip + risky-dialog assertions), applied.
- **Test Completeness Ledger:** see
  `shipwright_test_results.json.iterate_latest.test_completeness` — 10 behaviors,
  all `tested`; `untested_testable: 0`; enumeration_basis acs 7 / covered 7.
- **Confidence-pattern check:** asymptote — the guard is enforced at BOTH the
  client CTA and the server launch branch (not a single presentational layer),
  so deploy-skew/multi-tab/direct-API can't bypass it. Coverage — unit
  (loop-state parse/join/stale), route (union + torn-no-500), branch (409 + stale
  exemption), component (both buttons + the risky path), and a real-stack E2E.
