import { builtinModules, createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(repoRoot, 'dist-functions/package/bundle.cjs');

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const extensions = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'];
const optionalExternalPackages = new Set([
  '@aws-sdk/credential-providers',
  '@azure/functions-core',
  '@mongodb-js/zstd',
  '@opentelemetry/shim-opencensus',
  'gcp-metadata',
  'kerberos',
  'mongodb-client-encryption',
  'snappy',
  'socks',
]);

function isBareSpecifier(specifier) {
  return !specifier.startsWith('.') && !path.isAbsolute(specifier) && !specifier.includes(':');
}

function resolveFile(candidate) {
  for (const ext of extensions) {
    const file = `${candidate}${ext}`;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return file;
    }
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    for (const ext of extensions.slice(1)) {
      const indexFile = path.join(candidate, `index${ext}`);
      if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
        return indexFile;
      }
    }
  }
  return null;
}

function resolveWorkspaceImport(specifier, resolveDir) {
  const base = path.resolve(resolveDir || repoRoot, specifier);
  const resolved = resolveFile(base);
  if (resolved) {
    return { path: resolved };
  }
  return null;
}

function resolvePackageImport(specifier, resolveDir) {
  try {
    const resolved = require.resolve(specifier, { paths: [resolveDir || repoRoot] });
    return { path: resolved };
  } catch (error) {
    if (optionalExternalPackages.has(specifier)) {
      return { path: specifier, external: true };
    }
    throw error;
  }
}

const boundedResolver = {
  name: 'workspace-bounded-resolver',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, (args) => {
      if (builtins.has(args.path)) {
        return { path: args.path, external: true };
      }
      if (args.path === 'vmi-functions-entry') {
        return { path: path.join(repoRoot, 'src/backend/local/appTools.ts') };
      }
      if (isBareSpecifier(args.path)) {
        return resolvePackageImport(args.path, args.resolveDir);
      }
      const resolved = resolveWorkspaceImport(args.path, args.resolveDir);
      if (resolved) {
        return resolved;
      }
      return null;
    });
  },
};

await build({
  absWorkingDir: repoRoot,
  bundle: true,
  entryPoints: ['vmi-functions-entry'],
  format: 'cjs',
  logLevel: 'warning',
  outfile: outFile,
  platform: 'node',
  plugins: [boundedResolver],
  target: 'node20',
});
