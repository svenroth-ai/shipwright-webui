/*
 * MarkdownEditorModal — TipTap rich-text editor for a project markdown file,
 * in a centered Radix dialog (iterate-2026-06-03-smartviewer-markdown-editor,
 * FR-01.34). "Rich editing, Markdown saved."
 *
 * Mirrors SmartViewerModal's dialog chrome. Lifecycle:
 *   loading → editing ⇄ diff → (save) → onSaved + close
 *   loading → load_error (file vanished/unreadable — review #4)
 *   diff/save → conflict (409: file changed on disk — edits PRESERVED, review #11)
 *
 * The file is loaded FRESH on open (capturing the on-disk content-hash) so the
 * If-Match precondition is taken atomically with the bytes the user edits. The
 * pre-save diff (MarkdownDiffView) and warn banner (detectLossyConstructs) are
 * the safety nets for the lossy Markdown↔ProseMirror round-trip.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useEditor, EditorContent } from "@tiptap/react";
import { AlertCircle, AlertTriangle, FileText, Info, Loader2, X } from "lucide-react";

import {
  buildEditorExtensions,
  serializeEditorMarkdown,
  detectLossyConstructs,
  splitMarkdownEnvelope,
  composeMarkdownEnvelope,
  type MarkdownEnvelope,
} from "../../../lib/markdownTiptap";
import {
  loadMarkdownForEdit,
  saveMarkdown,
  MarkdownConflictError,
} from "../../../lib/markdownFileApi";
import { ApiError } from "../../../lib/externalApi";
import { MarkdownDiffView } from "./MarkdownDiffView";
import { MarkdownEditorToolbar } from "./MarkdownEditorToolbar";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Project-root-relative POSIX path of the markdown file. */
  path: string;
  /** Called after a successful write so the parent re-fetches the preview. */
  onSaved: () => void;
}

type Phase = "loading" | "load_error" | "editing" | "diff" | "saving" | "conflict";

const btnBase =
  "rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-50";

