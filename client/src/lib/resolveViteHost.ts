export interface ResolvedViteHost {
  host: true | string;
  allowedHosts: true;
}

// Vite 6 binds to loopback by default and rejects requests whose Host header
// doesn't match the bind address (defence against DNS-rebinding). To reach
// the dev server over Tailscale MagicDNS or LAN we need both a non-loopback
// bind AND `allowedHosts: true`. This is opt-in via VITE_HOST so the safe
// default (loopback only) survives — never expose the dev server in foreign
// Wi-Fi by accident.
export function resolveViteHost(
  env: Record<string, string | undefined>,
): ResolvedViteHost | undefined {
  const raw = env.VITE_HOST?.trim();
  if (!raw) return undefined;

  if (raw === 'true' || raw === '1') {
    return { host: true, allowedHosts: true };
  }

  return { host: raw, allowedHosts: true };
}
