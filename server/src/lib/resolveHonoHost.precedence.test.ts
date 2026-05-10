/*
 * Precedence regression tests on the server side, mirroring
 * `client/src/lib/resolveProxyTarget.precedence.test.ts`. Verifies
 * that the merged env shape (`.env.local` ∪ process.env) drives
 * resolveHonoHost correctly with process.env winning on conflict.
 *
 * Closes external code review (OpenAI MEDIUM #3): server-side
 * precedence behavior was previously asserted only by individual
 * HONO_HOST and SHIPWRIGHT_NETWORK_PROFILE tests, never by a merged
 * shape that simulates the actual `.env.local` + CLI override flow.
 *
 * See ADR-08Y (env-local-loading-fix).
 */

import { describe, it, expect, vi } from "vitest";
import { resolveHonoHost } from "./resolveHonoHost.js";

const fakeTailscaleExec = (ip = "100.64.0.1") => vi.fn(() => `${ip}\n`);

describe("resolveHonoHost env-merge precedence (.env.local vs process.env)", () => {
  function merge(
    fromFile: Record<string, string | undefined>,
    fromProcess: Record<string, string | undefined>,
  ): Record<string, string | undefined> {
    return { ...fromFile, ...fromProcess };
  }

  it("file-only SHIPWRIGHT_NETWORK_PROFILE=tailscale → tailscale IP", () => {
    const env = merge({ SHIPWRIGHT_NETWORK_PROFILE: "tailscale" }, {});
    expect(resolveHonoHost(env, fakeTailscaleExec("100.64.0.1"))).toBe(
      "100.64.0.1",
    );
  });

  it("process.env HONO_HOST wins over file profile (CLI override)", () => {
    const env = merge(
      { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
      { HONO_HOST: "127.0.0.1" },
    );
    expect(resolveHonoHost(env, fakeTailscaleExec())).toBe("127.0.0.1");
  });

  it("empty-string HONO_HOST normalized as unset (shell `HONO_HOST=` pattern)", () => {
    const env = merge(
      { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
      { HONO_HOST: "" },
    );
    expect(resolveHonoHost(env, fakeTailscaleExec("100.64.0.1"))).toBe(
      "100.64.0.1",
    );
  });

  it("file SHIPWRIGHT_TAILSCALE_IP wins over subprocess auto-detect", () => {
    const env = merge(
      {
        SHIPWRIGHT_NETWORK_PROFILE: "tailscale",
        SHIPWRIGHT_TAILSCALE_IP: "100.99.99.99",
      },
      {},
    );
    const exec = vi.fn(() => "100.64.0.1\n");
    expect(resolveHonoHost(env, exec)).toBe("100.99.99.99");
    expect(exec).not.toHaveBeenCalled();
  });

  it("process.env SHIPWRIGHT_TAILSCALE_IP overrides file value (CLI > file)", () => {
    const env = merge(
      {
        SHIPWRIGHT_NETWORK_PROFILE: "tailscale",
        SHIPWRIGHT_TAILSCALE_IP: "100.99.99.99",
      },
      { SHIPWRIGHT_TAILSCALE_IP: "100.42.42.42" },
    );
    expect(resolveHonoHost(env, fakeTailscaleExec())).toBe("100.42.42.42");
  });

  it("missing .env.local + empty process.env → default loopback", () => {
    expect(resolveHonoHost({}, fakeTailscaleExec())).toBe("127.0.0.1");
  });

  it("file profile=open + no override → 0.0.0.0 (operator opted into wide bind)", () => {
    const env = merge({ SHIPWRIGHT_NETWORK_PROFILE: "open" }, {});
    expect(resolveHonoHost(env, fakeTailscaleExec())).toBe("0.0.0.0");
  });

  it("process.env profile beats file profile (later property wins)", () => {
    const env = merge(
      { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
      { SHIPWRIGHT_NETWORK_PROFILE: "local" }, // CLI says: revert to safe
    );
    expect(resolveHonoHost(env, fakeTailscaleExec())).toBe("127.0.0.1");
  });
});
