/*
 * client/e2e/flows/lead-fields-tag-filter.spec.ts —
 * iterate-2026-08-16-v1-lead-fields-tag-filter (triage-v1-v4a.md Item 1).
 *
 * Real-HTTP surface proof for the three External Task API changes added in
 * this iterate (poFeedback PATCH, leadParentTaskId POST, ?tag= GET filter).
 * Pure API-testing spec — `request` fixture only, no `page.goto` — required
 * by the Backend-affects-Frontend rule (F0.5) once API routes are touched,
 * even though no client/** UI consumer exists yet (Out of Scope). Exhaustive
 * per-AC edge cases (clear-vs-omit, length cap, started-task exemption,
 * repeated ?tag=, findManyByUuid pre-filtering) already live in
 * server/src/external/routes.lead-fields-tag-filter.test.ts; this spec
 * proves the same contract holds over a real Hono HTTP server, not just
 * `app.request()` in-process.
 */
import { test, expect } from "@playwright/test";
import { apiUrl } from "../helpers/env";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  type SeededProject,
} from "../helpers/fixtures";

let project: SeededProject;

test.describe("External Task API — lead fields + tag filter", () => {
  test.beforeEach(async ({ request }) => {
    project = await seedProject(request, { name: "lead-fields-tag-filter" });
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("PATCH poFeedback: writes, echoes, clears via empty string, rejects over-length", async ({
    request,
  }) => {
    const create = await request.post(apiUrl("/api/external/tasks"), {
      data: { title: "e2e-po-feedback", cwd: project.path, projectId: project.projectId },
    });
    expect(create.ok()).toBeTruthy();
    const { task } = (await create.json()) as { task: { taskId: string } };

    const write = await request.patch(apiUrl(`/api/external/tasks/${task.taskId}`), {
      data: { poFeedback: "please redo the auth check" },
    });
    expect(write.ok()).toBeTruthy();
    const written = (await write.json()) as { task: { poFeedback?: string } };
    expect(written.task.poFeedback).toBe("please redo the auth check");

    const clear = await request.patch(apiUrl(`/api/external/tasks/${task.taskId}`), {
      data: { poFeedback: "" },
    });
    expect(clear.ok()).toBeTruthy();
    const cleared = (await clear.json()) as { task: { poFeedback?: string } };
    expect(cleared.task.poFeedback).toBeUndefined();

    const overLong = await request.patch(apiUrl(`/api/external/tasks/${task.taskId}`), {
      data: { poFeedback: "x".repeat(6001) },
    });
    expect(overLong.status()).toBe(400);
    const err = (await overLong.json()) as { error: string; detail: string };
    expect(err.error).toBe("invalid_po_feedback");
    expect(err.detail).toBe("poFeedback exceeds 6000 characters");

    await cleanupTask(request, task.taskId);
  });

  test("POST leadParentTaskId: persists + round-trips, soft-drops empty string, poFeedback stays PATCH-only", async ({
    request,
  }) => {
    const create = await request.post(apiUrl("/api/external/tasks"), {
      data: {
        title: "e2e-lead-parent",
        cwd: project.path,
        projectId: project.projectId,
        leadParentTaskId: "lead-task-root",
        poFeedback: "should not be creatable",
      },
    });
    expect(create.ok()).toBeTruthy();
    const { task } = (await create.json()) as {
      task: { taskId: string; leadParentTaskId?: string; poFeedback?: string };
    };
    expect(task.leadParentTaskId).toBe("lead-task-root");
    expect(task.poFeedback).toBeUndefined();

    const reload = await request.get(apiUrl(`/api/external/tasks/${task.taskId}`));
    expect(reload.ok()).toBeTruthy();
    const reloaded = (await reload.json()) as { task: { leadParentTaskId?: string } };
    expect(reloaded.task.leadParentTaskId).toBe("lead-task-root");

    const empty = await request.post(apiUrl("/api/external/tasks"), {
      data: {
        title: "e2e-lead-parent-empty",
        cwd: project.path,
        projectId: project.projectId,
        leadParentTaskId: "",
      },
    });
    expect(empty.ok()).toBeTruthy();
    const { task: emptyTask } = (await empty.json()) as {
      task: { taskId: string; leadParentTaskId?: string };
    };
    expect(emptyTask.leadParentTaskId).toBeUndefined();

    await cleanupTask(request, task.taskId);
    await cleanupTask(request, emptyTask.taskId);
  });

  test("GET ?tag= exact-matches across projects, 200-empties on an unknown tag, intersects with ?projectId=", async ({
    request,
  }) => {
    const other = await seedProject(request, { name: "lead-fields-tag-filter-other" });
    try {
      const match = await request.post(apiUrl("/api/external/tasks"), {
        data: {
          title: "e2e-tag-match",
          cwd: project.path,
          projectId: project.projectId,
          tags: ["lead-dedup:e2e"],
        },
      });
      const { task: matchTask } = (await match.json()) as { task: { taskId: string } };

      const otherProjectSameTag = await request.post(apiUrl("/api/external/tasks"), {
        data: {
          title: "e2e-tag-other-project",
          cwd: other.path,
          projectId: other.projectId,
          tags: ["lead-dedup:e2e"],
        },
      });
      const { task: otherTask } = (await otherProjectSameTag.json()) as {
        task: { taskId: string };
      };

      const byTag = await request.get(apiUrl("/api/external/tasks?tag=lead-dedup:e2e"));
      expect(byTag.ok()).toBeTruthy();
      const byTagBody = (await byTag.json()) as { tasks: Array<{ taskId: string }> };
      const byTagIds = byTagBody.tasks.map((t) => t.taskId);
      expect(byTagIds).toContain(matchTask.taskId);
      expect(byTagIds).toContain(otherTask.taskId);

      const intersected = await request.get(
        apiUrl(`/api/external/tasks?tag=lead-dedup:e2e&projectId=${project.projectId}`),
      );
      expect(intersected.ok()).toBeTruthy();
      const intersectedBody = (await intersected.json()) as { tasks: Array<{ taskId: string }> };
      expect(intersectedBody.tasks.map((t) => t.taskId)).toEqual([matchTask.taskId]);

      const unknown = await request.get(apiUrl("/api/external/tasks?tag=does-not-exist-e2e"));
      expect(unknown.status()).toBe(200);
      const unknownBody = (await unknown.json()) as { tasks: unknown[] };
      expect(unknownBody.tasks).toEqual([]);

      await cleanupTask(request, matchTask.taskId);
      await cleanupTask(request, otherTask.taskId);
    } finally {
      await cleanupProject(request, other);
    }
  });
});
