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
import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync } from "node:fs";

import { realPathGuard } from "../../core/path-guard.js";
import { resolveOrgAllowlistedTarget } from "./_helpers.js";
import { fileFingerprint } from "../file/_helpers.js";

export interface OrgFileReadDeps {
  leadsRoot: string;
  /**
   * Test seam for the O_NOFOLLOW open below (e.g. to simulate an ELOOP a
   * mocked final-component symlink would produce, without needing a REAL
   * symlink on disk — those require elevated privileges on Windows CI).
   * Defaults to the real `openSync`.
   */
  openSync?: typeof openSync;
}

export function registerOrgFileRead(app: Hono, deps: OrgFileReadDeps): void {
  const { leadsRoot } = deps;
  const open = deps.openSync ?? openSync;

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

    const realGuard = realPathGuard(leadsRoot, target.absolute);
    if (!realGuard.ok) {
      return c.json({ error: "path_traversal", detail: realGuard.reason }, 400);
    }

    // CodeQL js/file-system-race fix: a separate lstat-check + stat + read
    // (each its own syscall against the PATH) leaves a window where the
    // final component could be swapped for a symlink between checks. Open
    // ONCE with O_NOFOLLOW — the kernel atomically refuses a symlinked final
    // component (ELOOP), so there is no gap left to race — then fstat/read
    // the SAME fd, so what gets served is provably what got checked.
    let fd: number;
    try {
      fd = open(target.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      if (code === "ELOOP") {
        return c.json({ error: "symlink_forbidden", path: relpath }, 403);
      }
      return c.json(
        { error: "file_stat_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    try {
      if (!fstatSync(fd).isFile()) {
        return c.json({ error: "not_a_file", path: relpath }, 400);
      }
      const body = readFileSync(fd);
      c.header("Content-Type", "text/markdown; charset=utf-8");
      c.header("X-Content-Type-Options", "nosniff");
      c.header("ETag", `"${fileFingerprint(body)}"`);
      c.header("Cache-Control", "private, max-age=0, must-revalidate");
      return c.body(new Uint8Array(body));
    } catch (err) {
      return c.json(
        { error: "file_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    } finally {
      closeSync(fd);
    }
  });
}
