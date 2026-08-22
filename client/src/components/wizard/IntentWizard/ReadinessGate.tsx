/*
 * ReadinessGate — the not-ready BANNER (A08, FR-01.51). Renders only when the
 * environment is not ready (or the probe failed/loading): it names each missing
 * prerequisite, says WHY it matters in plain words, and gives the ONE command
 * that repairs all of it. When ready it renders nothing — the doors speak for
 * themselves. The doors' inert state is driven by `ready` in DoorGrid (the shared
 * doors+gate primitive), so this banner is the explanation, never the enforcement.
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
  // npx installs the Shipwright PLUGINS + CACHE — never the toolchain. So show
  // the repair command when a check it actually fixes is failing (plugins/cache);
  // a missing tool (claude/uv/python/git) is repaired by its own per-check hint,
  // not by re-running npx (the defect Sven reported: "updating shipwright does not
  // install a missing Python"). On a probe ERROR (no report at all) we can't tell
  // WHAT is wrong, so keep npx as the generic recovery — it also restarts the
  // Command Center, which is often the actual fix for an unreachable probe.
  const npxFixes = !report || bad.some((c) => c.key === "plugins" || c.key === "cache");
  // A just-installed tool stays invisible until a new shell — and this server —
  // pick up the changed PATH. Say so once, when a tool with an install hint fails.
  const anyToolHint = bad.some((c) => c.hint);

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
        <div key={c.key} data-testid={`readiness-missing-${c.key}`} style={{ padding: "3px 0" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
            <AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "var(--ink)" }}>
              <b>{c.label}</b> — {c.detail}
              {c.why ? <span style={{ color: "var(--muted)" }}> · {c.why}</span> : null}
            </span>
          </div>
          {c.hint ? (
            <div
              className="mono"
              data-testid={`readiness-hint-${c.key}`}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "var(--body)",
                margin: "3px 0 0 23px",
              }}
            >
              {c.hint}
            </div>
          ) : null}
        </div>
      ))}
      {anyToolHint ? (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          Just installed one of these? Open a new terminal so it’s on your PATH, then restart the
          Command Center.
        </div>
      ) : null}
      {npxFixes ? (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 5 }}>
            Install the Shipwright plugins and sync the cache:
          </div>
          <div
            className="mono"
            data-testid="readiness-repair-command"
            style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink)" }}
          >
            {repair}
          </div>
        </div>
      ) : null}
    </div>
  );
}
