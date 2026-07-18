/*
 * MarkdownRenderer — SmartViewer's .md / .markdown pane. Renders project
 * files through <DocumentMarkdown> (controlled-HTML + frontmatter + anchor
 * nav — distinct from the transcript's XSS-locked <MarkdownText>) and adds a
 * pop-out button + an Edit button + a single page-level horizontal scrollbar.
 *
 * The pop-out button delegates to an `onPopOut` callback — the parent opens
 * the centered in-app <SmartViewerModal>, NOT a new browser tab. When
 * `onPopOut` is omitted (the modal-nested instance), the button is suppressed.
 *
 * The Edit button (FR-01.34) opens the lazily-loaded <MarkdownEditorModal>
 * (TipTap rich editor → markdown save). It is shown only when `projectId`,
 * `path` AND `onSaved` are all provided — `onSaved` is set only by the primary
 * inline pane, so the nested pop-out instance shows no editor (no modal-in-modal).
 * The modal is `React.lazy`-loaded so TipTap/ProseMirror stays out of the
 * initial bundle.
 */

import { lazy, Suspense, useState } from "react";
import { ExternalLink, Pencil } from "lucide-react";

import { DocumentMarkdown } from "./DocumentMarkdown";

const MarkdownEditorModal = lazy(() =>
  import("./MarkdownEditorModal").then((m) => ({ default: m.MarkdownEditorModal })),
);

interface Props {
  text: string;
  /** Open the file in the centered in-app pop-out modal. Omitted inside the
   *  modal itself so the nested viewer renders no further pop-out button. */
  onPopOut?: () => void;
  /** Follow a relative `*.md(#frag)` cross-file link in-pane (AC8). */
  onDocLinkClick?: (href: string) => void;
  /** Scroll to this fragment once, after a cross-file navigation lands. */
  scrollToFragment?: string | null;
  /** Project id — required (with `path` + `onSaved`) to show the Edit button. */
  projectId?: string;
  /** Current file path (project-root-relative POSIX). */
  path?: string;
  /** Re-fetch callback fired after a successful in-app edit. Its presence
   *  (set only by the primary inline pane) gates the Edit button. */
  onSaved?: () => void;
}

const TOOLBAR_BTN =
  "inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium";

export function MarkdownRenderer({
  text,
  onPopOut,
  onDocLinkClick,
  scrollToFragment,
  projectId,
  path,
  onSaved,
}: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const canEdit = Boolean(projectId && path && onSaved);

  // Sven feedback (2026-07-17): the Edit / Pop out controls were muted-grey on a
  // near-invisible light border. Black text + black border makes them legible on
  // the white reading surface. Tokens keep the no-hardcoded-colors guard green.
  const btnStyle = {
    background: "var(--color-surface, #ffffff)",
    border: "1px solid var(--color-text, #1a1a1a)",
    color: "var(--color-text, #1a1a1a)",
  };

  return (
    <div className="relative flex h-full flex-col" data-testid="smart-viewer-markdown-wrap">
      <div className="absolute right-3 top-2 z-10 flex items-center gap-1.5">
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            className={TOOLBAR_BTN}
            style={btnStyle}
            data-testid="smart-viewer-edit"
            title="Edit this file in a rich-text editor"
          >
            <Pencil size={12} aria-hidden="true" />
            Edit
          </button>
        )}
        {onPopOut && (
          <button
            type="button"
            onClick={onPopOut}
            className={TOOLBAR_BTN}
            style={btnStyle}
            data-testid="smart-viewer-popout"
            title="Expand to a larger view"
          >
            <ExternalLink size={12} aria-hidden="true" />
            Pop out
          </button>
        )}
      </div>
      <div
        className="smart-viewer-markdown h-full overflow-auto p-5"
        style={{ background: "var(--color-surface, #ffffff)" }}
        data-testid="smart-viewer-markdown"
      >
        <DocumentMarkdown
          text={text}
          onDocLinkClick={onDocLinkClick}
          scrollToFragment={scrollToFragment}
        />
      </div>
      {canEdit && editorOpen && (
        <Suspense fallback={null}>
          <MarkdownEditorModal
            open
            onOpenChange={setEditorOpen}
            projectId={projectId!}
            path={path!}
            onSaved={() => onSaved!()}
          />
        </Suspense>
      )}
    </div>
  );
}
