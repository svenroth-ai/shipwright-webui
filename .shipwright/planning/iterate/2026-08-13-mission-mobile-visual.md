# Iterate Spec: mission-mobile-visual

- **Run ID:** iterate-2026-08-13-mission-mobile-visual
- **Type:** change
- **Complexity:** medium
- **Status:** draft

## Goal
Restyle the Mission tab's middle card onto a dark surface, remove the fact-free
VerdictBanner, rewrite the activity feed into a richer/more helpful narration
for a non-technical reader by reusing the transcript's own parsing
(`assistantText()`/BubbleTranscript rendering pieces), and remove the redundant
Transcript sub-tab from Files & Terminal now that Mission covers that ground —
all traced 1:1 against real component/CSS source and pre-approved via an
HTML mockup. In parallel, fix the concrete mobile-layout defects Sven found
on Board / Task Detail / Intent Wizard (header vertical-centering overlap,
inconsistent right-edge gutters, icon-only Resume, collapsed Mission/Terminal
tab sheet, mismatched control heights) per a second pre-approved 1:1 mockup,
including a documented phone-only exception to CLAUDE.md rule 26's 132px
create-CTA minimum width. Both mockups were built from and QA'd against the
actual rendered app (Playwright screenshots + measured `getBoundingClientRect`
values), not approximated.

## Acceptance Criteria
- [ ] Mission tab middle card (`OperationCard`/activity feed area) renders on
      a dark surface consistent with the approved "Mission Feed" mockup,
      instead of white.
- [ ] `VerdictBanner` (inside `OperationCard`, the Mission middle card —
      not the top row) no longer renders a fact-free "Not fully verified"/
      "No run data yet" status when there is nothing useful behind it.
      When a neutral verdict DOES have something useful underneath it
      (most importantly a red test-suite proof line), the banner is still
      suppressed but that proof line still renders — the existing
      guarantee that a red test suite is never hidden is preserved exactly
      (caught by internal plan review before build).
- [ ] The activity feed's narration is rewritten to be more expressive/
      helpful for a non-technical reader, reusing `assistantText()` /
      `missionActivityFeed.ts` parsing plus existing BubbleTranscript
      rendering pieces rather than new LLM infrastructure.
- [ ] The Transcript sub-tab is removed from Files & Terminal (`PaneTabBar`);
      only Files / Terminal / Viewer remain as direct destinations. The outer
      "Mission | Files & Terminal" tab pairing is unchanged.
- [ ] Board (mobile): project-filter dropdown and the primary create control
      share the same right-edge gutter as the rest of the header chrome.
- [ ] Task Detail (mobile): back-arrow / Resume / overflow-menu controls no
      longer visually overlap the two-line title+status block; Resume
      becomes an icon-only control; the collapsed Mission/Terminal control
      reads as a segmented glass pill consistent with `MissionSegmented`,
      not the plain white `PaneTabBar` tile style.
- [ ] Intent Wizard (mobile): included per Sven's explicit confirmation,
      fixed to the same header/spacing standard as Board and Task Detail.
- [ ] CLAUDE.md rule 26 gains a documented phone-only exception for the
      mobile create-CTA's minimum width (with the concrete phone value),
      rather than a silent per-component override.
- [ ] Current behavior of "does selecting Spec in Mission open the right
      detail panel" and "is Terminal the default pane in Files & Terminal"
      is verified against the real code (not assumed) before any change is
      made to either; a change to either ships only if verification shows
      it is actually broken.
- [ ] Terminal text-smearing is explicitly untouched by this iterate.

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:**
  - FR-01.66 (Mission view) — middle-card dark surface, VerdictBanner
    removal, richer activity-feed narration.
  - FR-01.68 (Mission middle card told as prose) — narration-quality
    acceptance criteria extended.
  - FR-01.56 (Operation card / derived verdict banner) — the derived
    verdict banner this FR introduced is removed as part of this run;
    row description updated to reflect the leaner shape.
  - FR-01.57 (three-card SHELL) — middle card surface color updated.
  - FR-01.62 (Files & Terminal three-card layout) — Transcript sub-tab
    removed from the compact destination set.
  - FR-01.38 (Responsive tablet/phone layout) — Board/Task Detail/Intent
    Wizard mobile fixes + the rule-26 phone exception.
  - FR-01.02 (Task detail 3-pane viewer) — phone header layout AC
    extended to close the vertical-centering overlap.
- **REMOVE:** none
- **NONE justification:** n/a — see Classification above.

## Out of Scope
- Terminal text-smearing (CUF differential-repaint class of bugs) — explicitly
  deferred to its own separate `/shipwright-iterate`, per Sven's instruction.
  Note for that future run: `iterate/terminal-table-smear` already has
  uncommitted in-progress work from 2026-07-28 (`post-replay-blank.ts`, a new
  E2E spec, server-side viewport-blank-repaint) worth resuming rather than
  restarting.
