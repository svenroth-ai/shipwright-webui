/*
 * useLeadwrightVerdict.test.ts — CI diff-coverage gap fix (Diff coverage
 * gate, iterate-2026-09-07-leadwright-setup-wizard): VerdictStep.test.tsx
 * mocks this hook wholesale, so its own lines never ran under any test.
 * Runs the REAL hook through a real QueryClient, mocking only the network
 * boundary (`postLeadVerdict`) — proves the `ran`/`ok`/`ranOk` derivation.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";

import { useLeadwrightVerdict } from "./useLeadwrightVerdict";
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useLeadwrightVerdict", () => {
  it("is disabled (never fetches) when proposal is null", () => {
    const spy = vi.spyOn(api, "postLeadVerdict");
    const { result } = renderHook(() => useLeadwrightVerdict(null, ""), { wrapper: wrapper() });
    expect(result.current.loading).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("derives ok/findings/proposalDigest from a green ran verdict", async () => {
    vi.spyOn(api, "postLeadVerdict").mockResolvedValue({
      kind: "ran",
      ranOk: true,
      result: { ok: true, findings: [] },
      proposalDigest: "digest-1",
    });
    const { result } = renderHook(() => useLeadwrightVerdict(PROPOSAL, "# charter"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.ranOk).toBe(true));
    expect(result.current.ok).toBe(true);
    expect(result.current.proposalDigest).toBe("digest-1");
    expect(result.current.reason).toBeNull();
    expect(result.current.notConfigured).toBe(false);
  });

  it("surfaces the reason and ranOk:false when the transport itself failed", async () => {
    vi.spyOn(api, "postLeadVerdict").mockResolvedValue({
      kind: "ran",
      ranOk: false,
      reason: "leadwright checkout is stale",
      proposalDigest: "digest-2",
    });
    const { result } = renderHook(() => useLeadwrightVerdict(PROPOSAL, "# charter"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.ranOk).toBe(false));
    expect(result.current.reason).toBe("leadwright checkout is stale");
    expect(result.current.ok).toBeNull();
    expect(result.current.findings).toEqual([]);
  });

  it("surfaces notConfigured on a 503", async () => {
    vi.spyOn(api, "postLeadVerdict").mockResolvedValue({ kind: "not_configured" });
    const { result } = renderHook(() => useLeadwrightVerdict(PROPOSAL, "# charter"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.notConfigured).toBe(true));
  });

  it("surfaces error on kind:error", async () => {
    vi.spyOn(api, "postLeadVerdict").mockResolvedValue({
      kind: "error",
      error: { message: "boom" } as never,
    });
    const { result } = renderHook(() => useLeadwrightVerdict(PROPOSAL, "# charter"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toBe(true));
  });

  it("changing charterContent alone changes the query key (re-fetches)", async () => {
    const spy = vi
      .spyOn(api, "postLeadVerdict")
      .mockResolvedValue({ kind: "ran", ranOk: true, result: { ok: true, findings: [] }, proposalDigest: "d" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ charterContent }: { charterContent: string }) => useLeadwrightVerdict(PROPOSAL, charterContent),
      { wrapper: Wrapper, initialProps: { charterContent: "v1" } },
    );
    await waitFor(() => expect(result.current.ranOk).toBe(true));
    rerender({ charterContent: "v2" });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
