import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'production';

const { build } = await import('vite');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');

await build({
  root,
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
});
