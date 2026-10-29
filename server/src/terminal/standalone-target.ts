/**
 * terminal/standalone-target.ts — where a task's pasted images may live.
 * Extracted from routes.ts (bloat ceiling). iterate-2026-10-29-standalone-mode.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { projectDataDir, type DataDirProject } from "../core/project-data-dir.js";

export type GetPasteProject = (id: string) => DataDirProject | undefined;

/**
 * Central data dir for a STANDALONE task's project, else null (regular
 * project: paste under `<cwd>/.shipwright-webui/pastes/` as before).
 */
export function standalonePasteRoot(
  projectId: string | undefined,
  getProjectById: GetPasteProject | undefined,
): string | null {
  if (!projectId) return null;
  const project = getProjectById?.(projectId);
  return project?.standalone === true ? projectDataDir(project) : null;
}

const norm = (p: string): string => {
  let r = p;
  try {
    r = realpathSync(p);
  } catch {
    /* not on disk (yet): compare lexically */
  }
  return path.resolve(r).toLowerCase();
};

/**
 * Task-level resolver: by `projectId` first, else by `cwd` equal to or inside
 * any STANDALONE project's path (a task created with the repo cwd but no
 * resolvable projectId must not fall back to an in-repo write).
 */
export function standaloneRootForTask(
  task: { projectId?: string; cwd?: string },
  listProjects: () => DataDirProject[],
): string | null {
  const all = listProjects();
  const byId = standalonePasteRoot(task.projectId, (id) => all.find((p) => p.id === id));
  if (byId) return byId;
  if (!task.cwd) return null;
  const cwd = norm(task.cwd);
  for (const p of all) {
    if (p.standalone !== true || !p.path) continue;
    const root = norm(p.path);
    if (cwd === root || cwd.startsWith(root + path.sep)) return projectDataDir(p);
  }
  return null;
}
