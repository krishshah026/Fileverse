import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :8080; the dev server proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: process.env.API_URL || 'http://localhost:8080', changeOrigin: false } } },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 700 },
});
