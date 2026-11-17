/*
 * MarkdownTableSourcePanel — edit the table under the caret as plain Markdown
 * (iterate-2026-11-17-md-editor-table-editing). For people who find the cell grid
 * fiddly: paste/type a pipe table, see validation inline, apply.
 */

import { useState } from "react";
import { type Editor } from "@tiptap/react";

import { applyTableSource, tableAtCaret, validateTableSource } from "../../../lib/markdownTableSource";

export function MarkdownTableSourcePanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [text, setText] = useState(() => tableAtCaret(editor)?.markdown ?? "");
  const [applyFailed, setApplyFailed] = useState(false);
  const error = validateTableSource(text) ?? (applyFailed ? "Die Tabelle konnte nicht übernommen werden (Cursor nicht in der Tabelle)." : null);
  return (
    <div className="border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)]/30 px-3 py-2" data-testid="md-table-source-panel">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setApplyFailed(false);
        }}
        spellCheck={false}
        rows={Math.min(12, Math.max(4, text.split("\n").length + 1))}
        aria-label="Tabelle als Markdown"
        data-testid="md-table-source-input"
        className="w-full resize-y rounded-[6px] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] p-2 font-mono text-[12px] leading-snug"
      />
      <div className="mt-1.5 flex items-center gap-2 text-[12px]">
        <span className="min-w-0 flex-1" style={{ color: error ? "var(--color-error, #DC2626)" : "var(--color-muted, #6b7280)" }} data-testid="md-table-source-status">
          {error ?? "Gültige Tabelle. Zellen mit | müssen als \\| geschrieben werden."}
        </span>
        <button type="button" onClick={onClose} data-testid="md-table-source-cancel" className="rounded-[6px] px-2 py-1 hover:bg-[var(--color-muted-bg,#ede8e1)]">
          Abbrechen
        </button>
        <button
          type="button"
          disabled={validateTableSource(text) !== null}
          onClick={() => {
            if (applyTableSource(editor, text)) onClose();
            else setApplyFailed(true);
          }}
          data-testid="md-table-source-apply"
          className="rounded-[6px] bg-[var(--color-accent,#857568)] px-2.5 py-1 text-white disabled:opacity-40"
        >
          Übernehmen
        </button>
      </div>
    </div>
  );
}
