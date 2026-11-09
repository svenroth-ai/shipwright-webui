/*
 * Shared class strings for the Triage toolbar menus — the same Radix
 * dropdown look as BoardStatusFilter (tokens only), kept in one place so
 * the funnel, Group, Sort and Snooze menus cannot drift apart.
 */

export const MENU_CONTENT =
  "z-50 min-w-[200px] max-h-[70vh] overflow-y-auto rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-sm shadow-[var(--shadow-card)]";

export const MENU_ITEM =
  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-muted-bg)]";

export const MENU_LABEL =
  "px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]";

export const MENU_SEPARATOR = "my-1 h-px bg-[var(--color-border)]";

export const MENU_COUNT = "font-mono text-[10px] text-[var(--color-muted)]";

export const MENU_CHECK = "flex h-4 w-4 items-center justify-center text-[var(--color-primary)]";

/** Text trigger in the PageHead (Group / Sort), same shell as the icon funnel. */
export const TOOLBAR_BUTTON =
  "relative inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-button)] pointer-coarse:min-h-[44px] border-[1.5px] border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)] data-[active]:border-[var(--color-primary)] data-[active]:text-[var(--color-primary)]";

export const TOOLBAR_ICON_BUTTON =
  "relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] pointer-coarse:min-h-[44px] border-[1.5px] border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)] data-[active]:border-[var(--color-primary)] data-[active]:text-[var(--color-primary)]";
