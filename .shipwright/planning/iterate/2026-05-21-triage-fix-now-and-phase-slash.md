# Iterate Spec: triage-fix-now-and-phase-slash

- **Run ID:** iterate-2026-05-21-triage-fix-now-and-phase-slash
- **Type:** change (UI rewire) + bug-fix (workaround)
- **Complexity:** medium
- **Status:** draft

## Goal

Two tightly-coupled changes to the triage / launch surface:

1. **Triage Fix-now UX**: replace the clipboard-copy-of-launchPayload with
   "open NewIssueModal pre-populated for a Fix run". Show Fix-now on
   every triage item in `status==="triage"` (not just items that carry a
   `launchPayload`).
2. **Phase → slash-command workaround**: emit the namespaced
   `<plugin>:<skill>` form for four phases / actions whose bare
   `/shipwright-<plugin>` form fails to resolve in current Claude Code
   skill resolution. Specifically:
   - `new-task` + phase=`plan`     → `/shipwright-plan:plan`     (was `/shipwright-plan`)
   - `new-task` + phase=`test`     → `/shipwright-test:test`     (was `/shipwright-test`)
   - `new-task` + phase=`security` → `/shipwright-security:security` (was `/shipwright-security`)
   - `new-pipeline`                → `/shipwright-run:run`       (was `/shipwright-run`)

   Everything else (`new-iterate`, plus phases `build`, `design`, `deploy`,
   `changelog`, `compliance`, `adopt`, `project`) stays at the bare form
   per empirical evidence — the user has been running those flows and
   they work.

## Acceptance Criteria

### Slash-command workaround
- [ ] AC-1 — `substitutePlaceholders` emits `'/shipwright-plan:plan'`
      for `actionId=new-task` + `phase=plan` across all three shell forms.
- [ ] AC-2 — Same for `phase=test` → `'/shipwright-test:test'`.
- [ ] AC-3 — Same for `phase=security` → `'/shipwright-security:security'`.
- [ ] AC-4 — `actionId=new-pipeline` emits `'/shipwright-run:run'` across
      all three shell forms (regardless of phase, since new-pipeline has
      no phase input).
- [ ] AC-5 — Non-namespaced phases unchanged: `new-task` + `phase=build`
      still emits `'/shipwright-build'` (regression guard).
- [ ] AC-6 — `new-iterate` still emits `'/shipwright-iterate'` (regression
      guard — user did not flag iterate as broken).

### Triage Fix-now UX
- [ ] AC-7 — Every triage item with `status==="triage"` shows the
      `Fix now` button (regardless of whether `launchPayload` is set).
- [ ] AC-8 — Clicking `Fix now` on an item whose `source==="github"`
      opens `NewIssueModal` with `action.id="new-task"`, `phase="security"`,
      `title="Fix for <triage.title>"`, `description=<triage.detail>`,
      `priority=<item.suggestedPriority>`, `domain=<item.suggestedDomain>`.
      The phase picker is locked to security (overridden=true so
      title-based auto-classify cannot move it). Rationale: GitHub-source
      triage items in this codebase are aggregated security-scan rollups
      (code-scanning + dependabot + shipwright-security) — the WebUI
      receives them from `gh-security-triage.py`. The only sensible
      "fix" path for a GitHub item is `/shipwright-security:security`.
      Source `"shipwright-security"` itself does **not** currently appear
      as a triage source (those findings flow through GitHub aggregation
      first), but if it ever does, the same branch applies — extend the
      condition then.
- [ ] AC-9 — Clicking `Fix now` on any other triage item (source
      `iterate`, `phaseQuality`, `compliance`, etc.) opens
      `NewIssueModal` with `action.id="new-iterate"`,
      `title="Fix for <triage.title>"`, `description=<triage.detail>`,
      `priority=<item.suggestedPriority>`, `domain=<item.suggestedDomain>`
      (new-iterate has no phase picker). Compliance items DO go to
      iterate — they're typically refactor / spec-update work, not a
      security finding sweep.
- [ ] AC-10 — When the pre-populated NewIssueModal is open, the
      TriageDetailModal closes itself (clean stack — no overlay-on-overlay).
- [ ] AC-11 — The legacy clipboard-copy-payload behaviour is removed.
      `LaunchPayloadBlock` still renders the payload as informational text;
      no separate copy button replaces the old Fix-now-copy semantics.

## Spec Impact

- **Classification:** MODIFY (the Fix-now behaviour spec lives under
  FR-01.30 / FR-01.32 family — Triage Tab + promote bridge);
  the slash-command emitter belongs to the launch path the WebUI never
  exposes as an FR (it is implementation detail behind FR-03.x).
- **ADD** (new FR appended): `none`
- **MODIFY** (existing FR changed): the FR carrying the Triage Tab
  contract gains an additional acceptance-criteria block describing the
  Fix-now rewire (open modal instead of copy). Slash-command emission is
  not user-visible at the FR level; no FR row touched there.
- **REMOVE** (FR retired): `none`
- **NONE justification:** n/a (one FR modified)
- **Affected FRs:** FR-01.30 (triage tab + promote bridge — Fix-now sub-flow)

## Out of Scope

- Renaming phase IDs upstream (out of repo scope — user has tried;
  workaround stays here).
- Adding namespaced form for phases the user did **not** flag as broken.
  If `/shipwright-build` ever breaks the same way, it gets its own
  iterate.
- Per-item action override (e.g. a triage item declaring its own
  preferred action) — keep heuristic simple: source/kind drives mode.
- Changing the `LaunchPayloadBlock` render or `prepareLaunchPayload`
  decision helper (still used purely for the informational preview).

## Design Notes

