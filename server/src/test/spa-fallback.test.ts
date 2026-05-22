import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Regression guard for iterate-2026-05-22-spa-fallback.
 *
 * BUG: hard-reload of any client-side SPA route (/triage, /inbox,
 * /tasks/:taskId, /projects, /diagnostics, /settings) hit
 * `app.notFound` and returned `{"error":"Not found"}` JSON because the
 * production server only wired `serveStatic({ root: client/dist })`
 * with no SPA fallback to `index.html`.
 *
 * FIX: a wildcard fallback after `serveStatic` reads
 * `client/dist/index.html` for any GET that is NOT under `/api/`. The
 * /api/* surface still returns JSON 404 for unknown routes (Webui's
 * REST contract — not browser routes).
 *
 * The test points the server's `config.staticDir` at a fixture
 * (`server/src/test/fixtures/spa-fallback-static/`) via the
 * `SHIPWRIGHT_STATIC_DIR` env override declared in
 * `server/src/config.ts`, so the assertion does not depend on a real
 * `client/dist` build being present in the worktree.
 *
 * Env wiring runs at module top level (above the dynamic `import`) so
 * `index.ts`'s module-load `getConfig()` (line ~65) picks up the
 * fixture. A `vi.hoisted` block won't work because it executes before
 * the `path` / `node:url` imports resolve.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureDir = path.resolve(__dirname, "fixtures", "spa-fallback-static");

process.env.SHIPWRIGHT_STATIC_DIR = fixtureDir;
// Same loopback-only CORS pin as index.test.ts so a dev shell's
// network-profile env doesn't widen the policy under test.
delete process.env.WEBUI_TRUSTED_ORIGINS;
delete process.env.HONO_HOST;
delete process.env.SHIPWRIGHT_NETWORK_PROFILE;

const { app } = await import("../index.js");

const SPA_ROUTES = [
  "/triage",
  "/inbox",
  "/tasks/abc-123",
  "/projects",
  "/diagnostics",
  "/settings",
];

describe("SPA fallback (iterate-2026-05-22-spa-fallback)", () => {
  it.each(SPA_ROUTES)(
    "GET %s returns 200 text/html with the SPA shell",
    async (routePath) => {
      const res = await app.request(routePath);
      expect(res.status, `expected 200 for ${routePath}`).toBe(200);
      const contentType = res.headers.get("content-type") ?? "";
      expect(contentType.toLowerCase()).toContain("text/html");
      const body = await res.text();
      expect(body).toContain('<div id="root"></div>');
      expect(body).toContain("__SPA_FALLBACK_FIXTURE__");
    },
  );

  it("GET / still serves index.html (root keeps working)", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div id="root"></div>');
  });

  it("serveStatic still wins over the fallback for real assets", async () => {
    const res = await app.request("/assets/real-asset.txt");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.trim()).toBe("real-static-asset-served-by-serveStatic");
  });

  it("/api/nonexistent still returns JSON 404 (NOT the SPA shell)", async () => {
    // Critical contract: the SPA fallback MUST NOT swallow unknown /api
    // routes — they need to surface as real 404s so the client doesn't
    // try to JSON.parse an HTML body.
    const res = await app.request("/api/nonexistent");
    expect(res.status).toBe(404);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType.toLowerCase()).toContain("application/json");
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("/api/health is unaffected (real handler still wins)", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
