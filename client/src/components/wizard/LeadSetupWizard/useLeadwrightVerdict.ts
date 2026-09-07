/*
 * useLeadwrightVerdict — mirrors `useReadiness`'s not-ready-until-proven
 * contract shape: while the fetch is in flight or hasn't run yet, the
 * finish button on VerdictStep stays inert. `retry: false` for the same
 * reason useReadiness gives — a probe failure must show at once, not spin
 * through a retry backoff behind an ambiguous "checking" state.
 *
 * The query key includes a content hash of the built proposal (not the raw
 * answers object identity), so editing ANY answer after a verdict was
 * fetched invalidates it automatically — VerdictStep can then tell the user
 * their last verdict is stale and re-fetch before allowing commit.
 */
import { useQuery } from "@tanstack/react-query";

import { postLeadVerdict } from "../../../lib/leadSetupWizardApi";
import type { PreflightFinding } from "../../../lib/leadSetupWizardApi";
import type { LeadProposal } from "./buildLeadProposal";

/** External-review fix (GLM, medium): must fingerprint `charterContent` too
 *  — it is part of the merged proposal the server hashes into
 *  `proposalDigest`, but is a SEPARATE argument from `proposal` here. Without
 *  it, editing only an authority-band body (charter text, no other answer)
 *  left the query key unchanged, so `staleTime: Infinity` kept serving a
 *  verdict computed over the OLD charter — Finish stayed enabled on a
 *  digest that no longer matched what would actually be committed. */
function proposalFingerprint(p: LeadProposal, charterContent: string): string {
  return JSON.stringify({ p, charterContent });
}

export interface LeadwrightVerdictState {
  loading: boolean;
  error: boolean;
  notConfigured: boolean;
  ranOk: boolean | null;
  /** `PreflightResult.ok` — leadwright's actual pass/fail judgment, distinct
   *  from `ranOk` (the transport succeeded). `null` until a verdict that ran
   *  successfully has come back. External-review fix (both legs, high):
   *  Finish must be gated on THIS, never on `ranOk` alone — a subprocess
   *  that ran fine can still report unsatisfied MUSS findings. */
  ok: boolean | null;
  reason: string | null;
  proposalDigest: string | null;
  findings: PreflightFinding[];
}

export function useLeadwrightVerdict(proposal: LeadProposal | null, charterContent: string) {
  const enabled = proposal !== null;
  const q = useQuery({
    queryKey: ["lead-wizard", "verdict", proposal ? proposalFingerprint(proposal, charterContent) : null],
    queryFn: async () => {
      const p = proposal!;
      return postLeadVerdict({
        leadId: p.leadId,
        lead: p.lead,
        daemonConfigAdditions: p.daemonConfigAdditions,
        charterContent,
      });
    },
    enabled,
    retry: false,
    staleTime: Infinity,
  });

  const result = q.data;
  const state: LeadwrightVerdictState = {
    loading: q.isLoading || q.isFetching,
    error: q.isError || result?.kind === "error",
    notConfigured: result?.kind === "not_configured",
    ranOk: result?.kind === "ran" ? result.ranOk : null,
    ok: result?.kind === "ran" && result.ranOk ? result.result.ok : null,
    reason: result?.kind === "ran" && !result.ranOk ? result.reason : null,
    proposalDigest: result?.kind === "ran" ? result.proposalDigest : null,
    findings: result?.kind === "ran" && result.ranOk ? result.result.findings : [],
  };
  return { ...state, refetch: q.refetch };
}
