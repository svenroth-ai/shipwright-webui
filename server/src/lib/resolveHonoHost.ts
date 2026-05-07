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
export function resolveHonoHost(env: Record<string, string | undefined>): string {
  const raw = env.HONO_HOST?.trim();
  if (!raw) return "127.0.0.1";
  if (raw === "true" || raw === "1") return "::";
  return raw;
}
