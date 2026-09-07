import { describe, it, expect, vi, afterEach } from "vitest";

import {
  fetchDomains,
  postLeadVerdict,
  postLeadCommit,
  type LeadVerdictRequestBody,
  type LeadCommitRequestBody,
} from "./leadSetupWizardApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

const LEAD: LeadVerdictRequestBody["lead"] = {
  name: "New Lead",
  domain: "billing",
  reports_to: null,
  manages: [],
  charter_path: "new-lead/charter.md",
  learnings_path: "new-lead/learnings.md",
  triggers: { cron: "0 * * * *", on: [] },
  max_concurrent_tasks: 2,
  budget: { window: "rolling-7d", usd: null, pause_at: 0.85, hard_stop_at: 0.95 },
  projects: ["p1"],
  allowed_skills: ["/shipwright-iterate"],
  allowed_tools: [],
  escalation_target: "po",
  model: "balanced",
  paused: false,
};

const VERDICT_BODY: LeadVerdictRequestBody = {
  leadId: "new-lead",
  lead: LEAD,
  daemonConfigAdditions: { path: "/abs/p1", actionId: "/shipwright-iterate", pluginDirs: [] },
};

describe("fetchDomains", () => {
  it("GETs /api/org/domains", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ domains: ["billing"], unclaimedCounts: { billing: 3 } }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchDomains();
    expect(fetchSpy).toHaveBeenCalledWith("/api/org/domains", expect.objectContaining({ cache: "no-store" }));
    expect(result).toEqual({ domains: ["billing"], unclaimedCounts: { billing: 3 } });
  });
});

describe("postLeadVerdict", () => {
  it('maps 503 to kind:"not_configured"', async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    const result = await postLeadVerdict(VERDICT_BODY);
    expect(result).toEqual({ kind: "not_configured" });
  });

  it('maps a 200 ranOk:true body to kind:"ran"', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ranOk: true, result: { ok: true, findings: [] }, proposalDigest: "abc" }),
      }),
    );
    const result = await postLeadVerdict(VERDICT_BODY);
    expect(result).toEqual({ kind: "ran", ranOk: true, result: { ok: true, findings: [] }, proposalDigest: "abc" });
  });

  it('maps a 200 ranOk:false body to kind:"ran" — this is the "leadwright not reachable" state', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ranOk: false, reason: "produced no parsable output", proposalDigest: "abc" }),
      }),
    );
    const result = await postLeadVerdict(VERDICT_BODY);
    expect(result).toEqual({ kind: "ran", ranOk: false, reason: "produced no parsable output", proposalDigest: "abc" });
  });

  it("maps another non-2xx status to kind:error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "invalid_request_body" }) }),
    );
    const result = await postLeadVerdict(VERDICT_BODY);
    expect(result.kind).toBe("error");
  });
});

describe("postLeadCommit", () => {
  const COMMIT_BODY: LeadCommitRequestBody = { ...VERDICT_BODY, charterContent: "# New Lead", expectedProposalDigest: "abc" };

  it('maps 503 to kind:"not_configured"', async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    expect(await postLeadCommit(COMMIT_BODY)).toEqual({ kind: "not_configured" });
  });

  it('maps 409 verdict_stale to kind:"verdict_stale"', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "verdict_stale" }) }),
    );
    expect(await postLeadCommit(COMMIT_BODY)).toEqual({ kind: "verdict_stale" });
  });

  it('maps 409 org_chart_lead_exists to kind:"lead_exists"', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "org_chart_lead_exists" }) }),
    );
    expect(await postLeadCommit(COMMIT_BODY)).toEqual({ kind: "lead_exists" });
  });

  it('maps 409 daemon_config_locked and org_chart_locked to kind:"locked"', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "daemon_config_locked" }) }),
    );
    expect(await postLeadCommit(COMMIT_BODY)).toEqual({ kind: "locked" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "org_chart_locked" }) }),
    );
    expect(await postLeadCommit(COMMIT_BODY)).toEqual({ kind: "locked" });
  });

  it('maps 409 verdict_not_ok to kind:"verdict_not_ok" with its findings — external-review fix (security)', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: "verdict_not_ok",
          findings: [{ key: "domain", layer: "MUSS", satisfied: false, message: "domain must be set" }],
        }),
      }),
    );
    expect(await postLeadCommit(COMMIT_BODY)).toEqual({
      kind: "verdict_not_ok",
      findings: [{ key: "domain", layer: "MUSS", satisfied: false, message: "domain must be set" }],
    });
  });

  it('maps committed:true to kind:"committed" with the restart notice', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ committed: true, leadId: "new-lead", restartRequired: true, restartNotice: "restart it" }),
      }),
    );
    expect(await postLeadCommit(COMMIT_BODY)).toEqual({
      kind: "committed",
      committed: true,
      leadId: "new-lead",
      restartRequired: true,
      restartNotice: "restart it",
    });
  });

  it('maps committed:false to kind:"daemon_config_missing" with the fragment', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ committed: false, stage: "daemon-config", fragment: '{"leadProjectRoots":{}}' }),
      }),
    );
    expect(await postLeadCommit(COMMIT_BODY)).toEqual({
      kind: "daemon_config_missing",
      fragment: '{"leadProjectRoots":{}}',
    });
  });
});
