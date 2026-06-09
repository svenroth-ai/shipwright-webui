---
run_id: iterate-2026-06-09-campaign-board-live-progress
intent: change
complexity: medium
spec_impact: MODIFY
risk_flags: [touches_io_boundary]
---

# Iterate: Live per-step in-progress feedback on the Campaigns board

## Context / Problem

PR #116 (`aa88b4f`, merged 2026-06-08) shipped the **double-launch guard** (the
task's part 1): the launch CTAs + triage Start-Campaign CTA disable & relabel
"Run attached", and the fresh-start launch branches reject a duplicate with
`409 campaign_run_already_attached`. Its detector `core/campaign-loop-state.ts`
reads `.shipwright/loop_state.json` (a live `in_progress` sub-iterate unit joined
to its campaign slug) and **collapses it to a campaign-level boolean
`Campaign.attachedRun`**.

What #116 did NOT fix is the task's **part 2** symptom: during an autonomous
campaign build the board sits at `done/total = 0/N` with the next-marker on the
running step — **visually identical to "not started"** for the whole build, then
jumps to 1/N. The per-step display is fed by `s.status`, which comes from
`status.json`; the autonomous loop only writes `status.json` `complete` (never
`in_progress`). The producer-side `in_progress` write is a **monorepo** follow-up
(triage `trg-9edbab4d`), out of scope for this repo.

But `loop_state.json` already knows **which** sub-iterate is live (`unit.id` ===
the campaign step `id`, e.g. `D1`; `unit.spec_path` carries the campaign slug).
#116 discards that granularity. This iterate surfaces it: the webui marks the
running step `in_progress` on the board **today**, independent of the producer
fix. Because the overlay also unions any `status.json` `in_progress`, it stays
forward-compatible — if `trg-9edbab4d` ever lands, the board gains nothing to
unlearn. (This obsoletes the *urgency* of `trg-9edbab4d`; `in_progress` is a
transient state and `loop_state.json` is the live authority during the run.)

## Spec Impact: MODIFY

Modifies the resolved read-view of `GET /api/campaigns/:projectId` (a UI-consumed
read surface) and the `CampaignLaneCard` rendering. No new route, no new write
surface. `.shipwright/loop_state.json` remains a read-only, tolerant input.

## Affected Boundaries

- **INPUT (read-only):** `<projectRoot>/.shipwright/loop_state.json` — already
  parsed by `campaign-loop-state.ts`; this iterate extracts per-unit `id` in
  addition to the slug. `touches_io_boundary` (JSON.parse of a `*_state.json`).
- **READ-SURFACE (server→client):** `Campaign.steps[].status` on
  `GET /api/campaigns/:projectId`. Backend-affects-frontend → F0.5 `surface=web`.
- **UI:** `CampaignLaneCard` step icon/label.

## Acceptance Criteria

- **AC-1** `readLoopRunState(projectRoot, nowMs)` returns
  `{ attachedSlugs: Set<slug>, runningStepIdsBySlug: Map<slug, Set<stepId>> }`
  from a single tolerant read. `runningStepIdsBySlug` groups every live
  (`in_progress`, non-stale) unit's `id` under its campaign slug.
- **AC-2** `readLoopAttachments` delegates to `readLoopRunState().attachedSlugs`
  with **byte-identical behavior** to today (all existing tolerance cases:
  missing / torn / non-`sub_iterate` / no-`in_progress` / stale / id-agnostic
  slug collection stay green, untouched).
- **AC-3** `GET /api/campaigns/:projectId` overlays `in_progress` onto a
  **`pending`** step whose `id` matches a live loop unit for that campaign slug.
  `done` / `total` / `nextPending` are unchanged; `attachedRun` stays `true`.
- **AC-4** The overlay NEVER downgrades an authoritative `status.json` status:
  only `pending → in_progress`. A `complete` / `failed` / `escalated` step (or a
  step already `in_progress`) is left exactly as `status.json` resolved it, even
  if a stale loop unit names it.
