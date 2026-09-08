/*
 * Lead Inventory page — real-browser smoke (iterate-2026-09-08-lead-
 * inventory-page). Same isolated-stack fixture pattern as
 * org-page.register.spec.ts: `~/.claude/leads/` is this file's own fixture
 * root under the harness's isolated HOME — never the operator's real
 * leads.
 *
 *   AC-1 — a lead with beats+steps renders both, band chips included.
 *   AC-2a — a beat carrying an unclaimed-effect audit entry renders a
 *     visible warning ON the beat.
 *   AC-4 — the authority panel renders per-band prose read from the
 *     charter, in the same order as the vocabulary.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const LEADS_ROOT = path.join(homedir(), ".claude", "leads");
const CHART_PATH = path.join(LEADS_ROOT, "org-chart.json");
const LEAD_ID = "acme-lead";
const BEAT_ID = "9f1c9e2a-2b1e-4a1e-9c1e-1a2b3c4d5e6f";

function removeChart() {
  rmSync(LEADS_ROOT, { recursive: true, force: true });
}

function writeChart() {
  mkdirSync(LEADS_ROOT, { recursive: true });
  writeFileSync(
    CHART_PATH,
    JSON.stringify({
      version: 1,
      po: "sven",
      leads: {
        [LEAD_ID]: {
          domain: "Acme",
          name: "Acme Lead",
          reports_to: null,
          manages: [],
          charter_path: "charter.md",
        },
      },
    }),
    "utf8",
  );
}

// A timestamp inside "last night" no matter when the suite runs: 03:00
// local on the calendar day whose 06:00 has not yet passed, else yesterday.
function withinLastNight(): string {
  const now = new Date();
  const today06 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0, 0);
  const anchor = now < today06 ? new Date(today06.getTime() - 86_400_000) : today06;
  return new Date(anchor.getTime() - 3 * 60 * 60_000).toISOString(); // anchor - 3h
}

test.describe("Lead Inventory page", () => {
  test.afterEach(() => removeChart());

  test("a lead with beats and steps renders both, band chips included, plus its authority panel (AC-1/AC-4)", async ({ page }) => {
    writeChart();
    const leadDir = path.join(LEADS_ROOT, LEAD_ID);
    mkdirSync(path.join(leadDir, "beats", BEAT_ID), { recursive: true });
    const startedAt = withinLastNight();
    writeFileSync(
      path.join(leadDir, "beat-register.json"),
      JSON.stringify({
        version: 1,
        entries: [{ sessionId: "s1", beatId: BEAT_ID, leadId: LEAD_ID, pid: 4242, startedAt, closedAt: startedAt }],
      }),
      "utf8",
    );
    writeFileSync(
      path.join(leadDir, "beats", BEAT_ID, "steps.jsonl"),
      `${JSON.stringify({ at: startedAt, band: "bugfix", summary: "fixed a typo in the README", effect: { kind: "none" } })}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(leadDir, "charter.md"),
      [
        "## Bugfix / bekannter Defekt",
        "Fix small, well-understood defects without asking.",
        "",
        "## Kleine Pflege",
        "Routine upkeep.",
        "",
        "## Neues Feature",
        "Ask first.",
        "",
        "## Architektur / Grundsatz",
        "Ask first.",
      ].join("\n"),
      "utf8",
    );

    await page.goto("/org/inventory");
    const section = page.getByTestId(`lead-inventory-section-${LEAD_ID}`);
    await expect(section).toBeVisible();
    await expect(section.getByTestId("authority-panel-completeness")).toHaveText("4/4 declared");
    await expect(section.getByTestId(`beat-card-${BEAT_ID}`)).toBeVisible();
    await expect(section.getByTestId(`beat-steps-${BEAT_ID}`)).toContainText("fixed a typo in the README");
    await expect(section.getByTestId("band-chip-bugfix").first()).toBeVisible();
  });

  test("a beat carrying an unclaimed-effect audit entry renders a visible warning ON the beat (AC-2a)", async ({ page }) => {
    writeChart();
    const leadDir = path.join(LEADS_ROOT, LEAD_ID);
    mkdirSync(leadDir, { recursive: true });
    const startedAt = withinLastNight();
    writeFileSync(
      path.join(leadDir, "beat-register.json"),
      JSON.stringify({
        version: 1,
        entries: [{ sessionId: "s1", beatId: BEAT_ID, leadId: LEAD_ID, pid: 4242, startedAt, closedAt: startedAt }],
      }),
      "utf8",
    );
    writeFileSync(
      path.join(leadDir, "audit.jsonl"),
      `${JSON.stringify({ ts: startedAt, kind: "beat_effect_not_claimed", lead_id: LEAD_ID, beat_id: BEAT_ID })}\n`,
      "utf8",
    );

    await page.goto("/org/inventory");
    const section = page.getByTestId(`lead-inventory-section-${LEAD_ID}`);
    await expect(section).toBeVisible();
    const warning = section.getByTestId("unclaimed-effect-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/effect no step accounts for/i);
  });
});
