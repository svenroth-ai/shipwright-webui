import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useStandaloneView } from "../../lib/standaloneView";

/** Route guard: with the Standalone view on, the page is not reachable — send the user to the board. */
export function HiddenInStandaloneView({ children }: { children: ReactNode }) {
  const standaloneView = useStandaloneView();
  const { projectId } = useParams();
  // A bookmarked /projects/:id/log keeps its project scope on the board.
  const to = projectId ? `/?projectId=${encodeURIComponent(projectId)}` : "/";
  return standaloneView ? <Navigate to={to} replace /> : <>{children}</>;
}
