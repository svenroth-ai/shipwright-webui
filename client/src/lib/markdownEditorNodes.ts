/*
 * markdownEditorNodes.ts — the editor nodes the SmartViewer markdown editor adds
 * on top of StarterKit (iterate-2026-11-12-smartviewer-editor-md-roundtrip,
 * FR-01.35): GFM tables (with column alignment), task lists, images, and a code
 * block whose fence can never be shorter than a backtick run inside it.
 *
 * Why this file exists: `tiptap-markdown` ships serializers for table / task /
 * image nodes, but the editor never LOADED those nodes, so a table was flattened
 * to its cell text on save, an image dropped and `- [x]` escaped. Loading the
 * nodes fixes that; two serializers are replaced because the shipped ones lose
 * information (table alignment, fence length).
 */

import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import CodeBlock from "@tiptap/extension-code-block";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor, Extensions } from "@tiptap/react";
/** The component type `ReactNodeViewRenderer` accepts. */
type NodeViewComponent = Parameters<typeof ReactNodeViewRenderer>[0];


type Align = "left" | "center" | "right" | null;

/** The markdown-it table renderer emits `style="text-align:center"` on th/td. */
const alignAttribute = {
  align: {
    default: null as Align,
    parseHTML: (el: HTMLElement): Align => {
      const a = el.style?.textAlign;
      return a === "left" || a === "center" || a === "right" ? a : null;
    },
    renderHTML: (attrs: { align?: Align }) =>
      attrs.align ? { style: `text-align:${attrs.align}` } : {},
  },
};

const DELIMITER: Record<string, string> = { left: ":---", center: ":---:", right: "---:", none: "---" };

/** Minimal slice of the prosemirror-markdown serializer state we call. */
interface MdState {
  write(s?: string): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
  renderInline(node: PMNode): void;
  out: string;
  inTable?: boolean;
}

/** A GFM pipe table only holds a header row of single-paragraph headers over
 *  body rows of single-paragraph cells, with no spans. Anything else is written
 *  as HTML (lossless; the Markdown parser reads it back) instead of destroyed. */
function isGfmRepresentable(table: PMNode): boolean {
  const rows: PMNode[] = [];
  table.forEach((r) => rows.push(r));
  if (rows.length === 0) return false;
  const cellsOf = (row: PMNode) => {
    const cells: PMNode[] = [];
    row.forEach((c) => cells.push(c));
    return cells;
  };
  const span = (c: PMNode) => c.attrs.colspan > 1 || c.attrs.rowspan > 1;
  // One plain paragraph per cell: a list/quote, a second block or a hard break
  // (a newline inside a row would split it) cannot live in a pipe-table cell.
  const plain = (c: PMNode) => {
    if (c.childCount > 1 || span(c)) return false;
    const p = c.firstChild;
    if (p && p.type.name !== "paragraph") return false;
    let hasBreak = false;
    p?.descendants((n) => {
      if (n.type.name === "hardBreak") hasBreak = true;
      return !hasBreak;
    });
    return !hasBreak;
  };
  if (cellsOf(rows[0]).some((c) => c.type.name !== "tableHeader" || !plain(c))) return false;
  return !rows.slice(1).some((r) => cellsOf(r).some((c) => c.type.name === "tableHeader" || !plain(c)));
}

/** Escape EVERY pipe in rendered cell text. renderInline never emits an escaping
 *  `\|` itself (a literal backslash is written as two), so escaping unconditionally
 *  is exact; a lookbehind for "already escaped" mis-handled a backslash before a pipe. */
export function escapeTablePipes(text: string): string {
  return text.replace(/[\\|]/g, (c) => (c === "|" ? "\\|" : c));
}

function serializeTable(state: MdState, node: PMNode): void {
  if (!isGfmRepresentable(node)) {
    const html = DOMSerializer.fromSchema(node.type.schema).serializeNode(node) as HTMLElement;
    // Newlines become character references: a blank line would end the HTML block, and a
    // raw newline inside a list/quote would lose the container prefix.
    state.write(html.outerHTML.replace(/\n/g, "&#10;"));
    state.closeBlock(node);
    return;
  }
  state.inTable = true;
  try {
    node.forEach((row, _offset, rowIndex) => {
      state.write("| ");
      row.forEach((cell, _o, colIndex) => {
        if (colIndex) state.write(" | ");
        const content = cell.firstChild;
        // childCount (not textContent): an image-only cell has no text but is not empty.
        if (content && content.childCount > 0) {
          // A literal pipe would end the cell: GFM needs it escaped (also in code spans).
          const before = state.out.length;
          state.renderInline(content);
          state.out = state.out.slice(0, before) + escapeTablePipes(state.out.slice(before));
        }
      });
      state.write(" |");
      state.ensureNewLine();
      if (rowIndex === 0) {
        const marks: string[] = [];
        row.forEach((cell) => marks.push(DELIMITER[(cell.attrs.align as string | null) ?? "none"]));
        state.write(`| ${marks.join(" | ")} |`);
        state.ensureNewLine();
      }
    });
    state.closeBlock(node);
  } finally {
    state.inTable = false;
  }
}

