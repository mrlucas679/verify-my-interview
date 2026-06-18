import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend dev server port (Express). Defaults to the root `npm run dev` port;
// set BACKEND_PORT=4000 etc. when running the API elsewhere.
const BACKEND = `http://localhost:${process.env.BACKEND_PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/analyze': BACKEND,
      '/upload': BACKEND,
      '/transcribe': BACKEND,
      '/chat': BACKEND,
      '/report': BACKEND,
      '/health': BACKEND,
      '/docs': BACKEND,
    },
  },
  build: {
    // Build straight into the folder Express serves statically.
    outDir: '../public',
    emptyOutDir: true,
  },
});
