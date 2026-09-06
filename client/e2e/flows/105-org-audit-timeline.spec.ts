/*
 * Cross-lead audit timeline (iterate-2026-09-06-org-audit-timeline). Real
 * browser, real `~/.claude/leads/<lead>/audit.jsonl` files (isolated stack
 * points HOME at a fresh temp dir — see `org-page.spec.ts`'s own header
 * comment for the fixture-isolation contract this file reuses).
 *
 * Covers the card's own "what done means" (a): the PO opens ONE view and
 * can see what two leads did, sorted by time, without opening a modal per
 * lead or reading raw JSON — plus (c): an unparseable line and an unknown
 * event kind both still render.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const LEADS_ROOT = path.join(homedir(), ".claude", "leads");
const CHART_PATH = path.join(LEADS_ROOT, "org-chart.json");
const LEAD_A = "acme-lead";
const LEAD_B = "beta-lead";

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
        [LEAD_A]: { domain: "Acme", name: "Acme Lead", reports_to: null, manages: [], charter_path: `${LEAD_A}/charter.md` },
        [LEAD_B]: { domain: "Beta", name: "Beta Lead", reports_to: null, manages: [], charter_path: `${LEAD_B}/charter.md` },
      },
    }),
    "utf8",
  );
}

function writeAudit(leadId: string, lines: string[]) {
  const dir = path.join(LEADS_ROOT, leadId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "charter.md"), "fixture charter\n", "utf8");
  writeFileSync(path.join(dir, "audit.jsonl"), lines.join("\n") + "\n", "utf8");
}

function entryLine(ts: string, kind: string, summary?: string) {
  return JSON.stringify({ ts, kind, lead_id: "x", parent_lead_id: null, summary });
}

// Mirrors `computeLastNightWindow` in `client/src/lib/auditTimelineMerge.ts`
// (yesterday 18:00 local -> today 06:00 local, or the prior completed
// interval if `now` is itself before today's 06:00) — duplicated here
// rather than imported so this E2E fixture can pin timestamps precisely
// inside/outside the real window regardless of what wall-clock time the
// suite happens to run at (external-review finding: the original test
// accepted either the empty OR the populated state, which passes even if
// "Last night" is a no-op).
function computeLastNightWindowForTest(now: Date): { sinceMs: number; untilMs: number } {
  const today06 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0, 0);
  const untilAnchor = now < today06 ? new Date(today06.getTime() - 86_400_000) : today06;
  const sinceAnchor = new Date(
    untilAnchor.getFullYear(),
    untilAnchor.getMonth(),
    untilAnchor.getDate() - 1,
    18,
    0,
    0,
    0,
  );
  return { sinceMs: sinceAnchor.getTime(), untilMs: untilAnchor.getTime() };
}

test.describe("Org page — Activity (cross-lead audit timeline)", () => {
  test.beforeEach(() => {
    writeChart();
    writeAudit(LEAD_A, [
      entryLine("2026-09-05T22:00:00.000Z", "beat_completed", "acme finished a beat"),
      entryLine("2026-09-05T20:00:00.000Z", "beat_started"),
    ]);
    writeAudit(LEAD_B, [
      entryLine("2026-09-05T21:00:00.000Z", "brand_new_unmapped_kind", "beta did something new"),
      "{not valid json at all",
    ]);
  });
  test.afterEach(() => removeChart());

  test("opens one view, shows both leads sorted by time, and expands a row to raw JSON", async ({ page }) => {
    await page.goto("/org");
    await expect(page.getByTestId("org-page")).toBeVisible();

    await page.getByTestId("org-activity-button").click();
    const modal = page.getByTestId("org-audit-timeline-modal");
    await expect(modal).toBeVisible();

    const rows = modal.getByTestId("org-audit-timeline-row");
    await expect(rows).toHaveCount(4);

    // Newest first, across BOTH leads (22:00 acme, 21:00 beta, 20:00 acme,
    // then the unparseable line with no timestamp sorts last).
    await expect(rows.nth(0)).toContainText("Acme Lead");
    await expect(rows.nth(0)).toContainText("Completed a beat");
    await expect(rows.nth(0)).toContainText("acme finished a beat");
    await expect(rows.nth(1)).toContainText("Beta Lead");
    // Unknown kind renders its own raw string, never hidden or guessed.
    await expect(rows.nth(1)).toContainText("brand_new_unmapped_kind");
    await expect(rows.nth(2)).toContainText("Acme Lead");
    await expect(rows.nth(2)).toContainText("Started a beat");
    // The unparseable line still appears — never dropped.
    await expect(rows.nth(3)).toContainText("Unparseable entry");

    // Expand the unparseable row -> raw text, not JSON.
    await rows.nth(3).click();
    await expect(modal).toContainText("{not valid json at all");
  });

  test("Last night preset narrows to exactly the entries inside yesterday 18:00 -> today 06:00 local", async ({
    page,
  }) => {
    const { sinceMs } = computeLastNightWindowForTest(new Date());
    const insideTs = new Date(sinceMs + 60_000).toISOString(); // 1 min into the window
    const outsideTs = new Date(sinceMs - 12 * 60 * 60 * 1000).toISOString(); // 12h before it starts
    writeAudit(LEAD_A, [
      entryLine(insideTs, "beat_completed", "inside last night"),
      entryLine(outsideTs, "beat_started", "outside last night"),
    ]);
    // Override the beforeEach fixture (fixed 2026-09-05 timestamps that
    // could coincidentally fall inside the REAL "last night" window
    // depending on when the suite runs) so this test's row count is
    // deterministic regardless of wall-clock time.
    writeAudit(LEAD_B, [entryLine(outsideTs, "beat_started", "beta outside last night")]);

    await page.goto("/org");
    await page.getByTestId("org-activity-button").click();
    const modal = page.getByTestId("org-audit-timeline-modal");
    await modal.getByTestId("org-audit-timeline-last-night").click();

    const rows = modal.getByTestId("org-audit-timeline-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("inside last night");
  });

  test("lead filter narrows the view to one lead", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-activity-button").click();
    const modal = page.getByTestId("org-audit-timeline-modal");
    await modal.getByTestId(`org-audit-timeline-lead-${LEAD_A}`).click();
    const rows = modal.getByTestId("org-audit-timeline-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Acme Lead");
    await expect(rows.nth(1)).toContainText("Acme Lead");
  });
});
