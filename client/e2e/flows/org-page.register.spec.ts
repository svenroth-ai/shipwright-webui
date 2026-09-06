/*
 * Org page — staleness + beat-register release, real-browser smoke
 * (FR-04.06 / FR-04.41, iterate-2026-09-06-org-lead-staleness-register).
 * Sibling of org-page.spec.ts (kept separate to stay under the 300-line
 * convention) — same isolated-stack fixture pattern: `~/.claude/leads/` is
 * this file's own fixture root under the isolated HOME, never the
 * operator's real leads.
 *
 *   AC-1 — a last run well past 3x cadence reads "Overdue" on the real page,
 *     never "Resting".
 *   AC-4/FR-04.41 — an open beat-register entry shows a visible finding
 *     with a Release button; clicking it, confirming a reason, actually
 *     closes the register entry and appends an audit line on the real
 *     filesystem (through `POST /api/org/leads/:leadId/beat-register/
 *     release` — the plain-surface proxy, not the secret-gated route), and
 *     the finding disappears once the roster re-fetches.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const LEADS_ROOT = path.join(homedir(), ".claude", "leads");
const CHART_PATH = path.join(LEADS_ROOT, "org-chart.json");
const LEAD_ID = "acme-lead";

function removeChart() {
  rmSync(LEADS_ROOT, { recursive: true, force: true });
}

function writeChart(leads: Record<string, unknown>) {
  mkdirSync(LEADS_ROOT, { recursive: true });
  writeFileSync(CHART_PATH, JSON.stringify({ version: 1, po: "sven", leads }), "utf8");
}

test.describe("Org page — staleness (AC-1)", () => {
  test.beforeEach(() => {
    writeChart({
      [LEAD_ID]: {
        domain: "Acme",
        name: "Acme Lead",
        reports_to: null,
        manages: [],
        charter_path: `${LEAD_ID}/charter.md`,
        triggers: { cron: "*/5 * * * *" }, // every 5 min -> 15 min stale threshold
      },
    });
    mkdirSync(path.join(LEADS_ROOT, LEAD_ID), { recursive: true });
    writeFileSync(
      path.join(LEADS_ROOT, LEAD_ID, "last-run.json"),
      JSON.stringify({
        lastRunAt: new Date(Date.now() - 40 * 60_000).toISOString(),
        sessionId: "11111111-1111-1111-1111-111111111111",
      }),
      "utf8",
    );
  });
  test.afterEach(() => removeChart());

  test("a lead well past its cadence reads Overdue on the real page, never Resting", async ({ page }) => {
    await page.goto("/org");
    const card = page.getByTestId("lead-card").first();
    await expect(card).toBeVisible();
    const now = card.getByTestId("lead-now-resting");
    await expect(now).toContainText("Overdue");
    await expect(now).not.toContainText("Resting");
    await expect(card.getByTestId("lead-status-badge")).toHaveText("overdue");
  });
});

test.describe("Org page — beat-register release (AC-4/FR-04.41)", () => {
  const SESSION_ID = "22222222-2222-2222-2222-222222222222";

  test.beforeEach(() => {
    writeChart({
      [LEAD_ID]: {
        domain: "Acme",
        name: "Acme Lead",
        reports_to: null,
        manages: [],
        charter_path: `${LEAD_ID}/charter.md`,
      },
    });
    mkdirSync(path.join(LEADS_ROOT, LEAD_ID), { recursive: true });
    writeFileSync(
      path.join(LEADS_ROOT, LEAD_ID, "beat-register.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            sessionId: SESSION_ID,
            beatId: "beat-e2e-1",
            leadId: LEAD_ID,
            pid: 4242,
            startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
            closedAt: null,
          },
        ],
      }),
      "utf8",
    );
  });
  test.afterEach(() => removeChart());

  test("an open register entry shows a finding with a Release button; releasing it closes the entry for real", async ({ page }) => {
    await page.goto("/org");
    const card = page.getByTestId("lead-card").first();
    await expect(card).toBeVisible();

    const finding = card.getByTestId("lead-register-finding");
    await expect(finding).toBeVisible();
    await expect(finding).toContainText("beat-e2e-1");

    page.once("dialog", (dialog) => dialog.accept("verified dead via e2e"));
    await card.getByTestId("lead-register-release").click();

    // The finding disappears once the roster re-fetches (query invalidation).
    await expect(finding).toHaveCount(0);

    // The authoritative artifact: the real files on disk, not a mock.
    await expect.poll(() => {
      const registerPath = path.join(LEADS_ROOT, LEAD_ID, "beat-register.json");
      if (!existsSync(registerPath)) return null;
      const file = JSON.parse(readFileSync(registerPath, "utf8"));
      return file.entries[0].closedAt;
    }).not.toBeNull();

    const auditPath = path.join(LEADS_ROOT, LEAD_ID, "audit.jsonl");
    await expect.poll(() => existsSync(auditPath)).toBe(true);
    const auditLines = readFileSync(auditPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
    expect(auditLines).toHaveLength(1);
    expect(JSON.parse(auditLines[0]).kind).toBe("beat_recovered");
  });
});
