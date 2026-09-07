/*
 * VerdictStep — question 8 (not a question; the review + finish step). Runs
 * leadwright's REAL `check-setup.ts` verdict (via `useLeadwrightVerdict`,
 * never re-implemented client-side), shows the findings grouped by layer,
 * and only enables Finish once a verdict has come back positive AND the
 * path-shape rule passes. `leadwrightCheckoutRoot` unset/wrong surfaces as
 * a blocking "leadwright not reachable" state — never a silent skip.
 *
 * A 409 verdict_stale on commit (answers changed since the last verdict, or
 * two tabs racing) auto-retries the verdict rather than surfacing a dead
 * end — the user just sees "re-checking…" and can press Finish again.
 */
import { useEffect, useState } from "react";

import { StepDots } from "../IntentWizard/StepDots";
import { WzPrimary, WzOutline } from "../IntentWizard/buttons";
import { buildLeadProposal } from "./buildLeadProposal";
import { buildDefaultCharter } from "./buildDefaultCharter";
import { checkProposalPaths } from "./absolutePaths";
import { useLeadwrightVerdict } from "./useLeadwrightVerdict";
import { useLeadwrightCommit } from "./useLeadwrightCommit";
import type { LeadSetupAction } from "./leadWizardState";
import type { LeadSetupAnswers } from "./types";
import { TOTAL_STEPS } from "./types";
import type { PreflightFindingLayer } from "../../../lib/leadSetupWizardApi";

const LAYER_LABELS: Record<PreflightFindingLayer, string> = {
  MUSS: "Must fix",
  KANN: "Should fix",
  advisory: "Advisory",
};
const LAYER_ORDER: PreflightFindingLayer[] = ["MUSS", "KANN", "advisory"];

