/*
 * AdoptResult — step 3 for the adopt door (A08; launch wired in A09a). Two
 * columns: what's already here vs what adopting would write. Adopting WRITES
 * files, so it is real work you watch — it ends in a MISSION (a task), not a
 * dialog. The CTA now REALLY starts the task: it registers the project against
 * the repo and launches `new-task` + the `adopt` phase (→ /shipwright-adopt)
 * with the repo path as the brief (contract.ts + useWizardLaunch). Webui spawns
 * no Claude (Architecture rule 1).
 *
 * The FINDINGS are still a provenance-tagged sample — the live repo scan is a
 * later server-side step; only the LAUNCH is wired here, so the note stays
 * honest about what is and isn't live (AC5). Copy matches the plugin: adopt is
 * NEVER-OVERWRITE (existing files kept byte-for-byte, originals preserved as
 * `.preserved`) — there is no diff-approval UI, so we don't claim one.
 */

import { Play } from "lucide-react";

import { ADOPT_SNAPSHOT, isRemote } from "./stubData";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import { buildAdoptLaunchRequest, type WizardLaunchRequest } from "./contract";
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

export function AdoptResult({
  path,
  dispatch,
  onLaunch,
}: {
  path: string | null;
  dispatch: (a: WizardAction) => void;
  onLaunch: (request: WizardLaunchRequest) => void;
}) {
  const trimmedPath = (path ?? "").trim();
  // Adopt registers a LOCAL git repo (it reads the working tree + history in
  // place). A remote URL — reachable here via the grade→adopt handoff or the
  // repo-picker's github chip — is not a registrable local path, so we don't
  // launch adopt against it; the honest ask is "clone it first" (OpenAI review).
  const remote = isRemote(trimmedPath);
  const canStart = trimmedPath.length > 0 && !remote;
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
          Sample findings — not a live read of your repo yet (the real scan lands later). The button below is real,
          though: it starts the adopt task on your repo now.
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
            Nothing of yours is overwritten — I write alongside your files, and any file that already exists is kept
            byte-for-byte.
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
          not seconds — so it runs as a <b>task</b>, and you follow it in Mission like any other. It never overwrites
          what’s already there, so you can review every change afterward.
        </div>
      </div>

      <div className="wz-foot">
        <WzOutline data-testid="wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
        <WzPrimary
          data-testid="wizard-adopt-start"
          disabled={!canStart}
          onClick={() => canStart && onLaunch(buildAdoptLaunchRequest(trimmedPath))}
        >
          <Play size={15} /> Adopt this repo — start the task
        </WzPrimary>
      </div>
      {remote ? (
        <div data-testid="wizard-adopt-remote-note" className="caption" style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", maxWidth: 840 }}>
          Adopt works on a local folder — clone <span className="mono">{trimmedPath}</span> first, then point me at the folder.
        </div>
      ) : null}
    </div>
  );
}
