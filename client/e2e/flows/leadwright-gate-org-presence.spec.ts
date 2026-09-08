/*
 * Leadwright board affordances — org-chart presence gate
 * (iterate-2026-09-09-leadwright-gate-org-presence).
 *
 * Real-browser F0.5 surface for the useOrgChartPresence() gate added to the
 * board toolbar's Bot dropdown + BellDot toggle (LeadTagFilterToolbarGroup)
 * and the New-issue dialog's LeadwrightFieldsFragment. Component-level
 * Vitest coverage (LeadTagFilter.test.tsx, LeadwrightFields.test.tsx,
 * TaskCardLeadExpander.test.tsx) proves the conditional-render logic in
 * isolation; this spec proves it against a real running stack, matching the
 * FR-01.71 precedent's own E2E coverage (org-page.spec.ts).
 *
 *   AC (a) — confirmed absent (no `~/.claude/leads/org-chart.json`): the
 *     Bot dropdown, BellDot, and the New-dialog's lead fields are all gone.
 *   AC (b) — broken (invalid org-chart.json, NOT a 404): all three still
 *     render — fail visible, not fail hidden.
 *   AC (c) — a task carrying lead tags still shows its glyph/chip even
 *     while the gate above is hiding the toolbar controls.
 *
 * Uses the same real-filesystem fixture pattern as org-page.spec.ts —
 * `~/.claude/leads/org-chart.json` resolves under the isolated stack's
 * temporary HOME, never the operator's real leads.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

const LEADS_ROOT = path.join(homedir(), ".claude", "leads");
const CHART_PATH = path.join(LEADS_ROOT, "org-chart.json");

function removeChart() {
  rmSync(LEADS_ROOT, { recursive: true, force: true });
}

function writeInvalidChart() {
  mkdirSync(LEADS_ROOT, { recursive: true });
  writeFileSync(CHART_PATH, "{ this is not valid json", "utf8");
}

test.describe("Leadwright board affordances — org-chart presence gate", () => {
  let project: SeededProject | undefined;
  const taskIds: string[] = [];

  test.afterEach(async ({ request }) => {
    removeChart();
    for (const id of taskIds) await cleanupTask(request, id);
    taskIds.length = 0;
    if (project) await cleanupProject(request, project);
    project = undefined;
  });

  test.describe("absent — no org chart installed (AC a, c)", () => {
    test.beforeEach(() => removeChart());

    // @covers FR-04.11
    test("Bot dropdown and BellDot are hidden from the board toolbar; a lead-tagged task's chip still renders", async ({
      page,
      request,
    }) => {
      project = await seedProject(request, { name: "leadwright-gate-absent" });
      const leadTask = await seedTask(request, {
        title: "Lead task",
        projectId: project.projectId,
        tags: ["lead:src-1", "lead-wait:po"],
      });
      taskIds.push(leadTask.taskId);

      await setActiveProject(page, project.projectId);
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();
      await expect(page.getByTestId(`task-card-${leadTask.taskId}`)).toBeVisible();

      // AC (a): the filtering/authoring affordances are gone.
      await expect(page.getByTestId("board-lead-filter-menu-trigger")).toHaveCount(0);
      await expect(page.getByTestId("board-lead-wait-toggle")).toHaveCount(0);

      // AC (c): the report-only glyph/chip still renders — a task already
      // carries this tag whether or not an org chart exists.
      await expect(page.getByTestId(`task-card-lead-glyph-${leadTask.taskId}`)).toBeVisible();
      await page.getByTestId(`task-card-lead-expander-toggle-${leadTask.taskId}`).click();
      await expect(page.getByTestId(`task-card-lead-wait-${leadTask.taskId}`)).toBeVisible();
    });

    // @covers FR-04.11
    test("the New Task dialog's lead fields are hidden, but the dialog itself still works", async ({
      page,
      request,
    }) => {
      project = await seedProject(request, { name: "leadwright-gate-absent-dialog" });
      await setActiveProject(page, project.projectId);
      await page.goto("/");

      await page.getByTestId("create-menu-primary").click();
      const modal = page.getByTestId("new-issue-modal-new-task");
      await expect(modal).toBeVisible();

      await page.getByTestId("new-issue-more-options-toggle").click();
      await expect(page.getByTestId("new-issue-more-options-content")).toBeVisible();

      // AC (a): no leadwright fields at all.
      await expect(page.getByTestId("new-issue-lead-fields")).toHaveCount(0);
      await expect(page.getByTestId("new-issue-domain-input")).toHaveCount(0);
      await expect(page.getByTestId("new-issue-priority-select")).toHaveCount(0);

      // The rest of the dialog is unaffected — not a broken page.
      await expect(page.getByTestId("new-issue-title-input")).toBeVisible();
    });
  });

  test.describe("broken — invalid org-chart.json, not absent (AC b)", () => {
    test.beforeEach(() => writeInvalidChart());

    // @covers FR-04.11
    test("Bot dropdown, BellDot, and the New dialog's lead fields still render", async ({
      page,
      request,
    }) => {
      project = await seedProject(request, { name: "leadwright-gate-broken" });
      await setActiveProject(page, project.projectId);
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();

      await expect(page.getByTestId("board-lead-filter-menu-trigger")).toBeVisible();
      await expect(page.getByTestId("board-lead-wait-toggle")).toBeVisible();

      await page.getByTestId("create-menu-primary").click();
      await expect(page.getByTestId("new-issue-modal-new-task")).toBeVisible();
      await page.getByTestId("new-issue-more-options-toggle").click();
      await expect(page.getByTestId("new-issue-lead-fields")).toBeVisible();
    });
  });
});
