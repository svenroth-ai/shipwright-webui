/*
 * CreateControls — the Task Board header right-cluster
 * (iterate-2026-06-02-all-projects-create-cascade).
 *
 * Extracted from TaskBoardPage (which is at its 675-LOC bloat ceiling, zero
 * headroom) to house the flat-vs-cascade branch cohesively:
 *
 *   - single-project scope (`activeProjectId !== null`): the flat
 *     `PlainClaudeButton` + `CreateMenuSplitButton` (unchanged), plus
 *     `PreviewButton` gated separately on `resolvedProjectId ===
 *     activeProjectId` — a genuine selection, not the fallback that also
 *     covers the synthesized "Unassigned" pseudo-project (see
 *     `resolvedProjectId`'s prop doc below). `onSelect` fires with no
 *     projectId (the page falls back to the scoped/active project).
 *   - All-Projects (`activeProjectId === null`): `ProjectPlainPicker` +
 *     `ProjectCreateMenu` — project-first cascades. `onSelect` carries the
 *     chosen `projectId`.
 *
 * The cluster lives in the SHARED Task Board header (above the board/list view
 * switch), so this applies identically to both Board and List views.
 */

import { CreateMenuSplitButton } from "./CreateMenuSplitButton";
import { PlainClaudeButton } from "./PlainClaudeButton";
import { PreviewButton } from "./PreviewButton";
import { ProjectCreateMenu } from "./ProjectCreateCascade";
import { ProjectPlainPicker } from "./ProjectPlainPicker";
import type { ActionDefinition } from "../../lib/externalApi";
import type { Project } from "../../types";

export interface CreateControlsProps {
  /** Active filter — null = "All Projects" (cascade), else single-project (flat). */
  activeProjectId: string | null;
  /**
   * Project whose actions feed flat mode + PreviewButton. TaskBoardPage
   * falls back to `realProjects[0]` (see `resolvedProjectId`'s own
   * computation there) whenever `activeProjectId` is null (All Projects)
   * OR the synthesized "Unassigned" pseudo-project — both are places with
   * no genuine single-project selection. `resolvedProjectId ===
   * activeProjectId` is the actual "is this a real selection" test; do not
   * substitute `activeProjectId !== null` for it, that misses Unassigned.
   */
  resolvedProjectId: string | null;
  /** Real projects (synthesized / unassigned already filtered out). */
  realProjects: Project[];
  /** Resolved actions for `resolvedProjectId` (flat mode only). */
  actionsList: ActionDefinition[];
  actionsLoading: boolean;
  previewEnabled: boolean;
  previewReadyTimeoutSeconds: number | null;
  /** projectId is set ONLY in cascade mode (the chosen project). */
  onSelect: (action: ActionDefinition, projectId?: string) => void;
}

export function CreateControls({
  activeProjectId,
  resolvedProjectId,
  realProjects,
  actionsList,
  actionsLoading,
  previewEnabled,
  previewReadyTimeoutSeconds,
  onSelect,
}: CreateControlsProps) {
  const allProjects = activeProjectId === null;
  return (
    <div className="flex items-center gap-2">
      {allProjects ? (
        <>
          <ProjectPlainPicker
            projects={realProjects}
            onSelect={onSelect}
            isLoading={actionsLoading}
          />
          <ProjectCreateMenu
            projects={realProjects}
            onSelect={onSelect}
            isLoading={actionsLoading}
          />
        </>
      ) : (
        <>
          {/* iterate-2026-08-09-triage-filter-styling: Preview spawns a dev
              server for ONE project — it has no meaning in All-Projects
              cascade mode OR while viewing the synthesized "Unassigned"
              pseudo-project, both of which leave resolvedProjectId as just
              the first real project used as an actions-dropdown fallback,
              not a genuine selection. `resolvedProjectId === activeProjectId`
              is true only when activeProjectId really is that project. */}
          {resolvedProjectId === activeProjectId && (
            <PreviewButton
              projectId={resolvedProjectId}
              enabled={previewEnabled}
              readyTimeoutSeconds={previewReadyTimeoutSeconds}
            />
          )}
          <PlainClaudeButton
            actions={actionsList}
            onSelect={(a) => onSelect(a)}
            isLoading={actionsLoading}
          />
          <CreateMenuSplitButton
            actions={actionsList.filter((a) => a.id !== "new-plain")}
            onSelect={(a) => onSelect(a)}
            isLoading={actionsLoading}
          />
        </>
      )}
    </div>
  );
}
