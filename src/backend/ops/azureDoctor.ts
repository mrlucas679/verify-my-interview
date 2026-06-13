import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { healthSnapshot } from '../local/appTools';

export type DoctorLevel = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  level: DoctorLevel;
  detail: string;
}

export interface AzureDoctorOptions {
  requireLive?: boolean;
  skipAz?: boolean;
  cwd?: string;
}

export interface AzureDoctorReport {
  ok: boolean;
  generatedAt: string;
  checks: DoctorCheck[];
}

const REQUIRED_DOCKERIGNORE_ENTRIES = ['.env', '.git', 'node_modules', 'dist'];
const LIVE_ENV_KEYS = [
  'AZURE_AI_PROJECT_ENDPOINT',
  'AZURE_AI_MODEL_DEPLOYMENT',
  'APPLICATIONINSIGHTS_CONNECTION_STRING',
];

function check(name: string, level: DoctorLevel, detail: string): DoctorCheck {
  return { name, level, detail };
}

function projectFile(cwd: string, file: string): string {
  return path.join(cwd, file);
}

function readJsonFile(file: string): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function hasPackageScript(pkg: Record<string, unknown>, script: string): boolean {
  const scripts = pkg.scripts;
  return Boolean(
    scripts &&
      typeof scripts === 'object' &&
      !Array.isArray(scripts) &&
      typeof (scripts as Record<string, unknown>)[script] === 'string'
  );
}

function dockerignoreChecks(cwd: string): DoctorCheck[] {
  const file = projectFile(cwd, '.dockerignore');
  if (!fs.existsSync(file)) return [check('dockerignore', 'fail', '.dockerignore is missing')];
  const text = fs.readFileSync(file, 'utf8');
  return REQUIRED_DOCKERIGNORE_ENTRIES.map((entry) =>
    text.split(/\r?\n/).includes(entry)
      ? check(`dockerignore:${entry}`, 'pass', `${entry} is excluded from container context`)
      : check(`dockerignore:${entry}`, 'fail', `${entry} must be excluded from container context`)
  );
}

function dockerfileChecks(cwd: string): DoctorCheck[] {
  const file = projectFile(cwd, 'Dockerfile');
  if (!fs.existsSync(file)) return [check('dockerfile', 'fail', 'Dockerfile is missing')];
  const text = fs.readFileSync(file, 'utf8');
  return [
    check('dockerfile:multi-stage', text.includes(' AS build') ? 'pass' : 'warn', 'multi-stage build expected'),
    check('dockerfile:production-deps', text.includes('npm ci --omit=dev') ? 'pass' : 'warn', 'runtime should install production dependencies only'),
    check('dockerfile:healthcheck', text.includes('HEALTHCHECK') ? 'pass' : 'warn', 'container healthcheck should call /health'),
  ];
}

function envChecks(requireLive: boolean): DoctorCheck[] {
  const health = healthSnapshot();
  const checks: DoctorCheck[] = [
    check(
      'foundry:configured',
      health.subsystems.foundry_agents ? 'pass' : requireLive ? 'fail' : 'warn',
      health.subsystems.foundry_agents
        ? 'Azure AI Foundry endpoint is configured'
        : 'AZURE_AI_PROJECT_ENDPOINT is not configured'
    ),
    check(
      'observability:azure-monitor',
      health.subsystems.azure_monitor ? 'pass' : requireLive ? 'fail' : 'warn',
      health.subsystems.azure_monitor
        ? 'Application Insights connection string is configured'
        : 'APPLICATIONINSIGHTS_CONNECTION_STRING is not configured'
    ),
    check(
      'search:scam-network',
      health.subsystems.scam_network_index ? 'pass' : 'warn',
      health.subsystems.scam_network_index
        ? 'Azure AI Search-backed scam network is configured'
        : 'Azure AI Search is not configured; in-memory graph fallback will be used'
    ),
  ];

  for (const key of LIVE_ENV_KEYS) {
    checks.push(
      check(
        `env:${key}`,
        process.env[key]?.trim() ? 'pass' : requireLive ? 'fail' : 'warn',
        process.env[key]?.trim() ? `${key} is set` : `${key} is not set`
      )
    );
  }
  return checks;
}

function azChecks(skipAz: boolean): DoctorCheck[] {
  if (skipAz) return [check('azure-cli', 'warn', 'Azure CLI check skipped')];
  try {
    const output = execFileSync('az', ['account', 'show', '--query', '{name:name,id:id}', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    const parsed = JSON.parse(output) as { name?: string; id?: string };
    return [
      check(
        'azure-cli',
        parsed.id ? 'pass' : 'warn',
        parsed.id ? `logged in to subscription ${parsed.name ?? parsed.id}` : 'az account show returned no subscription'
      ),
    ];
  } catch {
    return [check('azure-cli', 'warn', 'Azure CLI is unavailable or not logged in')];
  }
}

export function runAzureDoctor(options: AzureDoctorOptions = {}): AzureDoctorReport {
  const cwd = options.cwd ?? process.cwd();
  const requireLive = Boolean(options.requireLive);
  const pkgFile = projectFile(cwd, 'package.json');
  const pkg = fs.existsSync(pkgFile) ? readJsonFile(pkgFile) : {};
  const checks: DoctorCheck[] = [
    check('node:version', Number(process.versions.node.split('.')[0]) >= 18 ? 'pass' : 'fail', `Node ${process.version}`),
    check('package:build', hasPackageScript(pkg, 'build') ? 'pass' : 'fail', 'npm run build is available'),
    check(
      'package:verify-product',
      hasPackageScript(pkg, 'verify:product') ? 'pass' : 'fail',
      'npm run verify:product is available'
    ),
    check(
      'package:online-smoke',
      hasPackageScript(pkg, 'online:smoke') ? 'pass' : 'fail',
      'npm run online:smoke is available'
    ),
    ...dockerignoreChecks(cwd),
    ...dockerfileChecks(cwd),
    ...envChecks(requireLive),
    ...azChecks(Boolean(options.skipAz)),
  ];

  return {
    ok: checks.every((item) => item.level !== 'fail'),
    generatedAt: new Date().toISOString(),
    checks,
  };
}

export function formatAzureDoctor(report: AzureDoctorReport): string {
  const lines = [`Azure readiness doctor — ${report.generatedAt}`];
  for (const item of report.checks) {
    lines.push(`${item.level.toUpperCase().padEnd(4)} ${item.name} — ${item.detail}`);
  }
  lines.push(report.ok ? 'READY' : 'NOT READY');
  return `${lines.join('\n')}\n`;
}
