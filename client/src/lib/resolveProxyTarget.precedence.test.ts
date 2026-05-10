/*
 * Precedence regression tests for the env-merge that vite.config.ts
 * uses: `{...envFromFile, ...process.env}` — process.env wins on
 * conflict so CLI/shell overrides always trump .env.local.
 *
 * Covers the wiring boundary that resolver unit tests miss
 * (external review #5, #8). The actual `loadEnv` call lives in
 * vite.config.ts and runs at Vite's config-load time; this test
 * simulates the merged-env shape and asserts the resolvers handle
 * it correctly.
 *
 * See ADR-08X (env-local-loading-fix) and resolveProxyTarget.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveProxyTarget } from "./resolveProxyTarget";
import { resolveViteHost } from "./resolveViteHost";

const fakeTailscaleExec = (ip = "100.64.0.1") => vi.fn(() => `${ip}\n`);

describe("env-merge precedence (.env.local vs process.env)", () => {
  function merge(
    fromFile: Record<string, string | undefined>,
    fromProcess: Record<string, string | undefined>,
  ): Record<string, string | undefined> {
    return { ...fromFile, ...fromProcess };
  }

  it("file-only profile picks up when process.env empty", () => {
    const env = merge(
      { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
      {},
    );
    expect(
      resolveProxyTarget(env, fakeTailscaleExec("100.64.0.1")),
    ).toBe("http://100.64.0.1:3847");
  });

  it("process.env HONO_HOST wins over file profile (CLI override for proxy target)", () => {
    const env = merge(
      { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
      { HONO_HOST: "127.0.0.1" }, // CLI prefix `HONO_HOST=127.0.0.1 npm run dev`
    );
    expect(resolveProxyTarget(env, fakeTailscaleExec())).toBe(
      "http://127.0.0.1:3847",
    );
  });

  it("process.env VITE_HOST wins over file profile for resolveViteHost (AC-4)", () => {
    // External code review (OpenAI LOW #4): the existing precedence
    // test above uses HONO_HOST not VITE_HOST. Add a dedicated
    // VITE_HOST-specific test that exercises AC-4's explicit
    // "VITE_HOST overrides profile" path.
    const env = merge(
      { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
      { VITE_HOST: "true" }, // CLI prefix `VITE_HOST=true npm run dev`
    );
    expect(resolveViteHost(env, fakeTailscaleExec("100.64.0.1"))).toEqual({
      host: true,
      allowedHosts: true,
    });
  });

  it("process.env VITE_HOST=<ip> wins over file profile", () => {
    const env = merge(
      { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
      { VITE_HOST: "192.168.1.50" },
    );
    expect(resolveViteHost(env, fakeTailscaleExec("100.64.0.1"))).toEqual({
      host: "192.168.1.50",
      allowedHosts: true,
    });
  });

  it("empty-string env-vars normalized as unset (regression for shell `VITE_HOST=` pattern)", () => {
    // External review #5: user might pass `VITE_HOST= npm run dev` to
    // unset a previously-exported var. Empty string MUST be treated
    // as unset so the .env.local profile takes effect.
    const env = merge(
      { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
      { VITE_HOST: "", HONO_HOST: "" },
    );
    expect(resolveProxyTarget(env, fakeTailscaleExec("100.64.0.1"))).toBe(
      "http://100.64.0.1:3847",
    );
    expect(resolveViteHost(env, fakeTailscaleExec("100.64.0.1"))).toEqual({
      host: "100.64.0.1",
      allowedHosts: ["100.64.0.1", ".ts.net"],
    });
  });

  it("file SHIPWRIGHT_TAILSCALE_IP wins over auto-detect when present", () => {
    const env = merge(
      {
        SHIPWRIGHT_NETWORK_PROFILE: "tailscale",
        SHIPWRIGHT_TAILSCALE_IP: "100.99.99.99",
      },
      {},
    );
    const exec = vi.fn(() => "100.64.0.1\n"); // exec WOULD return a different IP
    expect(resolveProxyTarget(env, exec)).toBe("http://100.99.99.99:3847");
    expect(exec).not.toHaveBeenCalled();
  });

  it("process.env SHIPWRIGHT_TAILSCALE_IP overrides file value (CLI > file)", () => {
    const env = merge(
      {
        SHIPWRIGHT_NETWORK_PROFILE: "tailscale",
        SHIPWRIGHT_TAILSCALE_IP: "100.99.99.99", // from .env.local
      },
      { SHIPWRIGHT_TAILSCALE_IP: "100.42.42.42" }, // CLI prefix wins
    );
    expect(resolveProxyTarget(env, fakeTailscaleExec())).toBe(
      "http://100.42.42.42:3847",
    );
  });

  it("missing .env.local + empty process.env → default loopback", () => {
    expect(resolveProxyTarget({}, fakeTailscaleExec())).toBe(
      "http://127.0.0.1:3847",
    );
    expect(resolveViteHost({}, fakeTailscaleExec())).toBeUndefined();
  });
});
