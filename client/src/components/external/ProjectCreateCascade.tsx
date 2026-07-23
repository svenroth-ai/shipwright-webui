/*
 * All-Projects create-menu cascade
 * (iterate-2026-06-02-all-projects-create-cascade).
 *
 * When the Task Board filter is "All Projects" there is no single active
 * project, so the flat `CreateMenuSplitButton` (which renders one project's
 * action set) can't apply. Instead the create affordances become PROJECT-FIRST:
 *
 *   - `ProjectCreateMenu`  — two-level cascade. Level 1 = projects; each opens
 *     a submenu of THAT project's actions (lazy, via `useProjectActions`).
 *     Selecting an action carries the `(action, projectId)` tuple so the modal
 *     opens scoped to exactly one project — no action/schema mismatch.
 *   - `ProjectPlainPicker` — one-level project picker for Plain Claude (a
 *     single `new-plain` action). Projects whose actions.json omits `new-plain`
 *     are hidden, mirroring the single-project PlainClaudeButton.
 *   - `ProjectActionsLoader` — the shared lazy per-project loader. Radix-
 *     agnostic render-prop (testable in isolation); the consumer wraps the
 *     emitted actions in Radix items.
 *
 * No aggregation / union of actions, and no eager fetch-all: each project's
 * catalog loads only when its row/submenu mounts. Single-project mode keeps
 * using the flat `CreateMenuSplitButton` — see `CreateControls`.
 */

import type { ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight, Loader2, Plus } from "lucide-react";

import { useProjectActions } from "../../hooks/useProjectActions";
import { useIsPhoneViewport } from "../../hooks/useIsCompactViewport";
import { getProjectColor } from "../../lib/projectColor";
import { ProjectCreatePhoneMenu } from "./ProjectCreatePhoneMenu";
import {
  CreateMenuHeading,
  CreateMenuSeparator,
  GuidedWizardMenuItem,
  RegisterManuallyMenuItem,
} from "./CreateMenuIntentItems";
import type { ActionDefinition } from "../../lib/externalApi";
import type { Project } from "../../types";

export const SURFACE_CLS =
  "z-50 rounded-[var(--radius-button)] border border-[var(--color-border)] " +
  "bg-[var(--color-surface)] p-1 shadow-[var(--shadow-card)]";
export const ROW_CLS =
  "flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-[13px] " +
  "text-[var(--color-text)] outline-none focus:bg-[var(--color-muted-bg)] " +
  "hover:bg-[var(--color-muted-bg)]";

export interface ProjectActionsLoaderProps {
  projectId: string;
  /** Keep only actions matching this predicate (default: keep all). */
  filter?: (a: ActionDefinition) => boolean;
  /** Render-prop — receives the filtered, non-empty action list. */
  children: (actions: ActionDefinition[]) => ReactNode;
  /** Placeholder copy when the filtered list is empty (ignored if hidden). */
  emptyLabel?: string;
  /** When true, render nothing (instead of a placeholder) on an empty list. */
  hideWhenEmpty?: boolean;
}

/**
 * Lazy per-project action loader. Mounted inside a Radix `SubContent`
 * (create cascade) or directly in `Content` (plain picker); either way the
 * `useProjectActions` query fires only when this node mounts, so the catalog
 * is fetched on demand. React Query's 30 s staleTime makes re-opens cache-hits.
 */
export function ProjectActionsLoader({
  projectId,
  filter,
  children,
  emptyLabel = "No actions",
  hideWhenEmpty = false,
}: ProjectActionsLoaderProps) {
  const { data, isLoading } = useProjectActions(projectId);

  if (isLoading && !data) {
    return (
      <div
        data-testid={`project-actions-loading-${projectId}`}
        className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-[var(--color-muted)]"
      >
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        <span>Loading…</span>
      </div>
    );
  }

  const actions = (data?.actions ?? []).filter(filter ?? (() => true));
  if (actions.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <div
        data-testid={`project-actions-empty-${projectId}`}
        className="px-2.5 py-2 text-[13px] text-[var(--color-muted)]"
      >
        {emptyLabel}
      </div>
    );
  }

  return <>{children(actions)}</>;
}

