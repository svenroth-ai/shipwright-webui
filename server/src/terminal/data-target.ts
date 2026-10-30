/**
 * terminal/data-target.ts — where a task's pasted images live.
 * Extracted from routes.ts (bloat ceiling). iterate-2026-10-29-standalone-mode,
 * re-pointed by iterate-2026-10-30-central-data-default (central is the default).
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { projectDataDir, type DataDirProject } from "../core/project-data-dir.js";

export type GetPasteProject = (id: string) => DataDirProject | undefined;

/**
 * Central data dir for a task's project, or null for a `shared` project (or an
 * unknown one): those paste under `<cwd>/.shipwright-webui/pastes/` as before.
 */
export function centralPasteRoot(
  projectId: string | undefined,
  getProjectById: GetPasteProject | undefined,
): string | null {
  if (!projectId) return null;
  const project = getProjectById?.(projectId);
  return project && project.shared !== true ? projectDataDir(project) : null;
}

const norm = (p: string): string => {
  let r = p;
  try {
    r = realpathSync(p);
  } catch {
    /* not on disk (yet): compare lexically */
  }
  const abs = path.resolve(r);
  // Case-insensitive filesystems only (Windows, default macOS).
  return process.platform === "win32" || process.platform === "darwin" ? abs.toLowerCase() : abs;
};

/**
 * Task-level resolver: by `projectId` first, else by `cwd` equal to or inside
 * any non-`shared` project's path (a task created with the repo cwd but no
 * resolvable projectId must not fall back to an in-repo write).
 */
export function centralRootForTask(
  task: { projectId?: string; cwd?: string },
  listProjects: () => DataDirProject[],
): string | null {
  const all = listProjects();
  const byId = centralPasteRoot(task.projectId, (id) => all.find((p) => p.id === id));
  if (byId) return byId;
  if (!task.cwd) return null;
  const cwd = norm(task.cwd);
  // Longest matching root wins (nested projects); a shared owner means no central dir.
  let best: { len: number; project: DataDirProject } | null = null;
  for (const p of all) {
    if (!p.path) continue;
    const root = norm(p.path);
    if ((cwd === root || cwd.startsWith(root + path.sep)) && (!best || root.length > best.len)) {
      best = { len: root.length, project: p };
    }
  }
  return best && best.project.shared !== true ? projectDataDir(best.project) : null;
}
