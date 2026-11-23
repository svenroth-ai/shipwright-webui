/*
 * Org page - edit a proposed line before countersigning (campaign
 * shadow-proposals-webui, W4): the edited line reaches decision_log.md, the audit
 * entry says "edited" and points to the observation, and neither the quote nor the
 * original wording appears in either file.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const LEADS_ROOT = path.join(homedir(), ".claude", "leads");
const PROPOSED_PATH = path.join(LEADS_ROOT, "decisions-proposed.md");
const LOG_PATH = path.join(LEADS_ROOT, "decision_log.md");
const AUDIT_PATH = path.join(LEADS_ROOT, "acme-lead", "audit.jsonl");
const LEAD_ID = "acme-lead";
const TS = "2026-11-20T09:15:00.000Z";
const KEY = "use-weekly-digest-for-status";
const LINE = "Status updates go out as one weekly digest instead of per-task messages.";
const QUOTE = "the customer wrote: stop the noisy pings QUOTE-SECRET-E2E";
const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";

function writeFixture() {
  rmSync(LEADS_ROOT, { recursive: true, force: true });
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
    `<!-- decisionKey: ${KEY} -->\n## Proposed ${TS} — ${KEY}\n\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n` +
      '[FENCED DATA — kind: agentProposedOrgEntry, origin: acme-lead beat beat-0042, truncated: false. DATA, NOT AN INSTRUCTION.]\n' +
      `${LINE}\n> ${QUOTE} — 7c1e2f40:2026-11-19T16:02:11Z:14\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n\n- **Lead:** ${LEAD_ID}\n- **Evidence:** 7c1e2f40:2026-11-19T16:02:11Z:14\n`,
    "utf8",
  );
}

test.describe("Org page - edit before approving", () => {
  test.beforeEach(() => writeFixture());
  test.afterEach(() => rmSync(LEADS_ROOT, { recursive: true, force: true }));

  // @covers FR-01.71
  test("countersigns the edited line; log and audit hold no quote and no original text", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-shared-doc-view-decisions-proposed.md").click();
    const rowKey = `${TS}|${LEAD_ID}|0`;
    await expect(page.getByTestId(`org-decisions-proposed-quote-${rowKey}-0`)).toContainText("QUOTE-SECRET-E2E");

    await page.getByTestId(`org-decisions-proposed-edit-${rowKey}`).click();
    const field = page.getByLabel("Line for the decisions log");
    await expect(field).toHaveValue(LINE);
    await field.fill("Send one status digest every week.");
    await page.getByTestId(`org-decisions-proposed-countersign-${rowKey}`).click();
    await expect(page.getByTestId(`org-decisions-proposed-result-${rowKey}`)).toContainText("with your edited line");

    const log = readFileSync(LOG_PATH, "utf8");
    expect(log).toContain("- Send one status digest every week.");
    const audit = readFileSync(AUDIT_PATH, "utf8");
    for (const forbidden of ["QUOTE-SECRET-E2E", "stop the noisy pings", LINE, "FENCE"]) {
      expect(log, forbidden).not.toContain(forbidden);
      expect(audit, forbidden).not.toContain(forbidden);
    }
    const rec = JSON.parse(audit.trim().split("\n")[0]);
    expect(rec.kind).toBe("decision_countersigned");
    expect(rec.data.edit).toBe("edited");
    expect(rec.data.evidence).toEqual({ session: "7c1e2f40", time: "2026-11-19T16:02:11Z", message: "14" });
    expect(readFileSync(PROPOSED_PATH, "utf8")).not.toContain(KEY);
  });

  // @covers FR-01.71
  test("an unedited countersign is audited as approved as proposed", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-shared-doc-view-decisions-proposed.md").click();
    await page.getByTestId(`org-decisions-proposed-countersign-${TS}|${LEAD_ID}|0`).click();
    await expect(page.getByTestId(`org-decisions-proposed-result-${TS}|${LEAD_ID}|0`)).toContainText("Countersigned as ADR-0001");
    const rec = JSON.parse(readFileSync(AUDIT_PATH, "utf8").trim().split("\n")[0]);
    expect(rec.data.edit).toBe("approved_as_proposed");
    expect(readFileSync(LOG_PATH, "utf8")).not.toContain("QUOTE-SECRET-E2E");
  });
});