export function ProjectDot({ project }: { project: Project }) {
  if (project.synthesized) {
    return (
      <span
        aria-hidden="true"
        className="h-[10px] w-[10px] shrink-0 rounded-full border border-[var(--color-border)]"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="h-[10px] w-[10px] shrink-0 rounded-full"
      style={{ background: getProjectColor(project.id, project.settings?.color).hsl }}
    />
  );
}

export interface ProjectCascadeProps {
  /** Real projects (caller already filters out synthesized / unassigned). */
  projects: Project[];
  onSelect: (action: ActionDefinition, projectId: string) => void;
  isLoading?: boolean;
}

/** `+ New ▾` two-level cascade for All-Projects mode. On phones (≤767px) the
 *  side-opening submenu has no room and overflowed off-screen, so a flat
 *  downward drill-down replaces it (iterate-2026-06-15 phone-header-polish #1).
 *  Tablet/desktop keep the nested cascade below.
 *
 *  The trigger is the ONE canonical `.btn-primary` (styles/buttons.css) — same
 *  height, min-width, radius and teal as the Board's "New task" split button
 *  and the Projects page's "Create Project", so it also lands in the same place
 *  (iterate-2026-07-21-all-projects-new-button-parity). It is deliberately NOT
 *  the `.btn-primary-split` shape: All-Projects has no single default action a
 *  main half could fire — the whole button opens the project chooser. */
export function ProjectCreateMenu({
  projects,
  onSelect,
  isLoading = false,
}: ProjectCascadeProps) {
  const isPhone = useIsPhoneViewport();
  if (isPhone) {
    return (
      <ProjectCreatePhoneMenu
        projects={projects}
        onSelect={onSelect}
        isLoading={isLoading}
      />
    );
  }
  // NOT disabled at zero projects (iterate-2026-07-23-intent-launcher-front-door):
  // the menu now hosts project-INDEPENDENT onboarding rows (Guided → /wizard,
  // Register manually → /projects?new=1). On a fresh install (All-Projects, no
  // projects) the front door must be reachable — the old disable-at-zero fence
  // existed only when the menu held per-project actions alone.
  const disabled = isLoading;
  return (
    <div className="inline-flex" data-testid="create-menu-cascade">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            data-testid="create-menu-cascade-trigger"
            aria-label="New — choose a project"
            className="btn-primary shadow-sm"
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            <span>New</span>
            <ChevronDown size={12} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            data-testid="create-menu-cascade-content"
            className={`${SURFACE_CLS} min-w-[240px]`}
          >
            {/* Guided wizard leads even in All-Projects mode (it needs no active
                project); the per-project action submenus follow; register-manually
                closes (iterate-2026-07-23-intent-launcher-front-door). */}
            <CreateMenuHeading />
            <GuidedWizardMenuItem />
            <CreateMenuSeparator />
            {projects.length === 0 ? (
              <div className="px-2.5 py-2 text-[13px] text-[var(--color-muted)]">
                No projects yet
              </div>
            ) : (
              projects.map((p) => (
                <DropdownMenu.Sub key={p.id}>
                  <DropdownMenu.SubTrigger
                    data-testid={`create-menu-cascade-project-${p.id}`}
                    className={`${ROW_CLS} data-[state=open]:bg-[var(--color-muted-bg)]`}
                  >
                    <ProjectDot project={p} />
                    <span className="flex-1 truncate">{p.name}</span>
                    <ChevronRight
                      size={14}
                      className="text-[var(--color-muted)]"
                      aria-hidden="true"
                    />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent
                      sideOffset={4}
                      alignOffset={-4}
                      data-testid={`create-menu-cascade-actions-${p.id}`}
                      className={`${SURFACE_CLS} min-w-[240px] max-w-[280px]`}
                    >
                      <ProjectActionsLoader
                        projectId={p.id}
                        filter={(a) => a.id !== "new-plain"}
                        emptyLabel="No actions configured"
                      >
                        {(actions) =>
                          actions.map((a) => (
                            <DropdownMenu.Item
                              key={a.id}
                              data-testid={`create-menu-cascade-action-${p.id}-${a.id}`}
                              onSelect={() => onSelect(a, p.id)}
                              className="flex cursor-pointer flex-col rounded-[6px] px-2.5 py-2 text-[13px] text-[var(--color-text)] outline-none focus:bg-[var(--color-muted-bg)] hover:bg-[var(--color-muted-bg)]"
                            >
                              <span className="font-medium leading-tight">
                                {a.label}
                              </span>
                              {a.description && (
                                <span
                                  className="mt-[2px] text-[11px] text-[var(--color-muted)]"
                                  style={{ whiteSpace: "normal", lineHeight: 1.3 }}
                                >
                                  {a.description}
                                </span>
                              )}
                            </DropdownMenu.Item>
                          ))
                        }
                      </ProjectActionsLoader>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              ))
            )}
            <CreateMenuSeparator />
            <RegisterManuallyMenuItem />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
