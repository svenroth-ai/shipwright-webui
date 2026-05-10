/*
 * Mirror of `server/src/lib/resolveNetworkProfile.test.ts` — keep in sync.
 * Cross-mirror parity asserted via `network-profile-sync.test.ts` in
 * the server. See ADR-080 (duplicate-types pattern) + ADR-08X
 * (network-profile-flag).
 */

import { describe, it, expect, vi } from "vitest";
import { resolveNetworkProfile } from "./resolveNetworkProfile";

const fakeTailscaleExec = (ip = "100.64.0.1") => vi.fn(() => `${ip}\n`);

describe("resolveNetworkProfile (client mirror)", () => {
  it("unset env → undefined", () => {
    expect(resolveNetworkProfile({}, fakeTailscaleExec())).toBeUndefined();
  });

  it("whitespace-only profile → undefined", () => {
    expect(
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "   " },
        fakeTailscaleExec(),
      ),
    ).toBeUndefined();
  });

  it("profile=local → host=127.0.0.1", () => {
    expect(
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "local" },
        fakeTailscaleExec(),
      ),
    ).toEqual({ profile: "local", host: "127.0.0.1" });
  });

  it("profile=tailscale → host from resolveTailscaleIp", () => {
    const exec = fakeTailscaleExec("100.64.0.1");
    expect(
      resolveNetworkProfile({ SHIPWRIGHT_NETWORK_PROFILE: "tailscale" }, exec),
    ).toEqual({ profile: "tailscale", host: "100.64.0.1" });
    expect(exec).toHaveBeenCalled();
  });

  it("profile=open → host=0.0.0.0", () => {
    expect(
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "open" },
        fakeTailscaleExec(),
      ),
    ).toEqual({ profile: "open", host: "0.0.0.0" });
  });

  it("invalid profile → throws with valid-values list", () => {
    expect(() =>
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "public" },
        fakeTailscaleExec(),
      ),
    ).toThrow(/local.*tailscale.*open/);
  });

  it("uppercase rejected", () => {
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
    expect(() =>
      resolveNetworkProfile(
        { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
        vi.fn(() => ""),
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
