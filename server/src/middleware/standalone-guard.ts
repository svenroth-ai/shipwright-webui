/**
 * middleware/standalone-guard.ts — the HARD guard behind "a standalone project
 * is never written to" (iterate-2026-10-29-standalone-mode).
 *
 * One chokepoint instead of a check in every route: any non-read request that
 * targets a repo-writing surface of a STANDALONE project is refused with 403
 * `standalone_project_read_only` before the route runs. Surfaces covered:
 * the markdown file write, the design-feedback write, the triage status
 * writes and the campaign `start` write (all mutate `.shipwright/` files in
 * the repo), plus the campaign `readiness` GET (it runs `git fetch`).
 */
import type { MiddlewareHandler } from "hono";
import { STANDALONE_REFUSAL, type DataDirProject } from "../core/project-data-dir.js";

const REPO_WRITE_PATTERNS: RegExp[] = [
  /^\/api\/external\/projects\/([^/]+)\/(?:file|design-feedback)\/?$/,
  /^\/api\/triage\/([^/]+)\//,
  /^\/api\/campaigns\/([^/]+)\/[^/]+\/start\/?$/,
];

/** Read-looking routes with repo side effects (`git fetch` writes .git/FETCH_HEAD). */
const REPO_SIDE_EFFECT_PATTERNS: RegExp[] = [/^\/api\/campaigns\/([^/]+)\/[^/]+\/readiness\/?$/];

export function standaloneGuard(
  getProjectById: (id: string) => DataDirProject | undefined,
): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    const readOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";
    for (const re of readOnly ? REPO_SIDE_EFFECT_PATTERNS : [...REPO_WRITE_PATTERNS, ...REPO_SIDE_EFFECT_PATTERNS]) {
      const m = re.exec(c.req.path);
      if (!m) continue;
      let id = m[1];
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep raw id */
      }
      if (getProjectById(id)?.standalone === true) {
        return c.json(STANDALONE_REFUSAL, 403);
      }
    }
    return next();
  };
}
