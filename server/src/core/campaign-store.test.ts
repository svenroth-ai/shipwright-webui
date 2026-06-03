import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { readCampaigns } from "./campaign-store.js";

const CAMPAIGNS_SEGMENTS = [".shipwright", "planning", "iterate", "campaigns"];

interface SeedOpts {
  md?: string;
  status?: unknown;
  specFiles?: string[];
}

describe("campaign-store: readCampaigns", () => {
  let workDir: string;
  let projectRoot: string;
  let campaignsDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "campaign-store-"));
    projectRoot = realpathSync(workDir);
    campaignsDir = path.join(projectRoot, ...CAMPAIGNS_SEGMENTS);
    mkdirSync(campaignsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function seed(slug: string, opts: SeedOpts): void {
    const dir = path.join(campaignsDir, slug);
    mkdirSync(dir, { recursive: true });
    if (opts.md !== undefined) {
      writeFileSync(path.join(dir, "campaign.md"), opts.md, "utf-8");
    }
    if (opts.status !== undefined) {
      writeFileSync(
        path.join(dir, "status.json"),
        JSON.stringify(opts.status, null, 2),
        "utf-8",
      );
    }
    for (const f of opts.specFiles ?? []) {
      const subDir = path.join(dir, "sub-iterates");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(path.join(subDir, f), "# spec\n", "utf-8");
    }
  }

  function mdWith(rows: Array<[string, string, string, string]>, extraFm = ""): string {
    const body = rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`).join("\n");
    return `---
campaign: c
branch_strategy: stacked
${extraFm}---

# Campaign: c

## Intent

Test intent

## Sub-Iterates

| ID | Slug | Title | Status |
|---|---|---|---|
${body}
`;
  }

  it("returns [] when the campaigns dir is missing", () => {
    rmSync(campaignsDir, { recursive: true, force: true });
    expect(readCampaigns(campaignsDir, projectRoot)).toEqual([]);
  });

  it("returns [] when the campaigns dir is empty", () => {
    expect(readCampaigns(campaignsDir, projectRoot)).toEqual([]);
  });

  // AC-2a — status.json authoritative
  it("uses status.json status over the campaign.md table (status.json wins)", () => {
    seed("c1", {
      md: mdWith([["B0", "alpha", "Alpha", "pending"]]),
      status: {
        branch_strategy: "stacked",
        sub_iterates: [{ id: "B0", slug: "alpha", status: "complete", commit: "abc123", branch: "iterate/x" }],
      },
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.steps[0].status).toBe("complete");
    expect(c.steps[0].commit).toBe("abc123");
    expect(c.steps[0].branch).toBe("iterate/x");
    expect(c.done).toBe(1);
    expect(c.total).toBe(1);
  });

  // AC-2b — no status.json → derived from the campaign.md table
  it("derives status from the campaign.md table when status.json is absent", () => {
    seed("c1", {
      md: mdWith([
        ["B0", "alpha", "Alpha", "complete"],
        ["B1", "beta", "Beta", "pending"],
      ]),
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.steps.map((s) => s.status)).toEqual(["complete", "pending"]);
    expect(c.steps[0].commit).toBeNull();
    expect(c.done).toBe(1);
  });

  // AC-2c — both present, status.json still wins (in_progress)
  it("lets status.json win even for non-complete states", () => {
    seed("c1", {
      md: mdWith([["B0", "alpha", "Alpha", "pending"]]),
      status: { sub_iterates: [{ id: "B0", slug: "alpha", status: "in_progress" }] },
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.steps[0].status).toBe("in_progress");
  });

  it("falls back to the table when status.json is malformed (torn write)", () => {
    seed("c1", { md: mdWith([["B0", "alpha", "Alpha", "complete"]]) });
    // overwrite status.json with a half-written/garbage payload
    writeFileSync(
      path.join(campaignsDir, "c1", "status.json"),
      '{ "sub_iterates": [ {"id": "B0", "stat',
      "utf-8",
    );
    const list = readCampaigns(campaignsDir, projectRoot);
    expect(list).toHaveLength(1);
    expect(list[0].steps[0].status).toBe("complete"); // table-derived, no throw
  });

  it("skips a dir with neither campaign.md nor status.json, keeps valid ones", () => {
    seed("empty-dir", {});
    seed("good", { md: mdWith([["B0", "alpha", "Alpha", "pending"]]) });
    const list = readCampaigns(campaignsDir, projectRoot);
    expect(list.map((c) => c.slug)).toEqual(["good"]);
  });

  it("sorts campaigns by slug descending (newest date prefix first)", () => {
    seed("2026-06-01-a", { md: mdWith([["B0", "alpha", "A", "pending"]]) });
    seed("2026-06-03-b", { md: mdWith([["B0", "beta", "B", "pending"]]) });
    const list = readCampaigns(campaignsDir, projectRoot);
    expect(list.map((c) => c.slug)).toEqual(["2026-06-03-b", "2026-06-01-a"]);
  });

  it("nextPending = first non-complete step; a failed step is surfaced", () => {
    seed("c1", {
      md: mdWith([
        ["B0", "alpha", "A", "complete"],
        ["B1", "beta", "B", "failed"],
        ["B2", "gamma", "C", "pending"],
      ]),
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.nextPending?.id).toBe("B1");
  });

  it("nextPending is null when every step is complete", () => {
    seed("c1", {
      md: mdWith([
        ["B0", "alpha", "A", "complete"],
        ["B1", "beta", "B", "complete"],
      ]),
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.nextPending).toBeNull();
    expect(c.done).toBe(2);
    expect(c.total).toBe(2);
  });

  it("derives a project-root-relative POSIX specPath when the spec file exists", () => {
    seed("2026-06-02-hook", {
      md: mdWith([["B0", "phase-resolver", "Phase resolver", "pending"]]),
      specFiles: ["B0-phase-resolver.md"],
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.steps[0].specPath).toBe(
      ".shipwright/planning/iterate/campaigns/2026-06-02-hook/sub-iterates/B0-phase-resolver.md",
    );
    expect(c.nextPending?.specPath).toBe(c.steps[0].specPath);
  });

  it("specPath is null when the spec file is missing", () => {
    seed("c1", { md: mdWith([["B0", "alpha", "A", "pending"]]) });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.steps[0].specPath).toBeNull();
  });

  it("reads frontmatter branchStrategy + expandsTriage", () => {
    seed("c1", {
      md: mdWith([["B0", "alpha", "A", "pending"]], "expandsTriage: trg-721b1765\n"),
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.branchStrategy).toBe("stacked");
    expect(c.expandsTriage).toBe("trg-721b1765");
    expect(c.intent).toBe("Test intent");
  });

  // ---- campaign-level lifecycle status (Option B) ----

  it("reads the top-level lifecycle status from status.json", () => {
    seed("c1", {
      md: mdWith([["B0", "alpha", "A", "pending"]]),
      status: { status: "active", sub_iterates: [{ id: "B0", slug: "alpha", status: "pending" }] },
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.status).toBe("active");
  });

  it("reads the lifecycle status from the campaign.md frontmatter when no status.json", () => {
    seed("c1", { md: mdWith([["B0", "alpha", "A", "pending"]], "status: draft\n") });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.status).toBe("draft");
  });

  it("status.json top-level status wins over the frontmatter status", () => {
    seed("c1", {
      md: mdWith([["B0", "alpha", "A", "pending"]], "status: draft\n"),
      status: { status: "active", sub_iterates: [{ id: "B0", slug: "alpha", status: "pending" }] },
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.status).toBe("active");
  });

  it("status is null for a legacy campaign with no status field, and for an invalid value", () => {
    seed("legacy", { md: mdWith([["B0", "alpha", "A", "pending"]]) });
    seed("bogus", { md: mdWith([["B0", "alpha", "A", "pending"]], "status: bananas\n") });
    const byId = Object.fromEntries(
      readCampaigns(campaignsDir, projectRoot).map((c) => [c.slug, c.status]),
    );
    expect(byId["legacy"]).toBeNull();
    expect(byId["bogus"]).toBeNull();
  });

  it("renders a status.json-only campaign (no campaign.md) using slug as title", () => {
    seed("c1", {
      status: {
        branch_strategy: "independent",
        sub_iterates: [
          { id: "B0", slug: "alpha", status: "complete" },
          { id: "B1", slug: "beta", status: "pending" },
        ],
      },
    });
    const [c] = readCampaigns(campaignsDir, projectRoot);
    expect(c.steps.map((s) => s.id)).toEqual(["B0", "B1"]);
    expect(c.steps[0].title).toBe("alpha");
    expect(c.branchStrategy).toBe("independent");
    expect(c.done).toBe(1);
  });
});
