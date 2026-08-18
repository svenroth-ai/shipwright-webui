import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { readLeadOrgInfo } from "../org-chart-lookup.js";

describe("readLeadOrgInfo", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-chart-lookup-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function writeChart(chart: unknown): void {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(chart), "utf8");
  }

  it("reports org_chart_missing when org-chart.json doesn't exist", () => {
    const result = readLeadOrgInfo(leadsRoot, "acme-lead");
    expect(result).toEqual({ ok: false, reason: "org_chart_missing" });
  });

  it("reports org_chart_invalid on malformed JSON", () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), "{not json", "utf8");
    const result = readLeadOrgInfo(leadsRoot, "acme-lead");
    expect(result).toEqual({ ok: false, reason: "org_chart_invalid" });
  });

  it("reports lead_not_found when the leadId key is missing", () => {
    writeChart({ leads: { "other-lead": { triggers: { cron: "0 9 * * *" }, reports_to: null } } });
    const result = readLeadOrgInfo(leadsRoot, "acme-lead");
    expect(result).toEqual({ ok: false, reason: "lead_not_found" });
  });

  it("reports org_chart_invalid when the lead is present but triggers.cron is missing", () => {
    writeChart({ leads: { "acme-lead": { reports_to: null } } });
    const result = readLeadOrgInfo(leadsRoot, "acme-lead");
    expect(result).toEqual({ ok: false, reason: "org_chart_invalid" });
  });

  it("returns the cron + reportsTo for a well-formed lookup", () => {
    writeChart({
      leads: {
        "acme-lead": { triggers: { cron: "*/15 * * * *" }, reports_to: "parent-lead" },
      },
    });
    const result = readLeadOrgInfo(leadsRoot, "acme-lead");
    expect(result).toEqual({ ok: true, cron: "*/15 * * * *", reportsTo: "parent-lead" });
  });

  it("returns reportsTo:null when reports_to is null", () => {
    writeChart({
      leads: { "acme-lead": { triggers: { cron: "0 9 * * *" }, reports_to: null } },
    });
    const result = readLeadOrgInfo(leadsRoot, "acme-lead");
    expect(result).toEqual({ ok: true, cron: "0 9 * * *", reportsTo: null });
  });

  it("a DIFFERENT lead's malformed entry does not break this lead's lookup (decision 4)", () => {
    writeChart({
      leads: {
        "acme-lead": { triggers: { cron: "0 9 * * *" }, reports_to: null },
        "broken-lead": { triggers: "not-an-object" },
      },
    });
    const result = readLeadOrgInfo(leadsRoot, "acme-lead");
    expect(result).toEqual({ ok: true, cron: "0 9 * * *", reportsTo: null });
  });

  it("reports org_chart_symlink for a symlinked org-chart.json (injected ELOOP open)", () => {
    writeChart({ leads: { "acme-lead": { triggers: { cron: "0 9 * * *" }, reports_to: null } } });
    const fakeOpen = (() => {
      const err = new Error("ELOOP: too many symbolic links encountered") as NodeJS.ErrnoException;
      err.code = "ELOOP";
      throw err;
    }) as unknown as typeof import("node:fs").openSync;
    const result = readLeadOrgInfo(leadsRoot, "acme-lead", fakeOpen);
    expect(result).toEqual({ ok: false, reason: "org_chart_symlink" });
  });
});
