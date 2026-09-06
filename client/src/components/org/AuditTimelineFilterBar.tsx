/*
 * AuditTimelineFilterBar — lead / event-type multi-select + "Last night"
 * preset for `AuditTimelineModal`. Split out purely to keep the modal file
 * under the 300-line guideline; no behavior of its own beyond rendering
 * the current filter state and forwarding toggle/apply/clear callbacks.
 */

import { useState } from "react";

import { AUDIT_KIND_LABELS } from "../../lib/auditKindLabels";

export interface AuditTimelineLeadOption {
  leadId: string;
  name: string;
}

interface Props {
  leads: AuditTimelineLeadOption[];
  selectedLeads: string[];
  selectedKinds: string[];
  hasTimeWindow: boolean;
  activeTimeWindowSource: "last-night" | "manual" | null;
  onToggleLead: (leadId: string) => void;
  onToggleKind: (kind: string) => void;
  onApplyLastNight: () => void;
  onApplyRange: (sinceMs: number, untilMs: number) => void;
  onClearTimeWindow: () => void;
}

export function AuditTimelineFilterBar({
  leads,
  selectedLeads,
  selectedKinds,
  hasTimeWindow,
  activeTimeWindowSource,
  onToggleLead,
  onToggleKind,
  onApplyLastNight,
  onApplyRange,
  onClearTimeWindow,
}: Props) {
  const [sinceInput, setSinceInput] = useState("");
  const [untilInput, setUntilInput] = useState("");

  function applyRange() {
    let sinceMs = Date.parse(sinceInput);
    let untilMs = Date.parse(untilInput);
    if (Number.isNaN(sinceMs) || Number.isNaN(untilMs)) return;
    if (sinceMs > untilMs) [sinceMs, untilMs] = [untilMs, sinceMs];
    onApplyRange(sinceMs, untilMs);
  }

  function clearTimeWindow() {
    setSinceInput("");
    setUntilInput("");
    onClearTimeWindow();
  }
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2 text-[11px]"
      data-testid="org-audit-timeline-filters"
    >
      <fieldset className="flex flex-wrap items-center gap-1.5" title="Nothing checked shows every lead — check one or more to narrow the view to just those.">
        <legend className="mr-1 text-[var(--color-muted,#6b7280)]">Lead (check to narrow)</legend>
        {leads.map((lead) => (
          <label key={lead.leadId} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={selectedLeads.includes(lead.leadId)}
              onChange={() => onToggleLead(lead.leadId)}
              data-testid={`org-audit-timeline-lead-${lead.leadId}`}
            />
            {lead.name}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-1.5" title="Nothing checked shows every event type, including ones not listed here — check one or more to narrow.">
        <legend className="mr-1 text-[var(--color-muted,#6b7280)]">Event (check to narrow)</legend>
        {Object.keys(AUDIT_KIND_LABELS).map((kind) => (
          <label key={kind} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={selectedKinds.includes(kind)}
              onChange={() => onToggleKind(kind)}
              data-testid={`org-audit-timeline-kind-${kind}`}
            />
            {AUDIT_KIND_LABELS[kind]}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        onClick={onApplyLastNight}
        data-active={activeTimeWindowSource === "last-night" || undefined}
        data-testid="org-audit-timeline-last-night"
        className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 data-[active]:border-[var(--color-primary)] data-[active]:text-[var(--color-primary)]"
      >
        Last night
      </button>
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="mr-1 text-[var(--color-muted,#6b7280)]">Range</legend>
        <input
          type="datetime-local"
          value={sinceInput}
          onChange={(e) => setSinceInput(e.target.value)}
          data-testid="org-audit-timeline-range-since"
          className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-1 py-0.5"
        />
        <span>to</span>
        <input
          type="datetime-local"
          value={untilInput}
          onChange={(e) => setUntilInput(e.target.value)}
          data-testid="org-audit-timeline-range-until"
          className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-1 py-0.5"
        />
        <button
          type="button"
          onClick={applyRange}
          disabled={!sinceInput || !untilInput}
          data-testid="org-audit-timeline-range-apply"
          className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 disabled:opacity-50"
        >
          Apply
        </button>
      </fieldset>
      {hasTimeWindow && (
        <button type="button" onClick={clearTimeWindow} data-testid="org-audit-timeline-clear-window">
          Clear time filter
        </button>
      )}
    </div>
  );
}
