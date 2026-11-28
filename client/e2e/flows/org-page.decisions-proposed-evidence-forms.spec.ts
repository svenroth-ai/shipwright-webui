/*
 * Org page — the file-line and journal-event evidence pointers (leadwright #149), using the pinned leadwright
 * renderEntry evidence-forms sample as the fixture: each source is shown readably as plain text (never a link), with
 * its quote shown first. (The countersign copy guard for these forms is covered server-side in
 * `evidence-pointer-forms.test.ts`.)
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { guardedLeadsRoot, removeLeadsPath } from "../helpers/leads-home-guard";

const LEADS_ROOT = guardedLeadsRoot();
const LEAD_ID = "acme-lead";
const TS1 = "2026-11-27T09:15:00.000Z";
const TS2 = "2026-11-27T10:30:00.000Z";
const SAMPLE = path.resolve(import.meta.dirname, "../../../server/src/external/org/__tests__/fixtures/decisions-proposed-renderentry-evidence-forms-sample.md");

test.describe("Org page — file-line and journal-event evidence", () => {
  test.beforeEach(() => {
    removeLeadsPath(LEADS_ROOT);
    mkdirSync(path.join(LEADS_ROOT, LEAD_ID), { recursive: true });
    writeFileSync(
      path.join(LEADS_ROOT, "org-chart.json"),
      JSON.stringify({ version: 1, po: "sven", leads: { [LEAD_ID]: { domain: "Acme", name: "Acme Lead", reports_to: null, manages: [], charter_path: `${LEAD_ID}/charter.md` } } }),
      "utf8",
    );
    writeFileSync(path.join(LEADS_ROOT, LEAD_ID, "charter.md"), "Handles acme onboarding.\n", "utf8");
    writeFileSync(path.join(LEADS_ROOT, "decisions-proposed.md"), readFileSync(SAMPLE, "utf8").replace(/\r\n/g, "\n"), "utf8");
  });
  test.afterEach(() => removeLeadsPath(LEADS_ROOT));

  // @covers FR-01.71
  test("each source is shown readably as plain text with its quote", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-shared-doc-view-decisions-proposed.md").click();
    const cases: Array<[string, string, string]> = [
      [TS1, "dinovo GmbH · Projekte/Q4 Plan.md · line 3", "answered within two working days"],
      [TS2, "event evt-2026-11-27-001", "release branch be merged before the freeze"],
    ];
    for (const [ts, label, quote] of cases) {
      const key = `${ts}|${LEAD_ID}|0`;
      const row = page.getByTestId(`org-decisions-proposed-entry-${key}`);
      await expect(row).toBeVisible();
      const evidence = row.getByTestId(`org-decisions-proposed-evidence-${key}`);
      await expect(evidence).toHaveText(label);
      await expect(evidence.locator("a")).toHaveCount(0);
      const quotes = row.getByRole("listitem").filter({ has: page.locator("blockquote") });
      await expect(quotes).toHaveCount(1);
      await expect(quotes.first().locator("blockquote")).toHaveText(quote);
      await expect(quotes.first()).toContainText(label);
    }
  });
});
