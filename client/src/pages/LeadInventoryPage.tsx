/*
 * LeadInventoryPage — the lead inventory viewer (iterate-2026-09-08-lead-
 * inventory-page, FR-01.71(G)). The PO opens it in the morning and sees
 * what a lead did overnight, on whose authority, and where it needed him.
 *
 * A viewer, like `/org` is today — no org-chart editing, no terminal button
 * (card W15 owns that slot; omitted here entirely per Architecture Review,
 * not stubbed). Presence handling mirrors OrgPage's 4-state
 * `useOrgChartPresence()` contract exactly — the SAME hook the nav filters
 * on — so a broken chart never renders a blank page.
 *
 * ONE bounded scroller under the title bar (rule 27, the Diagnostics
 * pattern) — the shell never scrolls.
 */

import { PageHead } from "../components/common/PageHead";
import { AuthorityPanel } from "../components/leadInventory/AuthorityPanel";
import { BeatList } from "../components/leadInventory/BeatList";
import { NeedsYou } from "../components/leadInventory/NeedsYou";
import { useOrgChartPresence } from "../hooks/useOrgChartPresence";
import { useOrgChart } from "../hooks/useOrgChart";
import { useLeadInventory } from "../hooks/useLeadInventory";
import { useOrgThreads } from "../hooks/useOrgThreads";
import "../styles/leadInventory.css";

export default function LeadInventoryPage() {
  const presence = useOrgChartPresence();

  return (
    <div className="lead-inventory-page flex h-full flex-col bg-[var(--color-bg)]" data-testid="lead-inventory-page">
      <PageHead title="Lead Inventory" testId="lead-inventory-header" />
      <div className="flex-1 overflow-y-auto">
        {presence === "loading" && (
          <div className="page-container w-full" style={{ padding: "32px 0" }}>
            <span style={{ color: "var(--color-muted)", fontSize: 13 }}>Loading…</span>
          </div>
        )}
        {presence === "absent" && (
          <div className="page-container w-full" data-testid="lead-inventory-not-installed" style={{ padding: "32px 0" }}>
            <p style={{ fontSize: 13, color: "var(--color-muted)" }}>
              No AI leads are set up yet — install <code>leadwright</code> to see their inventory here.
            </p>
          </div>
        )}
        {presence === "broken" && <LeadInventoryErrorState />}
        {presence === "present" && <LeadInventoryContent />}
      </div>
    </div>
  );
}

function LeadInventoryErrorState() {
  const { error } = useOrgChart();
  return (
    <div className="page-container w-full" data-testid="lead-inventory-broken" role="alert" style={{ padding: "32px 0" }}>
      <p style={{ fontSize: 13, color: "var(--color-error)" }}>
        Couldn't load your organization: {error instanceof Error ? error.message : "unknown error"}
      </p>
    </div>
  );
}

function LeadInventoryContent() {
  const { data: chart, isLoading: chartLoading } = useOrgChart();
  const { data: inventory, isLoading: inventoryLoading, error } = useLeadInventory();
  const { data: threads } = useOrgThreads();

  if (chartLoading || inventoryLoading || !chart) {
    return (
      <div className="page-container w-full" style={{ padding: "32px 0" }}>
        <span style={{ color: "var(--color-muted)", fontSize: 13 }}>Loading…</span>
      </div>
    );
  }
  if (error || !inventory) {
    return (
      <div className="page-container w-full" role="alert" style={{ padding: "32px 0" }}>
        <span style={{ color: "var(--color-error)", fontSize: 13 }}>
          Couldn't load lead activity: {error instanceof Error ? error.message : "unknown error"}
        </span>
      </div>
    );
  }

  const leadIds = Object.keys(chart.leads);
  if (leadIds.length === 0) {
    return (
      <div className="page-container w-full" data-testid="lead-inventory-no-leads" style={{ padding: "32px 0" }}>
        <p style={{ fontSize: 13, color: "var(--color-muted)" }}>No AI leads are set up yet.</p>
      </div>
    );
  }

  return (
    <div className="page-container w-full" data-testid="lead-inventory-list" style={{ paddingBottom: "24px" }}>
      {leadIds.map((leadId) => {
        const chartLead = chart.leads[leadId];
        const entry = inventory[leadId];
        return (
          <section
            key={leadId}
            data-testid={`lead-inventory-section-${leadId}`}
            className="lead-inventory-section flex flex-col gap-3"
          >
            <header className="flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold text-[var(--color-text)]">{chartLead.name}</h2>
              <span className="text-[12px] text-[var(--color-muted)]">{chartLead.domain}</span>
            </header>
            {entry ? (
              <>
                <AuthorityPanel authority={entry.authority} />
                <BeatList beats={entry.beats} totalBeatsInRegister={entry.totalBeatsInRegister} />
              </>
            ) : (
              <p className="text-[13px] text-[var(--color-muted)]">No inventory data for this lead</p>
            )}
            <NeedsYou cards={threads?.[leadId]} />
          </section>
        );
      })}
    </div>
  );
}
