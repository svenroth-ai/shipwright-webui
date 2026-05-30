/*
 * MarkdownRenderer — SmartViewer's .md / .markdown pane. Renders project
 * files through <DocumentMarkdown> (controlled-HTML + frontmatter + anchor
 * nav — distinct from the transcript's XSS-locked <MarkdownText>) and adds a
 * pop-out button + a single page-level horizontal scrollbar (AC5).
 */

import { ExternalLink } from "lucide-react";

import { DocumentMarkdown } from "./DocumentMarkdown";

interface Props {
  text: string;
  /** Present in the in-pane viewer; omitted inside the pop-out window itself. */
  projectId?: string;
  path?: string;
  /** Follow a relative `*.md(#frag)` cross-file link in-pane (AC8). */
  onDocLinkClick?: (href: string) => void;
  /** Scroll to this fragment once, after a cross-file navigation lands. */
  scrollToFragment?: string | null;
}

export function MarkdownRenderer({
  text,
  projectId,
  path,
  onDocLinkClick,
  scrollToFragment,
}: Props) {
  const canPopOut = Boolean(projectId && path);

  return (
    <div className="relative flex h-full flex-col" data-testid="smart-viewer-markdown-wrap">
      {canPopOut && (
        <button
          type="button"
          onClick={() =>
            window.open(
              `/preview?projectId=${encodeURIComponent(projectId!)}&path=${encodeURIComponent(path!)}`,
              "_blank",
              "noopener",
            )
          }
          className="absolute right-3 top-2 z-10 inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px]"
          style={{
            background: "var(--color-surface, #ffffff)",
            border: "1px solid var(--color-border, #e0dbd4)",
            color: "var(--color-muted, #6b7280)",
          }}
          data-testid="smart-viewer-popout"
          title="Open in new window"
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
