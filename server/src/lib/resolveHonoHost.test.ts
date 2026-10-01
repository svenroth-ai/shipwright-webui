import { describe, it, expect, vi } from "vitest";
import { resolveHonoHost } from "./resolveHonoHost.js";

const fakeTailscaleExec = (ip = "100.64.0.1") => vi.fn(() => `${ip}\n`);

// @covers FR-01.31
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
    expect(resolveHonoHost({ HONO_HOST: "webui-host.tailnet.ts.net" })).toBe(
      "webui-host.tailnet.ts.net",
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

  // === Tailscale HTTPS front: tailscaled cannot dial the machine's own tailnet IP ===

  it("profile=tailscale + SHIPWRIGHT_TAILSCALE_HTTPS=1 binds loopback, not the tailnet IP", () => {
    const exec = fakeTailscaleExec("100.64.0.9");
    expect(
      resolveHonoHost(
        { SHIPWRIGHT_NETWORK_PROFILE: "tailscale", SHIPWRIGHT_TAILSCALE_HTTPS: "1" },
        exec,
      ),
    ).toBe("127.0.0.1");
  });

  it("profile=tailscale without the HTTPS flag still binds the tailnet IP", () => {
    for (const flag of [undefined, "0", "off", ""]) {
      expect(
        resolveHonoHost(
          { SHIPWRIGHT_NETWORK_PROFILE: "tailscale", SHIPWRIGHT_TAILSCALE_HTTPS: flag },
          fakeTailscaleExec("100.64.0.9"),
        ),
      ).toBe("100.64.0.9");
    }
  });

  it("the HTTPS flag does not touch other profiles or an explicit HONO_HOST", () => {
    expect(
      resolveHonoHost(
        { SHIPWRIGHT_NETWORK_PROFILE: "open", SHIPWRIGHT_TAILSCALE_HTTPS: "1" },
        fakeTailscaleExec(),
      ),
    ).toBe("0.0.0.0");
    expect(
      resolveHonoHost(
        { HONO_HOST: "100.64.0.1", SHIPWRIGHT_NETWORK_PROFILE: "tailscale", SHIPWRIGHT_TAILSCALE_HTTPS: "1" },
        fakeTailscaleExec(),
      ),
    ).toBe("100.64.0.1");
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
        fakeTailscaleExec("100.64.0.1"),
      ),
    ).toBe("100.64.0.1");
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
