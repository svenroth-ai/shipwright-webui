/*
 * A project WITH a task, set as the active project — the minimum state in which
 * the Task Board renders its columns and the List view renders its header.
 * A project with zero tasks shows the "No tasks yet" empty state instead, and no
 * project at all shows the first-contact hero; specs asserting on board/list
 * geometry used to pass only when an earlier spec left such state behind.
 */
import type { APIRequestContext, Page } from "@playwright/test";

import {
  cleanupProject,
  cleanupTaskCwd,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
  type SeededTask,
} from "./fixtures";

export interface BoardFixture {
  project: SeededProject;
  task: SeededTask;
}

export async function seedBoard(
  page: Page,
  request: APIRequestContext,
  name: string,
): Promise<BoardFixture> {
  const project = await seedProject(request, { name });
  let task: SeededTask | undefined;
  try {
    task = await seedTask(request, { title: `${name} task`, projectId: project.projectId });
    await setActiveProject(page, project.projectId);
    return { project, task };
  } catch (err) {
    // The caller never receives a fixture to clean up, so don't orphan either half.
    await cleanupTaskCwd(request, task);
    await cleanupProject(request, project);
    throw err;
  }
}

/** Task first (kills its pty before the cwd goes), then the project. Never throws. */
export async function cleanupBoard(
  request: APIRequestContext,
  board: BoardFixture | undefined,
): Promise<void> {
  if (!board) return;
  await cleanupTaskCwd(request, board.task);
  await cleanupProject(request, board.project);
}
