/*
 * GradeResult — step 3 for the grade door. A FAITHFUL rendering of the REAL
 * shipwright-grade ReportModel (A08 built the card against a stub; A09b wires
 * the live server route, FR-01.53). Grade WRITES NOTHING, so it ends in a
 * report, not a task.
 *
 * The card renders ONLY what /api/wizard/grade returned (AC5): the report is
 * fetched + shape-guarded by useGradeReport, and every non-ready outcome is an
 * HONEST state — grading, "couldn't grade that repo", "grade engine
 * unavailable" (with the repair command), or "report shape not recognised".
 * No client-side default, estimate or fallback ever fills a gap the plugin left
 * empty; an underivable dimension stays n/a.
 *
 * Order is load-bearing on the ready card:
 *   1. honest_ceiling_note ABOVE the dimensions — reframes a low grade as a
 *      finding about the RECORD, not a verdict on the code.
 *   2. the dimensions (GradeDimensionRow owns the n/a invariant + the 0..1 scale).
 *   3. controls_shipwright_would_light — what adopting lights up.
 *   4. network_enrichments — "exactly what left the machine", the receipt for
 *      "read-only, no account".
 */

import { Check, Eye, FileText, Wrench, AlertTriangle, Loader2, PackageX } from "lucide-react";

import { GradeRing } from "./GradeRing";
import { GradeDimensionRow } from "./GradeDimensionRow";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import type { GradeReport } from "./useGradeReport";
import type { WizardAction } from "./wizardState";

const CARD_MAX = 820;

/** A framed message state (grading / failed / unavailable / unrecognised). */
function GradeMessage({
  testid,
  icon,
  title,
  children,
  dispatch,
}: {
  testid: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  dispatch: (a: WizardAction) => void;
}) {
  return (
    <div className="wz-left wz-block" data-testid={testid}>
      <StepDots total={3} current={2} />
      <h2 className="wz-q wz-q-sub">
        {icon} {title}
      </h2>
      <div className="wz-hint" style={{ maxWidth: CARD_MAX }}>
        {children}
      </div>
      <div className="wz-foot">
        <WzOutline data-testid="wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
      </div>
    </div>
  );
}