- Any LLM-based "story mode" narration — deferred behind a future, explicitly
  opt-in settings flag; not built now (per Sven's original ask).
- Changing "Spec → opens right panel" or "Terminal always default pane"
  behavior unless verification shows it is actually broken (verify-first,
  not build-first).

## Design Notes
- Mission Feed mockup (approved): built by tracing exact values from
  `MissionTopRow.tsx`, `VerdictBanner.tsx`, `OperationCard.tsx`,
  `MissionActivityFeed.tsx`, `MissionSegmented.tsx`, `missionActivityFeed.ts`,
  `session-parser.ts` (`assistantText()`/`userText()`), BubbleTranscript
  sub-components, `mission-record.css`, `on-photo.css`, `type-scale.css`.
  Sven's approval: "Hey so sieht das super aus. genau so machen im iterate."
- Mobile Fixes mockup (approved): built and QA'd via headless Playwright
  (`.compare .after` screenshots + `boundingBox()`/`getBoundingClientRect()`
  measurements) against the real rendered markup, through several correction
  rounds (structural HTML bug, missing `:root` token scoping, missing button
  reset, wrong container for `max-width:%`, header vertical-centering
  overlap, inconsistent right-edge gutters, tab-row visual language
  mismatch). Final measured chrome-vs-terminal split at 720px phone height:
  chrome ~232px (32%), terminal ~478px (66%).
- New vs modified components: no new components expected — `VerdictBanner`
  usage removed from `MissionTopRow`/`MissionBody` composition (component
  file itself may be deleted if it has no other callers — verify at build
  time); `PaneTabBar` loses its Transcript entry; CSS-only changes to
  `mission-record.css`, `on-photo.css`, `files-terminal.css`,
  `buttons.css` (rule-26 phone exception), plus targeted mobile CSS/markup
  changes in `MissionTopRow.tsx`, `TaskDetailHeader/*`, `CreateControls.tsx`
  / `ProjectFilterDropdown.tsx`, `IntentWizard`/`FlightPlanRail.tsx`.
- Deviations from visual guidelines: none expected — both mockups were
  built strictly from existing tokens (`weather-deck.css`, `on-photo.css`,
  `type-scale.css`) with no new colors/fonts introduced.

## Affected Boundaries
n/a — this run is UI/CSS restyling of existing client-only React components
and Playwright specs; no new or changed serialized format (JSON/YAML/env)
crosses a producer/consumer boundary.

## Confidence Calibration
- **Boundaries touched:** n/a (see Affected Boundaries)
- **Empirical probes run:** {populated at Step 7.5, before F0 — real-browser
  screenshots of the built Mission tab and each mobile mockup viewport
  against the dev stack, not a re-read of the diff}
- **Test Completeness Ledger:** {populated at Step 7.5 — see AC list above
  for the behaviors to enumerate}
- **Confidence-pattern check:** {populated at Step 7.5}

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** high
- **Summary:** The mobile visual fixes were low-risk; the two structural
  Mission-tab/Files-&-Terminal changes needed rework before build.
- **Findings:**
  1. (high, fix) MissionBody-level gate on raw `verdict.outcome` would hide
     `proofLines.ts`'s `suiteFailLine` guarantee (a red test suite must
     never be hidden behind a neutral banner) — **fixed**: moved the
     suppression inside `OperationCard` to the `VerdictBanner` render only,
     gated on "neutral AND no proof lines", `MissionLine`/`ProofSummary`
     unaffected.
  2. (medium, fix) "No structural change expected" for `OperationCard` was
     incorrect given its single-derivation invariant (AC1) — **fixed**: no
     structural change now needed at all, since the gate lives inside
     `OperationCard`, which already owns the derivation.
  3. (high, fix) Transcript-removal blast radius understated — a ~15-20
     spec cohort reaches Transcript via a localStorage seed, plus 13 files
     use `getByRole("tab",...)` pinned to the desktop `Tabs.List` —
     **fixed**: enumerated explicitly in the mini-plan, with a recorded
     decision to migrate that coverage to component-level Vitest against
     `BubbleTranscript/*` directly (whose pieces gain a new consumer via
     the richer activity feed, so are not deleted) rather than dropped.
  4. (medium, fix) `getByRole("tab"` selector risk — **fixed**: added an
     explicit corpus-grep step before landing (work breakdown step 3).
  5. (low, fix) `component_inventory.md`/`architecture.md` doc-sync gap —
     **fixed**: added as an explicit mini-plan file + work-breakdown step.
- **Known limitations:** none disclosed — all findings integrated.
- **Status:** 5 fixed

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-08-13-mission-mobile-visual/architecture_brief.md`
- **Verdicts:** deepseek=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed — bounded
  changes to existing presentation/navigation machinery, no new standing
  mechanism.
- **Findings:** none from either reviewer.
- **Reconciliation:** n/a — both reviewers approved the plan as scoped; no
  divergence to reconcile.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `client/` Vitest (component-level: MissionTopRow,
  OperationCard, MissionActivityFeed, PaneTabBar, mobile header components)
  + targeted Playwright specs (`80-tablet-responsive.spec.ts`,
  `90-phone-responsive.spec.ts`, `A11-mission-record-rail.spec.ts`,
  `A13-mission-shell.spec.ts`, plus a new/updated mission-visual and
  mobile-header spec) run against the dev stack per F0.5.
- **Evidence path:** `shipwright_test_results.json.iterate_latest` +
  `.shipwright/planning/iterate/iterate-2026-08-13-mission-mobile-visual/`
- **Justification (only if surface=none):** n/a
