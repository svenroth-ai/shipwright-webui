/*
 * Phone (<768px) flat drill-down for the All-Projects "+ New" menu
 * (iterate-2026-06-15 phone-header-polish #1).
 *
 * The desktop/tablet `ProjectCreateMenu` uses a nested Radix submenu
 * (project → actions) that opens to the SIDE — on a 393px phone the submenu
 * has no horizontal room and overflowed off the left edge. This replacement
 * keeps everything DOWNWARD: level 1 is the project list; tapping a project
 * REPLACES the popup content with that project's actions (a back row returns
 * to the list). One popup, no side submenu, no off-screen overflow.
 *
 * Testids match the cascade (`create-menu-cascade-*`) so the same E2E/unit
 * selectors target both presentations. Action selection funnels through the
 * SAME `onSelect(action, projectId)` contract → existing NewIssueModal flow.
 *
 * The trigger carries the ONE canonical `.btn-primary` (styles/buttons.css),
 * identical to the desktop cascade — same button, smaller viewport
 * (iterate-2026-07-21-all-projects-new-button-parity).
 */

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";

import {
  ProjectActionsLoader,
  ProjectDot,
  SURFACE_CLS,
  ROW_CLS,
  type ProjectCascadeProps,
} from "./ProjectCreateCascade";
import type { Project } from "../../types";

export function ProjectCreatePhoneMenu({
  projects,
  onSelect,
  isLoading = false,
}: ProjectCascadeProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Project | null>(null);
  const disabled = isLoading || projects.length === 0;
  return (
    <div className="inline-flex" data-testid="create-menu-cascade">
      <DropdownMenu.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // Reset the drill-down whenever the menu closes so it reopens at the
          // project list, not a stale action sublist.
          if (!o) setPicked(null);
        }}
      >
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
            collisionPadding={8}
            data-testid="create-menu-cascade-content"
            className={`${SURFACE_CLS} max-h-[70vh] w-[min(88vw,320px)] overflow-y-auto`}
          >
            {picked === null ? (
              projects.length === 0 ? (
                <div className="px-2.5 py-2 text-[13px] text-[var(--color-muted)]">
                  No projects yet
                </div>
              ) : (
                projects.map((p) => (
                  <DropdownMenu.Item
                    key={p.id}
                    data-testid={`create-menu-cascade-project-${p.id}`}
                    // Drill in instead of closing the menu.
                    onSelect={(e) => {
                      e.preventDefault();
                      setPicked(p);
                    }}
                    className={ROW_CLS}
                  >
                    <ProjectDot project={p} />
                    <span className="flex-1 truncate">{p.name}</span>
                    <ChevronRight
                      size={14}
                      className="text-[var(--color-muted)]"
                      aria-hidden="true"
                    />
                  </DropdownMenu.Item>
                ))
              )
            ) : (
              <>
                <DropdownMenu.Item
                  data-testid="create-menu-phone-back"
                  onSelect={(e) => {
                    e.preventDefault();
                    setPicked(null);
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12px] font-medium text-[var(--color-muted)] outline-none focus:bg-[var(--color-muted-bg)] hover:bg-[var(--color-muted-bg)]"
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                  <span className="truncate">{picked.name}</span>
                </DropdownMenu.Item>
                <div
                  className="my-1 h-px bg-[var(--color-border)]"
                  aria-hidden="true"
                />
                <ProjectActionsLoader
                  projectId={picked.id}
                  filter={(a) => a.id !== "new-plain"}
                  emptyLabel="No actions configured"
                >
                  {(actions) =>
                    actions.map((a) => (
                      <DropdownMenu.Item
                        key={a.id}
                        data-testid={`create-menu-cascade-action-${picked.id}-${a.id}`}
                        onSelect={() => onSelect(a, picked.id)}
                        className="flex cursor-pointer flex-col rounded-[6px] px-2.5 py-2 text-[13px] text-[var(--color-text)] outline-none focus:bg-[var(--color-muted-bg)] hover:bg-[var(--color-muted-bg)]"
                      >
                        <span className="font-medium leading-tight">{a.label}</span>
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
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
