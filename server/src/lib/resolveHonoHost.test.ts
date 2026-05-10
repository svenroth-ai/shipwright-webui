import { describe, it, expect, vi } from "vitest";
import { resolveHonoHost } from "./resolveHonoHost.js";

const fakeTailscaleExec = (ip = "100.64.0.1") => vi.fn(() => `${ip}\n`);

describe("resolveHonoHost", () => {
  it("returns 127.0.0.1 when HONO_HOST is unset (loopback-only safe default)", () => {
    expect(resolveHonoHost({})).toBe("127.0.0.1");
  });

  it("returns 127.0.0.1 when HONO_HOST is empty string", () => {
    expect(resolveHonoHost({ HONO_HOST: "" })).toBe("127.0.0.1");
  });

  it('returns "::" (dual-stack all interfaces) when HONO_HOST=true', () => {
    expect(resolveHonoHost({ HONO_HOST: "true" })).toBe("::");
  });

  it("treats HONO_HOST=1 as truthy alias for true", () => {
    expect(resolveHonoHost({ HONO_HOST: "1" })).toBe("::");
  });

  it("returns the literal hostname when HONO_HOST=<hostname>", () => {
    expect(resolveHonoHost({ HONO_HOST: "pc-dinovo-002.tail4353f0.ts.net" })).toBe(
      "pc-dinovo-002.tail4353f0.ts.net",
    );
  });

  it("returns the literal IPv4 when HONO_HOST=<ipv4>", () => {
    expect(resolveHonoHost({ HONO_HOST: "100.64.0.1" })).toBe("100.64.0.1");
  });

  it("returns the literal IPv6 when HONO_HOST=<ipv6>", () => {
    expect(resolveHonoHost({ HONO_HOST: "fe80::1" })).toBe("fe80::1");
  });

  it("trims surrounding whitespace from HONO_HOST", () => {
    expect(resolveHonoHost({ HONO_HOST: "  true  " })).toBe("::");
    expect(resolveHonoHost({ HONO_HOST: "  127.0.0.1  " })).toBe("127.0.0.1");
  });

  // === Network profile fallback (ADR-08X) ===

  it("whitespace-only HONO_HOST treated as unset (falls through to profile/default)", () => {
    expect(
      resolveHonoHost(
        {
          HONO_HOST: "   ",
          SHIPWRIGHT_NETWORK_PROFILE: "open",
        },
        fakeTailscaleExec(),
      ),
    ).toBe("0.0.0.0");
  });

  it("explicit HONO_HOST overrides SHIPWRIGHT_NETWORK_PROFILE (backward compat)", () => {
    expect(
      resolveHonoHost(
        {
          HONO_HOST: "127.0.0.1",
          SHIPWRIGHT_NETWORK_PROFILE: "tailscale",
        },
        fakeTailscaleExec(),
      ),
    ).toBe("127.0.0.1");
  });

  it("SHIPWRIGHT_NETWORK_PROFILE=local → 127.0.0.1", () => {
    expect(
      resolveHonoHost(
        { SHIPWRIGHT_NETWORK_PROFILE: "local" },
        fakeTailscaleExec(),
      ),
    ).toBe("127.0.0.1");
  });

  it("SHIPWRIGHT_NETWORK_PROFILE=tailscale → resolved IP", () => {
    expect(
      resolveHonoHost(
        { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
        fakeTailscaleExec("100.105.29.88"),
      ),
    ).toBe("100.105.29.88");
  });

  it("SHIPWRIGHT_NETWORK_PROFILE=open → 0.0.0.0", () => {
    expect(
      resolveHonoHost(
        { SHIPWRIGHT_NETWORK_PROFILE: "open" },
        fakeTailscaleExec(),
      ),
    ).toBe("0.0.0.0");
  });

  it("invalid SHIPWRIGHT_NETWORK_PROFILE throws", () => {
    expect(() =>
      resolveHonoHost(
        { SHIPWRIGHT_NETWORK_PROFILE: "everywhere" },
        fakeTailscaleExec(),
      ),
    ).toThrow();
  });
});
