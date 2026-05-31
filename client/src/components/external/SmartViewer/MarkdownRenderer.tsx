/*
 * MarkdownRenderer — SmartViewer's .md / .markdown pane. Renders project
 * files through <DocumentMarkdown> (controlled-HTML + frontmatter + anchor
 * nav — distinct from the transcript's XSS-locked <MarkdownText>) and adds a
 * pop-out button + a single page-level horizontal scrollbar (AC5).
 *
 * The pop-out button delegates to an `onPopOut` callback — the parent opens
 * the centered in-app <SmartViewerModal>, NOT a new browser tab. When
 * `onPopOut` is omitted (the modal-nested instance), the button is suppressed
 * so the expanded view shows no further pop-out control.
 */

import { ExternalLink } from "lucide-react";

import { DocumentMarkdown } from "./DocumentMarkdown";

interface Props {
  text: string;
  /** Open the file in the centered in-app pop-out modal. Omitted inside the
   *  modal itself so the nested viewer renders no further pop-out button. */
  onPopOut?: () => void;
  /** Follow a relative `*.md(#frag)` cross-file link in-pane (AC8). */
  onDocLinkClick?: (href: string) => void;
  /** Scroll to this fragment once, after a cross-file navigation lands. */
  scrollToFragment?: string | null;
}

export function MarkdownRenderer({
  text,
  onPopOut,
  onDocLinkClick,
  scrollToFragment,
}: Props) {
  return (
    <div className="relative flex h-full flex-col" data-testid="smart-viewer-markdown-wrap">
      {onPopOut && (
        <button
          type="button"
          onClick={onPopOut}
          className="absolute right-3 top-2 z-10 inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px]"
          style={{
            background: "var(--color-surface, #ffffff)",
            border: "1px solid var(--color-border, #e0dbd4)",
            color: "var(--color-muted, #6b7280)",
          }}
          data-testid="smart-viewer-popout"
          title="Expand to a larger view"
        >
          <ExternalLink size={12} aria-hidden="true" />
          Pop out
        </button>
      )}
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
    </div>
  );
}
