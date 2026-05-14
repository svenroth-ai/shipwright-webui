import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { resolveViteHost } from './src/lib/resolveViteHost';
import { resolveProxyTarget } from './src/lib/resolveProxyTarget';
import type { TailscaleIpExec } from './src/lib/resolveTailscaleIp';

// Dev-server bind + /api proxy target both follow:
//   1. Explicit VITE_HOST / HONO_HOST (backward compat)
//   2. SHIPWRIGHT_NETWORK_PROFILE (local | tailscale | open)
//   3. Default = loopback only
// See ADR-08X (network-profile-flag) + ADR-08Y (env-local-loading-fix)
// and `src/lib/resolveViteHost.ts`.
//
// ADR-08Y: `envDir` points one level up (repo root) so .env.local
// values feed BOTH (a) this config's resolver calls below AND (b) the
// browser bundle's `import.meta.env.VITE_*` keys via Vite's normal
// envDir mechanism. Without `envDir`, Vite defaults to `client/` and
// only the resolver wiring would see repo-root .env.local — surprising
// inconsistency for anyone using VITE_* keys.
const repoRoot = path.resolve(__dirname, '..');

const tailscaleExec: TailscaleIpExec = (cmd, opts) =>
  String(execSync(cmd, opts as Parameters<typeof execSync>[1]));

export default defineConfig(({ mode }) => {
  // loadEnv reads .env, .env.local, .env.<mode>, .env.<mode>.local from
  // `repoRoot`. Empty prefix loads ALL keys (not just VITE_*) — needed
  // so SHIPWRIGHT_NETWORK_PROFILE flows into the resolvers below. The
  // browser bundle (import.meta.env) still respects Vite's VITE_*
  // filter — non-VITE_ keys do NOT leak to the client.
  //
  // Precedence: process.env wins on conflict (CLI prefix + shell env
  // override .env.local — backward compat with ADR-081 documented
  // behavior). External iterate review #5 medium.
  const envFromFile = loadEnv(mode, repoRoot, '');
  const env: Record<string, string | undefined> = {
    ...envFromFile,
    ...(process.env as Record<string, string | undefined>),
  };

  const hostConfig = resolveViteHost(env, tailscaleExec);
  const proxyTarget = resolveProxyTarget(env, tailscaleExec);

  // Centralized exposure warning. Two paths:
  //   1. SHIPWRIGHT_NETWORK_PROFILE=open (the normative path) — emits
  //      the exact AC-3 wording.
  //   2. Explicit VITE_HOST=true/0.0.0.0/::, no profile (legacy escape
  //      hatch) — emits a separate longer warning so users who haven't
  //      adopted the profile flag still see signal.
  const explicitProfileOpen = env.SHIPWRIGHT_NETWORK_PROFILE?.trim() === 'open';
  const explicitWildcardBind =
    hostConfig?.host === true ||
    hostConfig?.host === '0.0.0.0' ||
    hostConfig?.host === '::';

  if (explicitProfileOpen) {
    console.warn(
      '[network-profile] WARNING: profile=open — server is exposed on ' +
        'every interface; use only on trusted networks',
    );
  } else if (explicitWildcardBind) {
    console.warn(
      '[network-profile] WARNING: Vite dev server is binding to all ' +
        'interfaces via explicit VITE_HOST — exposed to every reachable ' +
        'network. Use only on trusted networks (home/office). Consider ' +
        'switching to SHIPWRIGHT_NETWORK_PROFILE=tailscale in .env.local ' +
        'when on untrusted Wi-Fi.',
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    envDir: repoRoot,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: parseInt(env.VITE_PORT || '5173', 10),
      strictPort: true,
      ...(hostConfig
        ? { host: hostConfig.host, allowedHosts: hostConfig.allowedHosts }
        : {}),
      proxy: {
        // ADR-067: `ws: true` MUST stay set — without it the embedded
        // terminal's `/api/terminal/:taskId/ws` upgrade does not survive
        // the Vite dev proxy (HTTP-only by default). Production serving
        // (Hono on 3847 hands client/dist directly) does not have this
        // gap; only `npm run dev` does.
        //
        // ADR-08X: target follows the resolved Hono bind so non-loopback
        // profiles (tailscale / open) don't ECONNREFUSED here.
        '/api': {
          target: proxyTarget,
          ws: true,
          changeOrigin: true,
          // Iterate K follow-up (ADR-099, 2026-05-14) — make the Vite WS
          // proxy robust against abrupt client/backend disconnects.
          //
          // Symptom: `[vite] ws proxy socket error: Error: read ECONNRESET`
          // (and ECONNABORTED on write) crashes the dev server with exit
          // code 127 when the embedded-terminal WebSocket is torn down
          // abruptly — e.g. on Hono restart, on rapid TaskDetailPage
          // navigation, on browser tab close mid-upgrade.
          //
          // Root cause: Vite 6.x's WS proxy (http-proxy) emits 'error'
          // events on the wrapped socket; Vite's default handler re-emits
          // which propagates to the process and exits dev. Attaching our
          // own listeners on both `proxy.on('error')` AND the WS client
          // socket from `proxyReqWs` swallows the well-known
          // ECONNRESET/ECONNABORTED disconnect codes (expected during
          // normal WS lifecycle) while still logging genuine errors.
          configure: (proxy) => {
            const isExpectedDisconnect = (err) => {
              const code = err && err.code;
              return code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'EPIPE';
            };
            proxy.on('error', (err, _req, res) => {
              if (isExpectedDisconnect(err)) {
                // Expected — peer closed mid-RT. Don't log spam, don't crash.
                return;
              }
              console.warn(`[vite proxy] error: ${err.message}`);
              try {
                if (res && 'writeHead' in res && !res.headersSent) {
                  res.writeHead(502, { 'Content-Type': 'text/plain' });
                  res.end('proxy error');
                }
              } catch {
                /* socket may have torn down */
              }
            });
            proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
              socket.on('error', (err) => {
                if (isExpectedDisconnect(err)) return;
                console.warn(`[vite proxy] WS client socket: ${err.message}`);
              });
            });
            proxy.on('open', (socket) => {
              socket.on('error', (err) => {
                if (isExpectedDisconnect(err)) return;
                console.warn(`[vite proxy] WS upstream socket: ${err.message}`);
              });
            });
          },
        },
      },
    },
  };
});