function longestRun(text: string, ch: string): number {
  let max = 0;
  let run = 0;
  for (const c of text) {
    run = c === ch ? run + 1 : 0;
    if (run > max) max = run;
  }
  return max;
}

/** Longest run of consecutive backticks in `text` (0 when none). */
export function longestBacktickRun(text: string): number {
  return longestRun(text, "`");
}

function serializeCodeBlock(state: MdState & { text(s: string, escape?: boolean): void }, node: PMNode): void {
  const lang = (node.attrs.language as string | null) ?? "";
  // A backtick in the info string is illegal after a backtick fence: use a tilde fence.
  const fence = lang.includes("`")
    ? "~".repeat(Math.max(3, longestRun(node.textContent, "~") + 1))
    : "`".repeat(Math.max(3, longestBacktickRun(node.textContent) + 1));
  state.write(fence + lang + "\n");
  state.text(node.textContent, false);
  state.ensureNewLine();
  state.write(fence);
  state.closeBlock(node);
}

/** tiptap-markdown's tight-list switch only covers bullet/ordered lists, so a
 *  task list was written loose (blank line between every item). Task lists are
 *  almost always tight; serialize them that way. */
const MarkdownTaskList = TaskList.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: { renderList(n: PMNode, d: string, f: () => string): void; options: { tightLists?: boolean } }, node: PMNode) {
          const prev = state.options.tightLists;
          state.options.tightLists = true;
          try {
            state.renderList(node, "  ", () => "- ");
          } finally {
            state.options.tightLists = prev;
          }
        },
      },
    };
  },
});

const MarkdownTable = Table.extend({
  addStorage() {
    return { markdown: { serialize: serializeTable } };
  },
});
const AlignedHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute };
  },
});
const AlignedCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute };
  },
});

/** `![alt](dest "title")`. A destination with whitespace, angle brackets or parens is
 *  wrapped in `<...>` (the default serializer wrote an invalid, space-broken link). */
function serializeImage(state: MdState & { esc(s: string): string }, node: PMNode): void {
  const src = String(node.attrs.src ?? "");
  const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/[\\"]/g, "\\$&")}"` : "";
  const dest = /[\s<>]/.test(src) ? `<${src.replace(/[\\<>]/g, (c) => (c === "\\" ? "\\\\" : c === "<" ? "%3C" : "%3E"))}>` : src.replace(/[()\\]/g, "\\$&");
  state.write(`![${state.esc(String(node.attrs.alt ?? ""))}](${dest}${title})`);
}

const MarkdownImage = Image.extend({
  addStorage() {
    return { markdown: { serialize: serializeImage } };
  },
});

/** Code block with a collision-proof fence. A React `view` (the live mermaid
 *  preview) is injected by the modal so this module stays free of UI imports. */
export function buildMarkdownCodeBlock(view?: NodeViewComponent) {
  const base = CodeBlock.extend({
    addStorage() {
      return { markdown: { serialize: serializeCodeBlock } };
    },
  });
  return view
    ? base.extend({
        addNodeView() {
          return ReactNodeViewRenderer(view);
        },
      })
    : base;
}

/**
 * Set the text alignment of the WHOLE column the caret is in. GFM alignment is a
 * per-column property (the delimiter row), so aligning a single cell would be
 * invisible in the saved Markdown. Returns false when the caret is not in a table.
 */
export function setColumnAlign(editor: Editor, align: Align): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  let cellDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "tableCell" || name === "tableHeader") {
      cellDepth = d;
      break;
    }
  }
  if (cellDepth < 2) return false;
  const table = $from.node(cellDepth - 2);
  const column = $from.index(cellDepth - 1);
  const tableStart = $from.start(cellDepth - 2);
  const tr = state.tr;
  table.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset, index) => {
      if (index !== column) return;
      tr.setNodeMarkup(tableStart + rowOffset + 1 + cellOffset, undefined, { ...cell.attrs, align });
    });
  });
  view.dispatch(tr);
  return true;
}

export interface MarkdownElementOptions {
  /** Node view for code blocks (the modal passes the mermaid-preview view). */
  codeBlockView?: NodeViewComponent;
}

/** Nodes added to the editor on top of StarterKit (minus its plain codeBlock). */
export function buildMarkdownElementExtensions(opts: MarkdownElementOptions = {}): Extensions {
  return [
    MarkdownTable.configure({ resizable: false }),
    TableRow,
    AlignedHeader,
    AlignedCell,
    MarkdownTaskList,
    TaskItem.configure({ nested: true }),
    // inline: keeps `![alt](src)` inside its paragraph, where Markdown puts it.
    // allowBase64: a `data:` image must survive (TipTap otherwise drops it on load).
    // No src allowlist, by decision: the editor shows the user's OWN file and the
    // read-only preview already loads the same images; `javascript:` in <img src>
    // does not execute in browsers, and the markdown text is saved verbatim.
    MarkdownImage.configure({ inline: true, allowBase64: true }),
    buildMarkdownCodeBlock(opts.codeBlockView),
  ];
}
