/*
 * ReadinessGate — the not-ready BANNER (A08, FR-01.51). Renders only when the
 * environment is not ready (or the probe failed/loading): it names each missing
 * prerequisite, says WHY it matters in plain words, and gives the ONE command
 * that repairs all of it. When ready it renders nothing — the doors speak for
 * themselves. The doors' inert state is driven by `ready` in DoorPicker, so this
 * banner is the explanation, never the enforcement.
 *
 * There is deliberately NO demo toggle: the prototype's `__fcDemo` is a demo
 * affordance and MUST NOT ship (no-fcdemo.test.ts asserts its absence).
 */

import { AlertTriangle } from "lucide-react";

import type { ReadinessState } from "./useReadiness";

export function ReadinessGate({ state }: { state: ReadinessState }) {
  if (state.loading) {
    return (
      <div
        className="iw-card pad"
        data-testid="readiness-loading"
        style={{ marginTop: 18, maxWidth: 560, borderColor: "var(--warn-line)", background: "var(--warn-tint)" }}
      >
        <div style={{ fontSize: 13, color: "var(--body)" }}>
          Checking your setup before opening the doors…
        </div>
      </div>
    );
  }

  const report = state.report;
  // Error OR not-ready → show the closed-doors banner. On a probe error we
  // cannot prove readiness, so we treat it as not-ready (never assume success).
  const bad = report ? report.checks.filter((c) => !c.ok) : [];
  const repair = report?.repairCommand ?? "npx @svenroth-ai/shipwright@latest";

  return (
    <div
      className="iw-card pad"
      data-testid="readiness-not-ready"
      style={{ marginTop: 18, maxWidth: 560, borderColor: "var(--warn-line)", background: "var(--warn-tint)" }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>
        Not ready yet — the doors are closed until this is fixed.
      </div>
      {state.error && !report ? (
        <div style={{ fontSize: 13, color: "var(--body)", marginBottom: 8 }}>
          Couldn’t reach the Command Center’s setup check, so nothing can be confirmed as ready.
        </div>
      ) : null}
      {bad.map((c) => (
        <div
          key={c.key}
          data-testid={`readiness-missing-${c.key}`}
          style={{ display: "flex", gap: 9, alignItems: "baseline", padding: "3px 0" }}
        >
          <AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            <b>{c.label}</b> — {c.detail}
            {c.why ? <span style={{ color: "var(--muted)" }}> · {c.why}</span> : null}
          </span>
        </div>
      ))}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 5 }}>
          One command repairs all of it:
        </div>
        <div
          className="mono"
          data-testid="readiness-repair-command"
          style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink)" }}
        >
          {repair}
        </div>
      </div>
    </div>
  );
}
