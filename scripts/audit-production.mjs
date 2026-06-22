import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmPrefixArgs = npmExecPath ? [npmExecPath] : [];

const targets = [
  { label: 'root', cwd: repoRoot, cache: path.join(repoRoot, '.npm-cache') },
  { label: 'frontend', cwd: path.join(repoRoot, 'frontend'), cache: path.join(repoRoot, '.npm-cache-frontend') },
];

function runNpm(args, cwd) {
  return spawnSync(npmCommand, [...npmPrefixArgs, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    shell: false,
  });
}

function combinedOutput(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n');
}

function writeOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function isRegistryFailure(output) {
  return /audit endpoint returned an error|registry\.npmjs\.org|EACCES|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(
    output
  );
}

function auditArgs(target, offline) {
  const args = ['audit', '--omit=dev', '--cache', target.cache];
  if (offline) args.push('--offline');
  return args;
}

for (const target of targets) {
  console.log(`\n[Audit] ${target.label}: online production dependency audit`);
  const online = runNpm(auditArgs(target, false), target.cwd);
  writeOutput(online);
  if (online.status === 0) continue;

  const output = combinedOutput(online);
  if (!isRegistryFailure(output)) process.exit(online.status ?? 1);

  console.warn(`[Audit] ${target.label}: registry unavailable; retrying with cached offline audit`);
  const offline = runNpm(auditArgs(target, true), target.cwd);
  writeOutput(offline);
  if (offline.status !== 0) process.exit(offline.status ?? 1);
}
