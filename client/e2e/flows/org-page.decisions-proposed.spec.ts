/*
 * Org page — decisions-proposed.md tile + Countersign (FR-01.71 (F),
 * iterate-2026-09-06-decisions-proposed-countersign). Sibling of
 * org-page.spec.ts / org-page.register.spec.ts (kept separate to stay under
 * the 300-line convention) — same isolated-stack fixture pattern:
 * `~/.claude/leads/` is this file's own fixture root under the isolated
 * HOME, never the operator's real leads.
 *
 *   Empty file: the tile opens the dedicated modal, which shows "No
 *     decisions waiting." — never a blank modal.
 *   Populated file: the tile shows the parsed entry (lead, timestamp,
 *     evidence); clicking Countersign hits the real plain-surface
 *     `POST /api/org/decisions/countersign` proxy (not a mock, not the
 *     secret-gated route), shows the assigned ADR number, and actually
 *     moves the entry from decisions-proposed.md into decision_log.md on
 *     disk. The decision_log.md tile's own content updates too, proving the
 *     cross-tile cache invalidation this iterate adds.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const LEADS_ROOT = path.join(homedir(), ".claude", "leads");
const CHART_PATH = path.join(LEADS_ROOT, "org-chart.json");
const PROPOSED_PATH = path.join(LEADS_ROOT, "decisions-proposed.md");
const LOGGED_PATH = path.join(LEADS_ROOT, "decision_log.md");
const LEAD_ID = "acme-lead";

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
          charter_path: `${LEAD_ID}/charter.md`,
        },
      },
    }),
    "utf8",
  );
  mkdirSync(path.join(LEADS_ROOT, LEAD_ID), { recursive: true });
  writeFileSync(path.join(LEADS_ROOT, LEAD_ID, "charter.md"), "Handles acme onboarding.\n", "utf8");
}

test.describe("Org page — decisions-proposed.md tile, empty", () => {
  test.beforeEach(() => writeChart());
  test.afterEach(() => removeChart());

  // @covers FR-01.71
  test("an absent decisions-proposed.md shows 'No decisions waiting.', never a blank modal", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-shared-doc-view-decisions-proposed.md").click();

    const modal = page.getByTestId("org-decisions-proposed-modal");
    await expect(modal).toBeVisible();
    await expect(page.getByTestId("org-decisions-proposed-not-found")).toBeVisible();
  });
});

test.describe("Org page — decisions-proposed.md tile, one waiting decision", () => {
  test.beforeEach(() => {
    writeChart();
    writeFileSync(
      PROPOSED_PATH,
      "## [2026-08-17T09:00:00.000Z] acme-lead\n" +
        "- **Context:** should webui show waiting decisions?\n" +
        "- **Decision:** yes, via a fifth tile.\n" +
        "- **Evidence:** learnings.md#2026-08-16\n",
      "utf8",
    );
  });
  test.afterEach(() => removeChart());

  // @covers FR-01.71
  test("shows the parsed entry, and Countersign assigns an ADR number and moves it into decision_log.md for real", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-shared-doc-view-decisions-proposed.md").click();

    const modal = page.getByTestId("org-decisions-proposed-modal");
    await expect(modal).toBeVisible();
    const row = page.getByTestId(`org-decisions-proposed-entry-2026-08-17T09:00:00.000Z|${LEAD_ID}|0`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(LEAD_ID);
    await expect(row).toContainText("learnings.md#2026-08-16");

    await page.getByTestId(`org-decisions-proposed-countersign-2026-08-17T09:00:00.000Z|${LEAD_ID}|0`).click();
    await expect(row.getByText(/Countersigned as ADR-0001\./)).toBeVisible();

    // The authoritative artifact: the real files on disk, not a mock.
    await expect.poll(() => existsSync(LOGGED_PATH)).toBe(true);
    await expect.poll(() => readFileSync(LOGGED_PATH, "utf8")).toContain("ADR-0001 [2026-08-17T09:00:00.000Z] acme-lead");
    await expect.poll(() => readFileSync(PROPOSED_PATH, "utf8")).not.toContain("acme-lead");

    // Closing this modal and opening decision_log.md's own tile proves the
    // cross-tile React Query cache invalidation this iterate adds.
    await page.getByTestId("org-decisions-proposed-close").click();
    await expect(modal).toBeHidden();
    await page.getByTestId("org-shared-doc-view-decision_log.md").click();
    await expect(page.getByTestId("org-doc-viewer-modal")).toContainText("ADR-0001");
  });
});
