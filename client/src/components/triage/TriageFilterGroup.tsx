/*
 * TriageFilterGroup.tsx — one filter dimension rendered as togglable chips
 * (Priority / Domain / Complexity / Parked).
 *
 * iterate-2026-08-09-triage-filter-styling: restyled to match the Task
 * Board's own toggle-button chrome (`StatusFilterMenu`'s trigger,
 * `ViewToggle`'s segments) rather than the badge-derived tinted-pill look
 * the previous draft used — Sven compared this bar directly against the
 * Board and the two had drifted. Geometry now matches: `--radius-button`
 * (8px) corners, `1.5px` border.
 *
 * The EXCLUDE-set semantics (see TriageFilterSortBar.tsx's docstring) mean
 * every chip starts "on" (included) — the exception the eye needs to catch
 * is a chip the user turned OFF (excluded). So instead of painting every
 * default-on chip in `--color-primary` (a wall of teal at rest, and a state
 * indistinguishable from the hover affordance below by anything but hue),
 * only the MINORITY excluded state gets a second cue: `bg-[var(--color-inset)]`
 * + `line-through`. `line-through` is load-bearing, not decorative:
 * `--color-inset` (#F5F5F4) on the card's white ground is ~1.09:1 —
 * imperceptible as a fill on its own — so without it the only *visible*
 * signal would be color/lightness alone (WCAG 1.4.1). Never `--color-faint`
 * (contrast-ladder-reroled to hairline/decor-only, ~2.52:1) or
 * `--color-muted` (the ladder records `--muted` on `--inset` as FAILING,
 * ~4.39:1, short of the 4.5:1 body floor this chip's label needs — it is
 * information the user must read, not decoration).
 *
 * Both states render the SAME ink (#1C1917), via different tokens for a
 * reason: included uses `--color-text` (matches `StatusFilterMenu`'s
 * convention on a white ground); excluded uses the never-re-themed
 * `--ink-fixed`, because it carries its OWN fixed `--inset` ground rather
 * than inheriting the page's — see `lib/phaseStyle.ts`'s `INK_FIXED` badge
 * pattern for the same shape. `tokens.contrast.test.ts` has a dedicated
 * ladder rung locking `--ink-fixed` on `--inset` at AA. With text identical
 * between states, `line-through` is the SOLE discriminator on hover (both
 * converge to the same primary border + ink text there); the inset fill is
 * a secondary resting-state cue. `--color-primary` is reserved for the
 * hover affordance's BORDER on EITHER state (hover text goes to
 * `--color-text`, matching `StatusFilterMenu` and this file's own
 * `TriageSortLevel` sibling) — no resting state uses `--color-primary`, so
 * a teal border unambiguously means "clickable", never "this is on".
 *
 * Known limitation (disclosed, not fixed here): `--color-border` on the
 * card's white ground is ~1.1:1, short of WCAG 1.4.11's 3:1 non-text
 * floor — a pre-existing app-wide border weakness (every bordered chip/
 * card in this codebase shares the token), out of scope for this styling
 * fix.
 *
 * Generic over the value type so the same component serves a closed
 * enum (Priority, Complexity) and a dynamic string set (Domain) alike.
 * The Parked control reuses this with a single option — see
 * TriageFilterSortBar.tsx.
 */

interface TriageFilterOption<T extends string> {
  value: T;
  label: string;
}

interface TriageFilterGroupProps<T extends string> {
  label: string;
  options: readonly TriageFilterOption<T>[];
  selected: ReadonlySet<T>;
  onToggle: (value: T) => void;
  testIdPrefix: string;
}

export function TriageFilterGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
  testIdPrefix,
}: TriageFilterGroupProps<T>) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid={`${testIdPrefix}-group`}>
      <span className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-[0.06em] mr-0.5">
        {label}
      </span>
      {options.map((opt) => {
        const isSelected = selected.has(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onToggle(opt.value)}
            aria-pressed={isSelected}
            className={
              "inline-flex items-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] px-2 py-0.5 text-[11px] font-medium transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)] " +
              (isSelected
                ? "text-[var(--color-text)]"
                : "bg-[var(--color-inset)] text-[var(--ink-fixed)] line-through")
            }
            data-testid={`${testIdPrefix}-${opt.value}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
