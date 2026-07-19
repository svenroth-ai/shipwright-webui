/*
 * S3 — Mission artifacts: native pipeline + campaign
 * (campaign 2026-07-18-mission-artifacts; FR-01.66).
 *
 * Real sources throughout: a real `shipwright_run_config.json` with two build
 * phase tasks that differ ONLY by split, a real campaign directory with a brief,
 * a runbook, per-unit specs and a `status.json`.
 *
 * Scenario 6 (the tab-hide) lives in its own sibling spec —
 * `mission-artifacts-s3-tab-hide.spec.ts` — because it is a different decision
 * with a different risk profile.
 *
 * @covers FR-01.66
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { apiUrl } from "../helpers/env";
import { writeFiles } from "../helpers/temp-dir";
import {
  CAMPAIGN_SLUG,
  PTK_CORE,
  PTK_UI,
  RUN_ID,
  UI_SESSION,
  adoptedSpec,
  campaignFiles,
  runConfig,
} from "../helpers/mission-s3-fixtures";

const ADOPTED_SPEC = ".shipwright/planning/01-adopted/spec.md";

test.describe("S3 — native pipeline + campaign artifacts", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  /** Create a task pre-linked to a phase task (the shape the orchestrator writes). */
  async function seedPhaseTask(
    request: APIRequestContext,
    args: { phaseTaskId: string; sessionUuid: string },
  ): Promise<string> {
    const res = await request.post(apiUrl("/api/external/tasks"), {
      data: {
        title: "Run-a1b2 / build",
        cwd: project.path,
        projectId: project.projectId,
        phaseTaskId: args.phaseTaskId,
        runId: RUN_ID,
        sessionUuid: args.sessionUuid,
        parentRunMaster: false,
      },
    });
    if (!res.ok()) throw new Error(`seedPhaseTask → HTTP ${res.status()} — ${await res.text()}`);
    const body = (await res.json()) as { task: { taskId: string } };
    return body.task.taskId;
  }

  async function openMission(page: Page, id: string): Promise<void> {
    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${id}`);
    await page.getByTestId("mission-tab-mission").click();
  }

  // -------------------------------------------------------------------------
  // AC1 — pipeline
  // -------------------------------------------------------------------------

  test("a pipeline phase task resolves its OWN split, plus the spec (AC1)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "MissionS3Pipe", dirName: "sw-s3-pipe", adopted: true });
    await writeFiles(project.path, {
      "shipwright_run_config.json": runConfig(),
      [ADOPTED_SPEC]: adoptedSpec(),
    });

    // Ask for the 02-ui task. Its sibling ptk-aaaa shares the phase name, so a
    // resolver that matched on phase would show "01-core" here.
    taskId = await seedPhaseTask(request, { phaseTaskId: PTK_UI, sessionUuid: UI_SESSION });
    await openMission(page, taskId);

    const phase = page.getByTestId("artifact-link-phase");
    await expect(phase).toBeVisible();
    await expect(phase).toContainText("02-ui");
    await expect(phase).not.toContainText("01-core");

    // The spec link is the adopted specification, and it OPENS (no dead link).
    const spec = page.getByTestId("artifact-link-spec");
    await expect(spec).toContainText("Spec & requirements");
    await spec.click();
    await expect(page.getByTestId("artifact-doc-body")).toBeVisible();
    await expect(page.getByTestId("artifact-doc-body")).toContainText("FR-01.66");
  });

  test("the phase detail reports plain-language state, not the raw enum (AC1)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "MissionS3Phase", dirName: "sw-s3-phase", adopted: true });
    await writeFiles(project.path, {
      "shipwright_run_config.json": runConfig(),
      [ADOPTED_SPEC]: adoptedSpec(),
    });
    taskId = await seedPhaseTask(request, { phaseTaskId: PTK_UI, sessionUuid: UI_SESSION });
    await openMission(page, taskId);

    await page.getByTestId("artifact-link-phase").click();
    await expect(page.getByTestId("artifact-phase-status")).toHaveText("running now");
    await expect(page.getByTestId("artifact-phase-meta")).toContainText(RUN_ID);
  });

  test("the COMPLETED sibling resolves to its own split — no conflation (AC1)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "MissionS3Core", dirName: "sw-s3-core", adopted: true });
    await writeFiles(project.path, {
      "shipwright_run_config.json": runConfig(),
      [ADOPTED_SPEC]: adoptedSpec(),
    });
    taskId = await seedPhaseTask(request, { phaseTaskId: PTK_CORE, sessionUuid: UI_SESSION });
    await openMission(page, taskId);

    await page.getByTestId("artifact-link-phase").click();
    await expect(page.getByTestId("artifact-phase-meta")).toContainText("01-core");
    await expect(page.getByTestId("artifact-phase-status")).toHaveText("complete");
  });

  // -------------------------------------------------------------------------
  // AC1 — campaign
  // -------------------------------------------------------------------------

  test("a campaign shows brief · runbook · progress · current unit, kept distinct (AC1)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "MissionS3Camp", dirName: "sw-s3-camp", adopted: true });
    await writeFiles(project.path, campaignFiles());

    const task = await seedTask(request, {
      title: `campaign: ${CAMPAIGN_SLUG}`,
      projectId: project.projectId,
    });
    taskId = task.taskId;
    await openMission(page, taskId);

    await expect(page.getByTestId("artifact-link-spec")).toContainText("Campaign brief");
    await expect(page.getByTestId("artifact-link-campaign_runbook")).toBeVisible();
    await expect(page.getByTestId("artifact-link-campaign_progress")).toContainText("1/3");
    await expect(page.getByTestId("artifact-link-sub_iterate")).toContainText("S2");
  });

  test("the current unit carries ITS OWN record, not a completed sibling's (AC1)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "MissionS3Unit", dirName: "sw-s3-unit", adopted: true });
    await writeFiles(project.path, campaignFiles());

    const task = await seedTask(request, {
      title: `campaign: ${CAMPAIGN_SLUG}`,
      projectId: project.projectId,
    });
    taskId = task.taskId;
    await openMission(page, taskId);

    await page.getByTestId("artifact-link-sub_iterate").click();

    // S2 is running and has reported nothing, so its counts are NOT recorded.
    // S1's real 5107/5108 must not appear here.
    await expect(page.getByTestId("artifact-sub-basis")).toContainText("running now");
    await expect(page.getByTestId("artifact-sub-tests")).toHaveText("not recorded");
    await expect(page.getByTestId("artifact-sub-meta")).not.toContainText("5107");
    await expect(page.getByTestId("artifact-sub-meta")).not.toContainText("66e275ae");

    // Its own spec document opens.
    await expect(page.getByTestId("artifact-sub-doc")).toBeVisible();
  });

  test("the campaign progress list marks exactly one unit as current (AC3)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "MissionS3Prog", dirName: "sw-s3-prog", adopted: true });
    await writeFiles(project.path, campaignFiles());

    const task = await seedTask(request, {
      title: `campaign: ${CAMPAIGN_SLUG}`,
      projectId: project.projectId,
    });
    taskId = task.taskId;
    await openMission(page, taskId);

    await page.getByTestId("artifact-link-campaign_progress").click();
    const rows = page.getByTestId("artifact-campaign-rows");
    await expect(rows).toContainText("S1 — Resolver core");
    await expect(rows.locator('[data-active="true"]')).toHaveCount(1);
    await expect(rows.locator('[data-active="true"]')).toContainText("S2");
  });

  // -------------------------------------------------------------------------
  // AC3 — a plain session keeps narration + stage, and gains no rail
  // -------------------------------------------------------------------------

  test("a plain session shows narration and the stage, with no artifact rail (AC3)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "MissionS3Plain", dirName: "sw-s3-plain", adopted: true });
    const task = await seedTask(request, { title: "Just a chat", projectId: project.projectId });
    taskId = task.taskId;
    await openMission(page, taskId);

    await expect(page.getByTestId("mission-summary")).toBeVisible();
    await expect(page.getByTestId("mission-stage")).toBeVisible();

    // None of the S3 kinds may appear for a session that has none of them.
    for (const kind of ["phase", "campaign_progress", "sub_iterate", "campaign_runbook"]) {
      await expect(page.getByTestId(`artifact-link-${kind}`)).toHaveCount(0);
    }
  });
});
