// Quick deterministic smoke test: full pipeline against the seeded Nimbus ring,
// no Azure required. Run: npx tsx src/backend/scripts/smoke.ts

import { AgentOrchestrator } from '../agent/orchestrator';
import { entityGraph } from '../network/entityGraph';

const RING_EVIDENCE = `From: Daniel Okafor <d.okafor@nimbus-talent-hr.com>
Reply-To: nimbus.onboarding@gmail.com
Received: from mail.nimbus-talent-hr.com (203.0.113.45) by mx.example.com
Authentication-Results: mx.example.com; spf=fail smtp.mailfrom=nimbus-talent-hr.com; dmarc=fail
Subject: Final step for your remote role at Google

Dear Candidate,

Congratulations! You have been selected for the remote Quality Analyst position at Google.
To activate your onboarding we require a refundable equipment deposit of $200 in USDT to
wallet TQrKp4mNbu77. You can also use Zelle: nimbus-onboard.

Please complete this within 24 hours to secure your position. Visit
https://nimbustalent-careers.net/onboarding or WhatsApp us at +1 (332) 555-0144.

Daniel Okafor
Google Remote Hiring`;

async function main() {
  const result = await AgentOrchestrator.analyze(RING_EVIDENCE, 'smoke-1');
  console.log('\n=== VERDICT ===');
  console.log(`${result.report.risk_level} (${result.report.risk_score}/100), confidence ${result.report.confidence.toFixed(2)}`);
  console.log('\n=== STAGES ===');
  for (const s of result.trace.stages) {
    console.log(`- ${s.stage} [${s.engine}] ${s.duration_ms}ms: ${s.summary} (${s.findings.length} findings)`);
  }
  console.log('\n=== SIGNALS ===');
  for (const s of result.signals) {
    console.log(`- [${s.category}] ${s.id} (${s.points}): ${s.evidence.detail}`);
  }
  console.log('\n=== GRAPH ===');
  const reports = result.graph.nodes.filter((n) => n.type === 'report');
  console.log(`nodes=${result.graph.nodes.length}, edges=${result.graph.edges.length}, linked reports=${reports.length - 1}`);
  for (const r of reports) console.log(`  ${r.label} trust=${r.trust ?? '-'} scamType=${r.scamType}`);

  const lookup = await entityGraph.lookup('TQrKp4mNbu77');
  console.log('\n=== WALLET LOOKUP ===');
  console.log(`found=${Boolean(lookup.node)}, linked reports=${lookup.reports.length}`);

  const stats = await entityGraph.stats();
  console.log('\n=== STATS ===');
  console.log(`reports=${stats.reportCount}, byTrust=${JSON.stringify(stats.byTrust)}`);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
