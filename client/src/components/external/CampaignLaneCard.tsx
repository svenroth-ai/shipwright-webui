/*
 * CampaignLaneCard — one card per active campaign in the Task Board's
 * Campaigns lane (FR-01.33). Read + launch only:
 *   - collapsed by default: header (chevron + slug + done/total) only
 *   - expanded: a collapsible Description (intent) disclosure, done/total
 *     progress bar, ordered steps (✓ complete / ▶ next-pending / ○ other),
 *     and two launch actions: `<CampaignStepLaunchButton>` ("Launch (Cx)",
 *     one-click launch of the next-pending sub-iterate, FR-01.36 — replaced
 *     the old "Copy launch" clipboard button) and `<CampaignAutonomousLaunchButton>`
 *     ("Launch autonomous", FR-01.34). Both open a TaskDetail terminal that
 *     auto-runs the command; disabled when there is no launchable step / project
 *     (never a dead button).
 *
 * Collapse + description-open state persist per-campaign-slug in localStorage
 * (`useLocalStorage`) so the last layout survives reload / navigation — like
 * TaskDescriptionDisclosure, but per-slug (campaigns are few + ephemeral, so
 * key growth is bounded, unlike per-task). Default: card collapsed,
 * description closed. The lane host (TaskBoardPage) caps the lane height so
 * many expanded cards never push the kanban off-screen.
 */

import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronRight, Circle, Play, ExternalLink } from "lucide-react";

import type { Campaign, CampaignStep } from "../../lib/campaignsApi";
import type { Project } from "../../types";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { CampaignStepLaunchButton } from "./CampaignStepLaunchButton";
import { CampaignAutonomousLaunchButton } from "./CampaignAutonomousLaunchButton";

function StepIcon({ kind }: { kind: "complete" | "next" | "other" }) {
  if (kind === "complete") {
    return <Check size={14} className="text-[var(--color-success-text,#16a34a)]" aria-label="complete" />;
  }
  if (kind === "next") {
    return <Play size={13} className="text-[var(--color-primary)]" aria-label="next pending" />;
  }
  return <Circle size={12} className="text-[var(--color-muted)]" aria-label="pending" />;
}

export function CampaignLaneCard({
  campaign,
  project,
}: {
  campaign: Campaign;
  /** Resolved active project — required for the autonomous-launch action
   *  (create-task cwd + projectId). Null when "All projects" / unresolved. */
  project?: Project | null;
}) {
  // Per-slug persisted UI state. Default: collapsed card, closed description.
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    `webui:campaign-card-collapsed:${campaign.slug}`,
    true,
  );
  const [descOpen, setDescOpen] = useLocalStorage<boolean>(
    `webui:campaign-desc-open:${campaign.slug}`,
    false,
  );

  const pct = campaign.total > 0 ? Math.round((campaign.done / campaign.total) * 100) : 0;
  const next = campaign.nextPending;

  const stepKind = (s: CampaignStep): "complete" | "next" | "other" => {
    if (s.status === "complete") return "complete";
    if (next && s.id === next.id) return "next";
    return "other";
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card,none)]"
      data-testid={`campaign-lane-card-${campaign.slug}`}
    >
      {/* Header — the collapse toggle (chevron + slug) + done/total. When
          expanded, also the branch-strategy badge + optional triage link. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          data-testid={`campaign-toggle-${campaign.slug}`}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          {collapsed ? (
            <ChevronRight size={14} className="shrink-0 text-[var(--color-muted)]" aria-hidden="true" />
          ) : (
            <ChevronDown size={14} className="shrink-0 text-[var(--color-muted)]" aria-hidden="true" />
          )}
          <span className="truncate font-mono text-[13px] font-semibold text-[var(--color-text,#111827)]">
            {campaign.slug}
          </span>
        </button>
        {!collapsed && campaign.branchStrategy && (
          <span className="rounded-[6px] bg-[var(--color-muted-bg)] px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            {campaign.branchStrategy}
          </span>
        )}
        <span
          className="ml-auto shrink-0 text-[11px] font-semibold text-[var(--color-muted)]"
          data-testid={`campaign-progress-${campaign.slug}`}
        >
          {campaign.done}/{campaign.total}
        </span>
        {!collapsed && campaign.expandsTriage && (
          <Link
            to="/triage"
            className="inline-flex shrink-0 items-center gap-1 text-[11px] text-[var(--color-primary)] hover:underline"
            title={`Promoted from triage ${campaign.expandsTriage}`}
            data-testid={`campaign-triage-link-${campaign.slug}`}
          >
            <ExternalLink size={11} />
            {campaign.expandsTriage}
          </Link>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Description (intent) — collapsible, closed by default, like the
              TaskDetail description disclosure. */}
          {campaign.intent && (
            <div data-testid={`campaign-description-${campaign.slug}`}>
              <button
                type="button"
                onClick={() => setDescOpen(!descOpen)}
                aria-expanded={descOpen}
                data-testid={`campaign-description-toggle-${campaign.slug}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)] transition hover:text-[var(--color-text,#1a1a1a)]"
              >
                {descOpen ? (
                  <ChevronDown size={12} aria-hidden="true" />
                ) : (
                  <ChevronRight size={12} aria-hidden="true" />
                )}
                <span>Description</span>
              </button>
              {descOpen && (
                <div
                  data-testid={`campaign-description-body-${campaign.slug}`}
                  className="mt-1 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-button,8px)] border border-[var(--color-border)] bg-[var(--color-bg,#f5f0eb)] px-2.5 py-1.5 text-[12px] leading-[1.5] text-[var(--color-text,#111827)]"
                >
                  {campaign.intent}
                </div>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-muted-bg)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Ordered steps */}
          <ol className="flex flex-col gap-1">
            {campaign.steps.map((s) => {
              const kind = stepKind(s);
              const showStatusText =
                s.status === "failed" || s.status === "escalated" || s.status === "in_progress";
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-2 text-[12px]"
                  data-testid={`campaign-step-${s.id}`}
                  data-step-status={s.status}
                  data-next={kind === "next" || undefined}
                >
                  <StepIcon kind={kind} />
                  <span className="font-mono text-[11px] text-[var(--color-muted)]">{s.id}</span>
                  <span className={kind === "complete" ? "text-[var(--color-muted)] line-through" : "text-[var(--color-text,#111827)]"}>
                    {s.title}
                  </span>
                  {showStatusText && (
                    <span
                      className={
                        s.status === "in_progress"
                          ? "text-[10px] text-[var(--color-warning-text,#b45309)]"
                          : "text-[10px] text-[var(--color-error,#dc2626)]"
                      }
                    >
                      {s.status}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {/* Launch affordances. Left: one-click launch of the next-pending
              sub-iterate (FR-01.36) — opens a terminal running
              `/shipwright-iterate "<specPath>"`; confirm dialog only when that
              step is risky. Right: autonomous run of every remaining step
              (FR-01.34). The old "Copy launch" clipboard button was replaced by
              the left action. */}
          <div className="flex items-center gap-2 pt-1">
            <CampaignStepLaunchButton campaign={campaign} project={project} />
            <CampaignAutonomousLaunchButton campaign={campaign} project={project} />
          </div>
        </>
      )}
    </div>
  );
}
