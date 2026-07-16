/*
 * AdoptResult — step 3 for the adopt door (A08). Two columns: what's already
 * here vs what adopting would write. Adopting WRITES files, so it is real work
 * you watch — it ends in a MISSION (a task), not a dialog. A08 is UI-only, so the
 * CTA is a not-yet-wired preview (A09 starts the real task); the stub findings are
 * tagged as a sample, never a live read of the repo (AC3).
 */

import { Play } from "lucide-react";

import { ADOPT_SNAPSHOT } from "./stubData";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import type { WizardAction } from "./wizardState";
import type { AdoptSnapshot } from "./types";

function Table({ rows, accent }: { rows: AdoptSnapshot["found"]; accent?: boolean }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", gap: 12, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
          <span
            style={{
              width: 150,
              flexShrink: 0,
              fontSize: 12.5,
              fontWeight: 600,
              color: accent ? "var(--accent-deep)" : "var(--ink)",
            }}
          >
            {r.label}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--body)", lineHeight: 1.5 }}>{r.value}</span>
        </div>
      ))}
    </>
  );
}

export function AdoptResult({ dispatch }: { dispatch: (a: WizardAction) => void }) {
  return (
    <div className="wz-left wz-block" data-testid="wizard-adopt-result" style={{ overflow: "auto" }}>
      <StepDots total={3} current={2} />
      <h2 className="wz-q wz-q-sub">Here’s what I learned.</h2>
      <div className="wz-hint">I read it before I touched it. Nothing has been written yet.</div>

      <div
        data-testid="wizard-adopt-stub-note"
        className="iw-card pad"
        style={{ maxWidth: 840, marginBottom: 12, borderColor: "var(--warn-line)", background: "var(--warn-tint)" }}
      >
        <span style={{ fontSize: 12.5, color: "var(--ink)" }}>
          Sample findings — not a live read of your repo yet. Wiring the real scan is the next step (A09).
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 840 }}>
        <div className="iw-card pad" data-testid="wizard-adopt-found">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            What’s already here
          </div>
          <Table rows={ADOPT_SNAPSHOT.found} />
        </div>
        <div className="iw-card pad" data-testid="wizard-adopt-writes">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            What I’ll write
          </div>
          <Table rows={ADOPT_SNAPSHOT.writes} accent />
          <div className="caption" style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
            Nothing of yours is overwritten — I write alongside your files and show you the diff first.
          </div>
        </div>
      </div>

      <div
        className="iw-card pad"
        style={{ maxWidth: 840, marginTop: 12, background: "var(--accent-tint)", borderColor: "var(--accent-line)" }}
      >
        <div className="eyebrow" style={{ marginBottom: 5, color: "var(--accent-deep)" }}>
          Adopting is real work — you’ll watch it happen
        </div>
        <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.6 }}>
          It writes those files, derives the spec from your code and crawls a baseline test suite. That takes minutes,
          not seconds — so it runs as a <b>task</b>, and you follow it in Mission like any other. You approve the diff
          before anything is final.
        </div>
      </div>

      <div className="wz-foot">
        <WzOutline data-testid="wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
        <WzPrimary data-testid="wizard-adopt-start" disabled>
          <Play size={15} /> Adopt this repo — start the task
        </WzPrimary>
      </div>
    </div>
  );
}
