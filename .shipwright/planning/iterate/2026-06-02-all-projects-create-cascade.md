# Iterate Spec — All-Projects create-menu cascade

- **Run ID:** `iterate-2026-06-02-all-projects-create-cascade`
- **Intent:** CHANGE (modify existing behavior) — Spec Impact: **MODIFY**
- **Complexity:** medium (classifier said `small`/0.75; escalated — 3–4 interacting
  files, load-bearing primary surface, latent correctness bug, real E2E needed)
- **Date:** 2026-06-02
- **Branch / worktree:** `iterate/all-projects-create-cascade`

## Problem

On the Task Board, the `+ New ▾` create-menu (`CreateMenuSplitButton`) and the
sibling Plain-Claude button render the action set of **exactly one** project.
In **single-project** filter mode that project is the selected one — correct.
In **"All Projects"** mode (`activeProjectId === null`) the page falls back to
the *most-recently-active* real project (`TaskBoardPage.tsx:144-150`,
`project-manager.ts:216-220` sorts `lastActive` desc) and pins the menu — and
the modal — to that one project.

Consequences (user-reported 2026-06-02):
1. The global create-menu shows one arbitrary project's actions. A custom
   `.shipwright-webui/actions.json` (e.g. content-marketing: Orchestrate /
   Research / Create) **fully replaces** the defaults
   (`project-actions-loader.ts:193-224` — no merge), so "All Projects" shows
   whichever project was touched last, non-deterministically.
2. Custom actions of any non-most-recent project are **unreachable** in
   "All Projects".
3. **Latent correctness bug.** The modal exposes a project selector in
   All-Projects mode (`SimpleFields.tsx:39-56`), but `projectActions` stays
   pinned to the most-recent project (`TaskBoardPage.tsx:474`). Launch/create
   send `actionId + projectId` and the server re-resolves the action against
   `projectId` (`useNewIssueFormSubmit.ts:103-105,153`) — while `phases` /
   `currentSchema` were built from the *wrong* project's catalog. Switching the
   target project to one whose `actions.json` lacks that `actionId` launches
   against a mismatched schema (invalid phase / 404 actionId).

A union of all projects' buttons is **not** a fix: it does not scale (N×actions
in one flat menu) and is semantically wrong (different command templates /
phases mashed together). Confirmed rejected by the user.

## Solution

In **All-Projects mode only**, make creation **project-first via a two-level
cascade** — the project choice becomes part of the click, so the action set is
always resolved for a concrete project:

```
+ New ▾
 ├─ Webui            ▸  New Task / New Pipeline / New Iterate
 ├─ Content Marketing▸  Orchestrate / Research / Create
 └─ Project C        ▸  …
```

- First level = real projects (sorted `lastActive` desc, same order as today).
- Second level (lazy `DropdownMenu.Sub`) = that project's actions, fetched on
  sub-open via `useProjectActions(projectId)` (staleTime 30 s; cached). **No
  eager fetch-all, no aggregation.**
- Clicking an action carries the `(action, projectId)` tuple. The modal opens
  scoped to that project: `initialProjectId = projectId`, `projectActions =
  useProjectActions(projectId)` (cache-hit from the submenu) → `action`,
  `phases`, `currentSchema`, and the launch `projectId` all belong to the **same**
  project. Fixes consequence #3.
