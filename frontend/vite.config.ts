import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend dev server port (Express). 3000 is often taken locally, so default 4000.
const BACKEND = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/analyze': BACKEND,
      '/health': BACKEND,
    },
  },
  build: {
    // Build straight into the folder Express serves statically.
    outDir: '../public',
    emptyOutDir: true,
  },
});
