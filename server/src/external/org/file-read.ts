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

export type OrgFileReadCoreResult =
  | { status: 200; kind: "file"; body: Buffer; headers: Record<string, string> }
  | {
      status: 400 | 403 | 404 | 500;
      kind: "json";
      body: { error: string; path?: string; detail?: string };
    };

/** Pure core — shared by the secret-gated route and the plain-surface proxy. */
export function orgFileReadCore(
  deps: OrgFileReadDeps,
  relpath: string | undefined,
): OrgFileReadCoreResult {
  const { leadsRoot } = deps;
  const open = deps.openSync ?? openSync;

  if (!relpath || relpath.length === 0) {
    return { status: 400, kind: "json", body: { error: "path_required" } };
  }

  const target = resolveOrgAllowlistedTarget(leadsRoot, relpath);
  if (!target.ok) {
    const status = target.reason === "not_allowlisted" ? 403 : 400;
    const err = target.reason === "traversal" ? "path_traversal" : target.reason;
    return { status, kind: "json", body: { error: err, detail: target.reason } };
  }

  // External-review fix (MEDIUM, spec): `realPathGuard` used to run BEFORE
  // the open below. Its own docstring requires the target to already exist
  // (it calls `realpathSync`, which throws ENOENT for a missing path) —
  // calling it first meant a genuinely-missing allowlisted target (e.g. an
  // as-yet-uncreated `conventions.md`) reported 400 `path_traversal`
  // instead of 404 `not_found`, so the shared-documents viewer's not-found
  // state (`OrgDocViewerModal`) was unreachable for any missing doc. Fixed
  // by reordering to the same open-first pattern `lead-doc-read.ts` /
  // `audit-log.ts` already use — see their comments for the rationale.
  //
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
      return { status: 404, kind: "json", body: { error: "not_found", path: relpath } };
    }
    if (code === "ELOOP") {
      return { status: 403, kind: "json", body: { error: "symlink_forbidden", path: relpath } };
    }
    return {
      status: 500,
      kind: "json",
      body: { error: "file_stat_failed", detail: String(err).slice(0, 200) },
    };
  }

  try {
    if (!fstatSync(fd).isFile()) {
      return { status: 400, kind: "json", body: { error: "not_a_file", path: relpath } };
    }
    // Existence is now confirmed (the open above succeeded) — realPathGuard's
    // own contract requires exactly this ordering.
    const realGuard = realPathGuard(leadsRoot, target.absolute);
    if (!realGuard.ok) {
      return {
        status: 403,
        kind: "json",
        body: { error: "symlink_forbidden", detail: realGuard.reason, path: relpath },
      };
    }
    const body = readFileSync(fd);
    return {
      status: 200,
      kind: "file",
      body,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${fileFingerprint(body)}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    };
  } catch (err) {
    return {
      status: 500,
      kind: "json",
      body: { error: "file_read_failed", detail: String(err).slice(0, 200) },
    };
  } finally {
    closeSync(fd);
  }
}

export function registerOrgFileRead(app: Hono, deps: OrgFileReadDeps): void {
  app.get("/api/external/org/file", async (c) => {
    const result = orgFileReadCore(deps, c.req.query("path"));
    if (result.kind === "json") {
      return c.json(result.body, result.status);
    }
    for (const [key, value] of Object.entries(result.headers)) {
      c.header(key, value);
    }
    return c.body(new Uint8Array(result.body), result.status);
  });
}