export function VerdictStep({
  answers,
  dispatch,
}: {
  answers: LeadSetupAnswers;
  dispatch: (a: LeadSetupAction) => void;
}) {
  const proposal = buildLeadProposal(answers);
  const charterContent = buildDefaultCharter(answers);
  const pathCheck = proposal ? checkProposalPaths(proposal) : { ok: false, badFields: [] };
  const verdict = useLeadwrightVerdict(proposal, charterContent);
  const commit = useLeadwrightCommit();
  const [autoRetried, setAutoRetried] = useState(false);

  const commitResult = commit.data;
  useEffect(() => {
    if (commitResult?.kind === "verdict_stale" && !autoRetried) {
      setAutoRetried(true);
      void verdict.refetch();
    }
    if (commitResult?.kind !== "verdict_stale") {
      setAutoRetried(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitResult]);

  const notConfigured = verdict.notConfigured;
  // External-review fix (both legs, high): `ranOk` only means the transport
  // ran — it says nothing about whether leadwright's verdict was GREEN.
  // Gating on `ranOk` alone let a proposal with unsatisfied MUSS findings
  // (a red verdict) commit, which is the exact silent-failure class this
  // wizard exists to close. `ok` is `PreflightResult.ok`.
  const canFinish =
    !!proposal &&
    pathCheck.ok &&
    verdict.ranOk === true &&
    verdict.ok === true &&
    !notConfigured &&
    !commit.isPending &&
    verdict.proposalDigest !== null;

  function handleFinish() {
    if (!proposal || verdict.proposalDigest === null) return;
    commit.mutate({ proposal, charterContent, expectedProposalDigest: verdict.proposalDigest });
  }

  if (commitResult?.kind === "committed") {
    return (
      <div className="wz-left" data-testid="lead-wizard-step-verdict">
        <h2 className="wz-q">{commitResult.leadId} is set up.</h2>
        <div
          className="wz-restart-notice"
          data-testid="lead-wizard-restart-notice"
          role="alert"
          style={{ border: "2px solid var(--color-error, #b3261e)", padding: 12, borderRadius: 8 }}
        >
          {commitResult.restartNotice}
        </div>
      </div>
    );
  }

  return (
    <div className="wz-left" data-testid="lead-wizard-step-verdict">
      <StepDots total={TOTAL_STEPS} current={8} />
      <h2 className="wz-q">Ready to check this proposal against leadwright's rules?</h2>

      {notConfigured ? (
        <div data-testid="lead-wizard-leadwright-unreachable" role="alert">
          leadwright isn't reachable — this webui doesn't know where your leadwright checkout is. Set it
          up before a lead can be created.
        </div>
      ) : null}

      {!pathCheck.ok ? (
        <div data-testid="lead-wizard-path-invalid" role="alert">
          These fields must be absolute paths: {pathCheck.badFields.join(", ")}.
        </div>
      ) : null}

      {verdict.loading ? <div data-testid="lead-wizard-verdict-loading">Checking…</div> : null}
      {verdict.error && !notConfigured ? (
        <div data-testid="lead-wizard-verdict-error" role="alert">
          Couldn't get a verdict from leadwright. Try again.
        </div>
      ) : null}

      {verdict.ranOk === false ? (
        <div data-testid="lead-wizard-verdict-ran-not-ok" role="alert">
          leadwright's check could not run: {verdict.reason}
        </div>
      ) : null}

      {verdict.ranOk === true && verdict.ok === false ? (
        <div data-testid="lead-wizard-verdict-not-ok" role="alert">
          This proposal doesn't satisfy leadwright's rules yet — fix the items marked ✗ below before
          finishing.
        </div>
      ) : null}

      {LAYER_ORDER.map((layer) => {
        const items = verdict.findings.filter((f) => f.layer === layer);
        if (items.length === 0) return null;
        return (
          <div key={layer} data-testid={`lead-wizard-findings-${layer}`}>
            <h3>{LAYER_LABELS[layer]}</h3>
            <ul>
              {items.map((f) => (
                <li key={f.key} data-testid="lead-wizard-finding-row">
                  {f.satisfied ? "✓" : "✗"} {f.message}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <div data-testid="lead-wizard-what-will-be-written">
        <h3>What will be written</h3>
        <ul>
          <li>charter.md</li>
          <li>daemon-config.json (new entries only — nothing else touched)</li>
          <li>org-chart.json (this lead added — every other lead untouched)</li>
        </ul>
      </div>

      {commitResult?.kind === "verdict_stale" ? (
        <div data-testid="lead-wizard-verdict-stale">Your answers changed — re-checking…</div>
      ) : null}
      {commitResult?.kind === "lead_exists" ? (
        <div data-testid="lead-wizard-lead-exists" role="alert">
          A different lead already exists at this id. Pick a different lead id.
        </div>
      ) : null}
      {commitResult?.kind === "verdict_not_ok" ? (
        <div data-testid="lead-wizard-commit-verdict-not-ok" role="alert">
          leadwright's own re-check just came back red — this proposal doesn't satisfy its rules. Fix the
          items marked ✗ above before finishing.
        </div>
      ) : null}
      {commitResult?.kind === "locked" ? (
        <div data-testid="lead-wizard-commit-locked" role="alert">
          Another change is being written to the same files right now. Wait a moment and press Finish again.
        </div>
      ) : null}
      {commitResult?.kind === "daemon_config_missing" ? (
        <div data-testid="lead-wizard-daemon-config-missing" role="alert">
          <p>The charter was written, but daemon-config.json doesn't exist yet. Add this by hand:</p>
          <pre>{commitResult.fragment}</pre>
        </div>
      ) : null}
      {commitResult?.kind === "error" ? (
        <div data-testid="lead-wizard-commit-error" role="alert">
          Couldn't finish setting up this lead. Try again.
        </div>
      ) : null}

      <div className="wz-foot">
        <WzOutline data-testid="lead-wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
        <WzPrimary data-testid="lead-wizard-finish" disabled={!canFinish} onClick={handleFinish}>
          {commit.isPending ? "Setting up…" : "Finish"}
        </WzPrimary>
      </div>
    </div>
  );
}
