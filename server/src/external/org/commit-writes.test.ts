import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeNewCharterFile, writeDaemonConfigAddition, writeOrgChartLead } from "./commit-writes.js";
import { OrgFileSymlinkEscapeError } from "./org-file-lock.js";
import type { PreflightLead } from "../../types/leadwright-preflight.js";

const LEAD: PreflightLead = {
  name: "New Lead",
  domain: "billing",
  reports_to: null,
  manages: [],
  charter_path: "new-lead/charter.md",
  learnings_path: "new-lead/learnings.md",
  triggers: { cron: "0 * * * *", on: [] },
  max_concurrent_tasks: 1,
  budget: { window: "rolling-7d", usd: null, pause_at: 0.85, hard_stop_at: 0.95 },
  projects: ["p1"],
  allowed_skills: ["/x"],
  allowed_tools: [],
  escalation_target: "po",
  model: "balanced",
  paused: false,
};

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "commit-writes-test-"));
}

describe("writeNewCharterFile", () => {
  it("creates the lead directory and writes charter.md", () => {
    const leadsRoot = tempDir();
    writeNewCharterFile(leadsRoot, "new-lead", "# New Lead\n");
    expect(readFileSync(path.join(leadsRoot, "new-lead", "charter.md"), "utf8")).toBe("# New Lead\n");
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it("refuses when the lead directory is a symlink", () => {
    const leadsRoot = tempDir();
    const lstat = (p: string) => ({ isSymbolicLink: () => p === path.join(leadsRoot, "new-lead") });
    expect(() => writeNewCharterFile(leadsRoot, "new-lead", "# New Lead\n", lstat)).toThrow(
      OrgFileSymlinkEscapeError,
    );
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it("refuses when charter.md itself is a symlink (a retry landing on a planted symlink)", () => {
    const leadsRoot = tempDir();
    const charterPath = path.join(leadsRoot, "new-lead", "charter.md");
    const lstat = (p: string) => ({ isSymbolicLink: () => p === charterPath });
    expect(() => writeNewCharterFile(leadsRoot, "new-lead", "# New Lead\n", lstat)).toThrow(
      OrgFileSymlinkEscapeError,
    );
    rmSync(leadsRoot, { recursive: true, force: true });
  });
});

describe("writeDaemonConfigAddition", () => {
  it("returns missing + a fragment when daemon-config.json does not exist, and never creates it", () => {
    const leadsRoot = tempDir();
    return writeDaemonConfigAddition(leadsRoot, "new-lead", { path: "/abs/p1", actionId: "/x", pluginDirs: ["/abs/plugins"] }).then(
      (result) => {
        expect(result.status).toBe("missing");
        if (result.status === "missing") {
          const fragment = JSON.parse(result.fragment);
          expect(fragment.leadProjectRoots["new-lead"]).toBe("/abs/p1");
          expect(fragment.leadActionIds["new-lead"]).toBe("/x");
          expect(fragment.leadPluginDirs["new-lead"]).toEqual(["/abs/plugins"]);
        }
        expect(existsSync(path.join(leadsRoot, "daemon-config.json"))).toBe(false);
        rmSync(leadsRoot, { recursive: true, force: true });
      },
    );
  });

  it("adds ONLY the three new-lead entries, preserving other leads' entries and unrelated fields", async () => {
    const leadsRoot = tempDir();
    const existing = {
      orgChartPath: "/leads/org-chart.json",
      webuiBaseUrl: "http://x",
      pollIntervalMs: 5000,
      leadProjectRoots: { "other-lead": "/abs/other" },
      leadActionIds: { "other-lead": "/y" },
      leadPluginDirs: { "other-lead": ["/abs/other-plugins"] },
    };
    writeFileSync(path.join(leadsRoot, "daemon-config.json"), JSON.stringify(existing));

    const result = await writeDaemonConfigAddition(leadsRoot, "new-lead", { path: "/abs/p1", actionId: "/x", pluginDirs: [] });
    expect(result.status).toBe("written");

    const written = JSON.parse(readFileSync(path.join(leadsRoot, "daemon-config.json"), "utf8"));
    expect(written.pollIntervalMs).toBe(5000);
    expect(written.leadProjectRoots).toEqual({ "other-lead": "/abs/other", "new-lead": "/abs/p1" });
    expect(written.leadActionIds).toEqual({ "other-lead": "/y", "new-lead": "/x" });
    expect(written.leadPluginDirs).toEqual({ "other-lead": ["/abs/other-plugins"], "new-lead": [] });
    rmSync(leadsRoot, { recursive: true, force: true });
  });
});

describe("writeOrgChartLead", () => {
  it("adds the new lead, preserving every existing entry and its order", async () => {
    const leadsRoot = tempDir();
    const existing = { version: 2, po: "sven", leads: { "existing-lead": { ...LEAD, name: "Existing" } } };
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(existing));

    const result = await writeOrgChartLead(leadsRoot, "new-lead", LEAD);
    expect(result.status).toBe("written");

    const written = JSON.parse(readFileSync(path.join(leadsRoot, "org-chart.json"), "utf8"));
    expect(written.leads["existing-lead"]).toEqual(existing.leads["existing-lead"]);
    expect(written.leads["new-lead"]).toEqual(LEAD);
    expect(Object.keys(written.leads)).toEqual(["existing-lead", "new-lead"]);
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it("is idempotent when the SAME lead content already exists at that id (safe retry)", async () => {
    const leadsRoot = tempDir();
    const existing = { version: 2, po: "sven", leads: { "new-lead": LEAD } };
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(existing));

    const result = await writeOrgChartLead(leadsRoot, "new-lead", LEAD);
    expect(result.status).toBe("already_committed");
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it("refuses (never overwrites) when a DIFFERENT lead already exists at that id", async () => {
    const leadsRoot = tempDir();
    const existing = { version: 2, po: "sven", leads: { "new-lead": { ...LEAD, name: "Someone Else" } } };
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(existing));

    const result = await writeOrgChartLead(leadsRoot, "new-lead", LEAD);
    expect(result.status).toBe("conflict");

    const written = JSON.parse(readFileSync(path.join(leadsRoot, "org-chart.json"), "utf8"));
    expect(written.leads["new-lead"].name).toBe("Someone Else");
    rmSync(leadsRoot, { recursive: true, force: true });
  });
});
