/*
 * external/design-review/serve.ts —
 * GET /api/external/projects/:projectId/designs/:rest{.+}.
 *
 * Serves the design phase's emitted review viewer + its relative assets
 * (`screens/*.html`, `flows/*.html`, css/js/images/fonts) so the WebUI can host
 * the viewer full-fidelity in a sandboxed iframe (AC1). This is DELIBERATELY
 * different from the generic `/file` read route (plan review R1):
 *
 *   - `.html` is served as **text/html** (not text/plain) so the viewer + the
 *     mockups actually RENDER — the whole point of this feature.
 *   - No `nosniff` / `default-src 'none'` CSP that would blank the viewer's
 *     inline <script>/<style> or its nested screen iframes. Isolation comes from
 *     the CLIENT-side iframe `sandbox` attribute, plus `frame-ancestors 'self'`
 *     (blocks third-party framing) here.
 *
 * The splat is rooted at `.shipwright/designs/` (NOT the project root, R5) so a
 * request can never reach elsewhere in the project; segments are URL-decoded
 * (screen names may contain spaces / non-ASCII). Only `index.html` gets the
 * feedback bridge injected (R4) — it overrides `window.showSaveFilePicker` so
 * the viewer's own `exportFeedback()` posts its markdown to the host instead of
 * downloading. Screen/flow files are served verbatim.
 *
 * Security posture (ADR — accepted trade-off, plan review R3): the served
 * content is the project's own design-phase artifacts, served loopback-only.
 * The client sandbox uses `allow-same-origin` (the viewer needs its own
 * `localStorage`), which — being same-origin — does not fully wall the content
 * off from the app. Acceptable for a local, single-user dev tool over the user's
 * own files; documented rather than silently shipped.
 */

import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, basename } from "node:path";
import path from "node:path";

import { pathGuard, realPathGuard } from "../../core/path-guard.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface DesignServeDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
}

/** MIME map that RENDERS (text/html for .html) — the opposite of the /file
 *  route's text/plain-everything policy. Unknown extensions → 415. */
const SERVE_MIME: Readonly<Record<string, string>> = Object.freeze({
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
});

/** The bridge injected into `index.html` (and nothing else). Overrides the File
 *  System Access save path so the viewer's existing `exportFeedback()` posts its
 *  markdown to the WebUI host. `write()` captures the blob text and posts it;
 *  it must NEVER reject (a throw would drop the viewer into its download
 *  fallback). Posts with `targetOrigin === location.origin` (same-origin host). */
const FEEDBACK_BRIDGE = `<script>
(function () {
  var HOST_ORIGIN = window.location.origin;
  function post(text) {
    try {
      window.parent.postMessage(
        { type: "shipwright:design-feedback", markdown: String(text) },
        HOST_ORIGIN
      );
    } catch (e) { /* never let a post error trip the viewer's download fallback */ }
  }
  window.showSaveFilePicker = function () {
    return Promise.resolve({
      createWritable: function () {
        return Promise.resolve({
          write: function (blob) {
            return Promise.resolve(
              blob && typeof blob.text === "function" ? blob.text() : blob
            ).then(post, function () { /* swallow */ });
          },
          close: function () { return Promise.resolve(); },
        });
      },
    });
  };
})();
</script>
`;

/** Insert the bridge before the first <script> (so the override is defined
 *  before the viewer script runs), else before </body>, else append. */
export function injectFeedbackBridge(html: string): string {
  const scriptIdx = html.search(/<script[\s>]/i);
  if (scriptIdx !== -1) {
    return html.slice(0, scriptIdx) + FEEDBACK_BRIDGE + html.slice(scriptIdx);
  }
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + FEEDBACK_BRIDGE + html.slice(bodyClose);
  }
  return html + FEEDBACK_BRIDGE;
}

/** URL-decode each path segment; returns null on a malformed escape. */
function decodeSplat(splat: string): string | null {
  try {
    return splat
      .split("/")
      .map((seg) => decodeURIComponent(seg))
      .join("/");
  } catch {
    return null;
  }
}

export function registerDesignServe(app: Hono, deps: DesignServeDeps): void {
  const { getProjectById } = deps;

  app.get("/api/external/projects/:projectId/designs/:rest{.+}", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const rawSplat = c.req.param("rest");
    const splat = decodeSplat(rawSplat ?? "");
    if (splat === null || splat.length === 0) {
      return c.json({ error: "path_required" }, 400);
    }

    // Root the guard at `.shipwright/designs` — a request can never escape the
    // designs subtree into the rest of the project (plan review R5).
    const designsRoot = path.join(project.path, ".shipwright", "designs");
    const guard = pathGuard(designsRoot, splat);
    if (!guard.ok) {
      const err = guard.reason === "traversal" ? "path_traversal" : guard.reason;
      return c.json({ error: err, detail: guard.reason }, 400);
    }

    let st;
    try {
      st = await stat(guard.absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return c.json({ error: "not_found", path: splat }, 404);
      return c.json({ error: "stat_failed", detail: String(err).slice(0, 200) }, 500);
    }
    if (!st.isFile()) return c.json({ error: "not_a_file", path: splat }, 400);

    const realGuard = realPathGuard(designsRoot, guard.absolute);
    if (!realGuard.ok) {
      return c.json({ error: "path_traversal", detail: realGuard.reason }, 400);
    }

    const ext = extname(guard.absolute).toLowerCase().slice(1);
    const mime = SERVE_MIME[ext];
    if (!mime) {
      return c.json({ error: "unsupported_asset", extension: ext || null }, 415);
    }

    let buf: Buffer;
    try {
      buf = readFileSync(realGuard.absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return c.json({ error: "not_found", path: splat }, 404);
      return c.json({ error: "read_failed", detail: String(err).slice(0, 200) }, 500);
    }

    c.header("Content-Type", mime);
    // Block third-party framing; do NOT set nosniff / default-src 'none' — the
    // viewer must execute its own inline script and frame its screens.
    c.header("Content-Security-Policy", "frame-ancestors 'self'");
    c.header("Cache-Control", "no-store");

    const isIndex = basename(guard.absolute).toLowerCase() === "index.html";
    if (isIndex) {
      return c.body(injectFeedbackBridge(buf.toString("utf-8")));
    }
    return c.body(new Uint8Array(buf));
  });
}
