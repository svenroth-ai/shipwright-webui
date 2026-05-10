/**
 * Vite 6 binds to loopback by default and rejects requests whose Host
 * header doesn't match the bind address (defence against
 * DNS-rebinding). To reach the dev server over Tailscale MagicDNS or
 * LAN we need both a non-loopback bind AND an explicit `allowedHosts`
 * value. This is opt-in via `VITE_HOST` so the safe default
 * (loopback only) survives — never expose the dev server on foreign
 * Wi-Fi by accident.
 *
 * SHIPWRIGHT_NETWORK_PROFILE precedence (ADR-08X):
 *   1. Explicit VITE_HOST (trimmed non-empty) wins. Backward-compatible.
 *   2. Else SHIPWRIGHT_NETWORK_PROFILE drives via resolveNetworkProfile:
 *      - local     → undefined (preserve Vite's own default loopback;
 *                    keeps Vite's URL printing / detection unchanged —
 *                    OpenAI external review #7).
 *      - tailscale → host=<ip>, allowedHosts=[<ip>] (NARROW allowlist —
 *                    Gemini external review HIGH; do NOT use `true`,
 *                    that disables DNS-rebinding protection against a
 *                    wider set of Host headers than needed).
 *      - open      → host='0.0.0.0', allowedHosts=true (only profile
 *                    where the wide allowlist is justified — caller
 *                    opted into "all interfaces, all hosts").
 *   3. Else undefined (existing default).
 */

import { resolveNetworkProfile } from './resolveNetworkProfile';
import type { TailscaleIpExec } from './resolveTailscaleIp';

export interface ResolvedViteHost {
  host: true | string;
  allowedHosts: true | string[];
}

export function resolveViteHost(
  env: Record<string, string | undefined>,
  exec?: TailscaleIpExec,
): ResolvedViteHost | undefined {
  const raw = env.VITE_HOST?.trim();
  if (raw) {
    if (raw === 'true' || raw === '1') {
      return { host: true, allowedHosts: true };
    }
    return { host: raw, allowedHosts: true };
  }

  // `exec` is required only to drive the `tailscale` profile; for
  // `local`/`open` it is never called. Caller (vite.config) passes
  // node:child_process.execSync.
  if (!exec) return undefined;

  const profile = resolveNetworkProfile(env, exec);
  if (!profile) return undefined;

  if (profile.profile === 'local') {
    // Don't override Vite's default loopback; returning undefined
    // keeps URL printing / detection logic untouched.
    return undefined;
  }
  if (profile.profile === 'open') {
    return { host: '0.0.0.0', allowedHosts: true };
  }
  // tailscale: bind to the resolved IPv4 + accept that IP AND any
  // MagicDNS hostname under `.ts.net` (Tailscale's DNS namespace).
  // Users typically access via the MagicDNS name (e.g.
  // `pc-dinovo-002.tail<id>.ts.net`) rather than the raw IP — without
  // the wildcard Vite 6 returns "Blocked request. This host is not
  // allowed." even though the request came from a peer authenticated
  // on the Tailscale mesh. The `.ts.net` allow is scoped narrowly
  // enough: reaching the bound port already requires Tailscale auth,
  // so the host-header surface is intra-mesh only.
  return {
    host: profile.host,
    allowedHosts: [profile.host, '.ts.net'],
  };
}
