#!/usr/bin/env node
/**
 * Opt-in HTTPS front for the production server via `tailscale serve`.
 *
 * Why: over the Tailscale IP the WebUI is plain http on a non-loopback host, which
 * the browser does NOT treat as a secure context — `navigator.clipboard` is
 * undefined, so keyboard paste (Ctrl+V / Shift+Insert) in the embedded terminal
 * cannot work. `tailscale serve` terminates TLS with a real cert for the tailnet
 * MagicDNS name (`https://<machine>.<tailnet>.ts.net`), which IS a secure context.
 * No server code changes: the Origin gate already accepts `https://*.ts.net` under
 * SHIPWRIGHT_NETWORK_PROFILE=tailscale and the client picks `wss:` from the page
 * protocol.
 *
 * Opt-in via `.env.local` (or the environment):
 *   SHIPWRIGHT_TAILSCALE_HTTPS=1          enable
 *   SHIPWRIGHT_TAILSCALE_HTTPS_PORT=443   tailnet-facing HTTPS port (default 443)
 *
 * Best-effort by design: this runs AFTER the deploy verdict, so it never fails a
 * deploy. `--bg` makes the serve config persist across restarts, so it only has to
 * succeed once. Tailnet-only — never `funnel` (that would publish to the internet).
 *
 * Usage: node scripts/tailscale-https.mjs [--port <backend-port>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isIPv4 } from 'node:net';
import { fileURLToPath } from 'node:url';

const TRUE_VALUES = new Set(['1', 'true', 'on', 'yes']);

/** Minimal dotenv: KEY=VALUE lines, `#` comments, optional surrounding quotes. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function isEnabled(env) {
  return TRUE_VALUES.has(String(env.SHIPWRIGHT_TAILSCALE_HTTPS ?? '').trim().toLowerCase());
}

export function resolveHttpsPort(env) {
  const raw = String(env.SHIPWRIGHT_TAILSCALE_HTTPS_PORT ?? '').trim();
  const n = Number(raw);
  return /^\d{1,5}$/.test(raw) && n > 0 && n < 65536 ? n : 443;
}

/**
 * The address the Hono server really listens on — `tailscale serve` must proxy to
 * THAT, not blindly to 127.0.0.1 (the tailscale profile binds the Tailscale IP only,
 * so loopback would be refused). Mirrors the bind decision in resolveHonoHost.ts:
 * HONO_HOST literal > profile (tailscale -> its IP) > loopback.
 *
 * @param {Record<string,string|undefined>} env
 * @param {() => string} getTailscaleIp lazy `tailscale ip -4` lookup
 */
export function resolveBackendHost(env, getTailscaleIp) {
  const honoHost = String(env.HONO_HOST ?? '').trim();
  if (honoHost && isIPv4(honoHost) && honoHost !== '0.0.0.0') return honoHost;
  if (honoHost) return '127.0.0.1'; // `true` / `::` / `0.0.0.0` wildcard — loopback is reachable
  const profile = String(env.SHIPWRIGHT_NETWORK_PROFILE ?? '').trim();
  if (profile === 'tailscale') {
    const override = String(env.SHIPWRIGHT_TAILSCALE_IP ?? '').trim();
    if (override && isIPv4(override)) return override;
    const ip = getTailscaleIp();
    if (!isIPv4(ip)) throw new Error('could not resolve the Tailscale IPv4 (is Tailscale connected?)');
    return ip;
  }
  return '127.0.0.1'; // local / open (0.0.0.0 is not a routable target) / unset
}

export function buildServeArgs({ host, port, httpsPort }) {
  return ['serve', '--bg', `--https=${httpsPort}`, `http://${host}:${port}`];
}

function tailscale(args) {
  return spawnSync('tailscale', args, { encoding: 'utf8', timeout: 15000 });
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let fileEnv = {};
  try {
    fileEnv = parseEnvFile(fs.readFileSync(path.join(here, '..', '.env.local'), 'utf8'));
  } catch { /* no .env.local — environment only */ }
  const env = { ...fileEnv, ...process.env }; // real env wins, like --env-file-if-exists

  if (!isEnabled(env)) return 0;

  const portArg = process.argv.indexOf('--port');
  const port = portArg > 0 && /^\d{1,5}$/.test(process.argv[portArg + 1] ?? '')
    ? Number(process.argv[portArg + 1])
    : Number(/^\d{1,5}$/.test(env.PORT ?? '') ? env.PORT : 3847);

  try {
    const host = resolveBackendHost(env, () => {
      const r = tailscale(['ip', '-4']);
      return String(r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).find(isIPv4) ?? '';
    });
    const r = tailscale(buildServeArgs({ host, port, httpsPort: resolveHttpsPort(env) }));
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    if (r.error || r.status !== 0) {
      console.log(`  HTTPS (tailscale serve) NOT enabled: ${r.error ? r.error.message : out}`);
      console.log('  Tailnet HTTPS certificates must be switched on once in the Tailscale admin console (DNS -> HTTPS Certificates).');
      return 1;
    }
    console.log(out ? `  HTTPS (tailscale serve): ${out}` : '  HTTPS (tailscale serve) enabled.');
    return 0;
  } catch (e) {
    console.log(`  HTTPS (tailscale serve) skipped: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
