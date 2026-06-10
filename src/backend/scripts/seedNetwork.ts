// Seed the scam-intelligence network: create the Azure AI Search index and
// upload the synthetic scam reports (with embeddings).
//
// Run: npm run seed:network

import 'dotenv/config';
import { scamNetwork } from '../network/scamNetwork';
import { SEED_REPORTS } from '../network/seedData';

(async () => {
  if (!scamNetwork.enabled) {
    console.error(
      '[seed] Network not enabled. Check AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_API_KEY, and AZURE_OPENAI_KEY in .env.'
    );
    process.exit(1);
  }
  console.log('[seed] Ensuring index exists...');
  await scamNetwork.ensureIndex();
  console.log(`[seed] Embedding + uploading ${SEED_REPORTS.length} reports...`);
  const n = await scamNetwork.seed(SEED_REPORTS);
  console.log(`[seed] Done — ${n} reports in the scam-intelligence network.`);
  process.exit(0);
})().catch((e) => {
  console.error('[seed] Failed:', e);
  process.exit(1);
});
