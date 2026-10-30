/*
 * /api/projects/* — minimal CRUD. Plan D'' Sub-iterate 3 simplification:
 * no more fileWatcher + eventStore + sseManager side-effects (all removed
 * with the chat/pipeline runtime).
 *
 * The wizard's "pipeline" project endpoint and initial-phase spawning are
 * gone — projects are plain metadata registrations. Pipeline mode is a
 * follow-up iterate once external-launch ships.
 */

import path from "node:path";
import { Hono } from "hono";
import type { ProjectManager } from "../core/project-manager.js";
import { AppError } from "../middleware/error-handler.js";
import { normalizeFsPath } from "../core/normalize-fs-path.js";
import { projectDataDir } from "../core/project-data-dir.js";
import { dataStatus, migrateProjectData } from "../core/project-data-migrate.js";
import { clearActionsCacheForRecord } from "../core/project-actions-loader.js";

export interface ProjectRouteDeps {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, opts?: { recursive: boolean }) => void;
  writeFileSync: (path: string, data: string) => void;
  renameSync: (from: string, to: string) => void;
}

// One-double-click-to-VS-Code: emitted into <project.path>/.shipwright-webui/
// on POST /api/projects. Relative `..` keeps the file portable across machines
// and survives directory renames. Idempotent — never overwrites a file the
// user may have customized.
const WORKSPACE_CONTENT = JSON.stringify(
  {
    folders: [{ path: ".." }],
    settings: {
      "terminal.integrated.defaultLocation": "editor",
      "explorer.compactFolders": false,
    },
  },
  null,
  2,
);

/** Central workspace file: absolute folder path (it does not live inside the repo). */
function workspaceContent(repoPath: string): string {
  return JSON.stringify({ ...JSON.parse(WORKSPACE_CONTENT), folders: [{ path: repoPath }] }, null, 2);
}

function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createProjectRoutes(
  projectManager: ProjectManager,
  fsDeps?: ProjectRouteDeps,
  /**
   * iterate-2026-07-06-project-delete-cascades-tasks — invoked AFTER a
   * successful project delete to cascade-remove that project's tasks (so no
   * orphaned "Unassigned" bucket lingers). Returns the count removed. Wired
   * in index.ts to `cascadeDeleteProjectTasks`; omitted in unit tests that
   * don't exercise the cascade.
   */
  onProjectDeleted?: (projectId: string) => number | Promise<number>,
): Hono {
  const app = new Hono();

  app.get("/api/projects", (c) => c.json({ data: projectManager.getAll() }));

  app.get("/api/projects/:id", (c) => {
    const project = projectManager.getById(c.req.param("id"));
    if (!project) throw new AppError("Project not found", 404);
    return c.json({ data: project });
  });

  app.post("/api/projects", async (c) => {
    const body = await c.req.json();
    // Strip a paste-artifact surrounding quote pair BEFORE the fs probes and
    // create() below run against it — a quoted path would otherwise fail
    // existsSync, mkdir a garbage relative directory, and (once stored) feed a
    // broken `cd ''\''…'\'''` prefix into the launch command. See
    // core/normalize-fs-path.ts.
    if (typeof body.path === "string") body.path = normalizeFsPath(body.path);
    if (!body.name || !body.path) {
      throw new AppError("name and path are required", 400);
    }
    // iterate-2026-10-30-central-data-default - the webui's own files stay out
    // of the repo unless the user opts in with `shared`. The project folder
    // itself is still created when missing (create() 400s otherwise).
    body.shared = body.shared === true;
    delete body.standalone; // retired 2026-10-29 flag
    if (fsDeps && !fsDeps.existsSync(body.path)) {
      fsDeps.mkdirSync(body.path, { recursive: true });
    }
    const project = projectManager.create(body);
    if (fsDeps) {
      // Convenience file only: the project is already stored, so a failure here
      // must not turn the request into a 500 (a retry would duplicate it).
      try {
        const slug = slugifyProjectName(String(body.name));
        const dir = projectDataDir(project);
        if (slug.length > 0) {
          const workspacePath = path.join(dir, `${slug}.code-workspace`);
          fsDeps.mkdirSync(dir, { recursive: true });
          if (!fsDeps.existsSync(workspacePath)) {
            // Atomic temp+rename mirrors sdk-sessions-store.ts convention. A shared
            // project keeps the portable `..`; a central one needs the absolute repo path.
            const tmpPath = `${workspacePath}.tmp`;
            fsDeps.writeFileSync(tmpPath, project.shared ? WORKSPACE_CONTENT : workspaceContent(project.path));
            fsDeps.renameSync(tmpPath, workspacePath);
          }
        }
      } catch {
        /* best effort */
      }
    }
    return c.json({ data: project }, 201);
  });

  app.patch("/api/projects/:id", async (c) => {
    const body = await c.req.json();
    // Same paste-artifact guard as POST, for path edits via the settings UI.
    if (typeof body.path === "string") body.path = normalizeFsPath(body.path);
    if ("shared" in body && typeof body.shared !== "boolean") {
      throw new AppError("shared must be a boolean", 400);
    }
    delete body.standalone; // retired flag: never persist it again
    const updated = projectManager.update(c.req.param("id"), body);
    if (!updated) throw new AppError("Project not found", 404);
    return c.json({ data: updated });
  });

  // Where the webui keeps this project's own files + whether legacy in-repo files remain.
  app.get("/api/projects/:id/data-status", (c) => {
    const project = projectManager.getById(c.req.param("id"));
    if (!project) throw new AppError("Project not found", 404);
    return c.json({ data: dataStatus(project) });
  });

  // "Move to user folder": legacy <repo>/.shipwright-webui/ to the central dir (copy, verify, delete).
  app.post("/api/projects/:id/migrate-data", (c) => {
    const project = projectManager.getById(c.req.param("id"));
    if (!project) throw new AppError("Project not found", 404);
    try {
      return c.json({ data: migrateProjectData(project) });
    } finally {
      clearActionsCacheForRecord(project);
    }
  });

  app.delete("/api/projects/:id", async (c) => {
    const id = c.req.param("id");
    // Throws AppError(404) when the id is unknown — the cascade below is
    // skipped in that case (the throw short-circuits to the error handler).
    projectManager.delete(id);
    // iterate-2026-07-06-project-delete-cascades-tasks — cascade-remove the
    // project's tasks so no orphaned "Unassigned" bucket survives. Without
    // this the tasks keep a dangling projectId and the projects list keeps
    // synthesizing a phantom, un-clearable Unassigned row.
    const deletedTaskCount = onProjectDeleted ? await onProjectDeleted(id) : 0;
    return c.json({ ok: true, deletedTaskCount });
  });

  return app;
}
