/*
 * Codextender integration (iterate-2026-09-23-codextender-webui-integration,
 * Spec/codextender-integration.md Part B). Proves the global "Codex
 * Integration Mode" setting (light vs codextender) actually reaches the New
 * Iterate modal's model-override fields and its catalog datalist through the
 * real stack — mirrors model-tier-defaults.spec.ts's Codex-runtime tests,
 * which cover the "light" mode fields this file does not re-assert.
 *
 * `/api/codextender-models` is intercepted with fixed responses, same
 * rationale as model-tier-defaults.spec.ts's `/api/codex-models` mocks: the
 * UI wiring is proven deterministically, independent of whether a
 * Codextender proxy is actually running on this machine. The real proxy
 * probe/parsing behavior is covered by server-side unit tests
 * (codextender-proxy-probe.test.ts).
 */

import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
  type SeededTask,
} from "../helpers/fixtures";
import { apiUrl } from "../helpers/env";
import { test, expect } from "@playwright/test";

let project: SeededProject;
let task: SeededTask;

test.describe("Codextender integration mode — New Iterate modal", () => {
  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "codextender-integration" });
    task = await seedTask(request, {
      title: "Codextender fixture task",
      cwd: project.path,
      projectId: project.projectId,
    });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    // Global settings are shared process-wide state (not per-task/per-project
    // fixtures) — restore to the default "light" mode so later spec files in
    // this same isolated-stack run don't inherit "codextender".
    await request.put(apiUrl("/api/settings"), {
      data: { codexIntegrationMode: "light" },
    });
    await cleanupTask(request, task?.taskId);
    await cleanupProject(request, project);
  });

  // @covers FR-01.74
  test("Codextender mode shows its own model-field placeholders and a live catalog datalist, no reviewer-identity block", async ({
    page,
    request,
  }) => {
    const settingsPut = await request.put(apiUrl("/api/settings"), {
      data: { codexIntegrationMode: "codextender", codexAvailability: "both" },
    });
    expect(settingsPut.ok()).toBeTruthy();

    await page.route("**/api/codextender-models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          models: [
            { slug: "sol", display_name: "sol" },
            { slug: "luna", display_name: "luna" },
          ],
        }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("task-card-" + task.taskId)).toBeVisible();
    await page.getByTestId("create-menu-caret").click();
    await page.getByTestId("create-menu-item-new-iterate").click();
    await expect(page.getByTestId("new-issue-modal-new-iterate")).toBeVisible();
    await page.getByTestId("runtime-codex").click();
    await page.getByTestId("new-issue-more-options-toggle").click();

    await expect(page.getByTestId("codex-reviewer-identity")).toHaveCount(0);

    const implementationField = page.getByTestId(
      "model-tier-override-codex-implementation-model",
    );
    const planReviewField = page.getByTestId("model-tier-override-codex-plan-review-model");
    const reviewField = page.getByTestId("model-tier-override-codex-review-model");
    await expect(implementationField).toBeVisible();
    await expect(implementationField).toHaveAttribute("placeholder", "e.g. sol");
    await expect(planReviewField).toHaveAttribute("placeholder", "e.g. sol");
    await expect(reviewField).toHaveAttribute("placeholder", "e.g. sol");

    const datalistId = await implementationField.getAttribute("list");
    expect(datalistId).toBeTruthy();
    const datalistOptions = page.locator(`[id="${datalistId}"] option`);
    await expect(datalistOptions).toHaveCount(2);
    await expect(datalistOptions.nth(0)).toHaveAttribute("value", "sol");
    await expect(datalistOptions.nth(1)).toHaveAttribute("value", "luna");
    await expect(page.getByTestId("codextender-model-catalog-status")).toHaveCount(0);

    // Free text is still accepted.
    await implementationField.fill("a-completely-custom-slug");
    await expect(implementationField).toHaveValue("a-completely-custom-slug");
  });

  test("Codextender mode falls back to static sol/astra suggestions and an unreachable-proxy caption when the catalog is empty", async ({
    page,
    request,
  }) => {
    const settingsPut = await request.put(apiUrl("/api/settings"), {
      data: { codexIntegrationMode: "codextender", codexAvailability: "both" },
    });
    expect(settingsPut.ok()).toBeTruthy();

    await page.route("**/api/codextender-models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "unavailable", models: [] }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("task-card-" + task.taskId)).toBeVisible();
    await page.getByTestId("create-menu-caret").click();
    await page.getByTestId("create-menu-item-new-iterate").click();
    await expect(page.getByTestId("new-issue-modal-new-iterate")).toBeVisible();
    await page.getByTestId("runtime-codex").click();
    await page.getByTestId("new-issue-more-options-toggle").click();

    const implementationField = page.getByTestId(
      "model-tier-override-codex-implementation-model",
    );
    await expect(implementationField).toBeVisible();

    const datalistId = await implementationField.getAttribute("list");
    const datalistOptions = page.locator(`[id="${datalistId}"] option`);
    await expect(datalistOptions).toHaveCount(2);
    await expect(datalistOptions.nth(0)).toHaveAttribute("value", "sol");
    await expect(datalistOptions.nth(1)).toHaveAttribute("value", "astra");

    await expect(page.getByTestId("codextender-model-catalog-status")).toContainText(
      "Codextender proxy isn't reachable",
    );

    await implementationField.fill("gpt-5.6-luna");
    await expect(implementationField).toHaveValue("gpt-5.6-luna");
  });

  test("Light mode (default) keeps the Codex Light placeholders — codexIntegrationMode is not stuck from a prior selection", async ({
    page,
  }) => {
    await page.route("**/api/codex-models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", models: [] }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("task-card-" + task.taskId)).toBeVisible();
    await page.getByTestId("create-menu-caret").click();
    await page.getByTestId("create-menu-item-new-iterate").click();
    await expect(page.getByTestId("new-issue-modal-new-iterate")).toBeVisible();
    await page.getByTestId("runtime-codex").click();
    await page.getByTestId("new-issue-more-options-toggle").click();

    const implementationField = page.getByTestId(
      "model-tier-override-codex-implementation-model",
    );
    await expect(implementationField).toBeVisible();
    await expect(implementationField).toHaveAttribute(
      "placeholder",
      "Suggested policy (AGENTS.md) — gpt-5.6-terra",
    );
    await expect(page.getByTestId("codextender-model-catalog-status")).toHaveCount(0);
  });
});
