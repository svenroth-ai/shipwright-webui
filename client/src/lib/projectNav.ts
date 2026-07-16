/*
 * projectNav.ts — the SINGLE navigation seam a project card uses to "open" a
 * project (A15, campaign webui-wow-usability-2026-07-10, FR-01.59).
 *
 * ⚠️ A16 (Ship's-Log project home) re-points THIS one function at
 * `/projects/:projectId/log`. Today it does exactly what a Projects row click
 * has always done: set the active-project filter and land on the EXISTING
 * project view (the task board, filtered to that project). One function, one
 * call-site, one edit — so A16 never has to hunt through the card markup for
 * the navigation.
 *
 * There is deliberately NO `/projects/:id/log` route yet: a dead route that
 * renders a placeholder / skeleton / "coming soon" panel is a lie with a URL
 * (spec AC4). Because the interim destination is the board (not a logbook),
 * the affordance is honestly labelled "Open board" until A16 ships the real
 * Ship's-Log home and renames it.
 */

export interface OpenProjectLogDeps {
  /** From `useProjectFilter()` — the single source of truth for the filter. */
  setActiveProjectId: (id: string | null) => void;
  /** From `useNavigate()`. */
  navigate: (to: string) => void;
}

export function openProjectLog(
  projectId: string,
  { setActiveProjectId, navigate }: OpenProjectLogDeps,
): void {
  setActiveProjectId(projectId);
  navigate(`/?projectId=${encodeURIComponent(projectId)}`);
}
