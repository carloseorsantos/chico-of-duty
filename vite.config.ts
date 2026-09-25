import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${process.env.SERVER_PORT || 3000}`, ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
});
