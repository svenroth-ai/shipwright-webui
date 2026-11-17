/*
 * markdownTableSource.ts — read / replace the pipe-table source of the table the
 * caret is in, so the table can be edited as plain Markdown text
 * (iterate-2026-11-17-md-editor-table-editing). The text is parsed back through
 * the editor's own Markdown parser, so whatever is applied is a real table node.
 */

import type { Editor } from "@tiptap/react";
import { extractPipeTables, splitRow } from "./markdownTablePreserve";

interface TableAtCaret {
  from: number;
  to: number;
  /** Table node as the editor would serialize it. */
  markdown: string;
}

export function tableAtCaret(editor: Editor): TableAtCaret | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name !== "table") continue;
    const serializer = (editor.storage as unknown as { markdown?: { serializer?: { serialize(n: unknown): string } } }).markdown?.serializer;
    if (!serializer) return null;
    const doc = editor.state.schema.topNodeType.create(null, node);
    const from = $from.before(d);
    return { from, to: from + node.nodeSize, markdown: serializer.serialize(doc).trimEnd() };
  }
  return null;
}

/**
 * Validate text the user typed as a table. Returns an error message (German, shown
 * inline) or null when it is exactly one well-formed pipe table.
 */
export function validateTableSource(text: string): string | null {
  const t = text.trim();
  if (!t) return "Die Tabelle ist leer.";
  const lines = t.split("\n");
  const tables = extractPipeTables(t);
  if (tables.length !== 1 || tables[0].start !== 0 || tables[0].end !== lines.length) {
    return "Erwartet wird genau eine Tabelle: jede Zeile beginnt mit | und die zweite Zeile ist die Trennzeile (| --- | --- |).";
  }
  const cols = splitRow(lines[0]).length;
  const bad = lines.findIndex((l) => splitRow(l).length !== cols);
  if (bad >= 0) return `Zeile ${bad + 1} hat ${splitRow(lines[bad]).length} statt ${cols} Spalten.`;
  return null;
}

/** Replace the caret's table with the (already validated) source text. */
export function applyTableSource(editor: Editor, text: string): boolean {
  const at = tableAtCaret(editor);
  if (!at || validateTableSource(text) !== null) return false;
  return editor.chain().focus().insertContentAt({ from: at.from, to: at.to }, text.trim()).run();
}
