/*
 * Tests for resolveNetworkProfile — pure resolver from env →
 * { profile, host }. Tailscale exec is injected so tests are
 * deterministic. See ADR-08X (network-profile-flag).
 */

import { describe, it, expect, vi } from "vitest";
import { resolveNetworkProfile } from "./resolveNetworkProfile.js";

const fakeTailscaleExec = (ip = "100.64.0.1") =>
  vi.fn(() => `${ip}\n`);

describe("resolveNetworkProfile", () => {
  it("unset env → undefined (caller falls back to default)", () => {
    expect(resolveNetworkProfile({}, fakeTailscaleExec())).toBeUndefined();
  });

  it("whitespace-only profile → undefined (treated as unset)", () => {
    expect(
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "   " },
        fakeTailscaleExec(),
      ),
    ).toBeUndefined();
  });

  it("profile=local → host=127.0.0.1", () => {
    const result = resolveNetworkProfile(
      { SHIPWRIGHT_NETWORK_PROFILE: "local" },
      fakeTailscaleExec(),
    );
    expect(result).toEqual({ profile: "local", host: "127.0.0.1" });
  });

  it("profile=tailscale → host from resolveTailscaleIp", () => {
    const exec = fakeTailscaleExec("100.105.29.88");
    const result = resolveNetworkProfile(
      { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
      exec,
    );
    expect(result).toEqual({ profile: "tailscale", host: "100.105.29.88" });
    expect(exec).toHaveBeenCalled();
  });

  it("profile=open → host=0.0.0.0", () => {
    const result = resolveNetworkProfile(
      { SHIPWRIGHT_NETWORK_PROFILE: "open" },
      fakeTailscaleExec(),
    );
    expect(result).toEqual({ profile: "open", host: "0.0.0.0" });
  });

  it("invalid profile value → throws with valid-values list", () => {
    expect(() =>
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "public" },
        fakeTailscaleExec(),
      ),
    ).toThrow(/local.*tailscale.*open/);
  });

  it("uppercase rejected (lowercase-only contract)", () => {
    expect(() =>
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "LOCAL" },
        fakeTailscaleExec(),
      ),
    ).toThrow();
  });

  it("mixed case rejected", () => {
    expect(() =>
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "TailScale" },
        fakeTailscaleExec(),
      ),
    ).toThrow();
  });

  it("profile=tailscale propagates resolveTailscaleIp errors", () => {
    const failingExec = vi.fn(() => "");
    expect(() =>
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
        failingExec,
      ),
    ).toThrow(/SHIPWRIGHT_TAILSCALE_IP/);
  });

  it("profile=local does NOT call tailscale exec", () => {
    const exec = vi.fn(() => "");
    resolveNetworkProfile({ SHIPWRIGHT_NETWORK_PROFILE: "local" }, exec);
    expect(exec).not.toHaveBeenCalled();
  });

  it("profile=open does NOT call tailscale exec", () => {
    const exec = vi.fn(() => "");
    resolveNetworkProfile({ SHIPWRIGHT_NETWORK_PROFILE: "open" }, exec);
    expect(exec).not.toHaveBeenCalled();
  });
});