export function GradeResult({
  path,
  report,
  dispatch,
}: {
  path: string | null;
  report: GradeReport;
  dispatch: (a: WizardAction) => void;
}) {
  // Still reading the repo (the fetch is in flight) — a real loading state.
  if (report.state === "idle" || report.state === "grading") {
    return (
      <GradeMessage
        testid="wizard-grade-grading"
        icon={<Loader2 className="iw-spin" size={20} style={{ verticalAlign: "-3px", color: "var(--accent)" }} />}
        title="Grading…"
        dispatch={dispatch}
      >
        Reading the whole history — that is what makes the grade honest rather than a guess. Nothing is written, nothing
        is uploaded.
      </GradeMessage>
    );
  }

  // The engine isn't installed — reuse the readiness repair command (honest).
  if (report.state === "engine-unavailable") {
    return (
      <GradeMessage
        testid="wizard-grade-engine-unavailable"
        icon={<PackageX size={22} style={{ color: "var(--warn)", verticalAlign: "-3px" }} />}
        title="Grade engine unavailable"
        dispatch={dispatch}
      >
        {report.reason ?? "The grade engine isn't installed on this machine."}
        {report.repairCommand ? (
          <>
            {" "}
            Run <span className="mono">{report.repairCommand}</span> to install it, then try again.
          </>
        ) : null}
      </GradeMessage>
    );
  }

  // grade.py couldn't grade this target (a bad path/URL, a non-zero exit).
  if (report.state === "grade-failed") {
    return (
      <GradeMessage
        testid="wizard-grade-failed"
        icon={<AlertTriangle size={22} style={{ color: "var(--warn)", verticalAlign: "-3px" }} />}
        title="Couldn't grade that repo"
        dispatch={dispatch}
      >
        {report.reason ?? "The grade tool couldn't read that repository."}
      </GradeMessage>
    );
  }

  // The payload came back in a shape this build can't render safely.
  if (report.state === "shape-unrecognised" || report.model === null) {
    return (
      <GradeMessage
        testid="wizard-grade-unrecognised"
        icon={<AlertTriangle size={22} style={{ color: "var(--warn)", verticalAlign: "-3px" }} />}
        title="Report shape not recognised"
        dispatch={dispatch}
      >
        The grade report came back in a shape this build doesn’t know how to render safely, so nothing is shown rather
        than a half-empty card.{report.reason ? ` (${report.reason})` : ""}
      </GradeMessage>
    );
  }

  const M = report.model;
  const target = path || M.target_display;
  // The network receipt is driven by the MODEL's own `network_enabled`, not an
  // inference from the entered path — so the receipt cannot disagree with the
  // report it claims to render (a local grade sends nothing; a remote clone does).
  const remote = M.network_enabled;

  return (
    <div className="wz-left wz-block" data-testid="wizard-grade-result" style={{ overflow: "auto" }}>
      <StepDots total={3} current={2} />

      {/* head */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <GradeRing letter={M.grade} score={M.score} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 className="wz-q wz-q-sub" style={{ margin: 0 }}>
              Control grade: {M.grade}
              {typeof M.score === "number" ? ` — ${M.score}/100` : ""}
            </h2>
            <span
              data-testid="wizard-grade-band"
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: "var(--r-badge)",
                background: "var(--inset)",
                color: "var(--body)",
              }}
            >
              {M.band_label}
              {M.gradeable ? "" : " · not gradeable"}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--body)", marginTop: 5, lineHeight: 1.5 }}>{M.verdict}</div>
          <div className="mono" style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            {target} · {M.mode} · {M.measurable_count} measurable,{" "}
            <b style={{ color: "var(--warn)" }}>{M.na_count} not derivable</b>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{M.routing_reason}</div>
        </div>
      </div>

      {/* honest ceiling — ABOVE the dimensions */}
      <div
        className="iw-card pad"
        data-testid="wizard-grade-ceiling"
        style={{ maxWidth: CARD_MAX, marginTop: 12, background: "var(--warn-tint)", borderColor: "var(--warn-line)" }}
      >
        <div className="eyebrow" style={{ marginBottom: 5 }}>
          Read this before you read the grade
        </div>
        <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.6 }}>{M.honest_ceiling_note}</div>
      </div>

      {/* the dimensions */}
      <div className="iw-card pad" data-testid="wizard-grade-dimensions" style={{ maxWidth: CARD_MAX, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span className="eyebrow">The dimensions</span>
          <span className="caption" style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            {M.static_test_inventory}
          </span>
        </div>
        {M.dimensions.map((d) => (
          <GradeDimensionRow key={d.key} dim={d} />
        ))}
      </div>

      {/* the model's own top reasons for the grade */}
      {M.reasons.length > 0 ? (
        <div className="iw-card pad" data-testid="wizard-grade-reasons" style={{ maxWidth: CARD_MAX, marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 7 }}>
            Why this grade
          </div>
          {M.reasons.map((r) => (
            <div key={r} style={{ fontSize: 13, color: "var(--body)", lineHeight: 1.5, padding: "2px 0" }}>
              — {r}
            </div>
          ))}
        </div>
      ) : null}

      {/* what adopting would light up */}
      {M.controls_shipwright_would_light.length > 0 ? (
        <div
          className="iw-card pad"
          data-testid="wizard-grade-lightup"
          style={{ maxWidth: CARD_MAX, marginTop: 12, background: "var(--accent-tint)", borderColor: "var(--accent-line)" }}
        >
          <div className="eyebrow" style={{ marginBottom: 7, color: "var(--accent-deep)" }}>
            What adopting Shipwright would light up
          </div>
          {M.controls_shipwright_would_light.map((c) => (
            <div key={c} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", fontSize: 13, color: "var(--ink)" }}>
              <Check size={13} style={{ color: "var(--accent-deep)", flexShrink: 0 }} />
              {c}
            </div>
          ))}
        </div>
      ) : null}

      {/* network receipt — sized to what actually happened */}
      {remote ? (
        <div className="iw-card pad" data-testid="wizard-grade-network" style={{ maxWidth: CARD_MAX, marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 5 }}>
            <Eye size={13} style={{ verticalAlign: "-2px" }} /> What left your machine
          </div>
          <div style={{ fontSize: 12.5, color: "var(--body)", lineHeight: 1.55, marginBottom: 7 }}>{M.network_note}</div>
          {M.network_enrichments.map((e) => (
            <div key={e} className="mono" style={{ fontSize: 11.5, color: "var(--muted)", padding: "2px 0" }}>
              → {e}
            </div>
          ))}
          <div className="caption" style={{ marginTop: 7, fontSize: 12, color: "var(--muted)" }}>
            Verified from: {M.verified_from}
          </div>
        </div>
      ) : (
        <div
          data-testid="wizard-grade-network-local"
          style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: CARD_MAX, marginTop: 14, fontSize: 12.5 }}
        >
          <Check size={14} style={{ color: "var(--ok-solid)" }} />
          <span style={{ color: "var(--body)" }}>
            Nothing left your machine — it was read where it lies. Nothing was written.
          </span>
        </div>
      )}

      <div className="wz-foot">
        <WzOutline data-testid="wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
        <WzOutline data-testid="wizard-grade-save" disabled style={{ opacity: 0.5, pointerEvents: "none" }}>
          <FileText size={15} /> Save the report
        </WzOutline>
        <WzPrimary data-testid="wizard-grade-to-adopt" onClick={() => dispatch({ t: "toAdopt" })}>
          <Wrench size={15} /> Adopt this repo →
        </WzPrimary>
      </div>
    </div>
  );
}
