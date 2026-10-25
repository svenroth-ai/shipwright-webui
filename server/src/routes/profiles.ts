import { Hono } from "hono";
import { readdirSync } from "node:fs";
import { loadProfile, getProfilesDir } from "../core/profile-loader.js";
import { createStackProfilesRoutes } from "./stack-profiles.js";
import { createAdoptScanRoutes } from "./adopt-scan.js";

export interface ProfileSummary {
  name: string;
  label?: string;
  description?: string;
}

export interface ProfilesRouteDeps {
  /** When given, also mounts the custom stack-profile routes (`/api/stack-profiles`). */
  projectManager?: { getById(id: string): { path: string; synthesized?: boolean } | undefined };
  profilesDir?: string;
  readdirSync?: (path: string) => string[];
  loadProfile?: (name: string, dir: string) => { name?: string; label?: string; description?: string } | null;
}

/**
 * Iterate 14.4 — GET /api/profiles
 *
 * Lists all profile JSON files in `shared/profiles/` as ProfileSummary
 * objects, sorted alphabetically by `name`. Files starting with `_` are
 * skipped (internal/disabled). Malformed JSON is logged and skipped — the
 * route never 500s on a single bad file.
 */
export function createProfilesRoutes(deps: ProfilesRouteDeps = {}): Hono {
  const app = new Hono();
  if (deps.projectManager) {
    const pm = deps.projectManager;
    // Read-only Adopt-screen scan; mounted here so index.ts (over its bloat limit) does not grow.
    app.route("/", createAdoptScanRoutes());
    app.route("/", createStackProfilesRoutes({
      getProjectPath: (id) => {
        const p = pm.getById(id);
        return p && !p.synthesized ? p.path : undefined;
      },
    }));
  }
  const dir = deps.profilesDir ?? getProfilesDir();
  const readdir = deps.readdirSync ?? ((p: string) => readdirSync(p));
  const load = deps.loadProfile ?? loadProfile;

  app.get("/api/profiles", (c) => {
    let entries: string[];
    try {
      entries = readdir(dir);
    } catch (err) {
      console.error(JSON.stringify({
        level: "warn",
        message: "Failed to read profiles directory",
        dir,
        error: String(err),
      }));
      return c.json({ data: [] });
    }

    const profiles: ProfileSummary[] = [];
    for (const file of entries) {
      if (!file.endsWith(".json")) continue;
      if (file.startsWith("_")) continue;
      const name = file.replace(/\.json$/, "");
      const data = load(name, dir);
      if (!data) {
        console.error(JSON.stringify({
          level: "warn",
          message: "Skipping malformed or unreadable profile",
          file,
        }));
        continue;
      }
      profiles.push({
        name: data.name ?? name,
        ...(data.label !== undefined && { label: data.label }),
        ...(data.description !== undefined && { description: data.description }),
      });
    }

    profiles.sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ data: profiles });
  });

  return app;
}
