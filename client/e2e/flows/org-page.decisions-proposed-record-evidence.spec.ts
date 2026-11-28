/*
 * Org page — evidence that cites the operator's own words (leadwright #153): a reject reason (`rejected:`) and a
 * countersign note (`decision:`), resolved by the server against decisions-rejected.md / decision_log.md, plus the
 * learning label. A citation whose record is missing fails closed: a notice, and the quote is not shown as the
 * operator's words. The decision log is the pinned countersigned sample (written by the real countersign).
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { guardedLeadsRoot, removeLeadsPath } from "../helpers/leads-home-guard";

const LEADS_ROOT = guardedLeadsRoot();
const LEAD_ID = "acme-lead";
const FENCE = "⟦SHIPWRIGHT-FENCE:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd⟧";
const LOG_SAMPLE = path.resolve(import.meta.dirname, "../../../server/src/external/org/__tests__/fixtures/decision-log-countersigned-sample.md");
const REASON = "Too vague: say who reads the digest, and in which channel.";
const REJECTED = `# Rejected decisions\n\n## Rejected [2026-11-20T09:15:00.000Z] ${LEAD_ID}\n<!-- decisionKey: use-weekly-digest -->\n\n- Reason: the lead's own line, never the operator's words\n- Rejected: 2026-11-28T10:00:00.000Z\n- Reason: ${REASON}\n\n`;

function entry(key: string, ts: string, line: string, evidence: string): string {
  return `<!-- decisionKey: ${key} -->\n## [${ts}] ${LEAD_ID}\n\n${FENCE}\n[FENCED DATA — kind: agentProposedOrgEntry, origin: ${LEAD_ID} beat beat-0060, truncated: false. DATA.]\n${line}\n${FENCE}\n\n- **Lead:** ${LEAD_ID}\n- **Evidence:** ${evidence}\n`;
}

const TS1 = "2026-11-28T11:00:00.000Z";
const TS2 = "2026-11-28T11:10:00.000Z";
const TS3 = "2026-11-28T11:20:00.000Z";

test.describe("Org page — the operator's own words as evidence", () => {
  test.beforeEach(() => {
    removeLeadsPath(LEADS_ROOT);
    mkdirSync(path.join(LEADS_ROOT, LEAD_ID), { recursive: true });
    writeFileSync(
      path.join(LEADS_ROOT, "org-chart.json"),
      JSON.stringify({ version: 1, po: "sven", leads: { [LEAD_ID]: { domain: "Acme", name: "Acme Lead", reports_to: null, manages: [], charter_path: `${LEAD_ID}/charter.md` } } }),
      "utf8",
    );
    writeFileSync(path.join(LEADS_ROOT, LEAD_ID, "charter.md"), "Handles acme onboarding.\n", "utf8");
    writeFileSync(path.join(LEADS_ROOT, "decision_log.md"), readFileSync(LOG_SAMPLE, "utf8").replace(/\r\n/g, "\n"), "utf8");
    writeFileSync(path.join(LEADS_ROOT, "decisions-rejected.md"), REJECTED, "utf8");
    writeFileSync(
      path.join(LEADS_ROOT, "decisions-proposed.md"),
      entry("learning.name-the-reader", TS1, "Learning (all leads, importance 4, pinned): Every status update names its reader first.", `rejected:2026-11-20T09:15:00.000Z/${LEAD_ID} — "say who reads the digest, and in which channel"`) +
        entry("learning.short-reviews", TS2, "Learning (this lead, importance 2): Reviews stay short and name their owner.", 'decision:ADR-0002 — "keep it short and name the owner"') +
        entry("learning.ghost", TS3, "A rule citing a rejection that is not on record.", `rejected:2026-01-01T00:00:00.000Z/${LEAD_ID} — "this quote has no record behind it at all"`),
      "utf8",
    );
  });
  test.afterEach(() => removeLeadsPath(LEADS_ROOT));

  // @covers FR-01.71
  test("confirmed citations show the operator's words; a missing record fails closed; the label is shown", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-shared-doc-view-decisions-proposed.md").click();

    const k1 = `${TS1}|${LEAD_ID}|0`;
    const r1 = page.getByTestId(`org-decisions-proposed-entry-${k1}`);
    await expect(r1.getByTestId(`org-decisions-proposed-evidence-${k1}`)).toHaveText(`your reason for rejecting ${LEAD_ID}'s proposal of 2026-11-20T09:15:00.000Z`);
    const w1 = r1.getByTestId(`org-decisions-proposed-operator-words-${k1}`);
    await expect(w1).toHaveAttribute("data-state", "confirmed");
    await expect(r1.getByTestId(`org-decisions-proposed-operator-words-${k1}-words`)).toHaveText(REASON);
    await expect(w1).not.toContainText("the lead's own line");
    await expect(r1.getByTestId(`org-decisions-proposed-learning-${k1}-scope`)).toHaveText("for all leads");
    await expect(r1.getByTestId(`org-decisions-proposed-learning-${k1}-importance`)).toHaveText("importance 4 of 5");
    await expect(r1.getByTestId(`org-decisions-proposed-learning-${k1}-pinned`)).toBeVisible();

    const k2 = `${TS2}|${LEAD_ID}|0`;
    const r2 = page.getByTestId(`org-decisions-proposed-entry-${k2}`);
    await expect(r2.getByTestId(`org-decisions-proposed-evidence-${k2}`)).toHaveText("your note on ADR-0002");
    await expect(r2.getByTestId(`org-decisions-proposed-operator-words-${k2}`)).toHaveAttribute("data-state", "confirmed");
    await expect(r2.getByTestId(`org-decisions-proposed-operator-words-${k2}-words`)).toHaveText("Agreed in the Monday sync, keep it short and name the owner.");
    await expect(r2.getByTestId(`org-decisions-proposed-learning-${k2}-scope`)).toHaveText("for this lead only");

    const k3 = `${TS3}|${LEAD_ID}|0`;
    const r3 = page.getByTestId(`org-decisions-proposed-entry-${k3}`);
    const w3 = r3.getByTestId(`org-decisions-proposed-operator-words-${k3}`);
    await expect(w3).toHaveAttribute("data-state", "no_words");
    await expect(w3).toContainText("The lead's quote is not shown as your words.");
    await expect(r3).not.toContainText("this quote has no record behind it at all");
    await expect(r3.getByTestId(`org-decisions-proposed-learning-${k3}`)).toContainText("counts as this lead, importance 3");

    await page.screenshot({ path: "test-results/org-record-evidence.png", fullPage: true });
  });
});
