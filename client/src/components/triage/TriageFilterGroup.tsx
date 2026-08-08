/*
 * TriageFilterGroup.tsx — one filter dimension rendered as togglable chips
 * (Priority / Domain / Complexity / Parked). Reuses the app's existing
 * chip visual language: resting state matches SourceBadge; selected state
 * is `--color-primary`-on-tint, per the iterate spec's Design Check —
 * the same convention `FolderTree.tsx`'s selected row and
 * `ViewerTabBar.tsx`'s active tab already use. CLAUDE.md rule 26's
 * `--color-primary` warning is scoped to the board header's
 * `.chrome-dark-controls` re-point (a DIFFERENT context this page is not
 * under, and not a blanket ban) — an earlier draft over-applied it here
 * and shipped `--color-accent` instead, which spec-reviewer Stage 1
 * caught as disagreeing with the Design Check.
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
      <span className="text-[11px] font-medium text-[var(--color-muted)] uppercase mr-0.5">
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
              "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border transition-colors " +
              (isSelected
                ? "bg-[var(--color-primary,#6b5e56)]/15 text-[var(--color-text)] border-[var(--color-primary,#6b5e56)]"
                : "bg-inset text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-muted-bg)]")
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
