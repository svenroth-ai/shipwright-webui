/*
 * leadNowDisplay.tsx — pure display logic for `LeadCard`'s Now block and
 * header status badge (iterate spec FR-04.06 staleness display). Split out
 * of `LeadCard.tsx` to keep that file under the 300-line convention — same
 * rationale as `leadUsageDisplay.ts`.
 */
import type { CadenceUnresolvedReason, LeadNowState } from "../../lib/orgApi";
import { formatRelativeTime } from "../../lib/formatTime";

/**
 * Plain-language gloss for a cadence that couldn't be resolved (FR-04.06) —
 * "unknown" must never render as if it were a measured value.
 *
 * `org_chart_invalid` is overloaded server-side (`org-chart-lookup.ts`):
 * it covers both "the whole org-chart.json is corrupt" AND "this lead has
 * no (or a malformed) `triggers.cron` block". By the time this code path
 * runs — inside the composite roster's per-lead `lastRunCore` call — the
 * chart has ALREADY parsed successfully (a corrupt chart fails the whole
 * `/api/org/leads` read earlier, in `orgChartCore`, before any per-lead
 * builder runs). So here `org_chart_invalid` can only mean the narrower
 * case: this specific lead has no cron trigger configured. Wording it as
 * "org chart invalid" would tell an operator to go check a file that is
 * provably fine (review finding #10) — say what's actually true instead.
 */
export function cadenceUnresolvedReasonText(reason: CadenceUnresolvedReason | undefined): string {
  switch (reason) {
    case "invalid_cron":
      return "cadence schedule invalid";
    case "org_chart_missing":
      return "org chart missing";
    case "org_chart_symlink":
      return "org chart unreadable";
    case "org_chart_invalid":
      return "cadence not configured for this lead";
    case "lead_not_found":
      return "lead not found in org chart";
    default:
      return "cadence unresolved";
  }
}

export function NowLine({ now }: { now: LeadNowState }) {
  if (now.state === "running") {
    return (
      <div className="nowline" data-testid="lead-now-running">
        <span className="pulse" />
        Running
      </div>
    );
  }
  if (now.state === "resting") {
    if (now.lastRun.measured === false) {
      return (
        <div className="nowline idle" data-testid="lead-now-resting" data-staleness="unmeasured">
          <span className="pulse" />
          Resting — No runs recorded yet
        </div>
      );
    }
    const relative = `Last active ${formatRelativeTime(now.lastRun.lastRunAt)}`;
    if (now.lastRun.staleness === "stale") {
      // AC-1: reads as overdue, never as "Resting" — take the verdict from
      // the server's `staleness`, never recompute it client-side.
      return (
        <div className="nowline attn" data-testid="lead-now-resting" data-staleness="stale">
          <span className="pulse" />
          Overdue — {relative}
        </div>
      );
    }
    if (now.lastRun.staleness === "unknown") {
      // AC-2: a third state — never reads as fresh.
      return (
        <div className="nowline idle" data-testid="lead-now-resting" data-staleness="unknown">
          <span className="pulse" />
          {relative} — {cadenceUnresolvedReasonText(now.lastRun.cadenceUnresolvedReason)}
        </div>
      );
    }
    return (
      <div className="nowline idle" data-testid="lead-now-resting" data-staleness="fresh">
        <span className="pulse" />
        Resting — {relative}
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

/**
 * The header's status badge is derived from the already-honest `now`
 * state — never a fabricated "active"/"paused" value (there is no
 * `paused` field in the strict org-chart projection to read one from, by
 * design; see the iterate spec's Design Notes).
 *
 * Code-review fix (low): this is a BINARY split, not a three-way mirror of
 * `NowLine`'s fresh/stale/unknown — `staleness === "stale"` reads
 * "overdue" (matching `NowLine`'s "Overdue"), and both `"fresh"` AND
 * `"unknown"` collapse to the same "resting" label here. That is
 * deliberate, not an oversight: the badge is a compact glance affordance
 * in the card header, and `NowLine` right below it is where the
 * `cadenceUnresolvedReason` detail actually lives (AC-2) — badging
 * "unknown" as a distinct third label would duplicate that detail in a
 * space too small to word it honestly, without adding any information
 * the line below doesn't already carry. The badge and the line never
 * *disagree* (an overdue lead is never badged "resting"); they just carry
 * different levels of detail.
 */
export function statusBadge(now: LeadNowState): { label: string; className: string } {
  if (now.state === "running") return { label: "running", className: "badge acc" };
  if (now.state === "needs-attention") return { label: "needs attention", className: "badge warn" };
  if (now.state === "resting") {
    if (now.lastRun.measured === true && now.lastRun.staleness === "stale") {
      return { label: "overdue", className: "badge warn" };
    }
    return { label: "resting", className: "badge" };
  }
  return { label: "not measured", className: "badge" };
}
