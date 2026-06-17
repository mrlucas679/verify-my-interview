#!/usr/bin/env node
import fs from 'fs';
import {
  analyzeEvidenceLocal,
  executeVerificationToolLocal,
  graphLookupLocal,
  healthSnapshot,
  networkStatsLocal,
  withLogsOnStderr,
} from '../local/appTools';
import { formatAzureDoctor, runAzureDoctor } from '../ops/azureDoctor';
import { formatOnlineSmoke, runOnlineSmoke } from '../ops/onlineSmoke';

type Flags = Record<string, string | boolean>;

function parseFlags(args: string[]): { command: string; positional: string[]; flags: Flags } {
  const command = args[0] ?? 'help';
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, positional, flags };
}

function flagString(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help(): void {
  process.stdout.write(`Verify My Interview CLI

Usage:
  vmi doctor [--json]
  vmi health [--json]
  vmi analyze --file evidence.txt [--json] [--case-id id]
  vmi analyze --text "job offer..." [--json] [--case-id id]
  vmi network-stats [--json]
  vmi graph-lookup <identifier> [--json]
  vmi raw-tool <toolName> --input '{"domain":"example.com"}' [--json]
  vmi azure-doctor [--json] [--require-live] [--skip-az]
  vmi online-smoke [--json] [--url https://app.example.com] [--require-foundry] [--require-telemetry]
  vmi mcp

No Express server is started. Commands call the local deterministic/Foundry pipeline directly.
`);
}

function readEvidence(flags: Flags): string {
  const text = flagString(flags, 'text');
  if (text) return text;
  const file = flagString(flags, 'file');
  if (file) return fs.readFileSync(file, 'utf8');
  if (!process.stdin.isTTY) return fs.readFileSync(0, 'utf8');
  throw new Error('provide --file, --text, or pipe evidence on stdin');
}

function printAnalyze(value: Awaited<ReturnType<typeof analyzeEvidenceLocal>>, json: boolean): void {
  if (json) {
    printJson(value);
    return;
  }
  const mp = value.multiPass;
  process.stdout.write(
    [
      `${value.report.risk_level} (${value.report.risk_score}/100), confidence ${(value.report.confidence * 100).toFixed(0)}%`,
      value.report.case_summary,
      `Multi-pass: ${mp.status} -> ${mp.outcome} (${mp.agreement} agreement)`,
      `Signals: ${value.signals.map((s) => s.id).join(', ') || 'none'}`,
      `Case ID: ${value.case_id}`,
    ].join('\n') + '\n'
  );
}

async function run(): Promise<void> {
  const { command, positional, flags } = parseFlags(process.argv.slice(2));
  const json = Boolean(flags.json);

  if (command === 'help' || command === '--help' || command === '-h') return help();
  if (command === 'doctor') {
    const payload = { ok: true, node: process.version, cwd: process.cwd(), health: healthSnapshot() };
    if (json) return printJson(payload);
    process.stdout.write(`ok (${process.version})\n`);
    return;
  }
  if (command === 'health') return printJson(healthSnapshot());
  if (command === 'network-stats') return printJson(await withLogsOnStderr(networkStatsLocal));
  if (command === 'graph-lookup') {
    const identifier = positional[0];
    if (!identifier) throw new Error('graph-lookup requires an identifier');
    return printJson(await withLogsOnStderr(() => graphLookupLocal(identifier)));
  }
  if (command === 'raw-tool') {
    const toolName = positional[0];
    const input = flagString(flags, 'input');
    if (!toolName || !input) throw new Error('raw-tool requires <toolName> and --input JSON');
    return printJson(
      await withLogsOnStderr(() => executeVerificationToolLocal(toolName, JSON.parse(input)))
    );
  }
  if (command === 'azure-doctor') {
    const report = runAzureDoctor({
      requireLive: Boolean(flags['require-live']),
      skipAz: Boolean(flags['skip-az']),
    });
    if (json) printJson(report);
    else process.stdout.write(formatAzureDoctor(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === 'online-smoke') {
    const report = await runOnlineSmoke({
      url: flagString(flags, 'url'),
      requireFoundry: Boolean(flags['require-foundry']),
      requireTelemetry: Boolean(flags['require-telemetry']),
    });
    if (json) printJson(report);
    else process.stdout.write(formatOnlineSmoke(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === 'analyze') {
    const evidence = readEvidence(flags);
    const caseId = flagString(flags, 'case-id');
    const result = await withLogsOnStderr(() => analyzeEvidenceLocal(evidence, caseId));
    return printAnalyze(result, json);
  }
  if (command === 'mcp') {
    const { startMcpServer } = await import('../mcp/server');
    await startMcpServer();
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`vmi: ${message}\n`);
    process.exit(1);
  });
}
