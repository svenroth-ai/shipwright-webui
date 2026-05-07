import { describe, it, expect } from "vitest";
import { app } from "./index.js";

describe("GET /api/health", () => {
  it("returns 200 with status ok, version, and uptime", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });
});

describe("Unknown routes", () => {
  it("returns 404 with JSON error body", async () => {
    const res = await app.request("/api/nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

describe("CORS", () => {
  it("includes CORS headers for localhost origins", async () => {
    const res = await app.request("/api/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173"
    );
  });

  it("rejects substring-attack lookalike (was a gap in the pre-v0.8.4 'origin.includes(localhost)' check)", async () => {
    // The old gate did `origin.includes("localhost")` which would have
    // happily echoed `http://evil-localhost-attack.com` back into the
    // Access-Control-Allow-Origin header. The v0.8.4 helper parses the
    // origin via WHATWG URL and matches on hostname equality, so this
    // case is rejected even in the default loopback policy.
    const res = await app.request("/api/health", {
      headers: { Origin: "http://evil-localhost-attack.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects Tailscale MagicDNS Origin in the default loopback-only policy", async () => {
    // Default test env carries no HONO_HOST / WEBUI_TRUSTED_ORIGINS,
    // so the policy is loopback-only — Tailscale Origin must NOT
    // receive CORS approval. (Widening is covered by the
    // resolveTrustedOrigins.test.ts unit tests; the integration test
    // here documents the back-compat default.)
    const res = await app.request("/api/health", {
      headers: { Origin: "http://webui-host.tailnet.ts.net:5173" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("Error handling", () => {
  it("produces correct JSON for thrown AppError instances", async () => {
    // The /api/nonexistent route triggers a 404 AppError via the notFound handler
    const res = await app.request("/api/nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