- **Plain Claude** (single `new-plain` action): same cascade, one level — a
  project picker; selecting project P opens the plain modal scoped to P. Lazy
  per-project resolution (item hidden when P's `actions.json` omits `new-plain`,
  mirroring today's single-project hide).
- **Single-project mode is unchanged** — flat `CreateMenuSplitButton` +
  `PlainClaudeButton` + locked `ProjectContextStrip` in the modal, byte-for-byte
  as today. The project level appears ONLY when `activeProjectId === null`.
- **All-Projects primary button**: no quick-fire default (no unambiguous
  primary) → the `+ New` control becomes a plain menu-opener in that mode.
- **Board filter after create**: stays on "All Projects" (no hidden filter
  mutation) — confirmed with user.

### Decisions / non-goals
- **`i` shortcut** (New Iterate) stays bound to the resolved (most-recent /
  active) project even in All-Projects — a keyboard shortcut cannot express a
  project choice. Unchanged behavior; documented, not "fixed".
- **`continue-pipeline`** synthetic action stays scoped to single-project mode
  (it depends on one project's run-config). NOT shown in the All-Projects
  cascade. The Pipelines lane + single-project view already cover it.
- **PreviewButton** in All-Projects keeps using the most-recent project
  (out of scope; unchanged).

### Architecture / files
- **NEW `client/src/components/external/CreateControls.tsx`** — header
  right-cluster wrapper. Branches flat (single-project, current JSX verbatim)
  vs cascade (All-Projects). *Justified by the bloat ceiling:* `TaskBoardPage.tsx`
  is grandfathered at **675/675 LOC (zero headroom)** — the cluster MUST move
  out so the page nets ≤ 675 and the anti-ratchet hook does not hard-block.
- **NEW `client/src/components/external/ProjectCreateCascade.tsx`** — the
  All-Projects `+ New` two-level cascade + Plain-Claude project picker + a
  shared lazy `useProjectActions` item-loader. < 300 LOC.
- **EDIT `client/src/pages/TaskBoardPage.tsx`** — replace the inline cluster
  with `<CreateControls/>`; add `modalProjectId` state + `modalActionsQuery`;
  `openModal(action, projectId?)`; pass `initialProjectId={modalProjectId}`
  (undefined in flat mode → preserves locked context-strip) and
  `projectActions={modalActionsQuery.data}`. Net LOC ≤ 0.
- **NO change to** `CreateMenuSplitButton.tsx`, `PlainClaudeButton.tsx`
  (reused as-is in flat mode), `NewIssueModal/*` logic (only new prop *values*
  flow through the existing `initialProjectId` / `projectActions` props).
- **Doc-sync**: add `CreateControls` + `ProjectCreateCascade` to
  `doc-sync.test.ts` REQUIRED_TOKENS and mention both in `architecture.md` /
  `component_inventory.md` (DO-NOT rule 11 / Test-Update-Klausel).

## Acceptance Criteria

- **AC1** — In All-Projects mode, `+ New ▾` shows a project level; expanding a
  project shows *that project's* actions (from its own `actions.json`), not a
  union and not one fixed project's set.
- **AC2** — Selecting an action under project P opens the NewIssueModal scoped
  to P: the project field resolves to P and the launch/create payload carries
  `projectId = P` with an `actionId` that exists in P's catalog (no schema
  mismatch). *(regression-pins consequence #3)*
- **AC3** — In single-project filter mode the create-menu and modal are
  unchanged (flat split-button; modal shows the locked project context strip).
- **AC4** — Per-project actions load lazily (only on submenu open); no eager
  fetch of every project's actions when the page or the top menu renders.
- **AC5** — Plain Claude in All-Projects opens a project picker; selecting P
  starts a plain session scoped to P; projects without `new-plain` are not
  offered.
- **AC6** — Board project filter is unchanged after creating from the cascade
  (stays "All Projects").

## Mini-Plan

**Chosen approach:** Two-level cascade (above), extract `CreateControls` +
`ProjectCreateCascade`, lazy per-project `useProjectActions`, modal scoped via
`initialProjectId` + a page-level `modalActionsQuery`.

**Alternatives considered & rejected:**
- **A. Flat grouped menu** (all projects' actions under project headers in one
  menu) — rejected: doesn't scale (N×actions), user rejected aggregation.
- **B. Disable `+ New` in All-Projects / require project pick first** —
  rejected: user rejected a blocking pre-step ("doof").
- **C. Keep most-recent actions, fix only the modal mismatch** (re-fetch
  `projectActions` when the modal's project selector changes) — rejected: the
  *button's* action set is still limited to one project at click time; other
  projects' custom actions stay unreachable. User rejected (b).

**Build order (TDD):**
1. RED: unit test `ProjectCreateCascade` — renders project level; expanding a
   project lazily renders its actions; `onSelect(action, projectId)` fires with
   both. Plain picker variant.
2. GREEN: implement `ProjectCreateCascade` (+ lazy item loader).
3. RED: unit test `CreateControls` — flat branch renders `CreateMenuSplitButton`
   (single-project); cascade branch renders `ProjectCreateCascade` (All-Projects).
4. GREEN: implement `CreateControls`; wire into `TaskBoardPage`; add
   `modalProjectId` + `modalActionsQuery`; `openModal(a, projectId?)`.
5. RED→GREEN: modal-scoping test — opening with `initialProjectId=P` +
   `projectActions=P` yields `selectedProject=P` and a create payload with
   `projectId=P` (pins AC2 / consequence #3).
6. Verify LOC: `TaskBoardPage.tsx` ≤ 675 (anti-ratchet); new files < 300.
7. Doc-sync tokens + architecture.md / component_inventory.md.
8. E2E `client/e2e/flows/` — All-Projects create flow + Plain Claude picker.

## Affected Boundaries
- React Query cache keying (`["project-actions", projectId]`) — per-project
  fetch fan-out in the cascade.
- `NewIssueModal` props contract (`initialProjectId`, `projectActions`) — value
  flow only, no shape change.
- No server / IO / persistence boundary touched. No `touches_io_boundary`.
  (`touches_migrations` risk flag is a false positive — no DB/migrations exist.)

## Confidence Calibration
- **Boundaries touched:** React Query cache (`["project-actions", projectId]`)
  per-project fan-out; `NewIssueModal` props (`initialProjectId`,
  `projectActions`) — value flow only, no shape change. No IO/network/auth/
  persistence boundary.
- **Empirical probes run:**
  - LOC: `TaskBoardPage.tsx` 673 ≤ 675 (anti-ratchet safe); new files 279 / 90
    (< 300) — `wc -l`.
  - `tsc --noEmit` exit 0; `oxlint` exit 0 on all changed files.
  - Full client vitest: **135 files / 1416 tests pass**, incl `doc-sync` (34)
    with the two new tokens resolving against `component_inventory.md`.
  - Real-browser E2E (spec 90) against an isolated single-process stack (built
    SPA + `SHIPWRIGHT_STATIC_DIR`, temp `USERPROFILE`, `:3947`, local net
    profile): **passed** — cascade scopes New + Plain to the chosen project,
    list-view shares the header, AC3 round-trip flat split-button returns, AC6
    filter stays "All projects". exit 0.
- **Test Completeness Ledger:**

  | AC | Behavior | Disposition | Evidence |
  |----|----------|-------------|----------|
  | AC1 | Project level + that project's actions (lazy) | tested | `ProjectActionsLoader` unit (filter/loading/empty) + E2E (both project rows; submenu actions appear on open) |
  | AC2 | Modal scoped to chosen project | tested | `scoped-project-launch` unit (payload `projectId=proj-2`) + E2E (`new-issue-project-select` === a.id) |
  | AC3 | Single-project mode = flat (unchanged) | tested | `CreateControls` unit (branching) + E2E round-trip (split-button returns, cascade gone) |
  | AC4 | Per-project actions load lazily | tested | E2E (actions resolve only after a project submenu opens; loader mounted in `SubContent`) |
  | AC5 | Plain picker scopes to chosen project | tested | `ProjectPlainPicker` trigger unit + E2E (plain → project B → `new-plain` modal === b.id) |
  | AC6 | Board filter stays "All Projects" after cascade select | tested | E2E (`project-filter-dropdown` still reads "All projects" with modal open; no `setActiveProjectId` in the new path) |

  0 testable-but-untested behaviors.
- **Confidence-pattern check:** depth — the latent mismatch bug (consequence #3)
  is pinned at two layers (modal-contract unit + page-level E2E project-select);
  breadth — flat path, cascade path, plain path, list-view, and the
  cascade↔flat round-trip all exercised. Radix submenu *pointer* interaction is
  the one jsdom-hostile surface → covered by real-browser E2E (keyboard-select
  to dodge the portal hit-test flake), matching the repo's unit/E2E split.
