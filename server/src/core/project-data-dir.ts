/**
 * project-data-dir.ts — the SOLE resolver for "where does the webui keep its
 * per-project files" (iterate-2026-10-29-standalone-mode).
 *
 *   regular project    → `<project.path>/.shipwright-webui/` (historic, in-repo)
 *   standalone project → `<registryDir>/projects/<project.id>/` (central)
 *
 * A standalone project is one the user registered on a repo they must leave
 * untouched (e.g. a customer repo): the webui then writes NOTHING under
 * `project.path`. `registryDir` is `~/.shipwright-webui` unless
 * `SHIPWRIGHT_DATA_DIR` overrides it (see config.ts).
 *
 * Every in-repo write site MUST derive its directory here; the meta-test
 * `project-data-dir-invariant.test.ts` fails on a direct
 * `".shipwright-webui"` path join elsewhere.
 */

import path from "node:path";
import { getConfig } from "../config.js";

export interface DataDirProject {
  id: string;
  path: string;
  standalone?: boolean;
}

/** Directory that holds `actions.json` + `pastes/` for this project. */
export function projectDataDir(project: DataDirProject): string {
  if (project.standalone === true) {
    // ids are UUIDs; refuse anything that could leave `projects/` (hand-edited registry).
    if (!/^[A-Za-z0-9_-]+$/.test(project.id)) throw new Error("invalid project id for data dir");
    return path.join(getConfig().registryDir, "projects", project.id);
  }
  return path.join(project.path, ".shipwright-webui");
}

/**
 * Root the realpath guard must confine writes to: the repo for a regular
 * project, the central data dir for a standalone one (which lives OUTSIDE
 * `project.path`, so guarding against the repo would wrongly refuse it).
 */
export function projectDataGuardRoot(project: DataDirProject): string {
  return project.standalone === true ? projectDataDir(project) : project.path;
}

/** Stable error body for routes that would write INTO a standalone repo. */
export const STANDALONE_REFUSAL = {
  error: "standalone_project_read_only",
  detail:
    "This project is registered as standalone: the webui never writes into its repository.",
} as const;
