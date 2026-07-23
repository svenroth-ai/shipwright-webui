# Iterate Spec: intent-launcher-front-door

- **Run ID:** iterate-2026-07-23-intent-launcher-front-door
- **Type:** feature
- **Complexity:** medium
- **Status:** draft

## Goal
The guided Intent Wizard was built (A08/A09) but is not reachable from any create
button in normal operation — the recorded FR-01.51 `Design/E2E = MISSING` gap. Make
the wizard the **front door** across all four create surfaces (Board single +
All-Projects "New", Projects "Create", Ship's Log header), matching the create menu
in `Spec/prototype/New_Dropdown.png`, and give the wizard a permanent
"Register a project manually…" escape hatch so it is the single, always-complete
project-creation hub.

## Acceptance Criteria
- [ ] **AC1** — The Board **single-project** "New" dropdown leads with a
  "Guided — Intent Wizard" item (marked *recommended*, under a "START SOMETHING"
  heading) that navigates to `/wizard`, and ends with a "Register a project
  manually…" item that opens the expert registration. The existing New
  pipeline/task/iterate items are unchanged.
- [ ] **AC2** — The Board **All-Projects** "New" cascade (desktop + phone) leads with
  the same "Guided — Intent Wizard" item → `/wizard` and ends with "Register a
  project manually…". The per-project action submenus are unchanged.
- [ ] **AC3** — The **Projects** page "Create Project" button (header + empty-state)
  navigates to `/wizard` (the guided door picker), not straight into the expert
  wizard. Landing on `/projects?new=1` auto-opens the expert registration dialog
  (the target of every "Register a project manually…").
- [ ] **AC4** — The wizard **DoorPicker** shows a permanent "Register a project
  manually…" one-liner beneath the three doors that opens the expert registration
  (via `/projects?new=1`), replacing the old "Add the existing project → /projects"
  line that dead-ended on the list.
- [ ] **AC5** — The **Ship's Log** header carries a `.btn-primary` "New ▾" launcher
  next to "Open board" offering "Guided — Intent Wizard" (→ `/wizard`) and "Register
  a project manually…" (→ `/projects?new=1`). The scoped-iterate promptbox is
  unchanged.
- [ ] **AC6** — The "Guided" and "Register manually" menu affordances come from ONE
  shared module (no per-surface re-implementation of the label/route), and every
  create-CTA trigger still rides `.btn-primary`/`.btn-primary-split`
  (create-cta-standard guard green; `ShipsLogPage.tsx` added to its registry).

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:** `FR-01.51` — the guided Intent Wizard is now the reachable front door
  from every create surface + a permanent register-manually escape hatch inside it.
  This FOLDS into FR-01.51 (completes/wires an already-built capability; MINT-vs-FOLD
  gate → FOLD, not a new capability). Append `(E)` acceptance-criteria lines.
- **REMOVE:** none
- **NONE justification:** n/a

## Out of Scope
- Folding "Plain Claude session" into the dropdown row (kept as its dedicated icon
  button — cosmetic parity with the screenshot, trivial follow-up).
- The board's left Campaign/Pipeline orchestration rail and the pipeline view
  (explicitly deferred by Sven).
- First Contact hero (Iterate B).
- Wiring per-project New pipeline/task creation into the Ship's Log launcher (the
  board + promptbox already serve those).

## Design Notes
- Design SSoT: `Spec/prototype/New_Dropdown.png` + `Spec/prototype/app.js`
  `openCreateMenu()` + `Spec/prototype/screens/firstContact.js` (canonical door
  wording). The prototype routes New pipeline/task/iterate to the wizard too; the
  honest app keeps those as the project's real expert actions and only ADDS the
  guided lead + register-manually — the wizard is about NEW/adopt/grade, the direct
  actions are project-scoped work.
- New shared module `client/src/components/external/CreateMenuIntentItems.tsx`:
  `CreateMenuHeading`, `GuidedWizardMenuItem` (→ `/wizard`), `RegisterManuallyMenuItem`
  (→ `/projects?new=1`). Radix `DropdownMenu.Item`-based, `useNavigate`.
- Register-manually target = `/projects?new=1` (ProjectsPage owns the single
  `ProjectWizard` dialog; no duplicated dialog, proper gallery backdrop, no new
  route). Guided target = `/wizard`.
- All-Projects is the honest adaptation of the flat screenshot menu: the middle
  items stay a project-first cascade because there is no active project; Guided +
  Register need no project and sit at top/bottom.
- Canonical geometry only (DO-NOT #26): all triggers on `.btn-primary` /
  `.btn-primary-split`; `ShipsLogPage.tsx` joins the create-cta registry.

## Affected Boundaries
No serialized producer/consumer format changes. Navigation-only (`/wizard`,
`/projects?new=1`) + Radix menu composition. `n/a` — this is UI wiring, no env/JSON
round-trip is introduced.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a |

## Confidence Calibration
- **Boundaries touched:** none (UI navigation + menu composition only).
- **Empirical probes run:** (1) create-cta-standard guard re-run after adding
  ShipsLogPage to the registry — green; (2) full client vitest — green; (3) tsc
  --noEmit — clean; (4) F0.5 real-browser smoke driving each surface's Guided →
  `/wizard` and Register → `/projects?new=1` with the wizard dialog opening.
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | Board single-project menu shows Guided (recommended) → /wizard | tested | CreateMenuSplitButton.test PASSED |
  | 2 | Board single-project menu shows Register manually → /projects?new=1 | tested | CreateMenuSplitButton.test PASSED |
  | 3 | All-Projects cascade (desktop) shows Guided + Register | tested | ProjectCreateCascade.test PASSED |
  | 4 | All-Projects phone menu shows Guided + Register | tested | ProjectCreatePhoneMenu.test PASSED |
  | 5 | Projects "Create Project" (header+empty) → /wizard | tested | ProjectsPage.test PASSED |
  | 6 | /projects?new=1 auto-opens the expert ProjectWizard | tested | ProjectsPage.test PASSED |
  | 7 | DoorPicker register line → /projects?new=1 | tested | IntentWizard/DoorPicker test PASSED |
  | 8 | Ship's Log header launcher shows Guided + Register + navigates | tested | ShipsLogPage.test PASSED |
  | 9 | Shared intent-items render both affordances with correct routes | tested | CreateMenuIntentItems.test PASSED |
  | 10 | create-cta guard: every trigger on .btn-primary, registry incl. ShipsLogPage | tested | create-cta-standard.test PASSED |
  | 11 | End-to-end: each surface reaches the wizard / registration in a real browser | tested | F0.5 web surface_verification |

- **Confidence-pattern check:** asymptote — no "are you confident?"→yes→later-finding
  loop this run; each behavior has an executed test. coverage — all 11 rows `tested`,
  0 untested-testable.

## Verification (medium+)
- **Surface:** web
- **Runner command:** isolated built-client stack (temp USERPROFILE) + Playwright
  smoke driving the four create surfaces → wizard / registration (F0.5 web).
- **Evidence path:** `.shipwright/agent_docs/iterates/<run_id>` + F0.5 surface block.
- **Justification (only if surface=none):** n/a — a startable web surface exists.
