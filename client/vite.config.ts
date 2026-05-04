import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

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
