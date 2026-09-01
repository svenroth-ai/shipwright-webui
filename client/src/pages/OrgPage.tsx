/*
 * OrgPage — the operator's Organization overview (FR-01.71). Chart → shared
 * documents (view-only) → one card per lead, in that fixed order (AC-1).
 *
 * Presence handling mirrors `useOrgChartPresence()`'s 4-state contract
 * (iterate spec Design Notes, "Nav presence"): `loading` → page-level
 * loading state; `present` → render; `broken` → render WITH the page-level
 * error naming the failure (AC-7, never a blank/broken screen); `absent` →
 * the "not installed" empty state (AC-6b) — this is the SAME hook the nav
 * entries filter on, so a direct `/org` visit and the nav entry agree.
 */

import { PageHead } from "../components/common/PageHead";
import { OrgChart } from "../components/org/OrgChart";
import { OrgSharedDocs } from "../components/org/OrgSharedDocs";
import { LeadCard } from "../components/org/LeadCard";
import { OrgThreadList } from "../components/org/OrgThread";
import { useOrgChartPresence } from "../hooks/useOrgChartPresence";
import { useOrgChart } from "../hooks/useOrgChart";
import { useOrgRoster } from "../hooks/useOrgRoster";
import { useOrgThreads } from "../hooks/useOrgThreads";

export default function OrgPage() {
  const presence = useOrgChartPresence();

  return (
    <div className="org-page flex h-full flex-col bg-[var(--color-bg)]" data-testid="org-page">
      <PageHead title="Org" testId="org-header" />
      <div className="flex-1 overflow-y-auto">
        {presence === "loading" && (
          <div className="page-container w-full" style={{ padding: "32px 0" }}>
            <span style={{ color: "var(--color-muted)", fontSize: 13 }}>Loading…</span>
          </div>
        )}
        {presence === "absent" && (
          <div className="page-container w-full" data-testid="org-page-not-installed" style={{ padding: "32px 0" }}>
            <p style={{ fontSize: 13, color: "var(--color-muted)" }}>
              No AI leads are set up yet — install <code>leadwright</code> to see your
              organization here.
            </p>
          </div>
        )}
        {presence === "broken" && <OrgPageErrorState />}
        {presence === "present" && <OrgPageContent />}
      </div>
    </div>
  );
}

function OrgPageErrorState() {
  const { error } = useOrgChart();
  return (
    <div
      className="page-container w-full"
      data-testid="org-page-broken"
      role="alert"
      style={{ padding: "32px 0" }}
    >
      <p style={{ fontSize: 13, color: "var(--color-error)" }}>
        Couldn't load your organization: {error instanceof Error ? error.message : "unknown error"}
      </p>
    </div>
  );
}

function OrgPageContent() {
  const { data: roster, isLoading, error } = useOrgRoster();
  const { data: chart } = useOrgChart();
  const threads = useOrgThreads();

  if (isLoading || !chart) {
    return (
      <div className="page-container w-full" style={{ padding: "32px 0" }}>
        <span style={{ color: "var(--color-muted)", fontSize: 13 }}>Loading…</span>
      </div>
    );
  }
  if (error || !roster) {
    return (
      <div className="page-container w-full" role="alert" style={{ padding: "32px 0" }}>
        <span style={{ color: "var(--color-error)", fontSize: 13 }}>
          Couldn't load your leads: {error instanceof Error ? error.message : "unknown error"}
        </span>
      </div>
    );
  }

  return (
    <div className="page-container w-full" style={{ paddingBottom: "24px" }}>
      <OrgChart chart={chart} roster={roster.leads} />
      <OrgSharedDocs />
      <div className="leadlist" data-testid="org-lead-list" style={{ padding: "0 18px 18px" }}>
        {roster.leads.map((lead) => (
          <div key={lead.leadId}>
            <LeadCard lead={lead} />
            <OrgThreadList cards={threads[lead.leadId]} />
          </div>
        ))}
      </div>
    </div>
  );
}
