/*
 * ConfirmClearHistoryDialog — extracted from HeaderMenu (Campaign C / C6).
 *
 * Menu-scoped destructive cleanup of disk-backed terminal scrollback
 * (ADR-068-A1). Surfaced via the "Clear terminal history" menu item;
 * inline dialog (vs. reusing ConfirmDeleteDialog which is task-shaped)
 * because the copy is terminal-specific and the destructive action is
 * contained.
 *
 * Extracted as a sub-module of HeaderMenu so HeaderMenu.tsx stays ≤300
 * LOC (Campaign C cleanup-invariant: NEW sub-modules MUST be under the
 * limit pre-merge; webui has no Stop-gate fallback).
 *
 * Stable props:
 *   - open / onOpenChange  — controlled by HeaderMenu's local state.
 *   - taskId               — used to scope the /clear-scrollback POST.
 *
 * Per Iterate v0.8.2 AC-1: the dialog is opened via requestAnimationFrame
 * from the menu-item onSelect so Radix DropdownMenu's focus-scope releases
 * before the modal grabs focus (Windows ConPTY timing was flaky without
 * this deferral). That deferral lives in HeaderMenu — this component
 * stays purely presentational + fetch.
 */
import { useCallback, useState } from "react";

export interface ConfirmClearHistoryDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  taskId: string;
}

export function ConfirmClearHistoryDialog({
  open,
  onOpenChange,
  taskId,
}: ConfirmClearHistoryDialogProps) {
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/terminal/${encodeURIComponent(taskId)}/clear-scrollback`,
        { method: "POST" },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        setError(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
        return;
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [taskId, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      data-testid="confirm-clear-history-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="w-full max-w-md rounded-[var(--radius-card,12px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] p-5 shadow-[var(--shadow-card,0_6px_30px_rgba(0,0,0,0.10))]"
        data-testid="confirm-clear-history-dialog"
      >
        <h2 className="text-[15px] font-semibold text-[var(--color-text,#1a1a1a)]">
          Clear terminal history?
        </h2>
        <p className="mt-2 text-[13px] text-[var(--color-muted,#6b7280)]">
          The persisted terminal scrollback for this task will be deleted
          from disk. The active session (if any) keeps running. This
          cannot be undone.
        </p>
        {error ? (
          <p
            className="mt-3 text-[12px] text-[var(--color-error,#DC2626)]"
            data-testid="confirm-clear-history-error"
          >
            Failed: {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] px-3 py-1.5 text-[12px] text-[var(--color-text,#1a1a1a)] transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
            data-testid="confirm-clear-history-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            className="rounded-[var(--radius-button,8px)] bg-[var(--color-error,#DC2626)] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90"
            data-testid="confirm-clear-history-confirm"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
