/*
 * LeadCard — the five-block `.rcard2` lead card (iterate spec AC-2). Block
 * order is a PROMISE (a future per-lead detail page is this same card
 * enlarged) — each block carries `data-block` so component tests assert
 * DOM order directly, never a snapshot.
 *
 * Every unmeasured figure renders the literal text "not measured" — never
 * a blank, a zero, a dash, or a spinner (AC-3). `parallel` and `projects`
 * are PERMANENTLY not-measured this iterate (no data source — see the
 * iterate spec's Stats source table); they must never read from
 * `manages.length` or any other inferred value.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { LeadCadenceView, LeadNowState, LeadRoleView, LeadRosterEntry } from "../../lib/orgApi";
import { fetchLeadLearnings } from "../../lib/orgApi";
import { usageLabel, usageNoteText, usageValueText } from "./leadUsageDisplay";
import { formatRelativeTime } from "../../lib/formatTime";
import { loadMarkdownForEdit, saveMarkdown } from "../../lib/orgMarkdownFileApi";
import { ORG_ROSTER_QUERY_KEY } from "../../hooks/useOrgRoster";
import { MarkdownEditorModal } from "../external/SmartViewer/MarkdownEditorModal";
import { OrgDocViewerModal } from "./OrgDocViewerModal";
import { AuditLogModal } from "./AuditLogModal";

const AVATAR_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
  </svg>
);

function NowLine({ now }: { now: LeadNowState }) {
  if (now.state === "running") {
    return (
      <div className="nowline" data-testid="lead-now-running">
        <span className="pulse" />
        Running
      </div>
    );
  }
  if (now.state === "resting") {
    const text =
      now.lastRun.measured === false
        ? "No runs recorded yet"
        : `Last active ${formatRelativeTime(now.lastRun.lastRunAt)}`;
    return (
      <div className="nowline idle" data-testid="lead-now-resting">
        <span className="pulse" />
        Resting — {text}
      </div>
    );
  }
  if (now.state === "needs-attention") {
    return (
      <div className="nowline attn" data-testid="lead-now-attention">
        <span className="pulse" />
        Needs attention — duplicate session
      </div>
    );
  }
  return (
    <div className="nowline idle" data-testid="lead-now-unmeasured">
      <span className="pulse" />
      not measured
    </div>
  );
}

function roleText(role: LeadRoleView): string {
  return role.measured ? role.text : "not measured";
}

/**
 * The header's status badge is derived from the already-honest `now`
 * state — never a fabricated "active"/"paused" value (there is no
 * `paused` field in the strict org-chart projection to read one from, by
 * design; see the iterate spec's Design Notes).
 */
function statusBadge(now: LeadNowState): { label: string; className: string } {
  if (now.state === "running") return { label: "running", className: "badge acc" };
  if (now.state === "needs-attention") return { label: "needs attention", className: "badge warn" };
  if (now.state === "resting") return { label: "resting", className: "badge" };
  return { label: "not measured", className: "badge" };
}

function cadenceText(cadence: LeadCadenceView): string {
  return cadence.measured ? cadence.text : "not measured";
}

