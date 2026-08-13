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
 *
 * Real title bar (iterate-2026-08-13-mission-mobile-visual): the back row
 * used to be a full-width `DropdownMenu.Item` ("‹ {project name}") that
 * combined navigation and the label as one row, so the drill-down read as a
 * flat list rather than a designed two-screen flow. A header band now sits
 * above the rows on both levels — "New — choose a project" on level 1, a
 * back-chevron + the picked project's name on level 2 — border-separated
 * from the list below. The chevron STAYS a `DropdownMenu.Item` (not a plain
 * sibling `<button>`, which an earlier version of this fix used and which
 * code review caught: Radix's Collection-based arrow-key/Tab nav inside
 * `DropdownMenu.Content` only sees `Item`s, so a plain button is keyboard-
 * unreachable) — it just carries a square icon-only className instead of a
 * full-width row.
 * Deliberately still `DropdownMenu.Content`, not a `Dialog` bottom sheet:
 * `GuidedWizardMenuItem`/`RegisterManuallyMenuItem`/`CreateMenuHeading` are
 * the SINGLE shared source of those rows across three surfaces (this file,
 * `CreateMenuSplitButton`, `ProjectCreateCascade`) and are Radix
 * `DropdownMenu.Item`-coupled — swapping the outer primitive here would
 * either fork them or force a matching change on the other two surfaces,
 * well past what this pass's visual scope covers. Radix's own Popper
 * positioning is also fixed-position via inline styles, which a CSS-only
 * "pin to the viewport bottom" override would be fighting rather than using.
 * A plain header band closes the "reads as an afterthought" gap without
 * that risk; a true fixed bottom sheet is a follow-up if still wanted after
 * this ships.
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
import {
  CreateMenuHeading,
  CreateMenuSeparator,
  GuidedWizardMenuItem,
  RegisterManuallyMenuItem,
} from "./CreateMenuIntentItems";
import type { Project } from "../../types";

export function ProjectCreatePhoneMenu({
  projects,
  onSelect,
  isLoading = false,
}: ProjectCascadeProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Project | null>(null);
  // Enabled even at zero projects — the guided front door + register-manually
  // rows need no project (iterate-2026-07-23-intent-launcher-front-door).
  const disabled = isLoading;
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
              <>
                <div
                  className="mb-1 border-b border-[var(--color-border)] px-2.5 pb-2 pt-1"
                  data-testid="create-menu-cascade-title"
                >
                  <span className="text-[13px] font-semibold text-[var(--color-text)]">
                    New — choose a project
                  </span>
                </div>
                {/* Guided + register-manually frame the project drill-down
                    (iterate-2026-07-23-intent-launcher-front-door). */}
                <CreateMenuHeading />
                <GuidedWizardMenuItem />
                <CreateMenuSeparator />
                {projects.length === 0 ? (
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
                )}
                <CreateMenuSeparator />
                <RegisterManuallyMenuItem />
              </>
            ) : (
              <>
                <div
                  className="mb-1 flex items-center gap-1.5 border-b border-[var(--color-border)] px-1 pb-2 pt-1"
                  data-testid="create-menu-cascade-title"
                >
                  <DropdownMenu.Item
                    data-testid="create-menu-phone-back"
                    // Drill back out instead of closing the menu — same
                    // preventDefault()-on-select pattern the project rows use
                    // above, so Radix's roving focus keeps this control
                    // keyboard-reachable (a plain sibling <button> is invisible
                    // to DropdownMenu.Content's Collection-based arrow-key nav).
                    onSelect={(e) => {
                      e.preventDefault();
                      setPicked(null);
                    }}
                    aria-label="Back to project list"
                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--color-muted)] outline-none focus:bg-[var(--color-muted-bg)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)]"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </DropdownMenu.Item>
                  <span className="truncate text-[13px] font-semibold text-[var(--color-text)]">
                    New — {picked.name}
                  </span>
                </div>
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
