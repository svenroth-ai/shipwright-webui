/*
 * NewPathPlanCard — "Here's what I understood." (A08; wired in A09a). The 7
 * pipeline phases in plain language, a compact "where should I create it?" and
 * the real Go. Go now hands the answers to `/shipwright-run` for real: it
 * creates the project + task and launches `new-pipeline` (→ /shipwright-run:run)
 * with the brief pre-loaded (contract.ts + useWizardLaunch). It waits for this
 * "Go" before spending a token; webui spawns no Claude (Architecture rule 1).
 *
 * Go stays disabled until a target folder is given — we cannot register a
 * project without knowing where it lives. Supabase env vars are only mentioned
 * for "web + remember" (AC1), and never collected here — the deploy phase asks
 * for the real secrets, not the wizard.
 */

import { useState } from "react";
import { Play } from "lucide-react";

import { planPhases, profileFor } from "./stubData";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import { buildNewLaunchRequest, deriveNewProjectName, resolveStackProfile } from "./contract";
import type { WizardLaunchRequest } from "./contract";
import type { WizardAction } from "./wizardState";
import type { NewAnswers } from "./types";

export function NewPathPlanCard({
  answers,
  dispatch,
  onLaunch,
}: {
  answers: NewAnswers;
  dispatch: (a: WizardAction) => void;
  onLaunch: (request: WizardLaunchRequest) => void;
}) {
  const p = profileFor(answers);
  const phases = planPhases(answers);
  const { envVarsRequired } = resolveStackProfile(answers);

  const [name, setName] = useState(() => deriveNewProjectName(answers.brief || ""));
  const [folder, setFolder] = useState("");
  const canGo = folder.trim().length > 0;

  return (
    <div className="wz-left wz-block" data-testid="wizard-plan-card">
      <StepDots total={5} current={5} />
      <h2 className="wz-q wz-q-sub">Here’s what I understood.</h2>
      <div className="wz-hint">
        {answers.brief || "Your idea"} — for <b>{answers.who || "you"}</b>, on the <b>{p.name}</b> stack ({p.note}).
      </div>

      <div
        style={{
          maxWidth: 620,
          background: "var(--card)",
          border: "1px solid var(--line-card)",
          borderRadius: 16,
          boxShadow: "var(--sh-card)",
          padding: "8px 18px",
        }}
      >
        {phases.map((ph) => (
          <div
            key={ph.name}
            data-testid={`wizard-phase-${ph.name}`}
            style={{
              padding: "12px 0",
              borderTop: "1px solid var(--line)",
              opacity: ph.skipped ? 0.55 : 1,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent-deep)" }}>{ph.name}</div>
            <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5, marginTop: 2 }}>{ph.desc}</div>
          </div>
        ))}
      </div>

      {envVarsRequired ? (
        <div
          data-testid="wizard-plan-envvars"
          className="iw-card pad"
          style={{ maxWidth: 620, marginTop: 12, borderColor: "var(--accent-line)", background: "var(--accent-tint)" }}
        >
          <span style={{ fontSize: 12.5, color: "var(--ink)" }}>
            On the web + saved data → you’ll need a free Supabase account. I’ll ask for those keys at the Deploy step,
            not now — nothing is asked twice.
          </span>
        </div>
      ) : null}

      {/* Where to create it — the one thing the 4 questions don't cover. */}
      <div style={{ maxWidth: 620, marginTop: 14, display: "grid", gap: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          Project name
          <input
            className="wz-input wz-line"
            data-testid="wizard-plan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-app"
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          Where should I create it?
          <input
            className="wz-input wz-line"
            data-testid="wizard-plan-folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="C:\path\to\your-projects\my-app"
          />
        </label>
      </div>

      <div className="wz-foot">
        <WzOutline data-testid="wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
        <WzPrimary
          data-testid="wizard-go"
          disabled={!canGo}
          onClick={() =>
            canGo && onLaunch(buildNewLaunchRequest(answers, { name, path: folder }))
          }
        >
          <Play size={15} /> Go — build it
        </WzPrimary>
      </div>
      <div
        data-testid="wizard-plan-provenance"
        style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 14, maxWidth: 620 }}
      >
        {canGo
          ? "Your answers are handed to /shipwright-run as a brief — the terminal interview only asks what’s still missing. It waits for this “Go” before spending a token."
          : "Tell me where to create it and I’ll hand these answers to /shipwright-run as a brief — the terminal interview only asks what’s still missing, and waits for your “Go” before spending a token."}
      </div>
    </div>
  );
}
