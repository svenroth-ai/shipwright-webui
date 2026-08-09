/*
 * TriageSortLevel.tsx — one sort level (key dropdown + independent
 * ascending/descending toggle). Used twice by TriageFilterSortBar for
 * the two-level sort (primary, secondary) — see the iterate spec's AC4.
 * The new control shape in this feature: nothing else in the app does
 * two-level sort, so unlike the filter chips there is no existing
 * pattern to reuse here (see the iterate spec's Design Check).
 *
 * iterate-2026-08-09-triage-filter-styling (AC1): geometry bumped to
 * `--radius-button` / `border-[1.5px]` and hover to
 * `hover:border-[var(--color-primary)] hover:text-[var(--color-text)]`,
 * matching the just-restyled filter chips in the same bar — see
 * TriageFilterGroup.tsx's docstring for the full rationale.
 */

import { ArrowDown, ArrowUp } from "lucide-react";
import type { SortDirection, SortKey, SortLevel } from "../../lib/triageFilterSort";

const SORT_KEY_LABELS: Record<SortKey, string> = {
  domain: "Domain",
  name: "Name",
  modified: "Modified",
};

const SORT_KEYS: readonly SortKey[] = ["domain", "name", "modified"];

interface TriageSortLevelProps {
  label: string;
  /**
   * Qualifier distinguishing this level from its sibling — the visual
   * `label` ("Sort open items" / "then") reads fine sighted, sitting next
   * to its counterpart, but is not distinguishing on its own for
   * assistive tech, which announces each control in isolation
   * (code-reviewer finding). Composed AHEAD of `label` in the accessible
   * name (never replacing it) so the visible text stays contained in the
   * name — WCAG 2.5.3 Label in Name; a bare `ariaLabel` replacement was
   * the first draft and a voice-control user saying "click Sort open
   * items" would have found nothing to match (re-review finding NEW-5).
   */
  ariaLabel?: string;
  level: SortLevel;
  onChange: (level: SortLevel) => void;
  testIdPrefix: string;
}

export function TriageSortLevel({
  label,
  ariaLabel,
  level,
  onChange,
  testIdPrefix,
}: TriageSortLevelProps) {
  const name = ariaLabel ? `${ariaLabel} — ${label}` : label;
  const toggleDirection = (): void => {
    const next: SortDirection = level.direction === "asc" ? "desc" : "asc";
    onChange({ ...level, direction: next });
  };

  return (
    <div className="flex items-center gap-1.5" data-testid={`${testIdPrefix}-group`}>
      <span className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-[0.06em]">{label}</span>
      <select
        value={level.key}
        onChange={(e) => onChange({ ...level, key: e.target.value as SortKey })}
        aria-label={`${name} sort key`}
        className="text-[11px] rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)]"
        data-testid={`${testIdPrefix}-key`}
      >
        {SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {SORT_KEY_LABELS[key]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={toggleDirection}
        aria-label={`${name} sort direction: ${level.direction === "asc" ? "Ascending" : "Descending"}`}
        title={level.direction === "asc" ? "Ascending" : "Descending"}
        className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)]"
        data-testid={`${testIdPrefix}-direction`}
      >
        {level.direction === "asc" ? (
          <ArrowUp size={12} aria-hidden="true" />
        ) : (
          <ArrowDown size={12} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
