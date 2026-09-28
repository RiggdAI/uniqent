import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: resolve(here, '../dist-web'), emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      // The Studio API only answers its own origin (see src/server/guard.ts), so the dev proxy
      // presents the dev page's requests as coming from the API server's origin.
      '/api': {
        target: 'http://localhost:4173',
        changeOrigin: true,
        headers: { origin: 'http://localhost:4173' },
      },
    },
  },
});