- Re-uses existing `NewIssueModal` body — does not introduce a new modal
  component. Five new optional props (`initialTitle`, `initialDescription`,
  `initialPhaseId`, `initialPriority`, `initialDomain`) consumed only by
  the `open: false→true` reset effect. When `initialPhaseId` is set, the
  modal seeds `phaseOverridden=true` so the debounced title-classifier
  cannot overwrite the chosen phase.
- TriageDetailModal hosts `NewIssueModal` as a sibling Dialog (same
  pattern it already uses for `PromoteModal`). Project actions are
  fetched via existing `useProjectActions(projectId)` hook.
- No new component files. No new visual tokens. Re-uses per-mode palette
  already defined in `NewIssueModal`.
- Discriminator (source-only): `item.source === "github"` → security
  phase (`/shipwright-security:security`); everything else →
  `/shipwright-iterate`. Empirically validated against the live triage
  view (Sven screenshot 2026-05-21): GitHub items in this codebase are
  always security-scan rollups; iterate-source / phaseQuality-source /
  compliance-source items map to iterate. The simple source-only rule
  matches the visible Triage Tab grouping (one source per section header).
- Metadata pre-fill: `priority` ← `item.suggestedPriority`, `domain` ←
  `item.suggestedDomain`. Both `new-task` and `new-iterate` already
  declare `priority` + `domain` in their `modal_fields`, so the inputs
  render automatically and pick up the seeded values via the same
  reset effect.
- Tags / `complexityHint` / `blockedBy` are **not** pre-filled — no
  reliable signal exists on the TriageItem shape for those (only
  suggestedPriority + suggestedDomain). PromoteModal's auto-tags
  (`source:X, severity:Y, triage:id`) are a Promote-specific concern,
  not duplicated here.

## Affected Boundaries

This iterate is behaviour-preserving for all serialized formats. The
launch-command STRING shape changes for 4 cases but the **wire format**
(JSON envelope returned by `POST /launch`) is unchanged. No env / JSON
config / YAML producers or consumers touched.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a — no serialized-format producer/consumer pair changed |

## Confidence Calibration

(Populated 2026-05-21 before F0 Fresh Verification Gate.)

- **Boundaries touched:** none. Pure UI rewire (TriageDetailModal) +
  string-emission tweak (`buildSlashCommand`). No JSON/env/YAML
  producer-consumer pair changed. The launch-command STRING does change
  shape for 4 cases but its consumer is the user's terminal /
  embedded-terminal — not a code parser. Test fixtures pin the new
  shape across all three shell forms.

- **Empirical probes run:**
  - Server `actions-substitute.test.ts` — 78 unit tests including
    6 new cases for the namespaced workaround (AC-1, AC-2 × posix,
    AC-3 × posix/ps/cmd, AC-4 × posix/cmd/ps, AC-5 + AC-6 regression
    guards). 3 existing assertions updated to new shape. **78/78 pass**.
  - Client `TriageDetailModal.test.tsx` — 8 tests including 6 new
    behavior tests (Fix-now visibility, github→new-task+security,
    iterate→new-iterate, compliance-kind→iterate regression guard,
    catalog-loading disable, catalog-permanent-failure inline error).
    **8/8 pass**.
  - Client `NewIssueModal.test.tsx` — 39 existing tests unchanged.
    **39/39 pass** (backwards-compat regression guard for the 5 new
    optional props).
  - Full server vitest — **1164/1164 pass** (89 files).
  - Full client vitest — **1021/1021 pass** (86 files).
  - Server tsc (via `npm run build`) — exit 0.
  - Client tsc (`npx tsc --noEmit`) — exit 0.

- **Edge cases NOT probed + why acceptable:**
  - **Custom `.webui/actions.json` overrides** — a project that
    defines its own `new-task` whose `command_template` uses
    `{task.phase}` (the legacy placeholder, not `{task.initial_prompt}`)
    keeps the bare `/shipwright-${phase}` form. Acceptable: custom
    actions are user-defined; if a custom action targets a phase that
    needs namespacing, the user can edit their template.
  - **Run-config phase_task launches** (`buildCopyCommands(slashCommand)`
    direct path, not via `substitutePlaceholders`) — out of scope per
    DO-NOT guard #12 (the framework owns run-config writes). If the
    upstream orchestrator writes `/shipwright-plan` bare into the
    run-config phase_task, it stays bare. Separate framework-side fix
    if it surfaces.
  - **AC-2 (`phase=test`)** per-shell-form coverage — POSIX asserted;
    PowerShell + cmd not explicitly asserted. Acceptable: AC-1 + AC-3
    cover all three shell forms; the escape pipeline is shell-form-
    agnostic (it wraps the whole `inner` string in `q()`), so per-form
    drift for `:test` is structurally impossible if `:plan` + `:security`
    work.
  - **Real-browser smoke** — F0.5 surface verification (next step)
    drives the live UI flow. Unit tests prove correctness in isolation
    but the user-flagged memory `feedback_browser_fixes_need_real_browser_smoke`
    requires live-stack verification for any change touching the UI.

- **Confidence-pattern check:** No "are you confident?" → "yes" →
  subsequent finding pattern fired in this run. The user DID override
  my initial discriminator (`kind === "compliance"` → `source === "github"`),
  but that was UX-policy clarification, not a self-reported confidence
  that turned out wrong. Spec was corrected pre-implementation, before
  any production code shipped to the discarded heuristic.

## Verification (medium+)

- **Surface:** web
- **Runner command:** `npm.cmd --prefix client run test:e2e -- --grep "triage|fix-now|phase-slash"`
  (Playwright E2E against the isolated server build, USERPROFILE pointed
  at a temp dir per memory `feedback_iterate_e2e_isolated_userprofile`).
- **Evidence path:** `client/playwright-report/index.html`
- **Justification:** n/a (surface=web)
