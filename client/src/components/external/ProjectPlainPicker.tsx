/*
 * Plain Claude project picker for All-Projects mode (single `new-plain`).
 *
 * Split out of ProjectCreateCascade.tsx to keep that file under the 300-LOC
 * ceiling once the intent-launcher front-door rows landed
 * (iterate-2026-07-23-intent-launcher-front-door; cohesive file-level split per
 * ADR-101/103, not a per-handler slice). It shares the lazy loader + surface
 * tokens still exported by ProjectCreateCascade.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Terminal } from "lucide-react";

import {
  ProjectActionsLoader,
  ProjectDot,
  SURFACE_CLS,
  ROW_CLS,
  type ProjectCascadeProps,
} from "./ProjectCreateCascade";

/** Plain Claude project picker for All-Projects mode (single `new-plain`). */
export function ProjectPlainPicker({
  projects,
  onSelect,
  isLoading = false,
}: ProjectCascadeProps) {
  const disabled = isLoading || projects.length === 0;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid="plain-cascade-trigger"
          title="Plain Claude — choose a project"
          aria-label="Plain Claude — choose a project"
          className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-button)] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Terminal size={16} strokeWidth={1.7} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          data-testid="plain-cascade-content"
          className={`${SURFACE_CLS} min-w-[220px]`}
        >
          <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Plain Claude in…
          </div>
          {projects.map((p) => (
            <ProjectActionsLoader
              key={p.id}
              projectId={p.id}
              filter={(a) => a.id === "new-plain"}
              hideWhenEmpty
            >
              {(actions) => (
                <DropdownMenu.Item
                  data-testid={`plain-cascade-project-${p.id}`}
                  onSelect={() => onSelect(actions[0], p.id)}
                  className={ROW_CLS}
                >
                  <ProjectDot project={p} />
                  <span className="flex-1 truncate">{p.name}</span>
                </DropdownMenu.Item>
              )}
            </ProjectActionsLoader>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
