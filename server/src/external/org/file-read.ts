/*
 * external/org/file-read.ts — GET /api/external/org/file.
 *
 * Mirrors `external/file/routes.ts` GET (symlink/realpath defense, ETag
 * fingerprint, nosniff), scoped to the six-target org allowlist instead of
 * an arbitrary project-relative path. Exists so the PUT handler's
 * `If-Match` contract is actually usable (a client needs the current
 * fingerprint before it can construct a conditional write) — `org-chart.json`
 * is deliberately unreachable here; it has its own typed endpoint
 * (`org-chart.ts`), because the acceptance bar for it is "malformed → error,
 * never a half structure", which needs parsing, not byte-streaming.
 *
 * Status codes:
 *   400 traversal / absolute / missing path / not-a-file
 *   403 symlink_forbidden / not_allowlisted
 *   404 missing target file
 *   500 stat / read failure
 */

import type { Hono } from "hono";
import { lstatSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";

import { realPathGuard } from "../../core/path-guard.js";
import { resolveOrgAllowlistedTarget } from "./_helpers.js";
import { fileFingerprint } from "../file/_helpers.js";

export interface OrgFileReadDeps {
  leadsRoot: string;
  lstatSync?: (path: string) => { isSymbolicLink(): boolean };
}

export function registerOrgFileRead(app: Hono, deps: OrgFileReadDeps): void {
  const { leadsRoot } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));

  app.get("/api/external/org/file", async (c) => {
    const relpath = c.req.query("path");
    if (!relpath || relpath.length === 0) {
      return c.json({ error: "path_required" }, 400);
    }

    const target = resolveOrgAllowlistedTarget(leadsRoot, relpath);
    if (!target.ok) {
      const status = target.reason === "not_allowlisted" ? 403 : 400;
      const err = target.reason === "traversal" ? "path_traversal" : target.reason;
      return c.json({ error: err, detail: target.reason }, status);
    }

    // Code-review fix: lstat BEFORE stat() — stat() follows symlinks, so a
    // final-component symlink that happens to resolve back under leadsRoot
    // was silently served 200 despite the docstring promising 403
    // symlink_forbidden (the same defense file-write.ts already applies).
    try {
      if (lstat(target.absolute).isSymbolicLink()) {
        return c.json({ error: "symlink_forbidden", path: relpath }, 403);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        return c.json(
          { error: "file_stat_failed", detail: String(err).slice(0, 200) },
          500,
        );
      }
    }

    let st;
    try {
      st = await stat(target.absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      return c.json(
        { error: "file_stat_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    if (!st.isFile()) {
      return c.json({ error: "not_a_file", path: relpath }, 400);
    }

    const realGuard = realPathGuard(leadsRoot, target.absolute);
    if (!realGuard.ok) {
      return c.json({ error: "path_traversal", detail: realGuard.reason }, 400);
    }

    let body: Buffer;
    try {
      body = readFileSync(target.absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      return c.json(
        { error: "file_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("ETag", `"${fileFingerprint(body)}"`);
    c.header("Cache-Control", "private, max-age=0, must-revalidate");
    return c.body(new Uint8Array(body));
  });
}
