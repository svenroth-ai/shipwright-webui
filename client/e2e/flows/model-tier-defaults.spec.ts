/*
 * Model-tier defaults are framework-owned project configuration. They are
 * visible only at an Iterate launch decision, never as task-card metadata.
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

test.describe("Model-tier defaults", () => {
  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, {
      name: "model-tier-defaults",
      adopted: true,
      files: {
        "shipwright_model_config.json": JSON.stringify({
          plan_review: "opus",
          review: "opus",
          finalization: "sonnet",
          execution: "sonnet",
        }),
      },
    });
    task = await seedTask(request, {
      title: "No model-tier card fixture",
      cwd: project.path,
      projectId: project.projectId,
    });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, task?.taskId);
    await cleanupProject(request, project);
  });

  test("shows project defaults only at Iterate start and sends an explicitly selected supported override", async ({
    page,
    request,
  }) => {
    let pageModelConfigRequests = 0;
    page.on("request", (outgoing) => {
      if (outgoing.url().includes(`/api/external/projects/${project.projectId}/model-config`)) {
        pageModelConfigRequests += 1;
      }
    });
    const response = await request.get(
      apiUrl(`/api/external/projects/${project.projectId}/model-config`),
    );
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      tiers: Record<string, { tier: string; source: string }>;
    };
    expect(body.tiers).toMatchObject({
      plan_review: { tier: "opus", source: "project_config" },
      review: { tier: "opus", source: "project_config" },
      finalization: { tier: "sonnet", source: "project_config" },
      execution: { tier: "sonnet", source: "project_config" },
    });

    for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
      const write = await request.fetch(
        apiUrl(`/api/external/projects/${project.projectId}/model-config`),
        { method },
      );
      expect(write.status(), `${method} must not expose a config write`).toBe(404);
    }

    await page.goto("/");
    await expect(page.getByTestId(`task-card-${task.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-model-tiers-${project.projectId}`)).toHaveCount(0);
    expect(pageModelConfigRequests).toBe(0);

    await page.getByTestId("create-menu-caret").click();
    await page.getByTestId("create-menu-item-new-task").click();
    await page.getByTestId("new-issue-phase-select").click();
    await page.getByTestId("new-issue-phase-option-plan").click();
    await page.getByTestId("new-issue-more-options-toggle").click();
    await expect(page.getByTestId("model-tier-override-fields")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByTestId("create-menu-caret").click();
    await page.getByTestId("create-menu-item-new-iterate").click();
    await expect(page.getByTestId("new-issue-modal-new-iterate")).toBeVisible();
    await page.getByTestId("new-issue-more-options-toggle").click();
    await expect(page.getByTestId("model-tier-override-plan-review-model")).toContainText("Project default — Opus");
    await expect(page.getByTestId("model-tier-override-review-model")).toContainText("Project default — Opus");
    await expect(page.getByTestId("model-tier-override-plan-review-model")).toHaveValue("");
    await expect(page.getByTestId("model-tier-override-review-model")).toHaveValue("");
    expect(pageModelConfigRequests).toBe(1);
    await expect(page.getByTestId("paramfield-finalization-model")).toHaveCount(0);
    await expect(page.getByTestId("paramfield-execution-model")).toHaveCount(0);
    await page.getByTestId("model-tier-override-review-model").selectOption("opus");
    await expect(page.getByTestId("command-preview-panel")).toContainText("--review-model opus");
    await page.getByTestId("new-issue-title-input").fill("Model-tier explicit launch fixture");
    const launchResponse = page.waitForResponse((response) =>
      response.url().includes("/launch") && response.request().method() === "POST",
    );
    await page.getByTestId("new-issue-launch-btn").click();
    const launch = await launchResponse;
    expect(launch.ok()).toBeTruthy();
    expect(launch.request().postDataJSON()).toMatchObject({
      parameters: { "review-model": "opus" },
    });
    const launched = (await launch.json()) as { commands: Record<string, string> };
    expect(Object.values(launched.commands).join(" ")).toContain("--review-model opus");

  });
});
