/*
 * OrgChart — the `.chartwrap` block at the top of the Org page: the PO
 * node, one `.lcard` per lead (from `org-chart.json`'s roster), and a
 * disabled, non-interactive "+ add lead" ghost card (AC-1; editing
 * `org-chart.json` is out of scope this iterate — see the iterate spec).
 */

import type { LeadRosterEntry, OrgChartView } from "../../lib/orgApi";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return chars.join("") || "?";
}

export function OrgChart({ chart, roster }: { chart: OrgChartView; roster: LeadRosterEntry[] }) {
  return (
    <div className="chartwrap" data-testid="org-chart">
      <div className="pnode">
        <span className="av">{initials(chart.po)}</span>
        <span style={{ flex: 1 }}>
          <span className="nm" style={{ display: "block" }}>
            {chart.po}
          </span>
          <span className="ro">Principal — decides what only they can decide</span>
        </span>
      </div>
      <div className="stem" />
      <div className="bar" style={{ width: "66.6%" }} />
      <div className="lrow">
        {roster.map((lead) => (
          <div className="lcard" key={lead.leadId} data-testid="org-chart-lead-card">
            <div className="lt">
              <span className="nm">{lead.name}</span>
            </div>
            <div className="sub">
              {lead.domain} · {lead.cadence.measured ? lead.cadence.text : "not measured"}
            </div>
            <div className="st">
              <span className="badge">{lead.now.state === "running" ? "running" : "not measured"}</span>
            </div>
          </div>
        ))}
        <div
          className="lcard ghost"
          data-testid="org-chart-add-lead"
          aria-disabled="true"
          title="Adding a lead is not available yet"
        >
          + add lead
        </div>
      </div>
    </div>
  );
}
