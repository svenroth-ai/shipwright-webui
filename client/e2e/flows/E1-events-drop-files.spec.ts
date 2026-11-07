/*
 * E1 — the plugin's drop-files layout end to end (events-drop-files, issue 978,
 * units S1 + S5b). Real files on disk in the NEW layout only — no legacy
 * `shipwright_events.jsonl`, the run's `work_completed` lives in its own
 * `shipwright_events.d/<key>--<wt8>--<nonce8>.jsonl`, and its documentation
 * update is a bullet drop under `.shipwright/agent_docs/decision-drops/bullets/`.
 * Drives the real resolver, the real Mission rail and the real Documents panel.
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

const RUN_ID = "iterate-2026-11-07-drops-e2e";
const DROP = `shipwright_events.d/${RUN_ID}--0a1b2c3d--11111111.jsonl`;
const BULLET = `.shipwright/agent_docs/decision-drops/bullets/architecture--${RUN_ID}--0a1b2c3d--22222222.md`;
const BULLET_TEXT = `- **${RUN_ID}** (2026-11-07): Data-flow — the drop-files reader e2e line.`;

function pointer(sessionUuid: string, mainRoot: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "drops-e2e",
    branch: "iterate/drops-e2e",
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-11-07T10:00:00Z",
  });
}

const workCompleted = `${JSON.stringify({
  id: "evt-drops-e2e-0001",
  type: "work_completed",
  ts: "2026-11-07T12:00:00Z",
  adr_id: RUN_ID,
  commit: "abc1234def5678",
  summary: "Read the drop-files layout.",
  spec_impact: "none",
  tests: { passed: 3, total: 3 },
})}\n`;

test.describe("E1 — drop-files layout", () => {
  let project: SeededProject;
  let taskId = "";

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
    taskId = "";
  });

  // @covers FR-01.66
  test("a run that exists only as a drop file is finalized in Mission, and its pending doc update shows under Decisions", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "DropsMission", dirName: "sw-e1-drops", adopted: true });
    const task = await seedTask(request, { title: "Drop-files run", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: "# Drops e2e\n\nFixture spec.\n",
      [DROP]: workCompleted,
      [BULLET]: `${BULLET_TEXT}\n`,
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // The run's only record is its drop file: the commit artifact still exists.
    await expect(page.getByTestId("artifact-link-commit")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("record-rail")).not.toContainText("No run data yet");

    // Decisions shows the pending documentation update — never as an ADR.
    await page.getByTestId("artifact-link-decisions").click();
    const update = page.getByTestId("artifact-doc-update");
    await expect(update).toHaveCount(1);
    await expect(update).toHaveAttribute("data-state", "pending");
    await expect(update).toContainText("the drop-files reader e2e line");
    await expect(page.getByTestId("artifact-decision-entry")).toHaveCount(0);
  });

  // @covers FR-01.59
  test("the Documents column lists the pending doc update and opens the bullet file", async ({ page, request }) => {
    project = await seedProject(request, {
      name: "DropsDocs",
      dirName: "sw-e1-docs",
      files: { ".shipwright/agent_docs/architecture.md": "# Architecture\n\n## Architecture Updates\n", [BULLET]: `${BULLET_TEXT}\n` },
    });
    await setActiveProject(page, project.projectId);
    await page.goto(`/projects/${project.projectId}/log`);

    await expect(page.getByRole("heading", { level: 3, name: "Pending doc updates" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("shipslog-pending-doc-note")).toContainText("next release");
    await page.getByTestId(`shipslog-doc-${BULLET}`).click();
    await expect(page.getByTestId("smart-viewer-modal-path")).toHaveText(BULLET);
    await expect(page.getByTestId("smart-viewer-markdown")).toContainText("the drop-files reader e2e line");
  });
});
