/*
 * /api/stack-profiles — custom stack profiles (project / user / bundled).
 *
 *   GET  /api/stack-profiles[?projectId=]   list + source + validity (resolver `list --json`)
 *   POST /api/stack-profiles/validate       { name, projectId? } → resolver `validate`
 *   POST /api/stack-profiles                { from, name, scope, projectId? } create-from-bundled
 *
 * Distinct from the legacy `GET /api/profiles` (bundled snapshot, name/label
 * only, used by project creation) — that route cannot see custom profiles.
 * Read outcomes are 200 with a discriminated `status` (the client renders an
 * honest card for each, like /api/wizard/grade); only a malformed REQUEST or a
 * create conflict is a 4xx.
 */

import { Hono } from "hono";

import {
  listStackProfiles,
  validateStackProfile,
  type StackProfileDeps,
} from "../core/stack-profiles.js";
import {
  createStackProfileFromBundled,
  type CreateStackProfileDeps,
  type StackProfileScope,
} from "../core/stack-profiles-create.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface StackProfilesRouteArgs {
  /** projectId → absolute project path (undefined = unknown / synthesized). */
  getProjectPath: (projectId: string) => string | undefined;
  deps?: CreateStackProfileDeps & StackProfileDeps;
}

export function createStackProfilesRoutes(args: StackProfilesRouteArgs): Hono {
  const app = new Hono();
  const deps = args.deps ?? {};

  /** Returns the project path, `undefined` when none asked, or `null` when asked-but-unknown. */
  const projectRootFor = (projectId: unknown): string | undefined | null => {
    if (projectId === undefined || projectId === null || projectId === "") return undefined;
    if (typeof projectId !== "string") return null;
    return args.getProjectPath(projectId) ?? null;
  };

  app.get("/api/stack-profiles", async (c) => {
    const root = projectRootFor(c.req.query("projectId"));
    if (root === null) return c.json({ status: "failed", reason: "Unknown project." }, 404);
    return c.json(await listStackProfiles({ projectRoot: root }, deps));
  });

  app.post("/api/stack-profiles/validate", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (!isObject(body) || typeof body.name !== "string" || body.name.length === 0) {
      return c.json({ status: "failed", reason: "No profile name was given." }, 400);
    }
    const root = projectRootFor(body.projectId);
    if (root === null) return c.json({ status: "failed", reason: "Unknown project." }, 404);
    return c.json(await validateStackProfile({ name: body.name, projectRoot: root }, deps));
  });

  app.post("/api/stack-profiles", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (
      !isObject(body) ||
      typeof body.from !== "string" ||
      typeof body.name !== "string" ||
      (body.scope !== "project" && body.scope !== "user")
    ) {
      return c.json({ status: "invalid-request", reason: "Pick a built-in profile, a name and where to save it." }, 400);
    }
    const scope: StackProfileScope = body.scope;
    const root = projectRootFor(body.projectId);
    if (root === null) return c.json({ status: "invalid-request", reason: "Unknown project." }, 404);

    const outcome = await createStackProfileFromBundled(
      { from: body.from, name: body.name, scope, projectRoot: root },
      deps,
    );
    const code = { created: 201, "invalid-request": 400, exists: 409, failed: 500 }[outcome.status];
    return c.json(outcome, code as 201 | 400 | 409 | 500);
  });

  return app;
}
