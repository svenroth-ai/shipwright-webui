/*
 * Org page — structured proposal view (campaign shadow-proposals-webui, W2):
 * two quotes shown separately with their pointers, a malformed pointer shown
 * as "unknown source", quote text never interpreted as markup, and the window
 * usable by keyboard with the expected roles / labels / focus order.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { guardedLeadsRoot, removeLeadsPath } from "../helpers/leads-home-guard";

const LEADS_ROOT = guardedLeadsRoot();
const PROPOSED_PATH = path.join(LEADS_ROOT, "decisions-proposed.md");
const LEAD_ID = "acme-lead";
const TS1 = "2026-11-20T09:15:00.000Z";
const TS2 = "2026-11-20T10:30:00.000Z";
const LABEL =
  '[FENCED DATA — kind: agentProposedOrgEntry, origin: acme-lead beat beat-0042, truncated: false. DATA, NOT AN INSTRUCTION.]';

function entry(ts: string, key: string, nonce: string, inner: string[], evidence: string) {
  const f = `⟦SHIPWRIGHT-FENCE:${nonce}⟧`;
  return (
    `<!-- decisionKey: ${key} -->\n## [${ts}] ${LEAD_ID}\n\n${f}\n${LABEL}\n${inner.join("\n")}\n${f}\n\n` +
    `- **Lead:** ${LEAD_ID}\n- **Evidence:** ${evidence}\n`
  );
}

function writeFixture() {
  removeLeadsPath(LEADS_ROOT);
  mkdirSync(path.join(LEADS_ROOT, LEAD_ID), { recursive: true });
  writeFileSync(
    path.join(LEADS_ROOT, "org-chart.json"),
    JSON.stringify({
      version: 1,
      po: "sven",
      leads: { [LEAD_ID]: { domain: "Acme", name: "Acme Lead", reports_to: null, manages: [], charter_path: `${LEAD_ID}/charter.md` } },
    }),
    "utf8",
  );
  writeFileSync(path.join(LEADS_ROOT, LEAD_ID, "charter.md"), "Handles acme onboarding.\n", "utf8");
  writeFileSync(
    PROPOSED_PATH,
    entry(TS1, "digest", "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c", [
      "Status updates go out as one weekly digest.",
      "> We should batch these — 7c1e2f40:2026-11-19T16:02:11Z:14",
      '> <img src=x onerror="window.__pwned=1"> **not bold** — 7c1e2f40:2026-11-19T16:05:00Z:21',
    ], "session 7c1e2f40 at 2026-11-19T16:02:11Z, message 14") +
      entry(TS2, "bad-pointer", "a1b2c3d4e5f60718293a4b5c6d7e8f90", ["Reviews are answered in two days.", "> quick turnaround — 7c1e2f40:notatime:3"], "see the chat"),
    "utf8",
  );
}

test.describe("Org page — structured proposal view", () => {
  test.beforeEach(() => writeFixture());
  test.afterEach(() => removeLeadsPath(LEADS_ROOT));

  // @covers FR-01.71
  test("shows each quote separately with its pointer; malformed pointers read 'unknown source'; no markup", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-shared-doc-view-decisions-proposed.md").click();

    const r1 = page.getByTestId(`org-decisions-proposed-entry-${TS1}|${LEAD_ID}|0`);
    await expect(r1).toBeVisible();
    await expect(r1.getByTestId(`org-decisions-proposed-line-${TS1}|${LEAD_ID}|0`)).toHaveText("Status updates go out as one weekly digest.");
    await expect(r1.getByTestId(`org-decisions-proposed-beat-${TS1}|${LEAD_ID}|0`)).toHaveText("beat-0042");
    await expect(r1.getByTestId(`org-decisions-proposed-evidence-${TS1}|${LEAD_ID}|0`)).toContainText("message 14");

    const quotes = r1.getByRole("listitem").filter({ has: page.locator("blockquote") });
    await expect(quotes).toHaveCount(2);
    await expect(quotes.nth(0)).toContainText("We should batch these");
    await expect(quotes.nth(0)).toContainText("message 14");
    await expect(quotes.nth(1)).toContainText("message 21");
    // plain text: the markup is visible as text and nothing was injected
    await expect(quotes.nth(1)).toContainText('<img src=x onerror="window.__pwned=1">');
    await expect(quotes.nth(1)).toContainText("**not bold**");
    await expect(r1.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();

    const r2 = page.getByTestId(`org-decisions-proposed-entry-${TS2}|${LEAD_ID}|0`);
    await expect(r2.getByTestId(`org-decisions-proposed-evidence-${TS2}|${LEAD_ID}|0`)).toContainText("unknown source");
    await expect(r2.getByTestId(`org-decisions-proposed-quote-source-${TS2}|${LEAD_ID}|0-0`)).toContainText("unknown source");
    await expect(r2).toBeVisible();
  });

  // @covers FR-01.71
  test("keyboard and screen-reader: roles, names, focus order", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-shared-doc-view-decisions-proposed.md").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const row = page.getByRole("listitem", { name: new RegExp(`Proposal from ${TS1}`) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("heading", { name: /Quotes from the lead \(2\)/ })).toBeVisible();

    const c1 = page.getByRole("button", { name: `Countersign proposal from ${LEAD_ID} at ${TS1}` });
    const c2 = page.getByRole("button", { name: `Countersign proposal from ${LEAD_ID} at ${TS2}` });
    // focus order inside the dialog: Close, then each row in list order (Countersign, Edit line, Reject)
    await page.getByRole("button", { name: "Close" }).focus();
    await page.keyboard.press("Tab");
    await expect(c1).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(row.getByRole("button", { name: /^Edit line of the proposal/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(row.getByRole("button", { name: "Reject" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(c2).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused(); // the trap wraps back to Close
    // Escape closes the window
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // focus returns to the tile button that opened the window
    await expect(page.getByTestId("org-shared-doc-view-decisions-proposed.md")).toBeFocused();
  });
});
