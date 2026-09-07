/*
 * useLeadwrightCommit.test.tsx — CI diff-coverage gap fix (Diff coverage
 * gate, iterate-2026-09-07-leadwright-setup-wizard): VerdictStep.test.tsx
 * mocks this hook wholesale, so its own lines never ran under any test.
 * Runs the REAL hook through a real QueryClient, mocking only the network
 * boundary (`postLeadCommit`).
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";

import { useLeadwrightCommit } from "./useLeadwrightCommit";
import * as api from "../../../lib/leadSetupWizardApi";
import type { LeadProposal } from "./buildLeadProposal";

const PROPOSAL: LeadProposal = {
  leadId: "billing-lead",
  lead: {
    name: "Billing Lead",
    domain: "billing",
    reports_to: null,
    manages: [],
    charter_path: "/abs/charter.md",
    learnings_path: "/abs/learnings.md",
    triggers: { cron: "0 * * * *", on: ["chat_session_ended"] },
    max_concurrent_tasks: 2,
    budget: { window: "rolling-7d", usd: 50, pause_at: 0.85, hard_stop_at: 0.95 },
    projects: ["/abs/p1"],
    allowed_skills: ["/content-orchestrator"],
    allowed_tools: [],
    escalation_target: "po-sven",
    model: "balanced",
    paused: false,
  },
  daemonConfigAdditions: { path: "/abs/daemon-config.json", actionId: "a1", pluginDirs: [] },
};

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useLeadwrightCommit", () => {
  it("calls postLeadCommit with the proposal's fields plus charterContent and expectedProposalDigest", async () => {
    const spy = vi.spyOn(api, "postLeadCommit").mockResolvedValue({
      kind: "committed",
      leadId: "billing-lead",
      restartRequired: true,
      restartNotice: "restart the daemon",
    });
    const { result } = renderHook(() => useLeadwrightCommit(), { wrapper: wrapper() });

    act(() => {
      result.current.mutate({ proposal: PROPOSAL, charterContent: "# charter", expectedProposalDigest: "digest-1" });
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(spy).toHaveBeenCalledWith({
      leadId: "billing-lead",
      lead: PROPOSAL.lead,
      daemonConfigAdditions: PROPOSAL.daemonConfigAdditions,
      charterContent: "# charter",
      expectedProposalDigest: "digest-1",
    });
    expect(result.current.data).toEqual({
      kind: "committed",
      leadId: "billing-lead",
      restartRequired: true,
      restartNotice: "restart the daemon",
    });
  });

  it("surfaces a verdict_stale result without throwing", async () => {
    vi.spyOn(api, "postLeadCommit").mockResolvedValue({ kind: "verdict_stale" });
    const { result } = renderHook(() => useLeadwrightCommit(), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ proposal: PROPOSAL, charterContent: "# charter", expectedProposalDigest: "stale" });
    });
    await waitFor(() => expect(result.current.data).toEqual({ kind: "verdict_stale" }));
  });
});
