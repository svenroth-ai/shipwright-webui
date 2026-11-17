/*
 * MarkdownEditorTableBar — contextual row/column/alignment controls for the
 * markdown editor, shown only while the caret is inside a table
 * (iterate-2026-11-12-smartviewer-editor-md-roundtrip, FR-01.35). Every command
 * here is a TipTap table command whose result serializes to a GFM pipe table
 * (markdownEditorNodes.ts), so editing never leaves the Markdown representable.
 */

import { useEffect, useState } from "react";
import { type Editor } from "@tiptap/react";
import {
  ArrowUpToLine,
  ArrowLeftToLine,
  FileCode2,
  ArrowDownToLine,
  ArrowRightToLine,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Rows3,
  Columns3,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { setColumnAlign } from "../../../lib/markdownEditorNodes";
import { useEditorTick } from "./useEditorTick";
import { tableAtCaret } from "../../../lib/markdownTableSource";
import { MarkdownTableSourcePanel } from "./MarkdownTableSourcePanel";

interface TableBtn {
  id: string;
  label: string;
  Icon: LucideIcon;
  run: (e: Editor) => void;
  enabled?: (e: Editor) => boolean;
  active?: (e: Editor) => boolean;
}

const align = (e: Editor, a: "left" | "center" | "right") => {
  e.commands.focus();
  setColumnAlign(e, a);
};
const alignActive = (e: Editor, a: string) =>
  e.isActive("tableCell", { align: a }) || e.isActive("tableHeader", { align: a });

const BUTTONS: TableBtn[] = [
  { id: "row-before", label: "Zeile oben einfügen", Icon: ArrowUpToLine, run: (e) => e.chain().focus().addRowBefore().run(), enabled: (e) => e.can().addRowBefore() && !e.isActive("tableHeader") },
  { id: "row-after", label: "Zeile unten einfügen", Icon: ArrowDownToLine, run: (e) => e.chain().focus().addRowAfter().run(), enabled: (e) => e.can().addRowAfter() },
  { id: "col-before", label: "Spalte links einfügen", Icon: ArrowLeftToLine, run: (e) => e.chain().focus().addColumnBefore().run(), enabled: (e) => e.can().addColumnBefore() },
  { id: "col-after", label: "Spalte rechts einfügen", Icon: ArrowRightToLine, run: (e) => e.chain().focus().addColumnAfter().run(), enabled: (e) => e.can().addColumnAfter() },
  { id: "row-del", label: "Zeile löschen", Icon: Rows3, run: (e) => e.chain().focus().deleteRow().run(), enabled: (e) => e.can().deleteRow() },
  { id: "col-del", label: "Spalte löschen", Icon: Columns3, run: (e) => e.chain().focus().deleteColumn().run(), enabled: (e) => e.can().deleteColumn() },
  { id: "align-left", label: "Linksbündig", Icon: AlignLeft, run: (e) => align(e, "left"), active: (e) => alignActive(e, "left") },
  { id: "align-center", label: "Zentriert", Icon: AlignCenter, run: (e) => align(e, "center"), active: (e) => alignActive(e, "center") },
  { id: "align-right", label: "Rechtsbündig", Icon: AlignRight, run: (e) => align(e, "right"), active: (e) => alignActive(e, "right") },
  { id: "table-del", label: "Tabelle löschen", Icon: Trash2, run: (e) => e.chain().focus().deleteTable().run() },
];

const btnCls =
  "inline-flex h-7 w-7 items-center justify-center rounded-[6px] transition " +
  "text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)] " +
  "disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed";
const btnActiveCls = "bg-[var(--color-accent,#857568)]/15 text-[var(--color-text,#1a1a1a)]";

export function MarkdownEditorTableBar({ editor }: { editor: Editor | null }) {
  useEditorTick(editor);
  const [sourceOpen, setSourceOpen] = useState(false);
  const inTable = !!editor && editor.isActive("table");
  // The source panel belongs to ONE table: close it when the caret leaves.
  useEffect(() => {
    if (!inTable) setSourceOpen(false);
  }, [inTable]);
  if (!editor || !inTable) return null;
  return (
    <>
      <div
        className="flex flex-wrap items-center gap-0.5 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)]/40 px-3 py-1"
        data-testid="md-editor-table-bar"
        role="toolbar"
        aria-label="Tabelle"
      >
        <span className="mr-2 text-[11px] text-[var(--color-muted,#6b7280)]">Tabelle</span>
        {BUTTONS.map(({ id, label, Icon, run, enabled, active }) => {
          const isActive = active ? active(editor) : false;
          return (
            <button
              key={id}
              type="button"
              data-testid={`md-tt-${id}`}
              aria-label={label}
              title={label}
              {...(active ? { "aria-pressed": isActive } : {})}
              disabled={enabled ? !enabled(editor) : false}
              onClick={() => run(editor)}
              className={`${btnCls} ${isActive ? btnActiveCls : ""}`}
            >
              <Icon size={15} aria-hidden={true} />
            </button>
          );
        })}
        <button
          type="button"
          data-testid="md-tt-source"
          aria-pressed={sourceOpen}
          title="Tabelle als Markdown bearbeiten"
          onClick={() => setSourceOpen((v) => !v)}
          className={`ml-2 inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] transition hover:bg-[var(--color-muted-bg,#ede8e1)] ${sourceOpen ? btnActiveCls : "text-[var(--color-muted,#6b7280)]"}`}
        >
          <FileCode2 size={14} aria-hidden={true} /> Als Markdown
        </button>
      </div>
      {sourceOpen && <MarkdownTableSourcePanel key={tableAtCaret(editor)?.from} editor={editor} onClose={() => setSourceOpen(false)} />}
    </>
  );
}
