// Force-OFFLINE dev server (design-review / demo-insurance use).
//
// Blanks every external-capability env var BEFORE the server module loads, so the
// whole pipeline runs deterministically with ZERO external calls (no Foundry,
// Cosmos, Search, Speech, OCR, Service Bus, telemetry, web/WHOIS providers, auth,
// or Blob). dotenv does NOT override variables already present in the
// environment, so pre-setting these to '' keeps .env from re-enabling them.
//
// Use: `npm run dev:offline` (serves the built SPA + API on :3000, same as
// `npm start`, but guaranteed offline). NOT for production.

const FORCE_OFFLINE = [
  'AZURE_AI_PROJECT_ENDPOINT',
  'PROJECT_ENDPOINT',
  'AZURE_AI_AGENT_ID',
  'AZURE_SEARCH_ENDPOINT',
  'AZURE_SEARCH_API_KEY',
  'AZURE_SEARCH_KNOWLEDGE_BASE',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_KEY',
  'AZURE_DOCINT_ENDPOINT',
  'AZURE_DOCINT_KEY',
  'AZURE_SPEECH_REGION',
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_LOCALES',
  'APPLICATIONINSIGHTS_CONNECTION_STRING',
  'SERPAPI_API_KEY',
  'NEWSAPI_API_KEY',
  'GNEWS_API_KEY',
  'OPENCORPORATES_API_KEY',
  'WHOIS_XML_API_KEY',
  'ABSTRACT_API_KEY',
  'WHOIS_LOOKUP_ENABLED',
  'WHOISJSON_API_KEY',
  'DOMSCAN_API_KEY',
  'ABSTRACT_EMAIL_REPUTATION_KEY',
  'ABSTRACT_PHONE_KEY',
  'ABSTRACT_COMPANY_KEY',
  'ABSTRACT_IP_KEY',
  'COSMOS_CONNECTION_STRING',
  'COSMOS_PII_CONNECTION_STRING',
  'SERVICEBUS_CONNECTION_STRING',
  'URL_UNWRAP_ENABLED',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'AUTH_JWKS_URI',
  'AUTH_SIGNED_IN_MONTHLY_MAX',
  'AUTH_ADMIN_EMAILS',
  'AZURE_STORAGE_ACCOUNT',
  'AZURE_STORAGE_CONNECTION_STRING',
  'VMI_REPORT_API_KEY',
];

for (const key of FORCE_OFFLINE) process.env[key] = '';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// Dynamic import AFTER scrubbing so the server's dotenv + subsystem singletons
// observe the blanked values. The server's own listen() is guarded by
// `require.main === module`, so we start it explicitly here.
void import('../server').then((mod) => {
  const app = (mod as { default: import('express').Express }).default;
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[dev:offline] Verify My Interview API (deterministic) on http://localhost:${port}`);
  });
});
