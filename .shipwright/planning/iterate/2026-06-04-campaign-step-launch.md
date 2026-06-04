---
run_id: iterate-2026-06-04-campaign-step-launch
intent: feature
complexity: medium
spec_impact: ADD
fr: FR-01.36
---

# Iterate Spec — One-click launch of a single campaign sub-iterate

## Intent

On the Task Board's Campaigns lane, the per-step affordance only **copies**
`/shipwright-iterate "<specPath>"` to the clipboard (no embedded terminal on the
board). Users expect "start this item" to actually start it — like
`Launch autonomous` does for the whole campaign. This iterate replaces the
per-step Copy button with a **one-click Launch** that opens a TaskDetail
terminal auto-running the next-pending sub-iterate.

## Scope

- **Target:** the campaign's `nextPending` step only (respects the stacked
  dependency order — never launches C4 before C1/C2).
- **UX:** the `Copy launch (Cx)` button is **removed** and replaced by
  `Launch (Cx)`, sitting next to `Launch autonomous`.
- **Confirm:** direct one-click launch for an ordinary step; a confirm dialog
  appears **only** when the next-pending step is risky (`failed` / `escalated`
  / `plan_first`) — mirrors the autonomous-launch risky-step guard.
- **Command authority:** the client sends only `{ slug, stepId }`; the server
  resolves the step's `specPath` (realpath-guarded, identical to what the board
  renders) and builds `/shipwright-iterate "<specPath>"` (Architecture rule 1 /
  regression guard #19). The client never sends a path or command.

## Acceptance Criteria

- **AC1** — `POST /launch { campaignStep: { slug, stepId } }` (fresh start)
  builds `claude … '/shipwright-iterate "<specPath>"'` where `<specPath>` is the
  server-resolved, root-relative spec path of that step.
- **AC2** — invalid `slug` → `400 invalid_campaign_slug`; invalid `stepId` →
  `400 invalid_campaign_step_id`; unknown step → `400 campaign_step_not_found`;
  step whose `specPath` is null (missing/unsafe file) → `400
  campaign_step_spec_missing`.
- **AC3** — `campaignStep` mixed with `actionId` / `phaseTaskRef` /
  `campaignSlug` → `400 mixed_launch_intents`. A genuine resume (JSONL on disk)
  falls through to `--resume` (no slash command).
- **AC4** — the board renders `Launch (Cx)` (next-pending id), disabled when
  there is no launchable next step (no `nextPending` or null `specPath`) or no
  resolved project. The `Copy launch` button no longer exists.
- **AC5** — clicking `Launch` on an ordinary next-pending step creates a task
  in the project cwd, server-launches it, writes the auto-launch handoff, and
  navigates to `/tasks/<id>` (no dialog).
- **AC6** — when the next-pending step is risky, the click opens a confirm
  dialog naming the step + reason; confirm launches, cancel does nothing.

## Affected Boundaries

- **Producer/consumer:** `POST /api/external/tasks/:id/launch` body gains
  `campaignStep` (new launch intent). Server is the command authority.
- **campaign.md → board:** server reuses `readCampaigns` so the launched
  `specPath` is byte-identical to the rendered step's `specPath`.

## Confidence Calibration

- **Boundaries touched:** `/launch` body contract (new `campaignStep` intent);
  campaign.md → specPath resolution (reused, not re-derived).
- **Empirical probes run:** server branch dry-run asserts the exact command
  string against a real on-disk fixture campaign; client hook test asserts
  create→launch→handoff ordering; button test asserts direct-vs-confirm.
- **Test Completeness Ledger:** authored at F5 — every AC → tested or
  untestable(reason_code); 0 untested-testable.
- **Confidence-pattern check:** depth = the server resolves the SAME specPath
  the board shows (no second derivation to drift); breadth = invalid slug /
  stepId / missing step / missing spec / mixed-intent all covered.

## Out of scope

- Launching arbitrary (non-next-pending) steps / per-row buttons.
- Producer-side `campaign_init.py` table-format unification (monorepo; this
  repo stays a read-only consumer — see iterate-2026-06-04-campaign-step-id-emphasis).
- Dependency-graph enforcement beyond "next-pending only".
