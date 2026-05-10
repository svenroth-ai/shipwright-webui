/**
 * Resolve `SHIPWRIGHT_NETWORK_PROFILE` env var to a bind-host decision.
 *
 *   local     → 127.0.0.1 (loopback, safe everywhere; default behavior)
 *   tailscale → resolveTailscaleIp(env, exec) — Tailscale interface only,
 *               safe in untrusted networks (café WLAN sees nothing)
 *   open      → 0.0.0.0 — all interfaces, ONLY in trusted networks.
 *               Caller emits the exposure warning at startup (this
 *               function stays pure — no side effects).
 *   unset / whitespace → undefined (caller falls back to its default)
 *   invalid   → throws with the valid-values list
 *
 * Lowercase-only; `LOCAL` / `TailScale` are rejected so silent typo
 * mismatches surface immediately.
 *
 * Mirror of `client/src/lib/resolveNetworkProfile.ts` — keep in sync.
 * Cross-mirror parity asserted via `network-profile-sync.test.ts`.
 *
 * See ADR-08X (network-profile-flag).
 */

import { resolveTailscaleIp, type TailscaleIpExec } from "./resolveTailscaleIp.js";

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
