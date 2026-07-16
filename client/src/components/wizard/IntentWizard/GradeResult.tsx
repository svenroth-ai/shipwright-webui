/*
 * GradeResult — step 3 for the grade door (A08). A FAITHFUL rendering of the
 * shipwright-grade ReportModel (field-for-field, never a second hand-rolled
 * shape). Grade WRITES NOTHING, so it ends in a report, not a task.
 *
 * Order is load-bearing:
 *   1. shape-guard the payload; a bad shape → honest "report shape not
 *      recognised", never a half-empty card (cross-repo contract).
 *   2. honest_ceiling_note ABOVE the dimensions — reframes a low grade as a
 *      finding about the RECORD, not a verdict on the code.
 *   3. the four dimensions (GradeDimensionRow owns the n/a invariant).
 *   4. controls_shipwright_would_light — what adopting lights up.
 *   5. network_enrichments — "exactly what left the machine", the receipt for
 *      "read-only, no account". Never omitted; sized to what happened (a local
 *      folder sends nothing, so it is one quiet line, not an invented card).
 */

import { Check, Eye, FileText, Wrench, AlertTriangle } from "lucide-react";

import { GRADE_REPORT } from "./stubData";
import { parseReportModel } from "./reportShape";
import { GradeRing } from "./GradeRing";
import { GradeDimensionRow } from "./GradeDimensionRow";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import type { WizardAction } from "./wizardState";

const CARD_MAX = 820;

export function GradeResult({
  path,
  dispatch,
}: {
  path: string | null;
  dispatch: (a: WizardAction) => void;
}) {
  const parsed = parseReportModel(GRADE_REPORT);

  if (!parsed.ok) {
    return (
      <div className="wz-left wz-block" data-testid="wizard-grade-unrecognised">
        <StepDots total={3} current={2} />
        <h2 className="wz-q wz-q-sub">
          <AlertTriangle size={22} style={{ color: "var(--warn)", verticalAlign: "-3px" }} /> Report shape not recognised
        </h2>
        <div className="wz-hint" style={{ maxWidth: CARD_MAX }}>
          The grade report came back in a shape this build doesn’t know how to render safely, so nothing is shown rather
          than a half-empty card. ({parsed.reason})
        </div>
        <div className="wz-foot">
          <WzOutline data-testid="wizard-back" onClick={() => dispatch({ t: "back" })}>
            Back
          </WzOutline>
        </div>
      </div>
    );
  }

  const M = parsed.model;
  const target = path || M.target_display;
  // The network receipt is driven by the MODEL's own `network_enabled`, not an
  // inference from the entered path — so the receipt cannot disagree with the
  // report it claims to render (a local grade sends nothing; a remote clone does).
  const remote = M.network_enabled;

  return (
    <div className="wz-left wz-block" data-testid="wizard-grade-result" style={{ overflow: "auto" }}>
      <StepDots total={3} current={2} />

      <div
        data-testid="wizard-grade-stub-note"
        className="iw-card pad"
        style={{ maxWidth: CARD_MAX, marginBottom: 12, borderColor: "var(--warn-line)", background: "var(--warn-tint)" }}
      >
        <span style={{ fontSize: 12.5, color: "var(--ink)" }}>
          Sample grade — not a live read of your repo yet. A09 runs the real /shipwright-grade.
        </span>
      </div>

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

      {/* the four dimensions */}
      <div className="iw-card pad" data-testid="wizard-grade-dimensions" style={{ maxWidth: CARD_MAX, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span className="eyebrow">The four dimensions</span>
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
