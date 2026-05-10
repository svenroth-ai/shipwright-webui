/*
 * Tests for resolveTailscaleIp — Tailscale IPv4 resolution with env override
 * + subprocess fallback. See ADR-08X (network-profile-flag).
 */

import { describe, it, expect, vi } from "vitest";
import { resolveTailscaleIp } from "./resolveTailscaleIp.js";

function fakeExec(stdout: string | Error, opts?: { stderr?: string }) {
  return vi.fn(() => {
    if (stdout instanceof Error) throw stdout;
    return stdout;
  });
}

describe("resolveTailscaleIp", () => {
  it("env override wins — returns trimmed IPv4", () => {
    const exec = fakeExec("should-not-be-called");
    const ip = resolveTailscaleIp(
      { SHIPWRIGHT_TAILSCALE_IP: "  100.105.29.88  " },
      exec,
    );
    expect(ip).toBe("100.105.29.88");
    expect(exec).not.toHaveBeenCalled();
  });

  it("env override rejects non-IPv4 (out-of-bounds octet)", () => {
    const exec = fakeExec("");
    expect(() =>
      resolveTailscaleIp({ SHIPWRIGHT_TAILSCALE_IP: "999.999.999.999" }, exec),
    ).toThrow(/SHIPWRIGHT_TAILSCALE_IP/);
  });

  it("env override rejects garbage", () => {
    const exec = fakeExec("");
    expect(() =>
      resolveTailscaleIp({ SHIPWRIGHT_TAILSCALE_IP: "not-an-ip" }, exec),
    ).toThrow();
  });

  it("env override rejects empty string (falls through to exec)", () => {
    const exec = fakeExec("100.64.0.1\n");
    const ip = resolveTailscaleIp({ SHIPWRIGHT_TAILSCALE_IP: "" }, exec);
    expect(ip).toBe("100.64.0.1");
  });

  it("subprocess success — single IPv4 line", () => {
    const exec = fakeExec("100.64.0.1\n");
    expect(resolveTailscaleIp({}, exec)).toBe("100.64.0.1");
  });

  it("subprocess success — multi-line, returns first VALID IPv4 (skips noise)", () => {
    const exec = fakeExec("\nnot-an-ip\n100.64.0.1\nfd7a:115c::1\n100.64.0.2\n");
    expect(resolveTailscaleIp({}, exec)).toBe("100.64.0.1");
  });

  it("subprocess success — handles Windows CRLF", () => {
    const exec = fakeExec("100.64.0.1\r\n100.64.0.2\r\n");
    expect(resolveTailscaleIp({}, exec)).toBe("100.64.0.1");
  });

  it("subprocess returns empty stdout — throws actionable error", () => {
    const exec = fakeExec("");
    expect(() => resolveTailscaleIp({}, exec)).toThrow(
      /SHIPWRIGHT_TAILSCALE_IP/,
    );
  });

  it("subprocess returns IPv6-only — throws (no IPv4 found)", () => {
    const exec = fakeExec("fd7a:115c:a1e0::1\nfd7a:115c:a1e0::2\n");
    expect(() => resolveTailscaleIp({}, exec)).toThrow();
  });

  it("subprocess throws (CLI not found) — throws actionable error", () => {
    const exec = fakeExec(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    expect(() => resolveTailscaleIp({}, exec)).toThrow(/SHIPWRIGHT_TAILSCALE_IP/);
  });

  it("subprocess throws (timeout) — throws actionable error mentioning timeout", () => {
    const exec = fakeExec(
      Object.assign(new Error("Command timed out"), { code: "ETIMEDOUT" }),
    );
    expect(() => resolveTailscaleIp({}, exec)).toThrow(/timed out/);
  });

  it("env override ignored if invalid even when exec would succeed", () => {
    // Strict semantics: explicit user-set value must be valid;
    // we don't silently fall through to exec on a typo.
    const exec = fakeExec("100.64.0.1\n");
    expect(() =>
      resolveTailscaleIp({ SHIPWRIGHT_TAILSCALE_IP: "192.168.0.999" }, exec),
    ).toThrow(/SHIPWRIGHT_TAILSCALE_IP/);
  });
});
