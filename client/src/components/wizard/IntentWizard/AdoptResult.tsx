/*
 * AdoptResult — step 3 for the adopt door (A08; launch wired in A09a). Two
 * columns: what's already here vs what adopting would write. Adopting WRITES
 * files, so it is real work you watch — it ends in a MISSION (a task), not a
 * dialog. The CTA now REALLY starts the task: it registers the project against
 * the repo and launches `new-task` + the `adopt` phase (→ /shipwright-adopt)
 * with the repo path as the brief (contract.ts + useWizardLaunch). Webui spawns
 * no Claude (Architecture rule 1).
 *
 * The FINDINGS are a provenance-tagged sample EXCEPT the rows a real read-only scan
 * of the chosen local repo answers (POST /api/adopt/scan - the detected profile,
 * where it came from and its discovery warnings, plus stack, routes, tests, CI,
 * conventions and the package.json script names; `adoptLiveRows.ts` decides row by
 * row). Rows the scan cannot answer stay samples and say so. While it loads, or when
 * it is unavailable, every row is a sample and the note says so - the note is
 * derived from the rows and must never claim more is live than is (AC5). Copy matches the plugin: adopt is
 * NEVER-OVERWRITE (existing files kept byte-for-byte, originals preserved as
 * `.preserved`) — there is no diff-approval UI, so we don't claim one.
 */

import { Play } from "lucide-react";

import { useAdoptScan } from "../../../hooks/useAdoptScan";
import { profileSourceLabel } from "../../../lib/adoptScanApi";
import { ADOPT_SNAPSHOT, isRemote } from "./stubData";
import { adoptBannerText, buildAdoptRows, type AdoptRowState } from "./adoptLiveRows";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import { buildAdoptLaunchRequest, type WizardLaunchRequest } from "./contract";
import type { WizardAction } from "./wizardState";

function Table({ rows, accent }: { rows: Array<{ label: string; value: string; state?: AdoptRowState }>; accent?: boolean }) {
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
          <span style={{ fontSize: 12.5, color: "var(--body)", lineHeight: 1.5, overflowWrap: "anywhere", minWidth: 0 }}>
            {r.value}
            {r.state === "sample" ? (
              <span data-testid="wizard-adopt-sample-tag" style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)" }}>
                (sample)
              </span>
            ) : null}
          </span>
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
  const scan = useAdoptScan(trimmedPath, canStart);
  const live = scan.data?.status === "ok" ? scan.data.profile : null;
  const liveValue = live
    ? `${live.matched ?? "no profile matched"}${live.source ? ` - ${profileSourceLabel(live.source)}` : ""}`
    : null;
  const found = buildAdoptRows(ADOPT_SNAPSHOT.found, {
    profileValue: liveValue,
    findings: scan.data?.status === "ok" ? (scan.data.findings ?? {}) : null,
  });
  let scanNote: string | null = null;
  if (canStart && !live) {
    if (scan.isPending) scanNote = "Reading your repo's stack profile…";
    else if (scan.data?.status === "unsupported-schema")
      scanNote = "This repo's scan is from a newer Shipwright than this Command Center understands — the sample row stays.";
    else if (scan.data && "reason" in scan.data)
      scanNote = `Couldn't read the profile live (${scan.data.reason}) — the sample row stays.`;
    else scanNote = "Couldn't read the profile live — the sample row stays.";
  }
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
          {adoptBannerText(found)}
          The button below is real, though: it starts the adopt task on your repo now.
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 840 }}>
        <div className="iw-card pad" data-testid="wizard-adopt-found">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            What’s already here
          </div>
          <Table rows={found} />
          {live ? (
            <div data-testid="wizard-adopt-profile-live" className="caption" style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              Profile read live from your repo.
            </div>
          ) : null}
          {live && live.warnings.length > 0 ? (
            <ul data-testid="wizard-adopt-profile-warnings" style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--ink)" }}>
              {live.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          {scanNote ? (
            <div data-testid="wizard-adopt-scan-note" className="caption" style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              {scanNote}
            </div>
          ) : null}
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
