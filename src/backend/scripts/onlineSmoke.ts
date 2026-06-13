import { formatOnlineSmoke, runOnlineSmoke } from '../ops/onlineSmoke';

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const next = process.argv[index + 1];
  return next && !next.startsWith('--') ? next : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function numberFlag(name: string): number | undefined {
  const raw = flagValue(name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

runOnlineSmoke({
  url: flagValue('--url'),
  requireFoundry: hasFlag('--require-foundry'),
  requireTelemetry: hasFlag('--require-telemetry'),
  timeoutMs: numberFlag('--timeout-ms'),
})
  .then((report) => {
    if (hasFlag('--json')) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(formatOnlineSmoke(report));
    }
    process.exit(report.ok ? 0 : 1);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`online-smoke failed: ${message}\n`);
    process.exit(1);
  });
