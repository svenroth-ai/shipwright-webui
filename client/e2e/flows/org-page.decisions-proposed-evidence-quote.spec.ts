/*
 * Org page — the quote carried on the Evidence line (`<pointer> — "<quote>"`), using the pinned leadwright
 * renderEntry sample as the fixture: the quote is shown in the entry view as plain text with its pointer.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { guardedLeadsRoot, removeLeadsPath } from "../helpers/leads-home-guard";

const LEADS_ROOT = guardedLeadsRoot();
const LEAD_ID = "acme-lead";
const TS2 = "2026-11-24T10:30:00.000Z";
const SAMPLE = path.resolve(import.meta.dirname, "../../../server/src/external/org/__tests__/fixtures/decisions-proposed-renderentry-sample.md");

test.describe("Org page — Evidence-line quote", () => {
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
  test("the quote on the Evidence line is shown in the entry view", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-shared-doc-view-decisions-proposed.md").click();
    const row = page.getByTestId(`org-decisions-proposed-entry-${TS2}|${LEAD_ID}|0`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId(`org-decisions-proposed-evidence-${TS2}|${LEAD_ID}|0`)).not.toContainText("unknown source");
    const quotes = row.getByRole("listitem").filter({ has: page.locator("blockquote") });
    await expect(quotes).toHaveCount(1);
    await expect(quotes.first()).toContainText("keep status updates as one weekly digest");
  });
});
