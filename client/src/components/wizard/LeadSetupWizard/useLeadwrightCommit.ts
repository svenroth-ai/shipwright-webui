/*
 * useLeadwrightCommit — the final write. Takes the SAME proposal +
 * `charterContent` used for the last verdict plus that verdict's
 * `proposalDigest`; the server rejects a mismatched digest with 409
 * `verdict_stale` (answers changed after the verdict was fetched), which
 * VerdictStep handles by re-running the verdict rather than retrying commit
 * blindly.
 */
import { useMutation } from "@tanstack/react-query";

import { postLeadCommit, type LeadCommitResult } from "../../../lib/leadSetupWizardApi";
import type { LeadProposal } from "./buildLeadProposal";

export function useLeadwrightCommit() {
  return useMutation<
    LeadCommitResult,
    Error,
    { proposal: LeadProposal; charterContent: string; expectedProposalDigest: string }
  >({
    mutationFn: ({ proposal, charterContent, expectedProposalDigest }) =>
      postLeadCommit({
        leadId: proposal.leadId,
        lead: proposal.lead,
        daemonConfigAdditions: proposal.daemonConfigAdditions,
        charterContent,
        expectedProposalDigest,
      }),
  });
}
