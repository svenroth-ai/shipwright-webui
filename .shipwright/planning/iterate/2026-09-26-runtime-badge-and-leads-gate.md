# Iterate Spec: runtime-badge-and-leads-gate

- **Run ID:** iterate-2026-09-26-runtime-badge-and-leads-gate
- **Type:** change
- **Complexity:** medium
- **Status:** draft

## Goal
Stop showing a runtime badge/bar on a task when Settings only allows one
runtime (there is no choice left to display), move the Codex Light
campaign/pipeline limitation note from every task into Settings as a single
global note, and gate the board's Claim filter toggle behind the same
org-chart presence check that already gates the sibling lead-tag filter, so
it disappears when Leadwright isn't installed.

## Acceptance Criteria
- [x] `RuntimeToggle` renders nothing (no interactive toggle, no fixed pill)
      when `codexAvailability !== "both"`, on every surface that uses it
      (NewTaskModal/NewIterateModal/NewPipelineModal via
      `RuntimeFieldFragment`, EditTaskModalFields, the Settings card's own
      "default runtime" preview).
- [x] The Codex Light "doesn't support campaign or multi-phase pipeline
      launches" hint no longer renders on any per-task surface.
- [x] Settings (`CodexSettingsCardFields`) shows that hint once, reworded to
      "Codex Light doesn't support campaign or multi-phase pipeline launches
      yet. Use Claude or Codex over Codextender for those.", shown whenever
      Codex Light is active and Codex is reachable (`availability !==
      "claude_only"`).
