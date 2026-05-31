import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  build: { outDir: resolve(here, '../dist-web'), emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4173' } },
});
