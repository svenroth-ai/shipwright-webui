// `@hono/node-server`'s `serve(...)` previously omitted `hostname`, which
// makes Node default to listening on the unspecified address (::), reachable
// from every network interface — Tailscale and untrusted Wi-Fi alike. The
// safe default is loopback only; bind on every interface stays opt-in via
// HONO_HOST, mirroring the VITE_HOST contract.
//
// Default = 127.0.0.1 (IPv4 loopback) so a client connecting to localhost
// resolves to a working interface on every Windows / macOS / Linux dual-stack
// host (some configs do not auto-resolve `::1` for a process bound to it).
// `HONO_HOST=true` => "::" so dual-stack accept hits both IPv4 and IPv6
// callers without an explicit second bind — same trick Vite plays with
// `host: true`.
//
// SHIPWRIGHT_NETWORK_PROFILE precedence (ADR-08X):
//   1. Explicit HONO_HOST (trimmed non-empty) wins. Backward-compatible.
//   2. Else SHIPWRIGHT_NETWORK_PROFILE drives the bind via
//      resolveNetworkProfile (local / tailscale / open).
//   3. Else 127.0.0.1 (existing default).

import { execSync } from "node:child_process";
import { resolveNetworkProfile } from "./resolveNetworkProfile.js";
import type { TailscaleIpExec } from "./resolveTailscaleIp.js";

const defaultExec: TailscaleIpExec = (cmd, opts) =>
  String(execSync(cmd, opts as Parameters<typeof execSync>[1]));

export function resolveHonoHost(
  env: Record<string, string | undefined>,
  exec: TailscaleIpExec = defaultExec,
): string {
  const raw = env.HONO_HOST?.trim();
  if (raw) {
    if (raw === "true" || raw === "1") return "::";
    return raw;
  }

  const profile = resolveNetworkProfile(env, exec);
  if (profile) return profile.host;

  return "127.0.0.1";
}