- [x] `ClaimFilterToggle` on the board toolbar is hidden when
      `useOrgChartPresence()` returns `"absent"`, and still renders on
      `"loading"`/`"broken"`/`"present"` (fail visible, matching
      `LeadTagFilterToolbarGroup`'s precedent).

## Spec Impact
- **Classification:** none
- **ADD:** none
- **MODIFY:** none
- **REMOVE:** none
- **NONE justification:** Both changes are UI-affordance corrections —
  hiding controls that already had no function in their trigger state
  (a runtime bar with no choice to show; a claim filter for a feature that
  doesn't exist without Leadwright) — not a change to any FR's described
  capability. Precedent: UI-affordance removal is classified `none`, not
  `modify` (established 2026-08, PR #196).

## Out of Scope
- Per-task Lead data displays (`TaskCardLeadExpander`, `LeadOriginGlyph`)
  are explicitly OUT — a prior, reviewed, tested decision
  (iterate-2026-09-09-leadwright-gate-org-presence, see
  `LeadTagFilter.test.tsx` / `TaskCardLeadExpander.test.tsx`'s "Lead chips
  REPORT existing data — never gated on org-chart presence" block) holds
  that a task's OWN already-persisted lead data must keep showing regardless
  of current Leadwright install state, since the tag/metadata already exists
  on the task independent of whether the org chart is currently reachable.
  Reopening that decision is a separate, deliberate call for the operator,
  not something this iterate silently reverses.
- No change to `codexAvailability`'s three-value vocabulary or to
  `useOrgChartPresence()`'s four-state contract — both are reused as-is.
- Read-only runtime display for an already-started task
  (`EditTaskModalFields`'s `readonlyValue("runtime", ...)` branch) is
  untouched — it reports a historical fact about the task, not a live
  choice, so it stays visible regardless of `codexAvailability`.

## Design Notes
Pure conditional-render change, no new visual language: `RuntimeToggle`
returning `null` removes an existing element rather than introducing one;
the Settings hint reuses the same `<p className="text-[13px]
text-[var(--color-muted)]">`-family styling as its sibling helper texts in
`CodexSettingsCardFields.tsx`; `ClaimFilterToggle`'s gate mirrors
`LeadTagFilterToolbarGroup`'s existing shell exactly (same `useOrgChartPresence()`
call, same `"absent"` → `null` branch).

## Affected Boundaries
n/a — no serialized format producer/consumer pair changes; `codexAvailability`
and the org-chart-presence signal are both read-only, pre-existing inputs.

## Confidence Calibration
- **Boundaries touched:** n/a (see above).
- **Empirical probes run:**
  - Real-browser E2E (`runtime-availability-badge-gate.spec.ts`, isolated
    stack, chromium): with `codexAvailability: "codex_only"` seeded via
    `PUT /api/settings`, NewTaskModal shows no runtime field/hint, task still
    creates with `runtime: "codex"` server-side, EditTaskModal on the
    resulting draft task shows no runtime bar either — PASSED.
  - Real-browser E2E (`leadwright-gate-org-presence.spec.ts`, extended):
    with no `~/.claude/leads/org-chart.json`, `board-claim-filter-toggle` is
    absent from the DOM; with an invalid (broken, not missing) org-chart.json,
    it still renders — PASSED (both legs).
  - Regression E2E (`runtime-toggle-codex.spec.ts`, pre-existing,
    unmodified): the "both" availability default path — NewTaskModal shows
    the interactive toggle, persists the choice, Edit dialog reflects it,
    and the post-launch read-only freeze still works — PASSED, proving no
    regression to the unrestricted case.
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | `RuntimeToggle` renders nothing when `availability` is `claude_only`/`codex_only` | tested | `RuntimeToggle.test.tsx` "availability !== 'both' renders nothing" (2 cases) PASSED |
  | 2 | `RuntimeToggle` still renders the interactive radiogroup when `availability` is `both` (no regression) | tested | `RuntimeToggle.test.tsx` pre-existing 6 cases PASSED |
  | 3 | `EditTaskModalFields` shows no Runtime field/hint for an editable (draft) task when availability is restricted, but form state still resolves and submits the forced runtime | tested | `EditTaskModal.runtime-availability-race.test.tsx` PASSED |
  | 4 | `EditTaskModalFields` still shows the read-only runtime label for an already-started task regardless of availability | tested | `EditTaskModal.runtime-toggle.test.tsx` (pre-existing, unmodified) PASSED |
  | 5 | `RuntimeFieldFragment` (create-form fragment) renders nothing when availability is restricted | tested | Covered transitively via `RuntimeToggle`'s own null-render (fragment has no independent branch left) + real-browser proof in `runtime-availability-badge-gate.spec.ts` PASSED |
  | 6 | `CodexSettingsCardFields` hides its own "default runtime" `RuntimeToggle` preview when availability is restricted | tested | `CodexSettingsCard.test.tsx` "hides the RuntimeToggle entirely..." PASSED |
  | 7 | Settings shows the reworded Codex Light limitation hint when Light is active and Codex is reachable | tested | `CodexSettingsCard.test.tsx` "shows the Codex Light limitation hint..." PASSED + `runtime-availability-badge-gate.spec.ts` real-browser leg PASSED |
  | 8 | Settings hides that hint when availability is `claude_only` | tested | `CodexSettingsCard.test.tsx` "hides the Codex Light limitation hint..." PASSED |
  | 9 | `ClaimFilterToggle` hidden on confirmed absent org-chart presence | tested | `ClaimFilterToggle.test.tsx` gate block PASSED + `leadwright-gate-org-presence.spec.ts` real-browser leg PASSED |
  | 10 | `ClaimFilterToggle` still renders on loading/broken/present (fail visible) | tested | `ClaimFilterToggle.test.tsx` `it.each` PASSED + `leadwright-gate-org-presence.spec.ts` "broken" leg PASSED |
  | 11 | Per-task lead data (`TaskCardLeadExpander`/`LeadOriginGlyph`) is explicitly untouched and keeps reporting regardless of org-chart presence (out-of-scope guard, not a regression) | tested | Pre-existing `TaskCardLeadExpander.test.tsx` "never gated on org-chart presence" block re-run unmodified, still PASSED |
  | 12 | An already-active claim filter clears itself (not just the button hiding) the moment org-chart presence resolves to absent — no invisible stuck filter | tested | `TaskBoardPage.test.tsx` "clears an already-active claim filter..." PASSED (new — added after external plan review finding, see Architecture Review below) |
  | 13 | `ClaimFilterToggle` and its board-driven `claimFilter` state stay in lockstep on `"present"`/`"loading"`/`"broken"` (filter keeps applying wherever the button is visible) | tested | `useBoardFilters.test.ts`'s pre-existing claim-filter block (unmodified) + `TaskBoardPage.test.tsx` new test's own pre-transition assertions (filter narrows the board before presence flips) PASSED |

- **Confidence-pattern check:** Asymptote (depth) — no prior "are you
  confident?"-style question in this run produced a "yes" that a later probe
  then contradicted; this is a first pass. Coverage (breadth) — all 11 ledger
  rows are `tested`, 0 untested-testable.

## Architecture Review
**Brief-first pass (Step 3.5, step 2a):** `architecture_brief.md`, external
review via `external_review.py --mode architecture --driver claude`
(`architecture_review_raw.json`). GLM leg unavailable in this environment
(`openai package not installed` — a pre-existing environment gap, not
introduced by this change); the OpenAI/codex leg answered: **`SHIPWRIGHT_VERDICT:
approve`** — "No new standing mechanism is needed; changing the existing
render conditions is proportionate to these UI corrections."

**Plan review (Step 3.5, step 1):** `external_review.py --mode iterate`
(`plan_review_raw.json`), same driver/leg availability. Verdict: **`revise`**
— finding: *"Hiding `ClaimFilterToggle` when the org chart becomes absent
may leave an already-enabled Claim filter active with no visible way to turn
it off. ... make the board ignore the Claim filter or clear its active
state."* **Integrated:** `TaskBoardPage.tsx` now calls `useOrgChartPresence()`
directly and clears `claimFilter` via `useEffect` the moment presence
resolves to `"absent"`, so an already-active filter genuinely stops applying
rather than silently persisting behind a hidden button. Ledger rows 12–13
above cover it; `TaskBoardPage.test.tsx` gained a dedicated regression test
for the transition. The identical latent gap exists for `leadTagFilter`
(the sibling Bot/BellDot filter from iterate-2026-09-09-leadwright-gate-org-presence)
— that filter's *effect* is likewise never gated on presence, only its
button's visibility is. That is a PRE-EXISTING gap this iterate did not
introduce and is explicitly OUT OF SCOPE here (not silently "fixed" as a
drive-by); flagged for the operator as a candidate follow-up, not resolved
in this diff.
