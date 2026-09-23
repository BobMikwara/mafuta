import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // The live preview reaches this dev server through a generated host name.
    // Vite 6 rejects unknown hosts by default, so the preview domains are
    // allow-listed here (a leading dot covers every subdomain).
    allowedHosts: ['.e2b.app'],
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
