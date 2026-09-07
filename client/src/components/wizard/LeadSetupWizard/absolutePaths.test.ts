import { describe, it, expect } from "vitest";

import { isAbsolutePath, checkProposalPaths } from "./absolutePaths";
import type { LeadProposal } from "./buildLeadProposal";

function proposalWith(path: string, pluginDirs: string[] = []): LeadProposal {
  return {
    leadId: "billing-lead",
    lead: {
      name: "Billing Lead",
      domain: "billing",
      reports_to: null,
      manages: [],
      charter_path: "billing-lead/charter.md",
      learnings_path: "billing-lead/learnings.md",
      triggers: { cron: "0 * * * *", on: ["chat_session_ended"] },
      max_concurrent_tasks: 2,
      budget: { window: "rolling-7d", usd: 50, pause_at: 0.85, hard_stop_at: 0.95 },
      projects: ["proj-1"],
      allowed_skills: ["/shipwright-task"],
      allowed_tools: [],
      escalation_target: "po",
      model: "balanced",
      paused: false,
    },
    daemonConfigAdditions: { path, actionId: "new-task", pluginDirs },
  };
}

describe("isAbsolutePath", () => {
  it("accepts POSIX absolute paths", () => {
    expect(isAbsolutePath("/home/sven/project")).toBe(true);
  });

  it("accepts Windows drive-letter paths (both slash styles)", () => {
    expect(isAbsolutePath("C:\\01_Development\\proj")).toBe(true);
    expect(isAbsolutePath("C:/01_Development/proj")).toBe(true);
  });

  it("accepts UNC paths", () => {
    expect(isAbsolutePath("\\\\server\\share\\proj")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isAbsolutePath("proj/sub")).toBe(false);
    expect(isAbsolutePath("./proj")).toBe(false);
  });

  it("rejects a path containing .. traversal even if it looks absolute", () => {
    expect(isAbsolutePath("/home/sven/../etc")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isAbsolutePath("")).toBe(false);
  });

  // External-review fix (GLM, low): ".." must be checked as a path SEGMENT,
  // not a substring — a legitimately-named directory containing ".." was
  // being rejected as if it were a traversal attempt.
  it("accepts an absolute path with a segment that merely CONTAINS .. (not a traversal segment)", () => {
    expect(isAbsolutePath("/abs/project..name/foo")).toBe(true);
    expect(isAbsolutePath("C:\\01_Development\\my..project")).toBe(true);
  });
});

describe("checkProposalPaths", () => {
  it("ok when leadProjectRoots (daemonConfigAdditions.path) is absolute and pluginDirs empty", () => {
    const r = checkProposalPaths(proposalWith("/abs/demo"));
    expect(r.ok).toBe(true);
    expect(r.badFields).toEqual([]);
  });

  it("flags a non-absolute daemonConfigAdditions.path", () => {
    const r = checkProposalPaths(proposalWith("relative/demo"));
    expect(r.ok).toBe(false);
    expect(r.badFields).toContain("leadProjectRoots");
  });

  it("flags a non-absolute pluginDirs entry by index", () => {
    const r = checkProposalPaths(proposalWith("/abs/demo", ["/abs/plugin", "relative/plugin"]));
    expect(r.ok).toBe(false);
    expect(r.badFields).toContain("leadPluginDirs[1]");
  });

  it("never flags charter_path or learnings_path (they must stay relative)", () => {
    const r = checkProposalPaths(proposalWith("/abs/demo"));
    expect(r.badFields.some((f) => f.includes("charter") || f.includes("learnings"))).toBe(false);
  });
});
