/*
 * Org page — real-browser smoke (FR-01.71, iterate-2026-08-26-org-page).
 * Runs through the isolated stack (npm run test:e2e), which points HOME at a
 * fresh temp dir; `~/.claude/leads/org-chart.json` is therefore this file's
 * own fixture, seeded/removed per test — never the operator's real leads.
 *
 * Single-worker, sequential (playwright.config.ts: fullyParallel:false,
 * workers:1), so each test owning the SAME on-disk fixture (org-chart.json)
 * never races another test or spec file.
 *
 *   AC-6a/AC-6b — absent chart: nav entries hidden, /org shows "not
 *     installed", never a 404 or blank page.
 *   AC-7 — invalid chart: nav entries still present, /org shows a
 *     page-level error naming the failure.
 *   AC-1/AC-2/AC-3 — present, one lead: chart -> shared docs -> lead cards
 *     order; the five-block card; unmeasured fields read "not measured".
 *   AC-8 — charter Edit -> MarkdownEditorModal loads fresh content -> Save
 *     writes the file for real (through the browser-facing `/api/org/*`
 *     proxy, not a mock).
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const LEADS_ROOT = path.join(homedir(), ".claude", "leads");
const CHART_PATH = path.join(LEADS_ROOT, "org-chart.json");

function removeChart() {
  rmSync(LEADS_ROOT, { recursive: true, force: true });
}

function writeChart(leads: Record<string, unknown>) {
  mkdirSync(LEADS_ROOT, { recursive: true });
  writeFileSync(
    CHART_PATH,
    JSON.stringify({ version: 1, po: "sven", leads }),
    "utf8",
  );
}

function seedLead(leadId: string, opts: { charterBody?: string } = {}) {
  const dir = path.join(LEADS_ROOT, leadId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "charter.md"),
    opts.charterBody ?? "Handles acme onboarding and support triage.\n\nMore detail below.\n",
    "utf8",
  );
}

test.describe("Org page — absent chart (AC-6a/AC-6b)", () => {
  test.beforeEach(() => removeChart());
  test.afterEach(() => removeChart());

  test("hides the nav entries and shows the not-installed empty state on direct navigation", async ({ page }) => {
    await page.goto("/");
    // AC-6a: neither nav site offers "Org" when the chart is a confirmed 404.
    await expect(page.getByTestId("sidebar-inline").getByRole("link", { name: "Org", exact: true })).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-item-open:org")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // AC-6b: a direct /org visit still shows the not-installed state, never
    // a 404 or a blank/broken page.
    await page.goto("/org");
    await expect(page.getByTestId("org-page-not-installed")).toBeVisible();
    await expect(page.getByTestId("org-page-broken")).toHaveCount(0);
  });
});

test.describe("Org page — invalid chart (AC-7)", () => {
  test.beforeEach(() => {
    mkdirSync(LEADS_ROOT, { recursive: true });
    writeFileSync(CHART_PATH, "{ this is not valid json", "utf8");
  });
  test.afterEach(() => removeChart());

  test("keeps the nav entries and shows a page-level error naming the failure", async ({ page }) => {
    await page.goto("/");
    // AC-7: still offered on both nav sites — a non-404 failure must not
    // read as "not installed".
    await expect(page.getByTestId("sidebar-inline").getByRole("link", { name: "Org", exact: true })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-item-open:org")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/org");
    const broken = page.getByTestId("org-page-broken");
    await expect(broken).toBeVisible();
    await expect(broken).toContainText("org_chart_invalid");
    await expect(page.getByTestId("org-page-not-installed")).toHaveCount(0);
  });
});

test.describe("Org page — present, one lead (AC-1/AC-2/AC-3/AC-8)", () => {
  const LEAD_ID = "acme-lead";

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
    seedLead(LEAD_ID);
  });
  test.afterEach(() => removeChart());

  test("renders chart -> shared docs -> lead cards in that fixed order, five blocks per card, unmeasured fields read 'not measured'", async ({ page }) => {
    await page.goto("/org");
    await expect(page.getByTestId("org-page")).toBeVisible();

    const chart = page.getByTestId("org-chart");
    const sharedDocs = page.getByTestId("org-shared-docs");
    const leadList = page.getByTestId("org-lead-list");
    await expect(chart).toBeVisible();
    await expect(sharedDocs).toBeVisible();
    await expect(leadList).toBeVisible();

    // AC-1 — DOM order, not just presence.
    const order = await page.evaluate(() => {
      const ids = ["org-chart", "org-shared-docs", "org-lead-list"];
      const els = ids.map((id) => document.querySelector(`[data-testid="${id}"]`));
      return els.every((el, i) => i === 0 || (els[i - 1]!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    });
    expect(order).toBe(true);

    const card = page.getByTestId("lead-card").first();
    await expect(card).toHaveAttribute("data-lead-id", LEAD_ID);

    // AC-2 — five blocks in fixed order.
    const blocks = await card.locator("[data-block]").evaluateAll((els) => els.map((e) => e.getAttribute("data-block")));
    expect(blocks).toEqual(["header", "role", "now", "stats", "docs"]);

    // AC-3 — settled unmeasured fields read the literal text, never blank.
    await expect(card.getByTestId("lead-card-stats")).toContainText("not measured");
    await expect(card.getByTestId("lead-card-now")).toBeVisible();
  });

  test("Edit charter -> MarkdownEditorModal loads fresh content -> Save writes the file (AC-8)", async ({ page }) => {
    await page.goto("/org");
    const card = page.getByTestId("lead-card").first();
    await expect(card).toBeVisible();

    await card.getByTestId("lead-charter-edit").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeVisible();
    const surface = page.getByTestId("md-editor-surface");
    await expect(surface).toContainText("Handles acme onboarding");

    await surface.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" EDITED-BY-E2E");

    await page.getByTestId("md-editor-review").click();
    await expect(page.getByTestId("markdown-diff")).toBeVisible();
    await page.getByTestId("md-editor-save").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeHidden();

    // The authoritative artifact: the real file on disk, not a mock.
    await expect.poll(() => {
      if (!existsSync(path.join(LEADS_ROOT, LEAD_ID, "charter.md"))) return "";
      return readFileSync(path.join(LEADS_ROOT, LEAD_ID, "charter.md"), "utf8");
    }).toContain("EDITED-BY-E2E");
  });
});
