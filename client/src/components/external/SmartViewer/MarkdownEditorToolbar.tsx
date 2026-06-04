/*
 * MarkdownEditorToolbar — formatting button bar for the SmartViewer markdown
 * editor (iterate-2026-06-04-md-editor-toolbar; completes FR-01.34's WYSIWYG UX).
 *
 * TipTap/ProseMirror is HEADLESS: StarterKit provides the *capability* (bold,
 * italic, headings, lists, code, blockquote, link, undo/redo — via keyboard
 * shortcuts + markdown input rules) but ships NO visible UI. This bar wires those
 * already-loaded StarterKit commands to clickable buttons whose pressed-state
 * mirrors the live editor selection. It introduces no new serialized construct —
 * every command here is already covered by the markdownTiptap round-trip
 * (markdownTiptap.test.ts), so the lossy-construct warning surface is unchanged.
 *
 * The bar re-renders on every editor transaction (its OWN subscription) so the
 * active / enabled state stays correct independently of the parent modal's
 * render cadence.
 */

import { useEffect, useState } from "react";
import { type Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Link as LinkIcon,
  Undo2,
  Redo2,
  type LucideIcon,
} from "lucide-react";

/** Re-render on every editor transaction so button active/enabled state tracks
 *  the live selection regardless of the parent's render cadence. */
function useEditorTick(editor: Editor | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => setTick((n) => n + 1);
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);
}

interface Btn {
  id: string;
  label: string;
  Icon: LucideIcon;
  run: (e: Editor) => void;
  /** Pressed-state for toggle buttons; omitted for action buttons (undo/redo/HR). */
  active?: (e: Editor) => boolean;
  /** Disabled-gate; defaults to always-enabled. */
  enabled?: (e: Editor) => boolean;
}

/** Toggle/prompt a link. Empty input or an already-linked selection removes it. */
function promptForLink(editor: Editor): void {
  if (editor.isActive("link")) {
    editor.chain().focus().unsetLink().run();
    return;
  }
  const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
  const url = typeof window === "undefined" ? null : window.prompt("Link-URL:", prev);
  if (url === null) return; // cancelled — leave the selection untouched
  if (url.trim() === "") {
    editor.chain().focus().unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
}

// Groups are rendered left-to-right with a thin divider between them. StarterKit
// `toggleHeading` collapses a heading back to a paragraph when toggled off.
const GROUPS: Btn[][] = [
  [
    { id: "undo", label: "Rückgängig", Icon: Undo2, run: (e) => e.chain().focus().undo().run(), enabled: (e) => e.can().undo() },
    { id: "redo", label: "Wiederholen", Icon: Redo2, run: (e) => e.chain().focus().redo().run(), enabled: (e) => e.can().redo() },
  ],
  [
    { id: "bold", label: "Fett", Icon: Bold, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
    { id: "italic", label: "Kursiv", Icon: Italic, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
    { id: "strike", label: "Durchgestrichen", Icon: Strikethrough, run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive("strike") },
    { id: "code", label: "Inline-Code", Icon: Code, run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  ],
  [
    { id: "h1", label: "Überschrift 1", Icon: Heading1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
    { id: "h2", label: "Überschrift 2", Icon: Heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
    { id: "h3", label: "Überschrift 3", Icon: Heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  ],
  [
    { id: "bullet-list", label: "Aufzählung", Icon: List, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
    { id: "ordered-list", label: "Nummerierte Liste", Icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  ],
  [
    { id: "blockquote", label: "Zitat", Icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
    { id: "code-block", label: "Codeblock", Icon: Code2, run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
    { id: "hr", label: "Trennlinie", Icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
    { id: "link", label: "Link", Icon: LinkIcon, run: (e) => promptForLink(e), active: (e) => e.isActive("link") },
  ],
];

const btnCls =
  "inline-flex h-7 w-7 items-center justify-center rounded-[6px] transition " +
  "text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)] " +
  "disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed";
const btnActiveCls = "bg-[var(--color-accent,#857568)]/15 text-[var(--color-text,#1a1a1a)]";

/** Formatting toolbar for the markdown editor. Renders nothing until the TipTap
 *  editor instance exists (the modal only mounts it in an editor-visible phase). */
export function MarkdownEditorToolbar({ editor }: { editor: Editor | null }) {
  useEditorTick(editor);
  if (!editor) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 border-b border-[var(--color-border,#e0dbd4)] px-3 py-1.5"
      data-testid="md-editor-toolbar"
      role="toolbar"
      aria-label="Formatierung"
    >
      {GROUPS.map((group, gi) => (
        <div key={group[0].id} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-5 w-px bg-[var(--color-border,#e0dbd4)]" aria-hidden="true" />}
          {group.map(({ id, label, Icon, run, active, enabled }) => {
            const isActive = active ? active(editor) : false;
            const isEnabled = enabled ? enabled(editor) : true;
            return (
              <button
                key={id}
                type="button"
                data-testid={`md-tb-${id}`}
                aria-label={label}
                title={label}
                {...(active ? { "aria-pressed": isActive } : {})}
                disabled={!isEnabled}
                onClick={() => run(editor)}
                className={`${btnCls} ${isActive ? btnActiveCls : ""}`}
              >
                <Icon size={15} aria-hidden={true} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default MarkdownEditorToolbar;
