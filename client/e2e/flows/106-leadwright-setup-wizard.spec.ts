/*
 * Leadwright lead-setup wizard (W14, iterate-2026-09-07-leadwright-setup-
 * wizard). Real-browser smoke: walking all 7 questions using only selects
 * (never typing a project id, path, or action id) reaches the verdict
 * step, and — since this E2E stack has no `leadwrightCheckoutRoot`
 * configured — the "leadwright not reachable" blocking state renders and
 * Finish stays disabled (Done criterion (e)). A real leadwright checkout is
 * out of scope for this harness; the verdict/commit success path is
 * covered by the server-side unit + integration tests instead.
 */
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

// Mirrors `105-org-audit-timeline.spec.ts`'s fixture-isolation contract: the
// isolated E2E stack points HOME at a fresh temp dir, so `~/.claude/leads`
// resolves per-worker rather than clobbering a real leads directory.
const LEADS_ROOT = path.join(homedir(), ".claude", "leads");
const CHART_PATH = path.join(LEADS_ROOT, "org-chart.json");

function writeChart() {
  mkdirSync(LEADS_ROOT, { recursive: true });
  writeFileSync(CHART_PATH, JSON.stringify({ version: 2, po: "sven", leads: {} }), "utf8");
}

function removeChart() {
  rmSync(LEADS_ROOT, { recursive: true, force: true });
}

const ACTIONS_JSON = {
  phases: [{ id: "build", label: "Build" }],
  actions: [
    {
      id: "run-content-orchestrator",
      label: "Content Orchestrator",
      kind: "external_launch",
      command_template: 'cd "p" && claude --session-id {task.uuid} /content-orchestrator',
      slash_command: "/content-orchestrator",
    },
  ],
  defaults: { autonomy: "guided" },
  preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
  diagnostics: [],
};

test.describe("Leadwright lead-setup wizard", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    writeChart();
    project = await seedProject(request, { name: "106-leadwright-setup-wizard", adopted: true });
    const upload = await request.post(`/api/projects/${project.projectId}/actions-upload`, {
      data: ACTIONS_JSON,
    });
    if (!upload.ok()) {
      throw new Error(`actions-upload seed failed: ${upload.status()} ${await upload.text()}`);
    }
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
    removeChart();
  });

  test("Org page's New lead CTA opens the wizard at question 1", async ({ page }) => {
    await page.goto("/org");
    await page.getByTestId("org-new-lead-button").click();
    await expect(page).toHaveURL(/\/org\/new-lead$/);
    await expect(page.getByTestId("lead-setup-wizard")).toBeVisible();
    await expect(page.getByTestId("lead-wizard-step-name-id-domain")).toBeVisible();
  });

  test("all 7 questions are answered without typing a project id, path, or action id, reaching the verdict step", async ({
    page,
  }) => {
    await page.goto("/org/new-lead");

    // Q1 — name, lead id, domain (create a fresh domain via the shared select).
    await page.getByTestId("lead-wizard-name-input").fill("E2E Billing Lead");
    await page.getByTestId("lead-wizard-id-input").fill("e2e-billing-lead");
    await page.getByTestId("lead-wizard-domain-select").selectOption("__create_new__");
    await page.getByTestId("lead-wizard-domain-select-create-input").fill("e2e-billing");
    await page.getByTestId("lead-wizard-domain-select-create-confirm").click();
    await page.getByTestId("lead-wizard-next").click();

    // Q2 — project: click a card, never type an id or path.
    await expect(page.getByTestId("lead-wizard-step-project")).toBeVisible();
    await page.getByTestId("lead-wizard-project-opt").first().click();
    await page.getByTestId("lead-wizard-next").click();

    // Q3 — action: click a card, never type an action id.
    await expect(page.getByTestId("lead-wizard-step-action")).toBeVisible();
    await page.getByTestId("lead-wizard-action-opt").first().click();
    await page.getByTestId("lead-wizard-next").click();

    // Q4 — cadence.
    await expect(page.getByTestId("lead-wizard-step-cadence")).toBeVisible();
    await page.getByTestId("lead-wizard-cadence-opt").first().click();
    await page.getByTestId("lead-wizard-next").click();

    // Q5 — budget.
    await expect(page.getByTestId("lead-wizard-step-budget")).toBeVisible();
    await page.getByTestId("lead-wizard-budget-usd").fill("50");
    await page.getByTestId("lead-wizard-next").click();

    // Q6 — authority (write into the first fixed band).
    await expect(page.getByTestId("lead-wizard-step-authority")).toBeVisible();
    await page.getByTestId("lead-wizard-authority-band").first().fill("Merge routine fixes.");
    await page.getByTestId("lead-wizard-next").click();

    // Q7 — escalation (the PO, seeded on the fixture org chart).
    await expect(page.getByTestId("lead-wizard-step-escalation")).toBeVisible();
    await page.getByTestId("lead-wizard-escalation-opt").first().click();
    await page.getByTestId("lead-wizard-next").click();
    await expect(page.getByTestId("lead-wizard-step-verdict")).toBeVisible();
  });

  test("no leadwright checkout configured blocks Finish (Done criterion (e))", async ({ page }) => {
    await page.goto("/org/new-lead");

    await page.getByTestId("lead-wizard-name-input").fill("E2E Blocked Lead");
    await page.getByTestId("lead-wizard-id-input").fill("e2e-blocked-lead");
    await page.getByTestId("lead-wizard-domain-select").selectOption("__create_new__");
    await page.getByTestId("lead-wizard-domain-select-create-input").fill("e2e-blocked");
    await page.getByTestId("lead-wizard-domain-select-create-confirm").click();
    await page.getByTestId("lead-wizard-next").click();

    await page.getByTestId("lead-wizard-project-opt").first().click();
    await page.getByTestId("lead-wizard-next").click();

    await page.getByTestId("lead-wizard-action-opt").first().click();
    await page.getByTestId("lead-wizard-next").click();

    await page.getByTestId("lead-wizard-cadence-opt").first().click();
    await page.getByTestId("lead-wizard-next").click();

    await page.getByTestId("lead-wizard-budget-usd").fill("50");
    await page.getByTestId("lead-wizard-next").click();

    await page.getByTestId("lead-wizard-authority-band").first().fill("Merge routine fixes.");
    await page.getByTestId("lead-wizard-next").click();

    await page.getByTestId("lead-wizard-escalation-opt").first().click();
    await page.getByTestId("lead-wizard-next").click();

    await expect(page.getByTestId("lead-wizard-step-verdict")).toBeVisible();
    await expect(page.getByTestId("lead-wizard-leadwright-unreachable")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lead-wizard-finish")).toBeDisabled();
  });
});
