/*
 * Trusted-Origin policy for the WS upgrade gate (terminal/routes.ts) +
 * HTTP CORS middleware (index.ts).
 *
 * Background: ADR-072 (HONO_HOST opt-in, iterate v0.8.x) widened the
 * backend bind from `127.0.0.1` to optionally `::` / a literal address,
 * but the Origin gates in both code paths stayed loopback-only. The
 * effect: a user opens the WebUI via Tailscale (`http://<machine>.<tail>.ts.net:5173`),
 * Vite proxies `/api/...` to `localhost:3847`, but Vite forwards the
 * browser's original `Origin` header verbatim → Hono's WS upgrade
 * rejects with `origin_not_allowed`, terminal stays mute. Same shape
 * for direct HTTP calls if the frontend ever moves off loopback.
 *
 * This helper resolves a single coherent policy consumed by both
 * gates, with three modes layered safest-default-first:
 *
 *   1. Explicit allowlist via `WEBUI_TRUSTED_ORIGINS=<comma-separated>` —
 *      narrowest match, takes precedence. Each entry compared as a
 *      string against the incoming Origin (no wildcard / scheme rewrite;
 *      callers must list the exact `http(s)://host[:port]` form they
 *      expect to see).
 *   2. `HONO_HOST` set (any non-empty value) — the user already opted
 *      into a non-loopback bind, accepting any non-empty Origin from
 *      the resulting tailnet/LAN is the consistent posture. Anonymous /
 *      missing Origin is still rejected (curl / scripted callers fall
 *      outside the browser CORS contract).
 *   3. Default — loopback-only (`localhost` / `127.0.0.1` / `::1`).
 *      Identical to the pre-iterate behaviour; safe in untrusted Wi-Fi.
 *
 * The helper returns an opaque policy object so the caller does not
 * need to know which mode resolved — it just calls `isAllowed(origin)`.
 * `describe()` returns a single-line human summary for the boot log.
 */

export type TrustedOriginMode = "loopback" | "any" | "allowlist";

export interface TrustedOriginPolicy {
  mode: TrustedOriginMode;
  isAllowed: (origin: string | null) => boolean;
  describe: () => string;
}

// WHATWG URL keeps IPv6 brackets on `.hostname`, so `new URL("http://[::1]")
// .hostname === "[::1]"`. Both forms are listed below — `::1` survives
// purely as a defensive cushion for any caller passing a pre-parsed
// origin string that already stripped the brackets.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function resolveTrustedOrigins(
  env: Record<string, string | undefined>,
): TrustedOriginPolicy {
  // (1) Explicit allowlist — narrowest, takes precedence.
  const rawList = env.WEBUI_TRUSTED_ORIGINS?.trim();
  if (rawList) {
    const entries = rawList
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const set = new Set(entries);
    return {
      mode: "allowlist",
      isAllowed: (origin) => {
        if (!origin) return false;
        return set.has(origin);
      },
      describe: () =>
        `WEBUI_TRUSTED_ORIGINS allowlist (${entries.length} entr${
          entries.length === 1 ? "y" : "ies"
        }): ${entries.join(", ")}`,
    };
  }

  // (2) HONO_HOST opt-in implies "the bind is non-loopback and I trust
  //     anything reaching it". Accept any non-empty Origin.
  const honoHost = env.HONO_HOST?.trim();
  if (honoHost) {
    return {
      mode: "any",
      isAllowed: (origin) => Boolean(origin && origin.length > 0),
      describe: () =>
        `HONO_HOST=${honoHost} → any non-empty Origin accepted (set WEBUI_TRUSTED_ORIGINS to narrow)`,
    };
  }

  // (3) Safe default — loopback-only.
  return {
    mode: "loopback",
    isAllowed: (origin) => Boolean(origin) && isLoopbackOrigin(origin as string),
    describe: () =>
      "loopback-only (localhost / 127.0.0.1 / ::1) — set HONO_HOST or WEBUI_TRUSTED_ORIGINS to widen",
  };
}
