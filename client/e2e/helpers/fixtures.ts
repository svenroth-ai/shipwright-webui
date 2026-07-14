/*
 * Seed-and-return E2E fixtures. iterate-2026-07-10-harness-hardening (A00).
 *
 * BEFORE: 27 specs pinned an operator UUID and 24 seeded `webui.activeProjectId`
 * from a literal. Two of those ids were live machine state (a real project in
 * Sven's `~/.shipwright-webui/sdk-sessions.json`); three more were DEAD — they
 * named projects that no longer exist, so those specs were already broken and
 * nobody noticed, because nothing ran them.
 *
 * The rule this file exists to enforce: **a spec never assumes a project or task
 * exists — it creates one through the real API and uses the id it gets back.**
 * That is also the only shape that can run on a CI runner, which has no
 * developer machine state at all.
 *
 * ⚠️ SAFETY. `seedProject()` creates a directory on disk (the server's
 * `POST /api/projects` mkdir's the path and drops a `.code-workspace` into it).
 * Every path this module hands the server is `fs.mkdtemp`'d under `os.tmpdir()`,
 * and `assertTempPath()` hard-aborts on anything that is not — the same paranoia
 * `helpers/isolated-store.ts` applies to the task store, extended (as the A00
 * brief requires) to every new fixture that writes.
 */

