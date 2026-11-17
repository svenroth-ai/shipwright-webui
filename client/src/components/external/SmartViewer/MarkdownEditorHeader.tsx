/*
 * MarkdownEditorHeader — title row of the markdown editor dialog: the file path
 * and a close button (extracted from MarkdownEditorModal.tsx, iterate-2026-11-17-
 * md-editor-table-editing, to keep the modal under its bloat ceiling).
 */

import * as Dialog from "@radix-ui/react-dialog";
import { FileText, X } from "lucide-react";

export function MarkdownEditorHeader({ path, busy }: { path: string; busy: boolean }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2.5">
      <FileText size={14} className="shrink-0 text-[var(--color-accent,#857568)]" aria-hidden="true" />
      <Dialog.Title
        className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-text,#1a1a1a)]"
        title={path}
      >
        {path}
      </Dialog.Title>
      <Dialog.Close asChild>
        <button
          type="button"
          aria-label="Close"
          disabled={busy}
          data-testid="markdown-editor-close"
          className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)] disabled:opacity-50"
        >
          <X size={14} />
        </button>
      </Dialog.Close>
    </div>
  );
}
