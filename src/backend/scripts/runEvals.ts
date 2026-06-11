// Eval harness — runs every tests/test_cases/*.json scenario through the FULL
// investigation pipeline and asserts the outcome: risk-level band, score
// range, required/forbidden signals, and network-match expectations.
//
// Offline by default: Azure / external-API env vars are scrubbed before the
// pipeline loads, so results are reproducible on any machine and prove the
// deterministic fallback path (the demo-insurance run). Pass --live to keep
// configured keys and evaluate the Foundry-driven pipeline instead.
//
// CLI: npm run eval [-- --live]      CI: tests/unit/evals.test.ts

import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisResult } from '../agent/orchestrator';

/** Env vars that switch on external services; scrubbed for offline evals. */
const SCRUBBED_ENV = [
  'AZURE_AI_PROJECT_ENDPOINT',
  'PROJECT_ENDPOINT',
  'AZURE_AI_AGENT_ID',
  'AZURE_SEARCH_ENDPOINT',
  'AZURE_SEARCH_API_KEY',
  'AZURE_SPEECH_REGION',
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_LOCALES',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_KEY',
  'SERPAPI_API_KEY',
  'NEWSAPI_API_KEY',
  'GNEWS_API_KEY',
  'OPENCORPORATES_API_KEY',
  'WHOIS_XML_API_KEY',
  'ABSTRACT_API_KEY',
  'AZURE_DOCINT_ENDPOINT',
  'AZURE_DOCINT_KEY',
  // External verification providers — scrubbed so offline evals never hit the
  // network and stay byte-for-byte reproducible.
  'WHOIS_LOOKUP_ENABLED',
  'WHOISJSON_API_KEY',
  'DOMSCAN_API_KEY',
  'ABSTRACT_EMAIL_REPUTATION_KEY',
  'ABSTRACT_PHONE_KEY',
  'ABSTRACT_COMPANY_KEY',
  'ABSTRACT_IP_KEY',
];

export interface EvalCaseFile {
  name: string;
  evidence: string;
  /** Acceptable final levels (preferred). */
  expected_risk_levels?: string[];
  /** Legacy single-level form. */
  expected_risk_level?: string;
  expected_score_range?: [number, number];
  /** Signal ids that MUST fire. */
  required_signals?: string[];
  /** Signal ids that must NOT fire. */
  forbidden_signals?: string[];
  /** Whether the case must (true) / must not (false) link to network reports. */
  expect_network_match?: boolean;
  notes?: string;
}

export interface EvalResult {
  file: string;
  name: string;
  level: string;
  score: number;
  signals: string[];
  failures: string[];
  passed: boolean;
  duration_ms: number;
}

const CASES_DIR = path.resolve(__dirname, '../../../tests/test_cases');

export async function runEvalCases(
  live = false
): Promise<{ results: EvalResult[]; allPassed: boolean; mode: 'offline' | 'live' }> {
  if (!live) {
    for (const key of SCRUBBED_ENV) delete process.env[key];
  }
  // Import AFTER scrubbing — subsystem singletons read env when first loaded.
  // (Tolerate both interop shapes for the dynamically imported module.)
  const mod: any = await import('../agent/orchestrator');
  const AgentOrchestrator = mod.AgentOrchestrator ?? mod.default?.AgentOrchestrator;
  if (!AgentOrchestrator) {
    throw new Error('Failed to load AgentOrchestrator from ../agent/orchestrator');
  }

  const files = fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const results: EvalResult[] = [];
  for (const file of files) {
    const c = JSON.parse(fs.readFileSync(path.join(CASES_DIR, file), 'utf-8')) as EvalCaseFile;
    const started = Date.now();
    const failures: string[] = [];
    try {
      const { report, signals, matches, graph }: AnalysisResult = await AgentOrchestrator.analyze(
        c.evidence,
        `eval-${file.replace('.json', '')}`
      );
      const fired = signals.map((s) => s.id);

      const expectedLevels =
        c.expected_risk_levels ?? (c.expected_risk_level ? [c.expected_risk_level] : null);
      if (expectedLevels && !expectedLevels.includes(report.risk_level)) {
        failures.push(`level "${report.risk_level}" not in [${expectedLevels.join(', ')}]`);
      }
      if (c.expected_score_range) {
        const [min, max] = c.expected_score_range;
        if (report.risk_score < min || report.risk_score > max) {
          failures.push(`score ${report.risk_score} outside [${min}, ${max}]`);
        }
      }
      for (const id of c.required_signals ?? []) {
        if (!fired.includes(id)) failures.push(`required signal missing: ${id}`);
      }
      for (const id of c.forbidden_signals ?? []) {
        if (fired.includes(id)) failures.push(`forbidden signal fired: ${id}`);
      }
      if (c.expect_network_match !== undefined) {
        const linkedReports = graph.nodes.filter(
          (n) => n.type === 'report' && n.id !== 'report:case-current'
        ).length;
        const hasMatch = matches.length > 0 || linkedReports > 0;
        if (hasMatch !== c.expect_network_match) {
          failures.push(
            `network match: expected ${c.expect_network_match}, got ${hasMatch} ` +
              `(${matches.length} semantic, ${linkedReports} graph-linked)`
          );
        }
      }

      results.push({
        file,
        name: c.name,
        level: report.risk_level,
        score: report.risk_score,
        signals: fired,
        failures,
        passed: failures.length === 0,
        duration_ms: Date.now() - started,
      });
    } catch (e) {
      results.push({
        file,
        name: c.name,
        level: 'ERROR',
        score: -1,
        signals: [],
        failures: [`pipeline threw: ${e instanceof Error ? e.message : String(e)}`],
        passed: false,
        duration_ms: Date.now() - started,
      });
    }
  }

  return { results, allPassed: results.every((r) => r.passed), mode: live ? 'live' : 'offline' };
}

function printTable(results: EvalResult[], mode: string): void {
  const w = { name: 44, level: 24, score: 5 };
  console.log(`\nEval run (${mode} mode) — ${new Date().toISOString()}\n`);
  console.log(
    `${'CASE'.padEnd(w.name)} ${'LEVEL'.padEnd(w.level)} ${'SCORE'.padEnd(w.score)} RESULT`
  );
  console.log('-'.repeat(w.name + w.level + w.score + 10));
  for (const r of results) {
    console.log(
      `${r.name.slice(0, w.name - 1).padEnd(w.name)} ${r.level.padEnd(w.level)} ${String(
        r.score
      ).padEnd(w.score)} ${r.passed ? 'PASS' : 'FAIL'}  (${(r.duration_ms / 1000).toFixed(1)}s)`
    );
    for (const f of r.failures) console.log(`  - ${f}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed.\n`);
}

if (require.main === module) {
  const live = process.argv.includes('--live');
  runEvalCases(live)
    .then(({ results, allPassed, mode }) => {
      printTable(results, mode);
      fs.writeFileSync(
        path.resolve(__dirname, '../../../eval-results.json'),
        JSON.stringify({ mode, generatedAt: new Date().toISOString(), results }, null, 2)
      );
      process.exit(allPassed ? 0 : 1);
    })
    .catch((e) => {
      console.error('Eval harness failed:', e);
      process.exit(1);
    });
}