export function LeadCard({ lead }: { lead: LeadRosterEntry }) {
  const badge = statusBadge(lead.now);
  const usageNote = usageNoteText(lead.usage);
  const queryClient = useQueryClient();
  const [charterOpen, setCharterOpen] = useState(false);
  const [learningsOpen, setLearningsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  return (
    <div className="rcard2" data-testid="lead-card" data-lead-id={lead.leadId}>
      {/* Block 1 — Header: avatar, name, "<Domain> — reports to you", status badge, pause switch. */}
      <div className="rh" data-block="header" data-testid="lead-card-header">
        <span className="id">
          <span className="av2">{AVATAR_ICON}</span>
          <span>
            <span className="nm2" style={{ display: "block" }}>
              {lead.name}
            </span>
            <span className="ro2">{lead.domain} — reports to you</span>
          </span>
        </span>
        <span className="ctl">
          <span className={badge.className} data-testid="lead-status-badge">
            {badge.label}
          </span>
          <button
            type="button"
            className="switch"
            disabled
            aria-label="Pause — no route exists yet"
            title="Pause — no route exists yet"
            data-testid="lead-pause-switch"
          >
            <i />
          </button>
        </span>
      </div>

      {/* Block 2 — Role: one sentence extracted from charter.md. */}
      <div className="rolebox" data-block="role" data-testid="lead-card-role">
        <b>Role.</b> {roleText(lead.role)}
      </div>

      {/* Block 3 — Now: running / resting / needs-attention / not-measured. */}
      <div data-block="now" data-testid="lead-card-now">
        <NowLine now={lead.now} />
      </div>

      {/* Block 4 — Stats: cadence, parallel, N-day consumed spend, projects, runs. */}
      <div data-block="stats" data-testid="lead-card-stats">
        <div className="statrow">
          <span className="stat">
            <span className="k" style={{ display: "block" }}>
              Cadence
            </span>
            <span className={`v${lead.cadence.measured ? "" : " unmeasured"}`}>
              {cadenceText(lead.cadence)}
            </span>
          </span>
          <span className="stat">
            <span className="k" style={{ display: "block" }}>
              Parallel
            </span>
            <span className="v unmeasured">not measured</span>
          </span>
          <span className="stat">
            <span className="k" style={{ display: "block" }}>
              {usageLabel(lead.usage)}
            </span>
            <span
              className={`v${
                !lead.usage.measured ? " unmeasured" : lead.usage.anyNotMeasured ? " partial" : ""
              }`}
            >
              {usageValueText(lead.usage)}
            </span>
          </span>
          <span className="stat">
            <span className="k" style={{ display: "block" }}>
              Projects
            </span>
            <span className="v unmeasured">not measured</span>
          </span>
          <span className="stat">
            <span className="k" style={{ display: "block" }}>
              Runs
            </span>
            <span className={`v${lead.usage.measured ? "" : " unmeasured"}`}>
              {lead.usage.measured ? lead.usage.runCount : "not measured"}
            </span>
          </span>
        </div>
        {usageNote && (
          <div className="usagenote" data-testid="lead-usage-note">
            {usageNote}
          </div>
        )}
      </div>

      {/* Block 5 — Docs: charter.md (edit), learnings.md (view), audit.jsonl (view). */}
      <div className="docs" data-block="docs" data-testid="lead-card-docs">
        <div className="doctiles">
          <div className="dtile">
            <span className="dn">
              <span className="t">charter.md</span>
            </span>
            <span className="dm">Role, escalation, bands</span>
            <button
              type="button"
              className="da"
              data-testid="lead-charter-edit"
              onClick={() => setCharterOpen(true)}
            >
              Edit <span className="pen">· operator-only</span>
            </button>
          </div>
          <div className="dtile">
            <span className="dn">
              <span className="t">learnings.md</span>
            </span>
            <span className="dm">Lead-written</span>
            <button
              type="button"
              className="da"
              data-testid="lead-learnings-view"
              onClick={() => setLearningsOpen(true)}
            >
              View <span className="pen">· lead writes</span>
            </button>
          </div>
          <div className="dtile">
            <span className="dn">
              <span className="t">audit.jsonl</span>
            </span>
            <span className="dm">Run log</span>
            <button
              type="button"
              className="da"
              data-testid="lead-audit-view"
              onClick={() => setAuditOpen(true)}
            >
              Open log
            </button>
          </div>
        </div>
      </div>

      {charterOpen && (
        <MarkdownEditorModal
          open={charterOpen}
          onOpenChange={setCharterOpen}
          projectId={lead.leadId}
          path={`${lead.leadId}/charter.md`}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ORG_ROSTER_QUERY_KEY })}
          loadOverride={() => loadMarkdownForEdit(lead.leadId)}
          saveOverride={(text, fingerprint) => saveMarkdown(lead.leadId, text, fingerprint)}
        />
      )}
      {learningsOpen && (
        <OrgDocViewerModal
          open={learningsOpen}
          onOpenChange={setLearningsOpen}
          title={`${lead.leadId}/learnings.md`}
          queryKey={["org", "lead-learnings", lead.leadId]}
          fetcher={() => fetchLeadLearnings(lead.leadId)}
        />
      )}
      {auditOpen && <AuditLogModal open={auditOpen} onOpenChange={setAuditOpen} leadId={lead.leadId} />}
    </div>
  );
}
