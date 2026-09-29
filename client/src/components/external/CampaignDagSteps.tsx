/*
 * CampaignDagSteps — the campaign card's ordered steps, now as a dependency-graph
 * view: for every sub-iterate, which units it waits on (edges), whether the
 * scheduler says it is ready / blocked (and by what) / already in flight, and —
 * for a READY unit — a guided one-click Launch.
 *
 * It RENDERS the monorepo scheduler's verdict (`GET …/readiness`, contract
 * `loop-readiness-1.0`); it never derives readiness from the `dependsOn` edges,
 * because "ready" also depends on git ancestry against the batch base and on the
 * branch strategy, neither of which a display layer can see. With no verdict
 * (no autonomous run set up, or the scheduler unavailable) it degrades to the
 * previous behaviour: edges are shown, and the card-level "Launch next" button
 * stays the launch control (`showUnitLaunch` is false then).
 *
 * The autonomous / guided split: "Launch" here is GUIDED (a hand-run with you
 * present); the autonomous run stays a per-campaign action on the card.
 */

import { Check, Circle, Loader2, Play } from "lucide-react";

import type { Campaign, CampaignStep } from "../../lib/campaignsApi";
import { blockerSentence } from "../../lib/campaignReadinessCopy";
import { unitFor, type CampaignReadiness, type UnitReadiness } from "../../lib/campaignReadinessApi";
import type { Project } from "../../types";
import { CampaignStepLaunchButton } from "./CampaignStepLaunchButton";

/** Loop-state statuses where an orchestrator/runner currently owns the unit. */
const IN_FLIGHT: ReadonlySet<string> = new Set(["in_progress", "claimed", "running", "built", "reviewed", "merging"]);

type Kind = "complete" | "in_progress" | "ready" | "waiting" | "next" | "other";

function StepIcon({ kind }: { kind: Kind }) {
  if (kind === "complete") {
    return <Check size={14} className="text-[var(--color-success-text,#16a34a)]" aria-label="complete" />;
  }
  if (kind === "in_progress") {
    return <Loader2 size={13} className="animate-spin text-[var(--color-warning-text,#b45309)]" aria-label="in progress" />;
  }
  if (kind === "ready" || kind === "next") {
    return <Play size={13} className="text-[var(--color-primary)]" aria-label={kind === "ready" ? "ready" : "next pending"} />;
  }
  return <Circle size={12} className="text-[var(--color-muted)]" aria-label={kind === "waiting" ? "waiting" : "pending"} />;
}

function kindOf(s: CampaignStep, unit: UnitReadiness | undefined, nextId: string | undefined): Kind {
  if (s.status === "complete" || unit?.state === "merged") return "complete";
  // A live (loop_state-derived) in_progress step beats the markers: actively running.
  if (s.status === "in_progress") return "in_progress";
  if (unit) {
    if (unit.ready) return "ready";
    if (unit.state === "pending" && unit.blocked_by.length > 0) return "waiting";
    if (IN_FLIGHT.has(unit.state)) return "in_progress";
  }
  if (!unit && nextId && s.id === nextId) return "next";
  return "other";
}

export function CampaignDagSteps({
  campaign,
  project,
  readiness,
  uncheckedNotice,
}: {
  campaign: Campaign;
  project?: Project | null;
  readiness: CampaignReadiness | undefined;
  /** Passed to each per-unit launch dialog when the scheduler verdict is missing. */
  uncheckedNotice: string | null;
}) {
  const report = readiness?.status === "report" ? readiness.report : null;
  const nextId = campaign.nextPending?.id;
  // Campaign-level gates (finalized / unsupported strategy) have no blocking unit:
  // they're stated once in the banner, not repeated on every row.
  const rowBlockers = (u: UnitReadiness) => u.blocked_by.filter((b) => b.id !== null);

  return (
    <ol className="flex flex-col gap-1" data-testid={`campaign-dag-${campaign.slug}`}>
      {campaign.steps.map((s) => {
        const unit = report ? unitFor(report, s.id) : undefined;
        const kind = kindOf(s, unit, nextId);
        const deps = s.dependsOn ?? [];
        const blockers = unit && kind === "waiting" ? rowBlockers(unit) : [];
        const showStatusText = s.status === "failed" || s.status === "escalated" || s.status === "in_progress";
        // The scheduler's own state once a unit has left `pending` (running, built,
        // failed, held, …); a merged unit is already shown as complete.
        const flightState = unit && unit.state !== "pending" && unit.state !== "merged" ? unit.state : null;
        return (
          <li
            key={s.id}
            className="flex min-w-0 flex-col gap-0.5 text-[12px]"
            data-testid={`campaign-step-${s.id}`}
            data-step-status={s.status}
            data-next={kind === "next" || undefined}
            data-dag-kind={kind}
            data-unit-state={unit?.state}
          >
            <div className="flex min-w-0 items-center gap-2">
              <StepIcon kind={kind} />
              <span className="font-mono text-[11px] text-[var(--color-muted)]">{s.id}</span>
              <span className={"min-w-0 truncate " + (kind === "complete" ? "text-[var(--color-muted)] line-through" : "text-[var(--color-text,#111827)]")}>
                {s.title}
              </span>
              {showStatusText && (
                <span className={s.status === "in_progress" ? "text-[10px] text-[var(--color-warning-text,#b45309)]" : "text-[10px] text-[var(--color-error,#dc2626)]"}>
                  {s.status}
                </span>
              )}
              {flightState && (
                <span
                  data-testid={`campaign-unit-state-${s.id}`}
                  className={"text-[10px] " + (IN_FLIGHT.has(unit!.state) ? "text-[var(--color-warning-text,#b45309)]" : "text-[var(--color-error,#dc2626)]")}
                >
                  {flightState}
                </span>
              )}
              {kind === "ready" && (
                <span
                  data-testid={`campaign-unit-ready-${s.id}`}
                  className="shrink-0 rounded-[6px] bg-[var(--color-success-bg,#e7f6ec)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-[var(--color-success-text,#16a34a)]"
                >
                  ready
                </span>
              )}
              {(kind === "ready" || (kind === "next" && report !== null)) && (
                <span className="ml-auto">
                  <CampaignStepLaunchButton campaign={campaign} project={project} stepId={s.id} compact notice={uncheckedNotice} />
                </span>
              )}
            </div>
            {(deps.length > 0 || blockers.length > 0) && (
              <div className="ml-[22px] flex min-w-0 flex-col gap-0.5 text-[11px] text-[var(--color-muted)]">
                {deps.length > 0 && (
                  <span data-testid={`campaign-unit-deps-${s.id}`}>
                    after <span className="font-mono">{deps.join(", ")}</span>
                  </span>
                )}
                {blockers.map((b, i) => (
                  <span key={`${b.id}-${b.reason}-${i}`} data-testid={`campaign-unit-blocker-${s.id}`} className="text-[var(--color-warning-text,#b45309)]">
                    {blockerSentence(b)}
                  </span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
