/*
 * TriageSearch — a text search over title + detail
 * (iterate-2026-11-08-triage-page-redesign). Rendered by the page only when
 * more than SEARCH_MIN_ITEMS open items are in scope; it is transient (never
 * saved with the view).
 */

import { Search } from "lucide-react";

export const SEARCH_MIN_ITEMS = 12;

export function TriageSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative mb-3 block max-w-sm">
      <Search
        size={13}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search title and detail"
        aria-label="Search triage items"
        data-testid="triage-search"
        className="h-8 w-full rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-2 text-sm text-[var(--color-text)]"
      />
    </label>
  );
}
