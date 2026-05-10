/**
 * Build the `target` URL string for Vite's `/api` dev-proxy. The proxy
 * target MUST follow the Hono bind decision — when Hono binds to a
 * non-loopback interface (tailscale / open profile), the previous
 * hardcoded `http://localhost:${PORT}` would `ECONNREFUSED` because
 * Hono is no longer listening on loopback.
 *
 * Precedence mirrors `server/src/lib/resolveHonoHost.ts`:
 *   1. Explicit HONO_HOST → that hostname (with `true`/`1` mapped to
 *      127.0.0.1 for proxy purposes — `[::]` URLs are awkward and
 *      loopback always works against a dual-stack listener).
 *   2. Else SHIPWRIGHT_NETWORK_PROFILE drives via resolveNetworkProfile.
 *   3. Else 127.0.0.1.
 *
 * Used only by `vite.config.ts` (Node-side at config-load time);
 * never bundled into the browser.
 *
 * See ADR-08X (network-profile-flag), Gemini external review HIGH
 * finding "Vite proxy hardcoded localhost".
 */

import { resolveNetworkProfile } from "./resolveNetworkProfile";
import type { TailscaleIpExec } from "./resolveTailscaleIp";

export function resolveProxyTarget(
  env: Record<string, string | undefined>,
  exec: TailscaleIpExec,
): string {
  const port = env.PORT?.trim() || "3847";

  const honoRaw = env.HONO_HOST?.trim();
  if (honoRaw) {
    if (honoRaw === "true" || honoRaw === "1") {
      // dual-stack bind — pick loopback for proxy target (works
      // against listeners on `::` AND `0.0.0.0`).
      return `http://127.0.0.1:${port}`;
    }
    return `http://${honoRaw}:${port}`;
  }

  const profile = resolveNetworkProfile(env, exec);
  if (profile) {
    // For `open` profile, Hono binds to 0.0.0.0 (wildcard). 0.0.0.0
    // is NOT a routable HTTP destination — proxying to
    // `http://0.0.0.0:3847` is unreliable across HTTP clients
    // (OpenAI external-code-review HIGH finding). Use loopback
    // for the proxy target instead; loopback always works against a
    // 0.0.0.0 listener on the same host.
    if (profile.host === "0.0.0.0") {
      return `http://127.0.0.1:${port}`;
    }
    return `http://${profile.host}:${port}`;
  }

  return `http://127.0.0.1:${port}`;
}
