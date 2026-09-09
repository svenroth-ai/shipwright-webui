/*
 * S2 — Mission artifacts: per-AC test coverage (triage card placed
 * 2026-09-06, unblocked 2026-09-08 by campaign req3-06-mechanics-webui).
 *
 * Split out of `mission-artifacts-s2.spec.ts` to keep that file under the
 * 300-LOC rule. Reuses the same real git repo + real manifest fixture
 * pattern — no mocked git, no mocked manifest read.
 *
 * `traceability({ withAc: true })` tags the ADDED test with a v4 `ac_id`;
 * the DEFAULT (untagged) fixture — the shape of THIS repo's real manifest
 * today — proves the absent-state note instead of a misleading empty group
 * list.
 *
 * @covers FR-01.66
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { writeFiles } from "../helpers/temp-dir";
import { eventsJsonl, pointer, seedRepoWithTestChanges, traceability } from "../helpers/mission-s2-fixtures";

test.describe("S2 — Tests artifact: per-AC coverage", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  async function seed(
    request: Parameters<typeof seedProject>[0],
    name: string,
    dirName: string,
  ): Promise<{ sessionUuid: string; commit: string }> {
    project = await seedProject(request, { name, dirName, adopted: true });
    const commit = seedRepoWithTestChanges(project.path);
    const task = await seedTask(request, { title: name, projectId: project.projectId });
    taskId = task.taskId;
    return { sessionUuid: task.sessionUuid, commit };
  }

  test("groups the ADDED test under its AC when the manifest tags one", async ({ page, request }) => {
    const { sessionUuid, commit } = await seed(request, "MissionS2AcTagged", "sw-s2-ac-tagged");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      ".shipwright/compliance/test-traceability.json": traceability({ withAc: true }),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("artifact-link-tests").click();

    await expect(page.getByTestId("artifact-tests-table")).toBeVisible();
    await expect(page.getByTestId("artifact-tests-ac-absent")).toHaveCount(0);

    const group = page.getByTestId("artifact-tests-ac-group");
    await expect(group).toContainText("AC07 — FR-01.28");
    await expect(group).toContainText("added.test.ts");
  });

  test("shows the 'not yet tagged' note when the manifest carries no ac_id — this repo's real shape", async ({
    page,
    request,
  }) => {
    const { sessionUuid, commit } = await seed(request, "MissionS2AcAbsent", "sw-s2-ac-absent");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      ".shipwright/compliance/test-traceability.json": traceability(),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("artifact-link-tests").click();

    // The file table itself still renders (untagged is not the same as absent
    // test data) — only the AC grouping is absent.
    await expect(page.getByTestId("artifact-tests-table")).toBeVisible();
    await expect(page.getByTestId("artifact-tests-ac-absent")).toContainText(/not yet tagged/i);
    await expect(page.getByTestId("artifact-tests-ac-group")).toHaveCount(0);
  });
});
