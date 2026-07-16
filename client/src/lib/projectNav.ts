/*
 * projectNav.ts — the SINGLE navigation seam a project card uses to "open" a
 * project (A15, campaign webui-wow-usability-2026-07-10, FR-01.59).
 *
 * A16 (FR-01.60) RE-POINTED this one function at the real Ship's-Log home,
 * `/projects/:projectId/log` (client/src/pages/ShipsLogPage.tsx). One function,
 * one edit — A15's card click + `.lc-open` now land on the logbook for free.
 * The active-project filter is still set so the board "Open board" escape (and
 * any board the user opens next) stays scoped to this project.
 *
 * There is deliberately ONE navigation path here — no second seam, no leftover
 * interim `/?projectId=` board destination (spec AC1).
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
  navigate(`/projects/${encodeURIComponent(projectId)}/log`);
}
