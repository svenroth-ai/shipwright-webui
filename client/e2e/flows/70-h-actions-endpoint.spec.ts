/*
 * Flow H — /api/external/projects/:id/actions endpoint contract (FR-03.07/08).
 *
 *   1. GET returns { actions, phases, preview, defaults, diagnostics }.
 *   2. actions[] contains 3 items with ids new-task / new-pipeline / new-iterate.
 *   3. phases[] contains at least the 9 Shipwright default phase ids.
 *   4. preview.enabled is a resolved boolean.
 *   5. New-task modal's Phase dropdown populates from phases[].
 *
 * Pure API + one UI assertion. No JSONL mutation.
 */

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { apiUrl } from "../helpers/env";
import { test, expect, type APIRequestContext } from "@playwright/test";

// A00 — was a pinned operator UUID; seeded via the real API in beforeEach.
let project: SeededProject;



async function fetchActions(request: APIRequestContext) {
  const resp = await request.get(
    apiUrl(`/api/external/projects/${project.projectId}/actions`),
  );
  expect(resp.ok(), `actions endpoint must be reachable — got ${resp.status()}`).toBeTruthy();
  return (await resp.json()) as {
    actions: Array<{ id: string; label: string; command_template?: string }>;
    phases: Array<{ id: string; label: string; color?: string }>;
    preview: { enabled: boolean };
    defaults: { autonomy?: string };
    diagnostics?: unknown;
  };
}

test.describe("Flow H — actions endpoint contract", () => {
  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "70-h-actions-endpoint" });
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("GET /actions returns the Shipwright default schema", async ({ request }) => {
    const body = await fetchActions(request);

    // Actions shape.
    expect(Array.isArray(body.actions)).toBe(true);
    expect(body.actions.length).toBeGreaterThanOrEqual(3);
    const ids = body.actions.map((a) => a.id);
    expect(ids).toContain("new-task");
    expect(ids).toContain("new-pipeline");
    expect(ids).toContain("new-iterate");
    // Each has a command_template.
    for (const a of body.actions) {
      expect.soft(typeof a.command_template).toBe("string");
    }

    // Phases shape.
    expect(Array.isArray(body.phases)).toBe(true);
    expect(body.phases.length).toBeGreaterThanOrEqual(9);
    const phaseIds = body.phases.map((p) => p.id);
    for (const required of [
      "project",
      "design",
      "plan",
      "build",
      "test",
      "deploy",
      "changelog",
      "compliance",
      "security",
    ]) {
      expect(phaseIds, `phases[] must include "${required}"`).toContain(required);
    }

    // Preview block resolved server-side.
    expect(typeof body.preview.enabled).toBe("boolean");

    // Defaults.autonomy is either "guided" or "autonomous".
    expect(["guided", "autonomous"]).toContain(body.defaults.autonomy);
  });

  test("NewTask modal phase select renders options from phases[]", async ({
    page,
    request,
  }) => {
    // Prime localStorage so resolvedProjectId is UAT 1.
    await setActiveProject(page, project.projectId);

    const body = await fetchActions(request);
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    await page.getByTestId("create-menu-primary").click();
    await expect(page.getByTestId("new-issue-modal-new-task")).toBeVisible();

    const phaseSelect = page.getByTestId("new-issue-phase-select");
    await expect(phaseSelect).toBeVisible();

    // iterate 3.8a: phase picker is a Radix DropdownMenu, not a native
    // <select>. Open the menu and count items by their per-phase testid
    // (new-issue-phase-option-<id>) instead of Array.from(el.options).
    await phaseSelect.click();
    await expect(page.getByTestId("new-issue-phase-menu")).toBeVisible();

    const renderedValues = await page
      .locator('[data-testid^="new-issue-phase-option-"]')
      .evaluateAll((els) =>
        els.map((el) => {
          const testid = el.getAttribute("data-testid") ?? "";
          return testid.replace(/^new-issue-phase-option-/, "");
        }),
      );
    const expectedValues = body.phases.map((p) => p.id);
    expect(renderedValues.sort()).toEqual(expectedValues.sort());
  });
});
