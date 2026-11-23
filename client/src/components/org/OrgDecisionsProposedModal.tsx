/*
 * OrgDecisionsProposedModal — the shared-documents block's fifth tile
 * (FR-01.71 (F), iterate-2026-09-06-decisions-proposed-countersign). Unlike
 * the other four tiles' generic `OrgDocViewerModal` (view-only by its own
 * doc comment — "never a write path"), this is a DEDICATED, write-capable
 * modal: it lists `decisions-proposed.md`'s parsed entries and gives each
 * one a Countersign button.
 *
 * Design Notes:
 *   - An empty file (no entries) shows an explicit "no decisions waiting"
 *     state — never a blank modal.
 *   - `409 duplicate_proposal_identity` reads as "two proposals share an
 *     identity, resolve by hand" — distinct wording from every other
 *     failure, since it names a data problem the PO must fix by hand, not a
 *     transient error to retry.
 *   - An idempotent retry that finds the entry already logged (`404` after
 *     someone else countersigned it moments ago, or the success response's
 *     own `alreadyCountersigned: true`) shows the existing ADR number and
 *     is rendered as a QUIET state, never as an error banner.
 *   - On a fresh success, both this list and the `decision_log.md` tile
 *     refresh — the PO sees the new ADR number without re-opening either
 *     modal. E2E-fix: the refetch this triggers removes the entry from the
 *     server's list (it really is gone from decisions-proposed.md) faster
 *     than a human — or a real-browser test — can observe the "done" banner
 *     that same click produced, so a just-countersigned entry stays pinned
 *     in view (via `settled`) showing its ADR number until the modal is
 *     closed, instead of vanishing mid-render.
 */

import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, CheckCircle2, FileQuestion, Inbox, Loader2, X } from "lucide-react";

import { fetchProposedDecisions, type ProposedDecisionEntry } from "../../lib/orgDecisionsApi";
import { fetchRejectedKeys } from "../../lib/orgRejectApi";
import { decisionKeyOf } from "../../lib/orgDecisionKey";
import { ApiError } from "../../lib/externalApi";
import { DecisionEntryRow } from "./DecisionEntryRow";
import { SkippedEntriesNotice } from "./SkippedEntriesNotice";
import { useDecisionActions, entryKey } from "./useDecisionActions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OrgDecisionsProposedModal({ open, onOpenChange }: Props) {
  const { data: result, isLoading, error, refetch } = useQuery({
    queryKey: ["org", "decisions-proposed"],
    queryFn: fetchProposedDecisions,
    enabled: open,
    retry: false,
  });

  const data = result?.entries;
  const leadIds = [...new Set((data ?? []).map((e) => e.leadId))];
  const { data: rejectedByLead } = useQuery({
    queryKey: ["org", "decisions-rejected-keys", leadIds.join(",")],
    queryFn: () => fetchRejectedKeys(leadIds),
    enabled: open && leadIds.length > 0,
    retry: false,
  });
  const isRepeat = (e: ProposedDecisionEntry) => {
    const key = decisionKeyOf(e.block);
    return key !== null && (rejectedByLead?.[e.leadId] ?? []).some((r) => r.key === key && r.entryTimestamp !== e.timestamp);
  };

  const notFound = error instanceof ApiError && error.status === 404;
  const { statuses, settled, notice, handleReject, handleCountersign } = useDecisionActions(refetch);

  const allEntries = data ?? [];
  const liveKeys = new Set(allEntries.map((e, i) => entryKey(e, i)));
  const visibleCount = allEntries.filter((e, i) => statuses[entryKey(e, i)]?.kind !== "rejected").length;
  // A settled entry the server has already dropped from its list (the
  // common case — the countersign actually removed it) stays pinned here;
  // one still present (a mocked/stale refetch, or the rare same-identity
  // coincidence) is already covered by `statuses` on its live row, so it is
  // excluded here to avoid rendering it twice.
  const settledExtras = Object.entries(settled).filter(([key]) => !liveKeys.has(key));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-[min(900px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card,12px)] bg-[var(--color-surface,#ffffff)] shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="org-decisions-proposed-modal"
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2.5">
            <Inbox size={14} className="shrink-0 text-[var(--color-accent,#857568)]" aria-hidden="true" />
            <Dialog.Title className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-text,#1a1a1a)]">
              decisions-proposed.md
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="org-decisions-proposed-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div role="status" aria-live="polite" className="text-[11px]" data-testid="org-decisions-proposed-notice">{notice}</div>
            {!error && <SkippedEntriesNotice skipped={result?.skipped} />}
            {isLoading && (
              <div className="flex h-full items-center justify-center text-[12px]" style={{ color: "var(--color-muted, #6b7280)" }} data-testid="org-decisions-proposed-loading">
                <Loader2 size={16} className="mr-2 animate-spin" /> Loading…
              </div>
            )}
            {!isLoading && notFound && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px]" style={{ color: "var(--color-muted, #6b7280)" }} data-testid="org-decisions-proposed-not-found">
                <FileQuestion size={20} aria-hidden="true" />
                <span>decisions-proposed.md doesn't exist yet.</span>
              </div>
            )}
            {!isLoading && error && !notFound && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px]" style={{ color: "var(--color-error, #DC2626)" }} data-testid="org-decisions-proposed-error">
                <AlertCircle size={20} aria-hidden="true" />
                <span>Couldn't load decisions-proposed.md: {error instanceof Error ? error.message : "unknown error"}</span>
              </div>
            )}
            {!isLoading && !error && data !== undefined && visibleCount === 0 && settledExtras.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px]" style={{ color: "var(--color-muted, #6b7280)" }} data-testid="org-decisions-proposed-empty">
                <CheckCircle2 size={20} aria-hidden="true" />
                <span>No decisions waiting.</span>
              </div>
            )}
            {!isLoading && !error && data !== undefined && (visibleCount > 0 || settledExtras.length > 0) && (
              <ul className="flex flex-col gap-3" data-testid="org-decisions-proposed-list">
                {allEntries.map((entry, index) => statuses[entryKey(entry, index)]?.kind === "rejected" ? null : (
                  <DecisionEntryRow
                    key={entryKey(entry, index)}
                    rowKey={entryKey(entry, index)}
                    entry={entry}
                    status={statuses[entryKey(entry, index)] ?? { kind: "idle" }}
                    onCountersign={(line) => void handleCountersign(entry, index, line)}
                    onReject={(reason) => void handleReject(entry, index, reason)}
                    isRepeat={isRepeat(entry)}
                  />
                ))}
                {settledExtras.map(([key, s]) => (
                  <DecisionEntryRow
                    key={key}
                    rowKey={key}
                    entry={s.entry}
                    status={s.status}
                    onCountersign={() => {}}
                    onReject={() => {}}
                    isRepeat={false}
                  />
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
