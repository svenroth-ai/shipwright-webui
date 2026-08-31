/*
 * MarkdownEditorFooter — the phase-dependent action-button row inside
 * MarkdownEditorModal (Cancel/Review, Back/Save, Reload&discard, Close).
 * Split out of the modal to stay under the 300-line anti-ratchet ceiling;
 * purely presentational, no state of its own.
 */
type Phase = "loading" | "load_error" | "editing" | "diff" | "saving" | "conflict";

interface Props {
  phase: Phase;
  busy: boolean;
  edited: string;
  original: string;
  onClose: () => void;
  onReload: () => void;
  onBackToEditor: () => void;
  onReview: () => void;
  onSave: () => void;
}

const btnBase =
  "rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-50";

export function MarkdownEditorFooter({
  phase,
  busy,
  edited,
  original,
  onClose,
  onReload,
  onBackToEditor,
  onReview,
  onSave,
}: Props) {
  if (phase === "load_error") {
    return (
      <button type="button" className={`${btnBase} bg-[var(--color-muted-bg,#ede8e1)] text-[var(--color-text,#1a1a1a)]`} onClick={onClose} data-testid="md-editor-close-error">
        Close
      </button>
    );
  }
  if (phase === "conflict") {
    return (
      <>
        <button type="button" className={`${btnBase} text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]`} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={`${btnBase} bg-[var(--color-error,#DC2626)] text-white`} onClick={onReload} data-testid="md-editor-reload">
          Reload &amp; discard my changes
        </button>
      </>
    );
  }
  if (phase === "diff" || phase === "saving") {
    return (
      <>
        <button type="button" disabled={busy} className={`${btnBase} text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]`} onClick={onBackToEditor} data-testid="md-editor-back">
          ← Back to editor
        </button>
        <button type="button" disabled={busy || edited === original} className={`${btnBase} bg-[var(--color-primary,#6b5e56)] text-white`} onClick={onSave} data-testid="md-editor-save">
          {busy ? "Saving…" : "Save"}
        </button>
      </>
    );
  }
  return (
    <>
      <button type="button" className={`${btnBase} text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]`} onClick={onClose} data-testid="md-editor-cancel">
        Cancel
      </button>
      <button type="button" disabled={phase !== "editing"} className={`${btnBase} bg-[var(--color-primary,#6b5e56)] text-white`} onClick={onReview} data-testid="md-editor-review">
        Review changes →
      </button>
    </>
  );
}
