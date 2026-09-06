/*
 * AuditTimelineModal — cross-lead activity view (iterate-2026-09-06-
 * org-audit-timeline). Answers "what did one or more leads do overnight"
 * in ONE view instead of opening `AuditLogModal` per lead and merging raw
 * JSON by eye.
 *
 * Stateless merge over the EXISTING, unmodified per-lead route — see
 * `lib/auditTimelineMerge.ts` for the full pagination-trap decision
 * history. No new server surface, no persisted cursor: every render
 * re-fetches each selected lead's newest `windowSize` entries fresh, so a
 * concurrent daemon append (the PO's actual overnight scenario) can never
 * desync a stored cursor, because there isn't one. Filter bar and row list
 * are split into sibling files purely to stay under the 300-line
 * guideline — this file owns state + the fetch/merge wiring only.
 */

import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { fetchLeadAuditLog, type AuditLogPage } from "../../lib/orgApi";
import {
  mergeAuditTimelineEntries,
  hasMoreToLoad,
  isAtWindowCeiling,
  computeLastNightWindow,
  DEFAULT_WINDOW,
  MAX_WINDOW,
} from "../../lib/auditTimelineMerge";
import { AuditTimelineFilterBar, type AuditTimelineLeadOption } from "./AuditTimelineFilterBar";
import { AuditTimelineRowList } from "./AuditTimelineRowList";

export type { AuditTimelineLeadOption } from "./AuditTimelineFilterBar";

const WINDOW_GROWTH = 50;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: AuditTimelineLeadOption[];
}

export function AuditTimelineModal({ open, onOpenChange, leads }: Props) {
  const allLeadIds = leads.map((l) => l.leadId);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [timeWindow, setTimeWindow] = useState<{ sinceMs?: number; untilMs?: number }>({});
  const [timeWindowSource, setTimeWindowSource] = useState<"last-night" | "manual" | null>(null);
  const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW);

  const activeLeadIds = selectedLeads.length > 0 ? selectedLeads : allLeadIds;
  const hasTimeWindow = timeWindow.sinceMs !== undefined || timeWindow.untilMs !== undefined;

  const queries = useQueries({
    queries: activeLeadIds.map((leadId) => ({
      queryKey: ["org", "audit-timeline", leadId, windowSize],
      queryFn: () => fetchLeadAuditLog(leadId, { before: 0, limit: windowSize }),
      enabled: open,
      retry: false,
      placeholderData: (prev: AuditLogPage | undefined) => prev,
    })),
  });

  const perLeadPages: Record<string, AuditLogPage | undefined> = {};
  activeLeadIds.forEach((leadId, i) => {
    if (queries[i]?.data) perLeadPages[leadId] = queries[i].data;
  });

  const isLoading = open && queries.some((q) => q.isLoading);
  // `placeholderData: prev => prev` (added to stop Load-More/window-growth
  // flicker) means `perLeadPages` can be showing a stale, smaller window
  // while a bigger one fetches — `hasMoreToLoad`/`isAtWindowCeiling` would
  // then be computed against the OLD page vs. the NEW target windowSize and
  // silently under-report, making the Load-more control vanish with no
  // feedback mid-fetch (doubt-review finding). Surface that state instead.
  const isWindowLoading = open && queries.some((q) => q.isFetching);
  const leadName = (leadId: string) => leads.find((l) => l.leadId === leadId)?.name ?? leadId;
  const failedLeadNames = activeLeadIds.filter((_, i) => queries[i]?.isError).map(leadName);

  const filters = {
    leadIds: selectedLeads.length > 0 ? selectedLeads : undefined,
    eventTypes: selectedKinds.length > 0 ? selectedKinds : undefined,
    sinceMs: timeWindow.sinceMs,
    untilMs: timeWindow.untilMs,
  };
  const rows = mergeAuditTimelineEntries(perLeadPages, filters, windowSize);

  function resetWindowFor(nextHasTimeWindow: boolean) {
    setWindowSize(nextHasTimeWindow ? MAX_WINDOW : DEFAULT_WINDOW);
  }

  function toggleLead(leadId: string) {
    setSelectedLeads((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId],
    );
    resetWindowFor(hasTimeWindow);
  }

  function toggleKind(kind: string) {
    setSelectedKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
    resetWindowFor(hasTimeWindow);
  }

  function applyLastNight() {
    setTimeWindow(computeLastNightWindow(new Date()));
    setTimeWindowSource("last-night");
    resetWindowFor(true);
  }

  function applyRange(sinceMs: number, untilMs: number) {
    setTimeWindow({ sinceMs, untilMs });
    setTimeWindowSource("manual");
    resetWindowFor(true);
  }

  function clearTimeWindow() {
    setTimeWindow({});
    setTimeWindowSource(null);
    resetWindowFor(false);
  }

  function resetAll() {
    setSelectedLeads([]);
    setSelectedKinds([]);
    setTimeWindow({});
    setTimeWindowSource(null);
    setWindowSize(DEFAULT_WINDOW);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) resetAll();
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex h-[85vh] w-[min(1000px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card,12px)] bg-[var(--color-surface,#ffffff)] shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="org-audit-timeline-modal"
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2.5">
            <Dialog.Title className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-text,#1a1a1a)]">
              Activity — every lead
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="org-audit-timeline-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <AuditTimelineFilterBar
            leads={leads}
            selectedLeads={selectedLeads}
            selectedKinds={selectedKinds}
            hasTimeWindow={hasTimeWindow}
            activeTimeWindowSource={timeWindowSource}
            onToggleLead={toggleLead}
            onToggleKind={toggleKind}
            onApplyLastNight={applyLastNight}
            onApplyRange={applyRange}
            onClearTimeWindow={clearTimeWindow}
          />

          <AuditTimelineRowList
            rows={rows}
            isLoading={isLoading}
            isWindowLoading={isWindowLoading}
            failedLeadNames={failedLeadNames}
            leadName={leadName}
            hasMore={hasMoreToLoad(perLeadPages, filters, windowSize)}
            atCeiling={isAtWindowCeiling(perLeadPages, filters, windowSize)}
            onLoadMore={() => setWindowSize((w) => Math.min(MAX_WINDOW, w + WINDOW_GROWTH))}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
