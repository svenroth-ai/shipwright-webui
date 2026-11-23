/*
 * routes/org-write-guard.ts — the cross-site guard of the browser-facing org writes
 * (`/api/org/*` POST and PUT: countersign, reject, beat-register release, the lead setup
 * wizard, the charter PUT). Same two rules as the reminder routes:
 *
 *   - a request the browser marks `Sec-Fetch-Site: cross-site` is refused (403): another
 *     website must not be able to make the operator's browser decide a proposal;
 *   - a POST needs a JSON content-type (415 otherwise): a cross-site "simple" POST
 *     (text/plain form, no preflight) would otherwise reach the handler, whose body parse is
 *     lenient about the type. Our own client always sends `application/json`.
 *
 * Not an authentication: a non-browser caller sets any header it likes. It closes the
 * drive-by browser path only. The PUT charter body is markdown and a PUT is never a "simple"
 * request, so only the cross-site rule applies to it.
 */

import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const orgWriteGuard: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  if (c.req.header("sec-fetch-site") === "cross-site") return c.json({ error: "cross_site_refused" }, 403);
  if (c.req.method === "POST" && !(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }
  return next();
};
