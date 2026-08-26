/*
 * AuditLogModal — bounded, paginated structured view of a lead's
 * `audit.jsonl` (Docs block "Open log", AC-2). Never fetches the whole
 * growing file: each page is `fetchLeadAuditLog`'s bounded response, with a
 * "Load older" button appending the next page via its `nextCursor`.
 */

import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, FileQuestion, Loader2, X } from "lucide-react";

import { fetchLeadAuditLog, type AuditLogEntry } from "../../lib/orgApi";
import { ApiError } from "../../lib/externalApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
}

function EntryRow({ entry }: { entry: AuditLogEntry }) {
  if (!entry.parsed) {
    return (
      <pre className="whitespace-pre-wrap break-all rounded-[6px] bg-[var(--color-muted-bg,#ede8e1)]/40 p-2 text-[11px] text-[var(--color-muted,#6b7280)]">
        {entry.raw}
      </pre>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-all rounded-[6px] bg-[var(--color-muted-bg,#ede8e1)]/40 p-2 text-[11px] text-[var(--color-text,#1a1a1a)]">
      {JSON.stringify(entry.parsed, null, 2)}
    </pre>
  );
}

export function AuditLogModal({ open, onOpenChange, leadId }: Props) {
  // Code-review fix: pages were previously accumulated via a side effect
  // inside `queryFn` (`setPages` called from there). That silently broke on
  // a cache-served remount — close the modal, reopen it within the default
  // 5-minute gcTime, and TanStack Query serves the cached page WITHOUT
  // re-invoking `queryFn`, so local `pages` state (re-initialized empty on
  // remount) never got populated and the modal rendered blank. One query
  // PER cursor page (via `useQueries`), with entries derived directly from
  // each query's own `data` rather than a side effect, has no such gap: a
  // cache hit on remount still returns `data` immediately.
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);

  const queries = useQueries({
    queries: cursors.map((cursor) => ({
      queryKey: ["org", "lead-audit", leadId, cursor],
      queryFn: () => fetchLeadAuditLog(leadId, { before: cursor }),
      enabled: open,
      retry: false,
    })),
  });

  const isLoading = queries[0]?.isLoading ?? false;
  // Doubt-review fix: reading only queries[0]'s error hid a failure on any
  // page after the first — existing rows just sat there with no error UI
  // and no way to retry the page that actually failed.
  const error = queries.find((q) => q.error)?.error;
  const isFetching = queries.some((q) => q.isFetching);
  const lastQuery = queries[queries.length - 1];
  const lastFailed = lastQuery?.isError ?? false;
  const hasMore = lastQuery?.data ? lastQuery.data.nextCursor !== null : true;

  const notFound = error instanceof ApiError && error.status === 404;
  const entries: AuditLogEntry[] = queries.flatMap((q) => q.data?.entries ?? []);

  function loadOlder() {
    // Doubt-review fix: a failed last page must be RETRIED at its own
    // cursor, not re-derived from `lastQuery.data` (undefined on error) —
    // that previously fell back to `undefined`, silently re-fetching page
    // ONE into a new slot instead of the page that actually failed.
    if (lastFailed) {
      void lastQuery?.refetch();
      return;
    }
    const next = lastQuery?.data?.nextCursor ?? undefined;
    // Doubt-review fix: two rapid clicks can both fire before `cursors`'s
    // state update is reflected in a re-render, so both computed the SAME
    // `next` from the same stale `lastQuery` closure and appended a
    // duplicate cursor. The functional updater sees each prior queued
    // update in order, so this idempotency check catches the second click.
    setCursors((prev) => (prev[prev.length - 1] === next ? prev : [...prev, next]));
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setCursors([undefined]);
        }
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-[min(900px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card,12px)] bg-[var(--color-surface,#ffffff)] shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="org-audit-log-modal"
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2.5">
            <Dialog.Title className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-text,#1a1a1a)]">
              {leadId}/audit.jsonl
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="org-audit-log-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {isLoading && entries.length === 0 && (
              <div className="flex h-full items-center justify-center text-[12px]" style={{ color: "var(--color-muted, #6b7280)" }} data-testid="org-audit-log-loading">
                <Loader2 size={16} className="mr-2 animate-spin" /> Loading…
              </div>
            )}
            {!isLoading && notFound && entries.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px]" style={{ color: "var(--color-muted, #6b7280)" }} data-testid="org-audit-log-not-found">
                <FileQuestion size={20} aria-hidden="true" />
                <span>No audit log recorded yet.</span>
              </div>
            )}
            {!isLoading && error && !notFound && entries.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px]" style={{ color: "var(--color-error, #DC2626)" }} data-testid="org-audit-log-error">
                <AlertCircle size={20} aria-hidden="true" />
                <span>Couldn't load the audit log: {error instanceof Error ? error.message : "unknown error"}</span>
              </div>
            )}
            {entries.length > 0 && (
              <div className="flex flex-col gap-2" data-testid="org-audit-log-entries">
                {entries.map((entry, i) => (
                  <EntryRow key={i} entry={entry} />
                ))}
                {lastFailed && (
                  <span
                    className="self-center text-[11px]"
                    style={{ color: "var(--color-error, #DC2626)" }}
                    data-testid="org-audit-log-page-error"
                  >
                    Couldn't load the next page — try again.
                  </span>
                )}
                {hasMore && (
                  <button
                    type="button"
                    disabled={isFetching}
                    onClick={loadOlder}
                    className="mt-2 self-center rounded-[6px] px-3 py-1.5 text-[12px] font-medium text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:opacity-50"
                    data-testid="org-audit-log-load-older"
                  >
                    {isFetching ? "Loading…" : lastFailed ? "Retry" : "Load older entries"}
                  </button>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
