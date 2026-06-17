import { formatAzureDoctor, runAzureDoctor } from '../ops/azureDoctor';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const report = runAzureDoctor({
  requireLive: hasFlag('--require-live'),
  skipAz: hasFlag('--skip-az'),
});

if (hasFlag('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(formatAzureDoctor(report));
}

process.exit(report.ok ? 0 : 1);