import type { APIRequestContext, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { apiUrl } from "./env";
import {
  assertTempPath,
  makeFixedDir,
  makeTempDir,
  removeTempDir,
  writeFiles,
} from "./temp-dir";

// Re-exported so specs can keep importing them from the fixtures barrel.
export { makeTempDir, removeTempDir } from "./temp-dir";

/** localStorage key the app reads the active project from (client/src/lib/projectIds.ts). */
export const ACTIVE_PROJECT_STORAGE_KEY = "webui.activeProjectId";

export interface SeededProject {
  projectId: string;
  name: string;
  /** Temp dir created for the project — remove it via `cleanupProject()`. */
  path: string;
}

export interface SeededTask {
  taskId: string;
  title: string;
  cwd: string;
  /** Pre-bound at creation (CLAUDE.md rule 2). Keys the JSONL a fixture may seed. */
  sessionUuid: string;
}

/**
 * Hex id for run-config fixtures. The run-config reader's `RUN_ID_PATTERN` /
 * `PHASE_TASK_ID_PATTERN` (server/src/types/run-config-v2.ts) SILENTLY reject a
 * non-hex id — the config is dropped and the card simply never renders, which
 * reads as a UI bug rather than a bad fixture. Never use `demo-1` here.
 */
export function hexId(length = 12): string {
  return randomUUID().replace(/-/g, "").slice(0, length);
}

/**
 * Fixed project colour. WITHOUT this, the colour is derived per project and the
 * project id is fresh on every run, so the Kanban colour dot and the card's left
 * accent stripe come out a different hue each time. That is ~900 differing pixels —
 * enough to fail the visual gate against its OWN baselines, on a no-op change.
 *
 * A flaky pixel gate is worse than none: it trains people to run
 * `--update-snapshots` reflexively, which is exactly how a visual gate stops
 * catching anything. Determinism is a property of the FIXTURE, so it is pinned
 * here rather than papered over with a looser pixel threshold.
 */
export const FIXTURE_PROJECT_COLOR = "#4f46e5";

/**
 * Create a project through the real `POST /api/projects` and return its
 * SERVER-GENERATED id. The project's path is a fresh temp dir.
 */
export async function seedProject(
  request: APIRequestContext,
  opts: {
    name?: string;
    profile?: string;
    color?: string;
    dirName?: string;
    /**
     * Make the project look ADOPTED. `adopted` is nothing more than the presence of
     * `shipwright_run_config.json` (project-manager.ts `isAdopted`) — and it is
     * load-bearing: an un-adopted project's action catalog collapses to
     * `/shipwright-adopt`, so a spec asserting on the normal Launch command sees an
     * "Adopt:" command instead. Several specs assumed the developer's project was
     * adopted; now they say so.
     */
    adopted?: boolean;
    /** Files to create in the project dir (the tree/file-route specs need real ones). */
    files?: Record<string, string>;
  } = {},
): Promise<SeededProject> {
  // dirName -> a deterministic path (the visual specs render it on screen).
  const dir = opts.dirName
    ? await makeFixedDir(opts.dirName)
    : assertTempPath(await makeTempDir("sw-e2e-project-"));

  await writeFiles(dir, {
    ...(opts.adopted
      ? {
          "shipwright_run_config.json": JSON.stringify(
            { schema_version: 2, status: "complete", iterate_history: [] },
            null,
            2,
          ),
        }
      : {}),
    ...(opts.files ?? {}),
  });

  const name = opts.name ?? `E2E Project ${hexId(6)}`;
  const res = await request.post(apiUrl("/api/projects"), {
    data: {
      name,
      path: dir,
      profile: opts.profile ?? "custom",
      status: "active",
      settings: { color: opts.color ?? FIXTURE_PROJECT_COLOR },
    },
  });
  if (!res.ok()) {
    throw new Error(
      `seedProject: POST /api/projects → HTTP ${res.status()} — ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { data: { id: string } };
  return { projectId: body.data.id, name, path: dir };
}

/**
 * Create a task through the real `POST /api/external/tasks` and return its
 * SERVER-GENERATED taskId. `cwd` defaults to a fresh temp dir.
 */
export async function seedTask(
  request: APIRequestContext,
  opts: {
    title?: string;
    cwd?: string;
    projectId?: string;
    pluginDirs?: string[];
    /**
     * Files to create in the task's cwd. The TaskDetail folder tree lists the TASK's
     * cwd, not the project dir — a freshly-mkdtemp'd cwd is empty, so a spec asserting
     * on a tree row was relying on whatever happened to be in the developer's folder.
     */
    files?: Record<string, string>;
  } = {},
): Promise<SeededTask> {
  const cwd = opts.cwd ?? assertTempPath(await makeTempDir("sw-e2e-task-"));
  await writeFiles(cwd, opts.files);
  const title = opts.title ?? `E2E task ${hexId(6)}`;
  const res = await request.post(apiUrl("/api/external/tasks"), {
    data: {
      title,
      cwd,
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.pluginDirs ? { pluginDirs: opts.pluginDirs } : {}),
    },
  });
  if (!res.ok()) {
    throw new Error(
      `seedTask: POST /api/external/tasks → HTTP ${res.status()} — ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { task: { taskId: string; sessionUuid: string } };
  return { taskId: body.task.taskId, title, cwd, sessionUuid: body.task.sessionUuid };
}

/**
 * Seed arbitrary localStorage keys BEFORE the first navigation. Every spec that
 * used to hand-roll an `addInitScript` block (15 of them, each 8-11 lines of
 * identical try/catch boilerplate) routes through here.
 *
 * Must be called before `page.goto` — `addInitScript` only applies to
 * navigations that happen after it is registered.
 */
export async function seedLocalStorage(
  page: Page,
  entries: Record<string, string>,
): Promise<void> {
  await page.addInitScript((kv: Record<string, string>) => {
    try {
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    } catch {
      /* private mode — the app falls back to its own defaults */
    }
  }, entries);
}

/**
 * Seed `webui.activeProjectId` before the first navigation. Replaces the specs
 * that depended on whatever project the developer's browser profile happened to
 * have selected — on a CI runner, that is none.
 */
export async function setActiveProject(page: Page, projectId: string): Promise<void> {
  await seedLocalStorage(page, { [ACTIVE_PROJECT_STORAGE_KEY]: projectId });
}

/** Delete a seeded task. Best-effort — never throws. */
export async function cleanupTask(
  request: APIRequestContext,
  taskId: string | undefined,
): Promise<void> {
  if (!taskId) return;
  try {
    await request.delete(apiUrl(`/api/external/tasks/${encodeURIComponent(taskId)}`));
  } catch {
    /* ignore */
  }
}

/**
 * Delete a seeded project and remove its temp dir. Best-effort — never throws.
 * The rm is retry-tolerant: Windows holds an EBUSY on a freshly-released dir
 * for a few ms after a pty exits (same pattern as `task-fixture.ts cleanupCwd`).
 */
export async function cleanupProject(
  request: APIRequestContext,
  project: SeededProject | undefined,
): Promise<void> {
  if (!project) return;
  try {
    await request.delete(apiUrl(`/api/projects/${encodeURIComponent(project.projectId)}`));
  } catch {
    /* ignore */
  }
  await removeTempDir(project.path);
}

