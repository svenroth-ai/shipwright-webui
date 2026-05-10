/*
 * Mirror of `server/src/lib/resolveTailscaleIp.test.ts` — keep in sync.
 * Cross-mirror parity asserted via `network-profile-sync.test.ts` in the
 * server side. See ADR-080 (duplicate-types pattern) + ADR-08X
 * (network-profile-flag).
 */

import { describe, it, expect, vi } from "vitest";
import { resolveTailscaleIp } from "./resolveTailscaleIp";

function fakeExec(stdout: string | Error) {
  return vi.fn(() => {
    if (stdout instanceof Error) throw stdout;
    return stdout;
  });
}

describe("resolveTailscaleIp (client mirror)", () => {
  it("env override wins — returns trimmed IPv4", () => {
    const exec = fakeExec("should-not-be-called");
    expect(
      resolveTailscaleIp(
        { SHIPWRIGHT_TAILSCALE_IP: "  100.64.0.1  " },
        exec,
      ),
    ).toBe("100.64.0.1");
    expect(exec).not.toHaveBeenCalled();
  });

  it("env override rejects non-IPv4 (out-of-bounds octet)", () => {
    expect(() =>
      resolveTailscaleIp(
        { SHIPWRIGHT_TAILSCALE_IP: "999.999.999.999" },
        fakeExec(""),
      ),
    ).toThrow(/SHIPWRIGHT_TAILSCALE_IP/);
  });

  it("env override rejects garbage", () => {
    expect(() =>
      resolveTailscaleIp(
        { SHIPWRIGHT_TAILSCALE_IP: "not-an-ip" },
        fakeExec(""),
      ),
    ).toThrow();
  });

  it("env override empty falls through to exec", () => {
    expect(
      resolveTailscaleIp(
        { SHIPWRIGHT_TAILSCALE_IP: "" },
        fakeExec("100.64.0.1\n"),
      ),
    ).toBe("100.64.0.1");
  });

  it("subprocess success — single IPv4 line", () => {
    expect(resolveTailscaleIp({}, fakeExec("100.64.0.1\n"))).toBe(
      "100.64.0.1",
    );
  });

  it("subprocess success — multi-line, returns first VALID IPv4", () => {
    expect(
      resolveTailscaleIp(
        {},
        fakeExec("\nnot-an-ip\n100.64.0.1\nfd7a:115c::1\n100.64.0.2\n"),
      ),
    ).toBe("100.64.0.1");
  });

  it("subprocess success — handles Windows CRLF", () => {
    expect(
      resolveTailscaleIp({}, fakeExec("100.64.0.1\r\n100.64.0.2\r\n")),
    ).toBe("100.64.0.1");
  });

  it("subprocess returns empty stdout — throws actionable error", () => {
    expect(() => resolveTailscaleIp({}, fakeExec(""))).toThrow(
      /SHIPWRIGHT_TAILSCALE_IP/,
    );
  });

  it("subprocess returns IPv6-only — throws", () => {
    expect(() =>
      resolveTailscaleIp({}, fakeExec("fd7a:115c::1\nfd7a:115c::2\n")),
    ).toThrow();
  });

  it("subprocess throws (CLI not found) — throws actionable error", () => {
    expect(() =>
      resolveTailscaleIp(
        {},
        fakeExec(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
      ),
    ).toThrow(/SHIPWRIGHT_TAILSCALE_IP/);
  });

  it("subprocess timeout → throws actionable error mentioning timeout", () => {
    expect(() =>
      resolveTailscaleIp(
        {},
        fakeExec(
          Object.assign(new Error("Command timed out"), { code: "ETIMEDOUT" }),
        ),
      ),
    ).toThrow(/timed out/);
  });

  it("env override invalid even when exec would succeed → throws (strict)", () => {
    expect(() =>
      resolveTailscaleIp(
        { SHIPWRIGHT_TAILSCALE_IP: "192.168.0.999" },
        fakeExec("100.64.0.1\n"),
      ),
    ).toThrow(/SHIPWRIGHT_TAILSCALE_IP/);
  });
});
