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

  // iterate-2026-09-19-codex-reviewer-fields — Codex runtime gets its own
  // free-text Plan review / Review overrides instead of the Claude dropdowns,
  // laid out the same way (left/right). AC8 (runtime-toggle-codex.spec.ts)
  // makes a genuine Codex /launch 400 on any machine without the Codex CLI
  // on PATH, so this test intercepts the /launch POST rather than letting
  // it hit the real route — it is proving the request BODY and the UI, not
  // a real Codex launch.
  //
  // iterate-2026-09-26-codex-model-field-removal — the Implementation
  // model field this test used to also check for is gone; Codex Light now
  // always inherits whatever model the `codex` CLI has configured itself.
  test("Runtime=Codex shows real Plan review / Review overrides (no reviewer-identity block) and threads them into the launch body", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-card-" + task.taskId)).toBeVisible();

    await page.getByTestId("create-menu-caret").click();
    await page.getByTestId("create-menu-item-new-iterate").click();
    await expect(page.getByTestId("new-issue-modal-new-iterate")).toBeVisible();
    await page.getByTestId("runtime-codex").click();
    await page.getByTestId("new-issue-more-options-toggle").click();

    await expect(page.getByTestId("codex-reviewer-identity")).toHaveCount(0);

    await expect(
      page.getByTestId("model-tier-override-codex-implementation-model"),
    ).toHaveCount(0);

    const planReviewField = page.getByTestId(
      "model-tier-override-codex-plan-review-model",
    );
    const reviewField = page.getByTestId("model-tier-override-codex-review-model");
    await expect(planReviewField).toBeVisible();
    await expect(reviewField).toBeVisible();

    await planReviewField.fill("gpt-5.6-terra");
    await reviewField.fill("gpt-5.6-sol");

    await page.getByTestId("new-issue-title-input").fill("Codex review-model launch fixture");

    let capturedBody: Record<string, unknown> | undefined;
    await page.route("**/api/external/tasks/*/launch", async (route) => {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          task: { taskId: "stub", runtime: "codex" },
          commands: { powershell: "codex", cmd: "codex", posix: "codex" },
        }),
      });
    });
    await page.getByTestId("new-issue-launch-btn").click();
    await expect.poll(() => capturedBody).toBeTruthy();
    expect(capturedBody).toMatchObject({
      codexPlanReviewModel: "gpt-5.6-terra",
      codexReviewModel: "gpt-5.6-sol",
    });
  });

  // iterate-2026-09-19-codex-model-catalog — the three Codex model fields
  // become comboboxes suggesting a live catalog. `/api/codex-models` is
  // intercepted with a fixed response (external review fix, openai): this
  // proves the UI wiring deterministically, independent of whether the E2E
  // runner's machine has the Codex CLI installed — real probe/parsing
  // behavior is covered by the server-side unit tests instead.
  test("Runtime=Codex suggests catalog slugs via a datalist and still accepts free text", async ({
    page,
  }) => {
    await page.route("**/api/codex-models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          models: [
            { slug: "gpt-6-astra", display_name: "GPT-6-Astra" },
            { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol" },
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

    await expect(
      page.getByTestId("model-tier-override-codex-implementation-model"),
    ).toHaveCount(0);

    const planReviewField = page.getByTestId(
      "model-tier-override-codex-plan-review-model",
    );
    await expect(planReviewField).toBeVisible();

    // The field is a combobox: its `list` attribute names a populated
    // <datalist> holding the fetched catalog.
    // `useId()` (React 18) returns ids containing colons (e.g. `:r1:`), which
    // is not a valid CSS id-selector token unescaped — an attribute selector
    // tolerates the raw value with no escaping needed (external code-review
    // finding, 2026-09-19).
    const datalistId = await planReviewField.getAttribute("list");
    expect(datalistId).toBeTruthy();
    const datalistOptions = page.locator(`[id="${datalistId}"] option`);
    await expect(datalistOptions).toHaveCount(2);
    await expect(datalistOptions.nth(0)).toHaveAttribute("value", "gpt-6-astra");

    // Free text is still accepted — a suggestion is a convenience, not a
    // restriction.
    await planReviewField.fill("a-completely-custom-slug");
    await expect(planReviewField).toHaveValue("a-completely-custom-slug");
    await expect(page.getByTestId("codex-model-catalog-status")).toHaveCount(0);
  });

  // Degrade path: the endpoint reports unavailable (e.g. Codex CLI missing
  // on the server host) — the form must still be fully usable.
  test("Runtime=Codex shows an unavailable caption when the catalog probe fails, form stays usable", async ({
    page,
  }) => {
    await page.route("**/api/codex-models", async (route) => {
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

    await expect(
      page.getByTestId("model-tier-override-codex-implementation-model"),
    ).toHaveCount(0);
    const planReviewField = page.getByTestId(
      "model-tier-override-codex-plan-review-model",
    );
    await expect(planReviewField).toBeVisible();
    await expect(page.getByTestId("codex-model-catalog-status")).toContainText(
      "Model suggestions unavailable",
    );
    await planReviewField.fill("gpt-5.6-luna");
    await expect(planReviewField).toHaveValue("gpt-5.6-luna");
  });
});
