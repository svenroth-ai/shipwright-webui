import { describe, it, expect } from "vitest";
import { resolveHonoHost } from "./resolveHonoHost.js";

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
});
