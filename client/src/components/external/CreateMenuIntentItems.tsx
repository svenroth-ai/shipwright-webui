/*
 * Shared "Intent launcher" menu affordances
 * (iterate-2026-07-23-intent-launcher-front-door).
 *
 * The guided Intent Wizard (A08/A09, FR-01.51) was built but unreachable from any
 * create button in normal operation. These rows make it the FRONT DOOR and are the
 * SINGLE SOURCE of the entry — composed into the Board single-project menu
 * (CreateMenuSplitButton), the All-Projects cascade (ProjectCreateCascade /
 * ProjectCreatePhoneMenu) and the Ship's Log launcher — so the label + route can
 * never drift per surface.
 *
 * Routes are app routes, NOT hardcoded slash-commands (DO-NOT #11 is about Claude
 * commands / phase strings, which these are not):
 *   - Guided            → /wizard          (the three-door picker)
 *   - Register manually → /projects?new=1  (ProjectsPage auto-opens the ONE expert
 *     ProjectWizard dialog — no duplicated dialog, no extra route)
 *
 * Layout mirrors CreateMenuSplitButton's dropdown item shape (28px rounded icon
 * tile + label). These render menu ITEMS, not a create-CTA trigger, so they carry
 * no `*-{button,trigger,primary,caret}` testid and are intentionally NOT in the
 * create-cta-standard registry (which guards the trigger ELEMENTS).
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FolderPlus, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

/** The two entry routes — exported so tests + callers reference one constant. */
export const GUIDED_WIZARD_ROUTE = "/wizard";
export const REGISTER_MANUALLY_ROUTE = "/projects?new=1";

const ITEM_CLS =
  "flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] " +
  "text-[var(--color-text)] outline-none focus:bg-[var(--color-muted-bg)] " +
  "hover:bg-[var(--color-muted-bg)]";

/** "START SOMETHING" section heading (New_Dropdown.png). Radix `Label` so the
 *  group heading is exposed to assistive tech, not just a bare div. */
export function CreateMenuHeading() {
  return (
    <DropdownMenu.Label
      className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]"
      data-testid="create-menu-heading"
    >
      Start something
    </DropdownMenu.Label>
  );
}

/** Thin divider between the framing rows and the direct actions (role=separator). */
export function CreateMenuSeparator() {
  return (
    <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border)]" />
  );
}

/** The recommended lead item — opens the guided three-door wizard. */
export function GuidedWizardMenuItem() {
  const navigate = useNavigate();
  return (
    <DropdownMenu.Item
      data-testid="create-menu-guided"
      onSelect={() => navigate(GUIDED_WIZARD_ROUTE)}
      className={ITEM_CLS}
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
        style={{ background: "#CCFBF1", color: "#0F766E" }}
      >
        <Sparkles size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium leading-tight text-[var(--color-text)]">
          Guided — Intent Wizard
        </span>
      </span>
      <span className="ml-2 shrink-0 text-[11px] text-[var(--color-muted)]">
        recommended
      </span>
    </DropdownMenu.Item>
  );
}

/** The always-present escape hatch — register an already-set-up repo. */
export function RegisterManuallyMenuItem() {
  const navigate = useNavigate();
  return (
    <DropdownMenu.Item
      data-testid="create-menu-register-manually"
      onSelect={() => navigate(REGISTER_MANUALLY_ROUTE)}
      className={ITEM_CLS}
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--color-muted)]"
      >
        <FolderPlus size={16} strokeWidth={1.7} />
      </span>
      <span className="flex-1">Register a project manually…</span>
    </DropdownMenu.Item>
  );
}
