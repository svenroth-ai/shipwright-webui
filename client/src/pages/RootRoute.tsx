/*
 * RootRoute — the "/" decision (iterate-2026-07-23-first-contact-hero, FR-01.51
 * delta). The fresh-install state the browser opens to: an EMPTY registry sends a
 * brand-new user to First Contact (redirected so the lighthouse backdrop resolves,
 * SceneBackdrop keys off the pathname); once ≥1 project is registered, "/" is the
 * Task Board as normal.
 *
 * The redirect fires ONLY on a successful, genuinely-empty registry. A still-
 * loading registry renders neither (no board flash); an errored/undefined result
 * falls through to the board — a transient projects-fetch failure must never
 * redirect an existing user away from their board.
 */

import { Navigate } from "react-router-dom";

import { useProjects } from "../hooks/useProjects";
import { useExternalTasks } from "../hooks/useExternalTasks";
import { UNASSIGNED_PROJECT_ID } from "../lib/projectIds";
import TaskBoardPage from "./TaskBoardPage";

export default function RootRoute() {
  const { data: projects } = useProjects();
  const { data: tasks } = useExternalTasks();

  const realProjects = (projects ?? []).filter(
    (p) => !p.synthesized && p.id !== UNASSIGNED_PROJECT_ID,
  );
  // First Contact is the TRUE fresh-install state: NO registered projects AND no
  // tasks anywhere. A user can have zero registered projects yet still own
  // genuinely-unassigned / discovered tasks — those surface only on the board's
  // "All projects" view at "/", so if ANY task exists "/" must stay the board or
  // that work becomes unreachable (doubt-review, iterate-2026-07-23).
  //
  // Redirect ONLY on a confirmed, successfully-loaded empty Command Center. While
  // either read is still loading (`data` undefined) OR a fetch failed, render the
  // board — TaskBoardPage shows its own skeleton immediately, so an existing user
  // (the common case) never waits behind a blank screen and a transient failure
  // never redirects them away. The redirect (vs an inline render) lets
  // SceneBackdrop resolve the lighthouse plate for "/first-contact" rather than
  // the board's deck-golden backdrop.
  const isFreshInstall =
    projects !== undefined &&
    realProjects.length === 0 &&
    tasks !== undefined &&
    tasks.length === 0;
  if (isFreshInstall) {
    return <Navigate to="/first-contact" replace />;
  }
  return <TaskBoardPage />;
}
