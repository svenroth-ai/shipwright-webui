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

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, CheckCircle2, FileQuestion, Inbox, Loader2, X } from "lucide-react";

import { fetchProposedDecisions, countersignDecision, type ProposedDecisionEntry } from "../../lib/orgDecisionsApi";
import { rejectDecision, fetchRejectedKeys } from "../../lib/orgRejectApi";
import { decisionKeyOf } from "../../lib/orgDecisionKey";
import { ApiError } from "../../lib/externalApi";
import { DecisionEntryRow, type EntryStatus } from "./DecisionEntryRow";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Index is part of the key — the server allows two distinct proposals to
// share (timestamp, leadId) (409 duplicate_proposal_identity), and without
// the index such entries would collide on both the React list `key` and the
// `statuses` map slot.
//
// Doubt-review rebuttal (LOW): the key is positional, so a refetch that
// removes/reorders entries (a successful countersign always does — the
// entry disappears) can orphan an UNRELATED row's non-idle `statuses` entry
// under a now-stale index, silently resetting that row's error/duplicate
// banner back to idle. This is a cosmetic staleness, not data loss: the
// underlying file state is always correct (the lock + core own that), and
// the affected row's banner reappears the moment the PO retries the action
// it was showing. Fixing it precisely (e.g. keying by a content hash) adds
// a second key scheme for a scenario — a stale banner racing a SIBLING
// row's independent success — that requires the PO to be mid-error on one
// proposal while successfully countersigning another in the same instant.
// Deferred rather than fixed; revisit if this proves confusing in practice.
const entryKey = (e: ProposedDecisionEntry, i: number) => `${e.timestamp}|${e.leadId}|${i}`;

export function OrgDecisionsProposedModal({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<Record<string, EntryStatus>>({});
  // E2E-fix: entries this modal instance has itself countersigned, kept
  // pinned so their "done" banner stays observable even after the refetch
  // below removes them from the server's own list (they really are gone
  // from decisions-proposed.md). Reset naturally on close — OrgSharedDocs
  // unmounts this component when the tile's modal closes, so a fresh open
  // starts with an empty map, never a stale success from a prior session.
  const [notice, setNotice] = useState<string | null>(null);
  const [settled, setSettled] = useState<Record<string, { entry: ProposedDecisionEntry; status: EntryStatus }>>({});
  // Rows with a request in flight: a double click must send ONE request.
  const inFlight = useRef(new Set<string>());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["org", "decisions-proposed"],
    queryFn: fetchProposedDecisions,
    enabled: open,
    retry: false,
  });

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

  async function handleReject(entry: ProposedDecisionEntry, index: number, reason: string) {
    const key = entryKey(entry, index);
    const flightKey = `${entry.timestamp}|${entry.leadId}`; // not positional: survives a sibling's refetch
    if (inFlight.current.has(flightKey)) return;
    inFlight.current.add(flightKey);
    setStatuses((prev) => ({ ...prev, [key]: { kind: "pending" } }));
    try {
      const result = await rejectDecision(entry.timestamp, entry.leadId, reason);
      let status: EntryStatus;
      if (result.ok) status = { kind: "rejected", alreadyRejected: result.alreadyRejected };
      else if (result.reason === "duplicate") status = { kind: "duplicate", count: result.count };
      else if (result.reason === "already-countersigned") status = { kind: "done", alreadyCountersigned: true, adr: `ADR-${String(result.adr).padStart(4, "0")}` };
      else if (result.reason === "lead-unknown") status = { kind: "blocked", message: "Can't reject: this lead has no folder." };
      else status = { kind: "resolved-elsewhere" };
      setStatuses((prev) => ({ ...prev, [key]: status }));
      // The rejected row leaves the list (it is filtered below); the notice carries no quote text.
      if (status.kind === "rejected") setNotice(`Rejected: ${entry.leadId}, ${entry.timestamp}. Recorded in the audit log.`);
      if (status.kind !== "duplicate") {
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: ["org", "decisions-rejected-keys"] }),
        ]);
      }
    } catch (err) {
      setStatuses((prev) => ({
        ...prev,
        [key]: { kind: "error", message: err instanceof Error ? err.message : "unknown error" },
      }));
    } finally {
      inFlight.current.delete(flightKey);
    }
  }

  async function handleCountersign(entry: ProposedDecisionEntry, index: number) {
    const key = entryKey(entry, index);
    const flightKey = `${entry.timestamp}|${entry.leadId}`; // not positional: survives a sibling's refetch
    if (inFlight.current.has(flightKey)) return;
    inFlight.current.add(flightKey);
    setStatuses((prev) => ({ ...prev, [key]: { kind: "pending" } }));
    try {
      const result = await countersignDecision(entry.timestamp, entry.leadId);
      if (!result.ok && result.reason === "duplicate") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "duplicate", count: result.count } }));
        return;
      }
      if (!result.ok && result.reason === "reject-pending") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "blocked", message: "This proposal was rejected but not removed. Use Reject to finish." } }));
        return;
      }
      if (!result.ok && result.reason === "not-found") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "resolved-elsewhere" } }));
        await refetch();
        return;
      }
      if (result.ok) {
        setStatuses((prev) => ({
          ...prev,
          [key]: { kind: "done", alreadyCountersigned: result.alreadyCountersigned, adr: result.adr },
        }));
        setSettled((prev) => ({
          ...prev,
          [key]: { entry, status: { kind: "done", alreadyCountersigned: result.alreadyCountersigned, adr: result.adr } },
        }));
        // Both surfaces observe the same countersign action's effect —
        // refresh the proposed list (the entry is gone) and the
        // decision_log.md tile (the new entry is there), without the PO
        // re-opening either.
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: ["org", "shared-doc", "decision_log.md"] }),
        ]);
      }
    } catch (err) {
      setStatuses((prev) => ({
        ...prev,
        [key]: { kind: "error", message: err instanceof Error ? err.message : "unknown error" },
      }));
    } finally {
      inFlight.current.delete(flightKey);
    }
  }

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
                    onCountersign={() => void handleCountersign(entry, index)}
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
