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
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

import type { Campaign, CampaignLifecycleStatus } from "../../lib/campaignsApi";
import { campaignLifecycleLabel } from "../../lib/campaignsApi";
import type { Project } from "../../types";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { CampaignStepLaunchButton } from "./CampaignStepLaunchButton";
import { CampaignAutonomousLaunchButton } from "./CampaignAutonomousLaunchButton";
import { useCampaignReadiness } from "../../hooks/useCampaignReadiness";
import { unitFor, type CampaignReadiness } from "../../lib/campaignReadinessApi";
import { hasVerdict, readinessBanner, uncheckedLaunchNotice } from "../../lib/campaignReadinessCopy";
import { CampaignDagSteps } from "./CampaignDagSteps";
import { CampaignStartButton } from "./CampaignStartButton";
import { CampaignDismissButton } from "./CampaignDismissButton";

/** Lifecycle status pill (FR-01.61) — draft / active / complete, so a draft is
 *  no longer visually identical to a running campaign. Legacy `null` resolves
 *  via the done/total heuristic (`campaignLifecycleLabel`). */
function LifecycleBadge({ slug, status }: { slug: string; status: CampaignLifecycleStatus }) {
  const tone: Record<CampaignLifecycleStatus, { bg: string; fg: string }> = {
    draft: { bg: "var(--color-muted-bg)", fg: "var(--color-muted)" },
    active: { bg: "var(--info-tint, #eef4ff)", fg: "var(--info, #2563eb)" },
    complete: { bg: "var(--color-success-bg, #e7f6ec)", fg: "var(--color-success-text, #16a34a)" },
  };
  return (
    <span
      data-testid={`campaign-status-${slug}`}
      data-status={status}
      className="shrink-0 rounded-[6px] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: tone[status].bg, color: tone[status].fg }}
    >
      {status}
    </span>
  );
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
  const lifecycle = campaignLifecycleLabel(campaign);
  const isDraft = lifecycle === "draft";

  // The scheduler's ready/blocked verdict — fetched only while the card is
  // expanded and the campaign is running (the server may `git fetch`).
  const readinessQ = useCampaignReadiness(project?.id, campaign.slug, {
    enabled: !collapsed && !isDraft && !campaign.derivedFromEvents,
  });
  // A failed refetch keeps the previous answer on screen (`data` survives an
  // error); say so instead of presenting it as current. No answer at all after an
  // error is an unavailable scheduler, not silence.
  const stale = readinessQ.isError && readinessQ.data !== undefined;
  const readiness: CampaignReadiness | undefined =
    readinessQ.data ??
    (readinessQ.isError ? { status: "failed", reason: "the readiness check couldn't be reached" } : undefined);
  const verdict = hasVerdict(readiness);
  // A campaign-level gate (unsupported strategy / finalized) makes EVERY unit
  // not-ready without any dependency being at fault — the per-unit buttons would
  // all be absent, so keep the card-level hand-launch (the server does not refuse
  // on such a gate either).
  const campaignGated = verdict && (!readiness.report.supported || readiness.report.finalized);
  // The step "Launch next" would start has no row in the scheduler's report (added
  // after the loop began): no per-unit button can exist for it either.
  const nextUnreported = verdict && !!campaign.nextPending && !unitFor(readiness.report, campaign.nextPending.id);
  const fallbackNotice = verdict
    ? (nextUnreported ? "Readiness not checked — the scheduler doesn't know this step yet, so this launch is not verified against the dependency graph."
      : campaignGated ? "Readiness not checked — the scheduler can't schedule this campaign, so this launch is not verified against the dependency graph." : null)
    : readinessQ.isLoading
      ? "Readiness not checked yet — the scheduler's answer is still loading, so this launch is not verified against the dependency graph."
      : uncheckedLaunchNotice(readiness, stale);
  const banner = readinessBanner(readiness, stale);

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
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
        <LifecycleBadge slug={campaign.slug} status={lifecycle} />
        {campaign.derivedFromEvents && (
          <span
            className="shrink-0 rounded-[6px] bg-[var(--color-muted-bg)] px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]"
            data-testid={`campaign-events-badge-${campaign.slug}`}
            title="Reconstructed from the tracked event log — this campaign's planning dir isn't present on this checkout, so only completed sub-iterates are shown."
          >
            events
          </span>
        )}
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
        {/* Board quittance — always visible (a finished ghost is usually
            collapsed); Erledigt → hide, Wiederherstellen → back. */}
        <CampaignDismissButton campaign={campaign} project={project} />
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

          {/* Progress bar — the board "segment-bar fills" moment (A20). The bar
              rests at its final width; the token transition eases only when the
              value CHANGES, and the reduced-motion floor neutralises it. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-muted-bg)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)]"
              style={{
                width: `${pct}%`,
                transitionProperty: "width",
                transitionDuration: "var(--motion-slow)",
                transitionTimingFunction: "var(--ease-standard)",
              }}
            />
          </div>

          {/* Dependency-graph steps (edges, scheduler verdict, per-unit guided launch) */}
          {banner && (
            <div
              data-testid={`campaign-readiness-banner-${campaign.slug}`}
              data-tone={banner.tone}
              className={"text-[11px] " + (banner.tone === "warn" ? "text-[var(--color-warning-text,#b45309)]" : "text-[var(--color-muted)]")}
            >
              {banner.text}
            </div>
          )}
          <CampaignDagSteps
            campaign={campaign}
            project={project}
            readiness={readiness}
            uncheckedNotice={uncheckedLaunchNotice(readiness, stale)}
          />

          {/* Launch affordances. Left: one-click launch of the next-pending
              sub-iterate (FR-01.36) — opens a terminal running
              `/shipwright-iterate "<specPath>"`; confirm dialog only when that
              step is risky. Right: autonomous run of every remaining step
              (FR-01.34). The old "Copy launch" clipboard button was replaced by
              the left action. */}
          {/* Draft → the board's Start-Campaign CTA (FR-01.61): flip draft →
              active through the EXISTING useStartCampaign hook, which enables
              the launch CTAs. Active/legacy → the launch affordances. */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {isDraft ? (
              <CampaignStartButton campaign={campaign} project={project} />
            ) : (
              <>
                {/* With a scheduler verdict each ready unit carries its own Launch
                    (CampaignDagSteps); the card-level "next" launch is the
                    no-verdict fallback only. */}
                {(!verdict || campaignGated || nextUnreported) && (
                  <CampaignStepLaunchButton campaign={campaign} project={project} notice={fallbackNotice} />
                )}
                <CampaignAutonomousLaunchButton campaign={campaign} project={project} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
