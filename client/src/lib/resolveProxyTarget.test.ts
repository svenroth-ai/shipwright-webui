/*
 * Tests for resolveProxyTarget — Vite /api proxy URL builder.
 * Closes the Hono-bind/proxy-target gap that external review (Gemini
 * HIGH) flagged for the `tailscale` and `open` profiles. See ADR-08X.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveProxyTarget } from "./resolveProxyTarget";

const fakeTailscaleExec = (ip = "100.64.0.1") => vi.fn(() => `${ip}\n`);

describe("resolveProxyTarget", () => {
  it("default: http://127.0.0.1:3847 (no env)", () => {
    expect(resolveProxyTarget({}, fakeTailscaleExec())).toBe(
      "http://127.0.0.1:3847",
    );
  });

  it("respects PORT env", () => {
    expect(resolveProxyTarget({ PORT: "3848" }, fakeTailscaleExec())).toBe(
      "http://127.0.0.1:3848",
    );
  });

  it("explicit HONO_HOST overrides profile (backward compat)", () => {
    expect(
      resolveProxyTarget(
        { HONO_HOST: "127.0.0.1", SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
        fakeTailscaleExec(),
      ),
    ).toBe("http://127.0.0.1:3847");
  });

  it("profile=local → loopback target", () => {
    expect(
      resolveProxyTarget(
        { SHIPWRIGHT_NETWORK_PROFILE: "local" },
        fakeTailscaleExec(),
      ),
    ).toBe("http://127.0.0.1:3847");
  });

  it("profile=tailscale → tailscale-IP target", () => {
    expect(
      resolveProxyTarget(
        { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
        fakeTailscaleExec("100.64.0.1"),
      ),
    ).toBe("http://100.64.0.1:3847");
  });

  it("profile=open → 127.0.0.1 target (NOT 0.0.0.0 — wildcard not routable as HTTP destination)", () => {
    // External code review (OpenAI HIGH): http://0.0.0.0/ is a wildcard
    // bind, not a valid client-side destination. Use loopback for the
    // proxy target; loopback works against a 0.0.0.0 listener on the
    // same host.
    expect(
      resolveProxyTarget(
        { SHIPWRIGHT_NETWORK_PROFILE: "open" },
        fakeTailscaleExec(),
      ),
    ).toBe("http://127.0.0.1:3847");
  });

  it("HONO_HOST=true (dual-stack) → resolves to 127.0.0.1 for proxy (loopback works for ::)", () => {
    // We avoid building http://[::]:3847 in the proxy target — pick
    // localhost which routes via loopback and works for both IPv4/IPv6
    // listeners.
    expect(
      resolveProxyTarget({ HONO_HOST: "true" }, fakeTailscaleExec()),
    ).toBe("http://127.0.0.1:3847");
  });

  it("HONO_HOST=<ipv4> → that IPv4 in URL", () => {
    expect(
      resolveProxyTarget({ HONO_HOST: "192.168.1.50" }, fakeTailscaleExec()),
    ).toBe("http://192.168.1.50:3847");
  });

  it("invalid profile rethrows (loud-fail)", () => {
    expect(() =>
      resolveProxyTarget(
        { SHIPWRIGHT_NETWORK_PROFILE: "everywhere" },
        fakeTailscaleExec(),
      ),
    ).toThrow();
  });
});
