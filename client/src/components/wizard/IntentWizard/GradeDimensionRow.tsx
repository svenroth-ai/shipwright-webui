/*
 * GradeDimensionRow — ONE dimension of the Control-Grade card (A08). This is the
 * AC2-critical renderer:
 *
 *   - `status` drives the visual, NEVER the score. An "n/a" draws a DASHED track
 *     and the literal text "n/a" — no width is computed, no number shown. There
 *     is no branch that turns a null score into a bar or a number.
 *   - per-dimension `provenance` ("How this was measured") is a disclosure row —
 *     the grade shows its work.
 *   - `would_light_up` is per-dimension (NOT the whole would-light list) — a
 *     dimension that already scores does not badge, so the signal stays sharp.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import type { DimensionView } from "./types";

export function GradeDimensionRow({ dim }: { dim: DimensionView }) {
  const [open, setOpen] = useState(false);
  const na = dim.status === "n/a";
  const valueColor = na ? "var(--warn)" : dim.status === "ok" ? "var(--ok-solid)" : "var(--body)";

  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "13px 0" }} data-testid={`grade-dim-${dim.key}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 168, flexShrink: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          {dim.label}
        </span>
        <span className="mono" style={{ width: 42, flexShrink: 0, fontSize: 12, color: "var(--muted)" }}>
          {dim.weight}%
        </span>

        {/* status drives the bar — n/a is a dashed track, never a 0-width fill. */}
        {na ? (
          <span className="bar-na" style={{ flex: 1, maxWidth: 150 }} data-testid={`grade-bar-na-${dim.key}`} />
        ) : (
          <span className="bar" style={{ flex: 1, maxWidth: 150 }}>
            <i style={{ width: `${dim.score}%` }} />
          </span>
        )}

        <span
          className="mono"
          data-testid={`grade-value-${dim.key}`}
          style={{
            width: 64,
            flexShrink: 0,
            textAlign: "right",
            fontSize: 12,
            color: valueColor,
            fontWeight: na ? 600 : 400,
          }}
        >
          {na ? "n/a" : `${dim.score}/100`}
        </span>

        {dim.would_light_up ? (
          <span className="iw-badge" data-testid={`grade-lightup-${dim.key}`} style={{ flexShrink: 0 }}>
            would light up
          </span>
        ) : (
          <span style={{ width: 88 }} />
        )}

        <button
          type="button"
          className="iw-more"
          style={{ marginLeft: "auto" }}
          aria-label={`How ${dim.label} was measured`}
          data-testid={`grade-why-${dim.key}`}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--body)", lineHeight: 1.55, margin: "6px 0 0 168px" }}>
        {dim.detail}
      </div>

      {open ? (
        <div
          data-testid={`grade-provenance-${dim.key}`}
          style={{
            margin: "8px 0 0 168px",
            padding: "9px 12px",
            background: "var(--inset)",
            borderRadius: 8,
            border: "1px solid var(--line)",
          }}
        >
          <div className="eyebrow" style={{ marginBottom: 3 }}>
            How this was measured
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--body)" }}>
            {dim.provenance.source}
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            mode: {dim.provenance.mode} · freshness: {dim.provenance.freshness}
            {dim.provenance.sampled ? " · sampled" : ""}
            {dim.provenance.truncated ? " · truncated" : ""}
            {dim.provenance.disabled_enrichments.length > 0
              ? ` · would light: ${dim.provenance.disabled_enrichments.join(", ")}`
              : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}
