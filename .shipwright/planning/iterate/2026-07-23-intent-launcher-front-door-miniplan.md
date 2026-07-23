# Mini-Plan: intent-launcher-front-door

**Run ID:** iterate-2026-07-23-intent-launcher-front-door

## Approach (chosen)
Add a shared, single-source pair of menu affordances — **Guided — Intent Wizard**
(→ `/wizard`) and **Register a project manually…** (→ `/projects?new=1`) — and
compose them into every existing create surface, rather than rewriting the create
cluster. Register-manually reuses the ONE `ProjectWizard` dialog already owned by
ProjectsPage (opened via `?new=1`); no dialog duplication, no new route.

## Alternative (rejected)
A brand-new unified "Intent launcher" component replacing CreateMenuSplitButton +
ProjectCreateCascade + the plain buttons everywhere, plus a dedicated `/wizard/manual`
route hosting a second ProjectWizard instance. **Rejected:** larger blast radius on a
`touches_shared_infra` cluster, duplicates the ProjectWizard dialog (drift risk), and
a modal-on-blank-route reads worse than the modal over the projects gallery. The
compose-shared-items approach delivers the same UX with far less risk.

## Steps (TDD)
1. New `CreateMenuIntentItems.tsx` (heading + Guided item + Register item) + test.
2. Compose into `CreateMenuSplitButton` (single-project) + test update.
3. Compose into `ProjectCreateCascade` + `ProjectCreatePhoneMenu` (All-Projects) + tests.
4. `ProjectsPage`: Create → `/wizard`; `?new=1` auto-opens ProjectWizard + test.
5. `DoorPicker`: register line → `/projects?new=1` + test.
6. `ShipsLogPage`: `.btn-primary` "New ▾" launcher (Guided + Register) + test;
   add ShipsLogPage to the create-cta registry.
7. `create-cta-standard.test.ts`: register ShipsLogPage.
8. Full suite + tsc + F0.5 web smoke. FR-01.51 MODIFY at F11.

## Approval
Scope pre-approved by Sven this session (converged over three messages) with an
explicit "mach das so … starte autonom durch". Proceeding without a fresh gate.
