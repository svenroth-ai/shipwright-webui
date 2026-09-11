/*
 * ListLoadErrorState — shared "the list failed to load" state (FR-01.01
 * triage trg-0f040744 finding 1). A failed primary list fetch must never
 * render the same teaching empty state a genuinely-empty successful
 * response gets ("No tasks yet" and "the list could not be loaded" are not
 * the same claim), and must offer a retry rather than silently keeping
 * a stale/blank list. One shared component so the four call sites (Task
 * Board, Ship's Log, Triage, Projects) render this consistently instead of
 * re-deriving the copy per page.
 */
import { AlertTriangle } from "lucide-react";

interface ListLoadErrorStateProps {
  /** Root element testid; the retry button is `${testId}-retry`. */
  testId: string;
  /** Plural noun describing what failed to load, e.g. "tasks", "projects". */
  label: string;
  onRetry: () => void;
}

export function ListLoadErrorState({ testId, label, onRetry }: ListLoadErrorStateProps) {
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{ padding: "64px 16px", color: "var(--color-muted)" }}
      data-testid={testId}
    >
      <AlertTriangle size={48} className="mb-3 opacity-50" aria-hidden="true" />
      <p className="text-lg" style={{ color: "var(--color-text)" }}>
        Couldn&rsquo;t load {label}
      </p>
      <p className="text-sm mb-4" data-testid={`${testId}-sentence`}>
        Something went wrong reading the list — your {label} are probably still
        there. Try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        data-testid={`${testId}-retry`}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-button)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
        style={{ background: "var(--color-primary)" }}
      >
        Retry
      </button>
    </div>
  );
}
