/**
 * project-data-migrate.ts — move a project's legacy in-repo webui files
 * (`<repo>/.shipwright-webui/`) into the central data dir
 * (iterate-2026-10-30-central-data-default).
 *
 * Copy → verify → delete, per file, and NEVER overwrite a file that already
 * exists centrally (the conflict is reported and the repo copy is left alone).
 * Idempotent: a second run finds nothing to move. Only webui-owned files are
 * touched: `actions.json` and `pastes/*`. The legacy `.code-workspace` file is
 * left alone: its relative `..` folder would point at the wrong place centrally.
 */
import fs from "node:fs";
import path from "node:path";
import {
  legacyRepoDataDir,
  projectDataDir,
  type DataDirProject,
} from "./project-data-dir.js";

export interface MigrateResult {
  moved: string[];
  conflicts: string[];
}

export interface DataStatus {
  shared: boolean;
  centralDir: string;
  /** A legacy in-repo `.shipwright-webui/` with webui files still exists. */
  legacyPresent: boolean;
}

/** A real directory (a symlink/junction could lead outside the repo). */
function isRealDir(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function legacyFiles(dir: string): string[] {
  const out: string[] = [];
  if (!isRealDir(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name === "actions.json") out.push(e.name);
  }
  const pastes = path.join(dir, "pastes");
  if (isRealDir(pastes)) {
    for (const e of fs.readdirSync(pastes, { withFileTypes: true })) {
      if (e.isFile()) out.push(path.join("pastes", e.name));
    }
  }
  return out;
}

export function dataStatus(project: DataDirProject): DataStatus {
  const legacy = legacyRepoDataDir(project);
  return {
    shared: project.shared === true,
    centralDir: projectDataDir(project),
    legacyPresent: !!legacy && legacyFiles(legacy).length > 0,
  };
}

export function migrateProjectData(project: DataDirProject): MigrateResult {
  const result: MigrateResult = { moved: [], conflicts: [] };
  const src = legacyRepoDataDir(project);
  if (!src) return result;
  const dest = projectDataDir(project);
  for (const rel of legacyFiles(src)) {
    const from = path.join(src, rel);
    const to = path.join(dest, rel);
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      // COPYFILE_EXCL: never overwrite (nor write through a dangling symlink).
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    } catch {
      result.conflicts.push(rel);
      continue;
    }
    try {
      // Verify before deleting the original: a short copy must never cost the user data.
      if (!fs.readFileSync(from).equals(fs.readFileSync(to))) {
        fs.rmSync(to, { force: true });
        result.conflicts.push(rel);
        continue;
      }
      fs.unlinkSync(from);
      result.moved.push(rel);
    } catch {
      result.conflicts.push(rel);
    }
  }
  // Tidy up only directories we emptied; a non-empty one belongs to the user.
  for (const d of [path.join(src, "pastes"), src]) {
    try {
      if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    } catch {
      /* leave it */
    }
  }
  return result;
}
