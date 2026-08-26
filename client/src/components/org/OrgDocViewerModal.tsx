/*
 * OrgDocViewerModal — read-only viewer for a GET-only org document (the
 * shared-documents block's four tiles, and a lead's `learnings.md`). Design
 * Notes, "Docs block — view-only contract": markdown renders through the
 * existing `DocumentMarkdown` pipeline (no edit affordance, no save path);
 * `org-chart.json` isn't markdown, so it renders pretty-printed instead. A
 * missing file shows a visible "not found" state, never a blank/broken pane.
 */

import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, FileQuestion, FileText, Loader2, X } from "lucide-react";

import { DocumentMarkdown } from "../external/SmartViewer/DocumentMarkdown";
import { ApiError } from "../../lib/externalApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  queryKey: readonly unknown[];
  fetcher: () => Promise<string>;
  renderAs?: "markdown" | "json";
}

export function OrgDocViewerModal({ open, onOpenChange, title, queryKey, fetcher, renderAs = "markdown" }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: fetcher,
    enabled: open,
    retry: false,
  });

  const notFound = error instanceof ApiError && error.status === 404;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-[min(900px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card,12px)] bg-[var(--color-surface,#ffffff)] shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="org-doc-viewer-modal"
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2.5">
            <FileText size={14} className="shrink-0 text-[var(--color-accent,#857568)]" aria-hidden="true" />
            <Dialog.Title
              className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-text,#1a1a1a)]"
              title={title}
            >
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="org-doc-viewer-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {isLoading && (
              <div className="flex h-full items-center justify-center text-[12px]" style={{ color: "var(--color-muted, #6b7280)" }} data-testid="org-doc-viewer-loading">
                <Loader2 size={16} className="mr-2 animate-spin" /> Loading…
              </div>
            )}
            {!isLoading && notFound && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px]" style={{ color: "var(--color-muted, #6b7280)" }} data-testid="org-doc-viewer-not-found">
                <FileQuestion size={20} aria-hidden="true" />
                <span>{title} doesn't exist yet.</span>
              </div>
            )}
            {!isLoading && error && !notFound && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px]" style={{ color: "var(--color-error, #DC2626)" }} data-testid="org-doc-viewer-error">
                <AlertCircle size={20} aria-hidden="true" />
                <span>Couldn't load {title}: {error instanceof Error ? error.message : "unknown error"}</span>
              </div>
            )}
            {!isLoading && !error && data !== undefined && renderAs === "markdown" && (
              <DocumentMarkdown text={data} />
            )}
            {!isLoading && !error && data !== undefined && renderAs === "json" && (
              <pre className="markdown-body text-xs leading-relaxed" data-testid="org-doc-viewer-json">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(data), null, 2);
                  } catch {
                    return data;
                  }
                })()}
              </pre>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
