/**
 * project-data-dir.ts — the SOLE resolver for "where does the webui keep its
 * per-project files" (iterate-2026-10-30-central-data-default; supersedes the
 * `standalone` model of iterate-2026-10-29).
 *
 *   default             → `<registryDir>/projects/<project.id>/` (central)
 *   `shared: true`      → `<project.path>/.shipwright-webui/` (in the repo)
 *
 * Files the WEBUI produces (actions.json, pasted screenshots, the
 * `.code-workspace` convenience file) stay out of the repo unless the user
 * opts in with `shared`. The user's OWN work in the repo (Markdown editor,
 * triage, campaigns) is never restricted. `registryDir` is
 * `~/.shipwright-webui` unless `SHIPWRIGHT_DATA_DIR` overrides it (config.ts).
 *
 * Every webui-file write site MUST derive its directory here; the meta-test
 * `project-data-dir-invariant.test.ts` fails on a direct `".shipwright-webui"`
 * path join elsewhere.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config.js";

export interface DataDirProject {
  id: string;
  path: string;
  shared?: boolean;
}

const LEGACY_DIRNAME = ".shipwright-webui";

/** The central dir for this project, regardless of the `shared` flag. */
export function centralDataDir(project: DataDirProject): string {
  // ids are UUIDs; refuse anything that could leave `projects/` (hand-edited registry).
  if (!/^[A-Za-z0-9_-]+$/.test(project.id)) throw new Error("invalid project id for data dir");
  return path.join(getConfig().registryDir, "projects", project.id);
}

/** Directory that holds `actions.json` + `pastes/` for this project (writes go here). */
export function projectDataDir(project: DataDirProject): string {
  if (project.shared === true) return path.join(project.path, LEGACY_DIRNAME);
  return centralDataDir(project);
}

/** The pre-central in-repo directory of a NON-shared project (read fallback + migration source). */
export function legacyRepoDataDir(project: DataDirProject): string | null {
  return project.shared === true || !project.path ? null : path.join(project.path, LEGACY_DIRNAME);
}

/**
 * Where to READ actions.json from: the central dir, unless it has none and the
 * project still carries a legacy in-repo one (a project not yet migrated).
 */
export function projectActionsReadDir(project: DataDirProject): string {
  const dir = projectDataDir(project);
  if (existsSync(path.join(dir, "actions.json"))) return dir;
  // Mirror fallback: a project just switched to `shared` keeps using its central actions.json.
  if (project.shared === true) {
    const central = centralDataDir(project);
    return existsSync(path.join(central, "actions.json")) ? central : dir;
  }
  const legacy = legacyRepoDataDir(project);
  return legacy && existsSync(path.join(legacy, "actions.json")) ? legacy : dir;
}

/**
 * Root the realpath guard must confine webui-file writes to: the repo for a
 * shared project, the central data dir otherwise (which lives OUTSIDE
 * `project.path`, so guarding against the repo would wrongly refuse it).
 */
export function projectDataGuardRoot(project: DataDirProject): string {
  return project.shared === true ? project.path : projectDataDir(project);
}
