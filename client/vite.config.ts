import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { resolveViteHost } from './src/lib/resolveViteHost';

// Default = loopback only. `VITE_HOST=true` binds 0.0.0.0 (Tailscale / LAN),
// `VITE_HOST=<host|ip>` binds a specific interface. When set, allowedHosts is
// also unblocked — Vite 6 otherwise rejects MagicDNS hostnames via the Host
// header check. See docs/guide.md §9 and src/lib/resolveViteHost.ts.
const hostConfig = resolveViteHost(process.env);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.VITE_PORT || '5173', 10),
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
      '/api': {
        target: `http://localhost:${process.env.PORT || '3847'}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
