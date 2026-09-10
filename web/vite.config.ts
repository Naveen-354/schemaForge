import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@schemaforge/shared': path.resolve(__dirname, '../shared/src/index.ts') },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:4310', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
