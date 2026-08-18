import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createOrgRouter } from "../routes.js";
import { fileFingerprint } from "../../file/_helpers.js";

const ALL_ENDPOINTS: Array<{ method: string; path: string }> = [
  { method: "GET", path: "/api/external/org/file?path=conventions.md" },
  { method: "PUT", path: "/api/external/org/file?path=conventions.md" },
  { method: "GET", path: "/api/external/org/org-chart" },
  { method: "GET", path: "/api/external/org/leads/acme-lead/usage" },
  { method: "POST", path: "/api/external/org/decisions/countersign" },
  { method: "GET", path: "/api/external/org/leads/acme-lead/last-run" },
  { method: "GET", path: "/api/external/org/leads/acme-lead/beat-register" },
  { method: "POST", path: "/api/external/org/leads/acme-lead/beat-register/release" },
];

describe("createOrgRouter — host + secret gates", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-routes-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it.each(ALL_ENDPOINTS)(
    "$method $path — disallowed host is 403 host_not_allowed, checked before the secret",
    async ({ method, path: p }) => {
      const app = createOrgRouter({
        leadsRoot,
        honoHost: "0.0.0.0",
        leadsRouteSecret: undefined, // secret ALSO unconfigured — host must still win
      });
      const res = await app.request(p, { method });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("host_not_allowed");
    },
  );

  it.each(ALL_ENDPOINTS)(
    "$method $path — allowed host, unconfigured secret is 503",
    async ({ method, path: p }) => {
      const app = createOrgRouter({
        leadsRoot,
        honoHost: "127.0.0.1",
        leadsRouteSecret: undefined,
      });
      const res = await app.request(p, { method });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("leads_route_not_configured");
    },
  );

  it.each(ALL_ENDPOINTS)(
    "$method $path — allowed host, missing header is 401",
    async ({ method, path: p }) => {
      const app = createOrgRouter({
        leadsRoot,
        honoHost: "127.0.0.1",
        leadsRouteSecret: "s3cr3t",
      });
      const res = await app.request(p, { method });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("invalid_secret");
    },
  );

  it.each(ALL_ENDPOINTS)(
    "$method $path — allowed host, wrong header is 401",
    async ({ method, path: p }) => {
      const app = createOrgRouter({
        leadsRoot,
        honoHost: "127.0.0.1",
        leadsRouteSecret: "s3cr3t",
      });
      const res = await app.request(p, {
        method,
        headers: { "X-Shipwright-Leads-Secret": "wrong" },
      });
      expect(res.status).toBe(401);
    },
  );

  it("Tailscale-range host is allowed through the gate (reaches the handler, not a 403/401/503)", async () => {
    writeFileSync(path.join(leadsRoot, "conventions.md"), "# hi\n", "utf8");
    const app = createOrgRouter({
      leadsRoot,
      honoHost: "100.100.50.50",
      leadsRouteSecret: "s3cr3t",
    });
    const res = await app.request("/api/external/org/file?path=conventions.md", {
      headers: { "X-Shipwright-Leads-Secret": "s3cr3t" },
    });
    expect(res.status).toBe(200);
  });

  it("full happy path: correct host + correct secret reaches the GET handler", async () => {
    writeFileSync(path.join(leadsRoot, "conventions.md"), "# hi\n", "utf8");
    const app = createOrgRouter({
      leadsRoot,
      honoHost: "127.0.0.1",
      leadsRouteSecret: "s3cr3t",
    });
    const res = await app.request("/api/external/org/file?path=conventions.md", {
      headers: { "X-Shipwright-Leads-Secret": "s3cr3t" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# hi\n");
  });

  it("full happy path: PUT with correct gates + If-Match succeeds", async () => {
    const p = path.join(leadsRoot, "conventions.md");
    writeFileSync(p, "# hi\n", "utf8");
    const etag = `"${fileFingerprint(Buffer.from("# hi\n"))}"`;
    const app = createOrgRouter({
      leadsRoot,
      honoHost: "127.0.0.1",
      leadsRouteSecret: "s3cr3t",
    });
    const res = await app.request("/api/external/org/file?path=conventions.md", {
      method: "PUT",
      headers: { "X-Shipwright-Leads-Secret": "s3cr3t", "If-Match": etag },
      body: "# updated\n",
    });
    expect(res.status).toBe(200);
  });

  it("a configured secret shorter than 20 chars logs a boot-time weak-secret warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createOrgRouter({ leadsRoot, honoHost: "127.0.0.1", leadsRouteSecret: "short" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.error).toBe("leads_route_secret_weak");
    warnSpy.mockRestore();
  });

  it("a configured secret at/above 20 chars logs no weak-secret warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createOrgRouter({
      leadsRoot,
      honoHost: "127.0.0.1",
      leadsRouteSecret: "a".repeat(20),
    });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("routes not under /api/external/org/* are unaffected by the gate", async () => {
    const app = createOrgRouter({
      leadsRoot,
      honoHost: "0.0.0.0",
      leadsRouteSecret: undefined,
    });
    const res = await app.request("/some/other/path");
    expect(res.status).toBe(404); // Hono's default not-found, not a gate rejection
  });
});