- **AC-5** A torn / missing `loop_state.json` never 500s the route and leaves
  every step at its `status.json` status (defense-in-depth parity with #116).
- **AC-6** `CampaignLaneCard` renders an `in_progress` step with a distinct
  spinner icon (`aria-label="in progress"`) + the status label — visually
  distinct from `pending`, `next pending`, and `complete`.

## Mini-Plan (chosen)

1. **`server/src/core/campaign-loop-state.ts`** — extract the file-read+filter
   into a single `readLoopRunState`; collect `{slug, id}` per live unit. Keep
   `readLoopAttachments` as a thin delegating wrapper (back-compat). +~25 LOC.
2. **`server/src/routes/campaigns.ts`** — call `readLoopRunState` ONCE; overlay
   `in_progress` onto matching `pending` steps before computing `attachedRun`.
   Replaces the existing `readLoopAttachments` call (no double-read). +~8 LOC.
3. **`client/src/components/external/CampaignLaneCard.tsx`** — `stepKind` gains an
   `"in_progress"` branch; `StepIcon` renders `Loader2` (`animate-spin`,
   warning color) for it. The existing `in_progress` text label stays. +~6 LOC.

### Alternative (rejected)

Keep two separate readers (`readLoopAttachments` + a new `readLoopRunningStepIds`)
and call both in the route. Rejected: two reads of the same file in one handler
admit a torn-read inconsistency window (attachedRun vs step-overlay disagree) and
a senior reviewer would flag the redundant parse. A single consistent snapshot is
trivially available, so `readLoopRunState` is the right seam.

Producer-side `status.json in_progress` write (monorepo `trg-9edbab4d`): rejected
as out-of-repo + obsoleted-in-urgency by this overlay.

## Confidence Calibration

- **Boundaries touched:** `.shipwright/loop_state.json` (read-only input parse);
  `Campaign.steps[].status` read-surface; `CampaignLaneCard` UI.
- **Empirical probes run:**
  1. Real on-disk `loop_state.json` parsed — `kind=sub_iterate`, all 8 units
     carry `id` + `status` + `spec_path` (the exact fields the reader depends
     on). Producer→consumer field contract holds.
  2. Single-read property pinned by a `vi.spyOn` on `readLoopRunState`: the route
     calls it **exactly once** per request (not per-campaign) — the torn-snapshot
     window the rejected two-reader alternative would open cannot reappear.
  3. Live-stack E2E (F0.5): `status.json` says B1 `pending`, `loop_state.json`
     says B1 `in_progress` → the real board renders `data-step-status=
     "in_progress"` + spinner + label; B0 stays `complete`. `exit_code 0`,
     `tests_run 2` (my spec **+** #116's attached-run-guard spec → no regression).

- **Test Completeness Ledger:**

  | Behavior (AC) | Disposition | Evidence |
  |---|---|---|
  | AC-1 per-unit `{slug,id}` collection | `tested` | `campaign-loop-state.test.ts` (3 cases: map, multi-group, slug-without-id) |
  | AC-2 `readLoopAttachments` delegation parity | `tested` | `campaign-loop-state.test.ts` (12 pre-existing cases, unchanged, green) |
  | AC-3 route overlays `pending → in_progress`; counts invariant | `tested` | `campaigns.test.ts` overlay + single-read consistency |
  | AC-4 never downgrade `complete/failed/escalated` | `tested` | `campaigns.test.ts` "never downgrades an authoritative non-pending step" |
  | AC-5 tolerant ∅ (missing/torn/stale); no 500 | `tested` | `campaign-loop-state.test.ts` (missing/torn/stale) + `campaigns.test.ts` torn-never-500 |
  | AC-6 card renders `in_progress` distinctly (spinner+label, beats next) | `tested` | `CampaignLaneCard.test.tsx` AC-6 + E2E `campaign-board-live-progress.spec.ts` |

  Enumeration basis: the 6 ACs above. **0 untested-testable.** No `untestable`
  rows (every behavior is unit- or E2E-reachable).

- **Confidence-pattern check:**
  - *Asymptote (depth):* the overlay is strictly additive — only `pending →
    in_progress`; authoritative non-pending statuses are never touched (AC-4);
    `done`/`total`/`nextPending` are computed before the overlay and the overlay
    keeps the step non-complete, so they are invariant (asserted in AC-3). All
    failure modes (missing/torn/stale/no-id) resolve to ∅, never a throw (AC-5).
  - *Coverage (breadth):* all three layers (core reader, route, client) plus the
    HTTP wire (E2E). The only other per-step-`status` consumer was audited —
    both launch buttons read `attachedRun` (already `true`/disabled during the
    overlay window), not the rendered step status; `CampaignLaneCard` is the sole
    per-step-status renderer.
