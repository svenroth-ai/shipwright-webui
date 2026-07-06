/*
 * project-delete-cascade.spec.ts —
 * iterate-2026-07-06-project-delete-cascade-e2e (browser regression guard for #200).
 *
 * FR-01.25: deleting a project that still has tasks must cascade-remove those
 * tasks so the projects list does NOT keep a phantom, un-clearable synthesized
 * "Unassigned" row. Pre-#200 the orphaned task's dangling projectId made
 * ProjectManager.getAll() synthesize that row forever (client showed it with 0
 * tasks, unfilterable); only a server restart self-healed it via O26.
 *
 * This drives the REAL delete flow through the browser: seed a project + one
 * task assigned to it, click the trash affordance, accept the confirm dialog,
 * then assert the project row is gone AND no Unassigned row appeared.
 */

import { test, expect } from "@playwright/test";
import { makeTaskCwd, cleanupCwd } from "../helpers/task-fixture";

test.describe("Project delete cascades to its tasks (iterate-2026-07-06, #200)", () => {
  test("deleting a project with a task leaves no phantom Unassigned row", async ({
    page,
    request,
  }) => {
    const suffix = Date.now();
    const cwd = await makeTaskCwd("iterate-del-cascade-");
    let projectId = "";
    try {
      // Seed: a project + one task assigned to it (real API, like the sibling specs).
      const mkProj = await request.post("/api/projects", {
        data: {
          name: `del-cascade-${suffix}`,
          path: cwd,
          profile: "default",
          status: "active",
        },
      });
      expect(mkProj.ok()).toBeTruthy();
      projectId = ((await mkProj.json()) as { data: { id: string } }).data.id;

      const mkTask = await request.post("/api/external/tasks", {
        data: { title: `task-${suffix}`, cwd, projectId },
      });
      expect(mkTask.ok()).toBeTruthy();

      // The projects page shows the project row with a task count of 1, and —
      // because the task belongs to a REAL project — NO synthesized Unassigned row.
      await page.goto("/projects");
      await expect(page.getByTestId(`projects-row-${projectId}`)).toBeVisible();
      await expect(
        page.getByTestId(`projects-cell-${projectId}-tasks`),
      ).toHaveText("1");
      await expect(page.getByTestId("projects-row-unassigned")).toHaveCount(0);

      // The delete button raises a window.confirm — capture its text (it must
      // warn about the 1 task) and accept it.
      let dialogMsg = "";
      page.on("dialog", (d) => {
        dialogMsg = d.message();
        void d.accept();
      });
      await page.getByTestId(`projects-delete-${projectId}`).click();
      expect(dialogMsg).toContain("1 task belonging to this project");

      // Post-cascade: the project row is gone AND — the regression guard — NO
      // phantom Unassigned row appears (pre-#200 the orphaned task synthesized one).
      await expect(page.getByTestId(`projects-row-${projectId}`)).toHaveCount(0);
      await expect(page.getByTestId("projects-row-unassigned")).toHaveCount(0);

      // And the task is actually gone from the store (not merely re-homed).
      const list = await request.get("/api/external/tasks");
      const { tasks } = (await list.json()) as {
        tasks: Array<{ projectId: string }>;
      };
      expect(tasks.some((t) => t.projectId === projectId)).toBe(false);
    } finally {
      if (projectId) {
        await request.delete(`/api/projects/${projectId}`).catch(() => {});
      }
      await cleanupCwd(cwd);
    }
  });
});
