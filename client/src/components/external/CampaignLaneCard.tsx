/*
 * CampaignLaneCard — one card per active campaign in the Task Board's
 * Campaigns lane (FR-01.33). Read + launch only:
 *   - collapsed by default: header (chevron + slug + done/total) only
 *   - expanded: a collapsible Description (intent) disclosure, done/total
 *     progress bar, ordered steps (✓ complete / ▶ next-pending / ○ other),
 *     and a "Copy launch (Bx)" button that copies `/shipwright-iterate
 *     "<specPath>"` for the next-pending step. The board has no embedded
 *     terminal, so launch is a copy-command affordance (NOT auto-inject);
 *     disabled when there is no launchable step (never a dead button).
 *
 * Collapse + description-open state persist per-campaign-slug in localStorage
 * (`useLocalStorage`) so the last layout survives reload / navigation — like
 * TaskDescriptionDisclosure, but per-slug (campaigns are few + ephemeral, so
 * key growth is bounded, unlike per-task). Default: card collapsed,
 * description closed. The lane host (TaskBoardPage) caps the lane height so
 * many expanded cards never push the kanban off-screen.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronRight, Circle, Play, ExternalLink } from "lucide-react";

import type { Campaign, CampaignStep } from "../../lib/campaignsApi";
import { copyText } from "../../lib/clipboard";
import { useLocalStorage } from "../../hooks/useLocalStorage";

type CopyState = "idle" | "copied" | "error";

function StepIcon({ kind }: { kind: "complete" | "next" | "other" }) {
  if (kind === "complete") {
    return <Check size={14} className="text-[var(--color-success-text,#16a34a)]" aria-label="complete" />;
  }
  if (kind === "next") {
    return <Play size={13} className="text-[var(--color-primary)]" aria-label="next pending" />;
  }
  return <Circle size={12} className="text-[var(--color-muted)]" aria-label="pending" />;
}

export function CampaignLaneCard({ campaign }: { campaign: Campaign }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
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
  const launchable = Boolean(next && next.specPath);
  const launchCommand = next?.specPath
    ? `/shipwright-iterate "${next.specPath}"`
    : null;

  const onCopy = async () => {
    if (!launchCommand) return;
    try {
      await copyText(launchCommand);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  };

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

          {/* Launch affordance — copy command for the next-pending step. */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onCopy}
              disabled={!launchable}
              data-testid={`campaign-launch-${campaign.slug}`}
              className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text,#111827)] transition-colors enabled:hover:bg-[var(--color-muted-bg)] disabled:cursor-not-allowed disabled:opacity-50"
              title={
                launchable
                  ? `Copy: /shipwright-iterate "${next!.specPath}"`
                  : "No launchable next step (all complete or spec file missing)"
              }
            >
              <Play size={12} />
              {next ? `Copy launch (${next.id})` : "Copy launch"}
            </button>
            {copyState === "copied" && (
              <span className="text-[11px] text-[var(--color-success-text,#16a34a)]">Copied</span>
            )}
            {copyState === "error" && (
              <span className="text-[11px] text-[var(--color-error,#dc2626)]">Copy failed</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