export function MarkdownEditorModal({
  open,
  onOpenChange,
  projectId,
  path,
  onSaved,
}: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hasFrontmatter, setHasFrontmatter] = useState(false);
  const original = useRef<string>("");
  const fingerprint = useRef<string>("");
  // The non-prose envelope the editor must NOT touch (preserved verbatim around
  // the serialized body). Rationale: see markdownTiptap.ts envelope section.
  const envelopeRef = useRef<MarkdownEnvelope | null>(null);
  // Monotonic load token — discards a stale/superseded async load result
  // (modal reopened for another path, closed mid-flight, or reload-on-conflict).
  const loadGen = useRef(0);
  const [edited, setEdited] = useState<string>("");

  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: "",
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "markdown-body focus:outline-none min-h-full",
        "data-testid": "md-editor-surface",
      },
    },
  });

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setPhase("loading");
    setErrorMsg(null);
    try {
      const res = await loadMarkdownForEdit(projectId, path);
      if (gen !== loadGen.current) return; // superseded (reopen / close / reload)
      original.current = res.text;
      fingerprint.current = res.fingerprint;
      const env = splitMarkdownEnvelope(res.text);
      envelopeRef.current = env;
      setHasFrontmatter(env.frontmatter.length > 0);
      setWarnings(detectLossyConstructs(res.text));
      // The editor owns ONLY the prose body; frontmatter / line-endings /
      // trailing newline live in the envelope and are re-attached on serialize.
      editor?.commands.setContent(env.core);
      setEdited(res.text); // baseline so a no-op save is detectable
      setPhase("editing");
    } catch (err) {
      if (gen !== loadGen.current) return;
      const msg = err instanceof ApiError ? err.code : err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("load_error");
    }
  }, [projectId, path, editor]);

  // Load fresh content each time the modal opens (capturing the on-disk
  // fingerprint atomically). Bumping loadGen on cleanup invalidates any
  // in-flight load if the modal closes before it resolves (review #3/#5).
  useEffect(() => {
    if (open && editor) void load();
    return () => {
      loadGen.current++;
    };
  }, [open, editor, load]);

  const toDiff = useCallback(() => {
    if (!editor) return;
    const env = envelopeRef.current;
    const serializedCore = serializeEditorMarkdown(editor);
    // Re-attach the preserved envelope so the diff (and the eventual save)
    // compares full file vs full file — not body vs whole-file.
    setEdited(
      env ? composeMarkdownEnvelope(env, serializedCore) : serializedCore,
    );
    setPhase("diff");
  }, [editor]);

  const doSave = useCallback(async () => {
    setPhase("saving");
    setErrorMsg(null);
    try {
      await saveMarkdown(projectId, path, edited, fingerprint.current);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof MarkdownConflictError) {
        setPhase("conflict");
        return;
      }
      const msg = err instanceof ApiError ? err.code : err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("diff"); // stay on the diff with a save-error banner
    }
  }, [projectId, path, edited, onSaved, onOpenChange]);

  const busy = phase === "saving";
  // Editor + formatting toolbar show in every phase except loading/load_error/diff.
  const showEditor = phase === "editing" || phase === "saving" || phase === "conflict";

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex h-[90vh] w-[min(1100px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card,12px)] bg-[var(--color-surface,#ffffff)] shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="markdown-editor-modal"
        >
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

          {showEditor && <MarkdownEditorToolbar editor={editor} />}
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {phase === "loading" && (
              <div className="flex h-full items-center justify-center text-[12px]" style={{ color: "var(--color-muted, #6b7280)" }} data-testid="md-editor-loading">
                <Loader2 size={16} className="mr-2 animate-spin" /> Loading…
              </div>
            )}
            {phase === "load_error" && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px]" style={{ color: "var(--color-error, #DC2626)" }} data-testid="md-editor-load-error">
                <AlertCircle size={20} aria-hidden="true" />
                <span>Could not open this file for editing: {errorMsg}</span>
              </div>
            )}
            {phase === "diff" ? (
              <MarkdownDiffView original={original.current} edited={edited} />
            ) : (
              <div className={showEditor ? "h-full" : "hidden"}>
                <EditorContent editor={editor} className="h-full text-sm leading-relaxed" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border,#e0dbd4)] px-4 py-2.5">
            {phase === "load_error" ? (
              <button type="button" className={`${btnBase} bg-[var(--color-muted-bg,#ede8e1)] text-[var(--color-text,#1a1a1a)]`} onClick={() => onOpenChange(false)} data-testid="md-editor-close-error">
                Close
              </button>
            ) : phase === "conflict" ? (
              <>
                <button type="button" className={`${btnBase} text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]`} onClick={() => onOpenChange(false)}>
                  Cancel
                </button>
                <button type="button" className={`${btnBase} bg-[var(--color-error,#DC2626)] text-white`} onClick={() => void load()} data-testid="md-editor-reload">
                  Reload &amp; discard my changes
                </button>
              </>
            ) : phase === "diff" || phase === "saving" ? (
              <>
                <button type="button" disabled={busy} className={`${btnBase} text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]`} onClick={() => setPhase("editing")} data-testid="md-editor-back">
                  ← Back to editor
                </button>
                <button type="button" disabled={busy || edited === original.current} className={`${btnBase} bg-[var(--color-primary,#6b5e56)] text-white`} onClick={() => void doSave()} data-testid="md-editor-save">
                  {busy ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <>
                <button type="button" className={`${btnBase} text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]`} onClick={() => onOpenChange(false)} data-testid="md-editor-cancel">
                  Cancel
                </button>
                <button type="button" disabled={phase !== "editing"} className={`${btnBase} bg-[var(--color-primary,#6b5e56)] text-white`} onClick={toDiff} data-testid="md-editor-review">
                  Review changes →
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default MarkdownEditorModal;
