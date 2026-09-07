/*
 * org-chart-full-read.test.ts — a FULL-fidelity read of org-chart.json (all
 * PreflightLead fields), distinct from org-chart.ts's parseOrgChart (a
 * deliberately narrow 5-field structural mirror for the existing GET
 * /org-chart route). The verdict/commit routes need every field to build a
 * correct merged proposal (iterate-2026-09-07-leadwright-setup-wizard, W14).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readOrgChartFull } from "./org-chart-full-read.js";

describe("readOrgChartFull", () => {
  it("returns the full parsed org chart, all fields intact", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "org-chart-full-read-test-"));
    const orgChart = {
      version: 2,
      po: "sven",
      leads: {
        a: {
          name: "A",
          domain: "a",
          reports_to: null,
          manages: [],
          charter_path: "a/charter.md",
          learnings_path: "a/learnings.md",
          triggers: { cron: "0 * * * *", on: ["chat_session_ended"] },
          max_concurrent_tasks: 2,
          budget: { window: "rolling-7d", usd: null, pause_at: 0.85, hard_stop_at: 0.95 },
          projects: ["p1"],
          allowed_skills: ["/x"],
          allowed_tools: [],
          escalation_target: "po",
          model: "balanced",
          paused: false,
        },
      },
    };
    writeFileSync(path.join(dir, "org-chart.json"), JSON.stringify(orgChart));
    const result = readOrgChartFull({ leadsRoot: dir });
    expect(result).toEqual({ status: 200, body: orgChart });
    rmSync(dir, { recursive: true, force: true });
  });

  it("404s when org-chart.json does not exist (unlike daemon-config, this file is expected to already exist)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "org-chart-full-read-test-"));
    const result = readOrgChartFull({ leadsRoot: dir });
    expect(result.status).toBe(404);
    rmSync(dir, { recursive: true, force: true });
  });

  it("502s on malformed JSON", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "org-chart-full-read-test-"));
    writeFileSync(path.join(dir, "org-chart.json"), "not json{");
    const result = readOrgChartFull({ leadsRoot: dir });
    expect(result.status).toBe(502);
    rmSync(dir, { recursive: true, force: true });
  });
});
