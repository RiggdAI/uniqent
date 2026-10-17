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
    // No other page may make cross-origin requests to the dev server (Vite's default CORS allows
    // any localhost origin).
    cors: false,
  },
});
