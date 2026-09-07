import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { commitCore } from "./commit.js";
import { computeProposalDigest } from "./leadwright-proposal-merge.js";
import type { PreflightOrgChart } from "../../types/leadwright-preflight.js";
import { EMPTY_ORG_CHART, VALID_LEAD, ADDITIONS, baseDeps, validBody } from "./commit.test-fixtures.js";

describe("commitCore", () => {
  it("503s leadwright_not_configured when leadwrightCheckoutRoot is unset", async () => {
    const deps = baseDeps({ leadwrightCheckoutRoot: undefined });
    const result = await commitCore(deps, validBody());
    expect(result).toEqual({ status: 503, body: { error: "leadwright_not_configured" } });
  });

  it("400s on a non-relative charter_path", async () => {
    const deps = baseDeps();
    const result = await commitCore(deps, validBody({ lead: { ...VALID_LEAD, charter_path: "/abs/charter.md" } }));
    expect(result).toEqual({ status: 400, body: { error: "charter_path_must_match_lead_id_convention" } });
  });

  // The remaining validateCommitBody branches (relative-but-mismatched
  // charter_path, learnings_path convention, allowed_skills shape, etc.) are
  // unit-tested directly against the validator in commit-validate.test.ts —
  // this file keeps just enough coverage to prove commitCore actually wires
  // that validator in and maps its rejection to a 400.
  it("400s on a non-absolute daemonConfigAdditions.path", async () => {
    const deps = baseDeps();
    const result = await commitCore(deps, validBody({ daemonConfigAdditions: { ...ADDITIONS, path: "relative/p1" } }));
    expect(result).toEqual({ status: 400, body: { error: "daemon_config_additions_must_be_absolute" } });
  });

  it("409s verdict_stale when the digest no longer matches the fresh merge", async () => {
    const deps = baseDeps();
    const result = await commitCore(deps, validBody({ expectedProposalDigest: "stale-digest" }));
    expect(result).toEqual({ status: 409, body: { error: "verdict_stale" } });
    expect(deps.writeCharterFn).not.toHaveBeenCalled();
  });

  // External-review fix (openai, high — security): expectedProposalDigest is
  // an unsigned hash a client could compute WITHOUT ever calling /verdict —
  // it proves the client's claimed proposal matches the fresh server merge,
  // not that leadwright's real check-setup.ts actually approved it. commitCore
  // must independently re-run the transport against the exact proposal it is
  // about to write and refuse to write on anything but a genuine green result.
  it("409s verdict_not_ok (never writes) when the server's own re-verification comes back red, even though the digest matches", async () => {
    const deps = baseDeps({
      runLeadwrightPreflightFn: vi.fn(async () => ({
        ranOk: true as const,
        result: { ok: false, findings: [{ key: "domain", layer: "MUSS" as const, satisfied: false, message: "domain must be set" }] },
      })),
    });
    const result = await commitCore(deps, validBody());
    expect(result).toEqual({
      status: 409,
      body: { error: "verdict_not_ok", findings: [{ key: "domain", layer: "MUSS", satisfied: false, message: "domain must be set" }] },
    });
    expect(deps.writeCharterFn).not.toHaveBeenCalled();
  });

  it("502s leadwright_transport_failed (never writes) when the server's own re-verification can't get a parsable result", async () => {
    const deps = baseDeps({
      runLeadwrightPreflightFn: vi.fn(async () => ({ ranOk: false as const, reason: "leadwright check-setup produced no output" })),
    });
    const result = await commitCore(deps, validBody());
    expect(result).toEqual({
      status: 502,
      body: { error: "leadwright_transport_failed", detail: "leadwright check-setup produced no output" },
    });
    expect(deps.writeCharterFn).not.toHaveBeenCalled();
  });

  it("propagates a non-200 org-chart read (e.g. missing org-chart.json) without writing anything", async () => {
    const deps = baseDeps({ readOrgChartFullFn: vi.fn(() => ({ status: 404 as const, body: { error: "org_chart_missing" } })) });
    const result = await commitCore(deps, validBody());
    expect(result).toEqual({ status: 404, body: { error: "org_chart_missing" } });
    expect(deps.writeCharterFn).not.toHaveBeenCalled();
  });

  it("returns committed:false with a fragment (never writes) when daemon-config.json is absent", async () => {
    const leadsRoot = mkdtempSync(path.join(tmpdir(), "commit-test-"));
    const fs = await import("node:fs");
    fs.writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(EMPTY_ORG_CHART));

    const deps = baseDeps({ leadsRoot, readOrgChartFullFn: () => ({ status: 200 as const, body: EMPTY_ORG_CHART }) });
    const result = await commitCore(deps, validBody());
    expect(result.status).toBe(200);
    if (result.status === 200 && "committed" in result.body && result.body.committed === false) {
      expect(result.body.stage).toBe("daemon-config");
      expect(JSON.parse(result.body.fragment).leadProjectRoots["new-lead"]).toBe("/abs/p1");
    } else {
      throw new Error("expected committed:false");
    }
    expect(deps.writeCharterFn).toHaveBeenCalledWith(leadsRoot, "new-lead", "# New Lead");

    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it("performs all three ordered writes and returns the restart notice when daemon-config.json exists", async () => {
    const leadsRoot = mkdtempSync(path.join(tmpdir(), "commit-test-"));
    const fs = await import("node:fs");
    fs.writeFileSync(
      path.join(leadsRoot, "daemon-config.json"),
      JSON.stringify({ orgChartPath: path.join(leadsRoot, "org-chart.json"), webuiBaseUrl: "http://localhost:5173" }),
    );
    fs.writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(EMPTY_ORG_CHART));

    const deps = baseDeps({
      leadsRoot,
      readOrgChartFullFn: () => ({ status: 200 as const, body: EMPTY_ORG_CHART }),
      daemonConfigReadFn: () => ({
        status: 200 as const,
        body: {
          found: true as const,
          config: { orgChartPath: path.join(leadsRoot, "org-chart.json"), webuiBaseUrl: "http://localhost:5173" },
        },
      }),
      writeCharterFn: vi.fn(),
    });
    const digest = computeProposalDigest({
      orgChart: { ...EMPTY_ORG_CHART, leads: { "new-lead": VALID_LEAD } },
      charters: [{ leadId: "new-lead", content: "# New Lead" }],
      daemonConfig: {
        orgChartPath: path.join(leadsRoot, "org-chart.json"),
        webuiBaseUrl: "http://localhost:5173",
        leadProjectRoots: { "new-lead": ADDITIONS.path },
        leadActionIds: { "new-lead": ADDITIONS.actionId },
        leadPluginDirs: { "new-lead": ADDITIONS.pluginDirs },
      },
    });

    const result = await commitCore(deps, validBody({ expectedProposalDigest: digest }));
    expect(result).toEqual({
      status: 200,
      body: { committed: true, leadId: "new-lead", restartRequired: true, restartNotice: expect.stringContaining("restart") },
    });
    expect(deps.writeCharterFn).toHaveBeenCalledWith(leadsRoot, "new-lead", "# New Lead");

    const writtenDaemonConfig = JSON.parse(readFileSync(path.join(leadsRoot, "daemon-config.json"), "utf8"));
    expect(writtenDaemonConfig.leadProjectRoots["new-lead"]).toBe("/abs/p1");
    const writtenOrgChart = JSON.parse(readFileSync(path.join(leadsRoot, "org-chart.json"), "utf8"));
    expect(writtenOrgChart.leads["new-lead"]).toEqual(VALID_LEAD);

    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it("409s org_chart_lead_exists BEFORE any write when a DIFFERENT lead already occupies the id — doubt-review fix: this must be caught upfront, never discovered only by the org-chart write's own late conflict check, or charter.md/daemon-config.json get silently clobbered first", async () => {
    const leadsRoot = mkdtempSync(path.join(tmpdir(), "commit-test-"));
    const fs = await import("node:fs");
    const conflicting = { ...VALID_LEAD, name: "Someone Else" };
    const currentOrgChart: PreflightOrgChart = { version: 2, po: "sven", leads: { "new-lead": conflicting } };
    fs.writeFileSync(
      path.join(leadsRoot, "daemon-config.json"),
      JSON.stringify({ orgChartPath: path.join(leadsRoot, "org-chart.json"), webuiBaseUrl: "http://localhost:5173" }),
    );
    fs.writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(currentOrgChart));

    const deps = baseDeps({
      leadsRoot,
      readOrgChartFullFn: () => ({ status: 200 as const, body: currentOrgChart }),
      daemonConfigReadFn: () => ({
        status: 200 as const,
        body: {
          found: true as const,
          config: { orgChartPath: path.join(leadsRoot, "org-chart.json"), webuiBaseUrl: "http://localhost:5173" },
        },
      }),
    });
    // The digest reflects THIS operator's proposal (overwriting the id) —
    // matching what mergeLeadProposal produces from currentOrgChart + lead.
    const digest = computeProposalDigest({
      orgChart: { ...currentOrgChart, leads: { "new-lead": VALID_LEAD } },
      charters: [{ leadId: "new-lead", content: "# New Lead" }],
      daemonConfig: {
        orgChartPath: path.join(leadsRoot, "org-chart.json"),
        webuiBaseUrl: "http://localhost:5173",
        leadProjectRoots: { "new-lead": ADDITIONS.path },
        leadActionIds: { "new-lead": ADDITIONS.actionId },
        leadPluginDirs: { "new-lead": ADDITIONS.pluginDirs },
      },
    });

    const result = await commitCore(deps, validBody({ expectedProposalDigest: digest }));
    expect(result).toEqual({ status: 409, body: { error: "org_chart_lead_exists" } });

    const stillOnDisk = JSON.parse(readFileSync(path.join(leadsRoot, "org-chart.json"), "utf8"));
    expect(stillOnDisk.leads["new-lead"].name).toBe("Someone Else");

    // The regression this test guards: daemon-config.json must ALSO be
    // untouched — writeDaemonConfigAddition has no conflict check of its
    // own (it's an unconditional add-only merge), so without the upfront
    // check in commitCore it would have already overwritten this leadId's
    // entries with the rejected proposal's data by the time org-chart.json's
    // write finally rejected the request.
    const daemonConfigStillOnDisk = JSON.parse(readFileSync(path.join(leadsRoot, "daemon-config.json"), "utf8"));
    expect(daemonConfigStillOnDisk.leadProjectRoots).toBeUndefined();
    expect(deps.writeCharterFn).not.toHaveBeenCalled();

    rmSync(leadsRoot, { recursive: true, force: true });
  });
});
