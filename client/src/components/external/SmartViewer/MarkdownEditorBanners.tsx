/*
 * MarkdownEditorBanners — the stacked notice banners inside
 * MarkdownEditorModal (lossy-construct warning, frontmatter note, conflict
 * notice, save-error). Split out of the modal to stay under the 300-line
 * anti-ratchet ceiling; purely presentational, no state of its own.
 */
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

interface Props {
  phase: "loading" | "load_error" | "editing" | "diff" | "saving" | "conflict";
  warnings: string[];
  hasFrontmatter: boolean;
  errorMsg: string | null;
}

export function MarkdownEditorBanners({ phase, warnings, hasFrontmatter, errorMsg }: Props) {
  return (
    <>
      {warnings.length > 0 && phase !== "load_error" && (
        <div
          className="flex items-start gap-2 border-b border-[var(--color-warning,#D97706)]/30 bg-[var(--color-warning,#D97706)]/10 px-4 py-2 text-[12px]"
          style={{ color: "var(--color-text, #1a1a1a)" }}
          data-testid="md-editor-warn"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning, #D97706)" }} aria-hidden="true" />
          <span>
            This file contains constructs that may not round-trip cleanly
            (<span className="font-medium">{warnings.join(", ")}</span>).
            Review the diff carefully before saving.
          </span>
        </div>
      )}

      {hasFrontmatter && phase !== "load_error" && (
        <div
          className="flex items-start gap-2 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)]/40 px-4 py-2 text-[12px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
          data-testid="md-editor-frontmatter-note"
        >
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            YAML frontmatter is preserved unchanged and is not edited here —
            only the document body below is editable.
          </span>
        </div>
      )}

      {phase === "conflict" && (
        <div
          className="flex items-start gap-2 border-b border-[var(--color-error,#DC2626)]/30 bg-[var(--color-error,#DC2626)]/10 px-4 py-2 text-[12px]"
          style={{ color: "var(--color-text, #1a1a1a)" }}
          data-testid="md-editor-conflict"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-error, #DC2626)" }} aria-hidden="true" />
          <span>
            This file changed on disk since you opened it (another process or
            a Claude session may have edited it). Your edits are kept below —
            reload to discard them and start from the current file.
          </span>
        </div>
      )}

      {errorMsg && phase === "diff" && (
        <div
          className="border-b border-[var(--color-error,#DC2626)]/30 bg-[var(--color-error,#DC2626)]/10 px-4 py-2 text-[12px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          data-testid="md-editor-save-error"
        >
          Save failed: {errorMsg}
        </div>
      )}
    </>
  );
}
