import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const backend = `http://localhost:${process.env.BACKEND_PORT ?? 3000}`;

const server = await createServer({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/analyze': backend,
      '/upload': backend,
      '/transcribe': backend,
      '/chat': backend,
      '/report': backend,
      '/health': backend,
      '/docs': backend,
    },
  },
});

await server.listen();
server.printUrls();
