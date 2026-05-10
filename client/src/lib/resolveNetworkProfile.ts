/**
 * Mirror of `server/src/lib/resolveNetworkProfile.ts` — keep in sync.
 *
 * Resolve `SHIPWRIGHT_NETWORK_PROFILE` env var (local / tailscale /
 * open / unset) to a bind-host decision. Pure function — no
 * side-effects. Caller (`resolveViteHost.ts`, `resolveProxyTarget.ts`,
 * `vite.config.ts` for the warning) decides what to do with the
 * result.
 *
 * Cross-mirror parity asserted by
 * `server/src/lib/network-profile-sync.test.ts`.
 *
 * See ADR-08X (network-profile-flag).
 */

import { resolveTailscaleIp, type TailscaleIpExec } from "./resolveTailscaleIp";

export type NetworkProfile = "local" | "tailscale" | "open";

export interface ResolvedNetworkProfile {
  profile: NetworkProfile;
  host: string;
}

const VALID_PROFILES: readonly NetworkProfile[] = [
  "local",
  "tailscale",
  "open",
] as const;

export function resolveNetworkProfile(
  env: Record<string, string | undefined>,
  exec: TailscaleIpExec,
): ResolvedNetworkProfile | undefined {
  const raw = env.SHIPWRIGHT_NETWORK_PROFILE?.trim();
  if (!raw) return undefined;

  if (!VALID_PROFILES.includes(raw as NetworkProfile)) {
    throw new Error(
      `[resolveNetworkProfile] Invalid SHIPWRIGHT_NETWORK_PROFILE="${raw}". ` +
        `Valid values (lowercase only): ${VALID_PROFILES.join(", ")}.`,
    );
  }

  const profile = raw as NetworkProfile;
  if (profile === "local") return { profile, host: "127.0.0.1" };
  if (profile === "open") return { profile, host: "0.0.0.0" };
  return { profile, host: resolveTailscaleIp(env, exec) };
}
