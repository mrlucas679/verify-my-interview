// Deep web / OSINT research.
//
// Corroborates or contradicts a job offer by searching the public web and the
// news for the company/role: official listings, and any scam/fraud warnings or
// press coverage. Three independent, optional sources — SerpAPI (Google),
// NewsAPI, and GNews — each degrades to a no-op when its key is absent, so the
// pipeline (and offline evals, which scrub these keys) is unchanged when nothing
// is configured.

import axios from 'axios';
import { sanitizeHttpUrl } from '../http/guard';

export function webResearchEnabled(): boolean {
  return Boolean(
    process.env.SERPAPI_API_KEY || process.env.NEWSAPI_API_KEY || process.env.GNEWS_API_KEY
  );
}

/** Output validation: external search/news payloads are untrusted. Only
 *  http(s) links survive (no javascript:/data: schemes), and titles/snippets
 *  are length-capped before they reach reports the UI renders. */
function cleanResult(r: { title?: any; link?: any; snippet?: any; source?: string }): ResearchResult {
  return {
    title: typeof r.title === 'string' ? r.title.slice(0, 200) : '',
    link: sanitizeHttpUrl(r.link),
    snippet: typeof r.snippet === 'string' ? r.snippet.slice(0, 300) : '',
    source: r.source,
  };
}

export interface ResearchResult {
  title: string;
  link: string;
  snippet: string;
  /** Source of the hit, for the report/trace ("google" | "newsapi" | "gnews"). */
  source?: string;
}

export interface CompanyResearch {
  officialListingFound: boolean;
  scamMentions: boolean;
  resultCount: number;
  citations: string[];
  topResults: ResearchResult[];
  /** The specific result each verdict rests on — distinct URLs, never shared. */
  officialListingUrl?: string;
  scamMentionUrl?: string;
}

const SCAM_RE = /\b(scam|fraud|warning|complaint|reported|fake|phishing|blacklist)\b/i;
const JOB_CONTEXT_RE = /\b(recruit(?:er|ing|ment)?|job|hiring|interview|career|employment|offer|onboarding)\b/i;
const LEGAL_SUFFIXES = new Set([
  'inc',
  'llc',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'company',
  'group',
  'technologies',
  'technology',
  'solutions',
  'labs',
]);

function companyTokens(company: string): string[] {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !LEGAL_SUFFIXES.has(token))
    .slice(0, 4);
}

function mentionsCompany(text: string, company: string): boolean {
  const haystack = text.toLowerCase();
  const phrase = company.toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = companyTokens(company);
  if (phrase.length >= 3 && haystack.includes(phrase)) return true;
  if (tokens.length > 1) return tokens.every((token) => haystack.includes(token));
  return tokens.length === 1 && haystack.includes(tokens[0]);
}

function hostMatchesDomain(host: string, domain?: string): boolean {
  if (!domain) return false;
  const root = domain.toLowerCase().replace(/^www\./, '');
  return host === root || host.endsWith(`.${root}`);
}

function hostContainsCompany(host: string, company: string): boolean {
  const hostParts = host.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return companyTokens(company).some((token) => hostParts.includes(token));
}

// ── SerpAPI (Google) ────────────────────────────────────────────────────────

async function serp(query: string, key: string): Promise<ResearchResult[]> {
  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { engine: 'google', q: query, api_key: key, num: 5 },
      timeout: 15000,
    });
    return (res.data.organic_results || []).slice(0, 5).map((o: any) =>
      cleanResult({ title: o.title, link: o.link, snippet: o.snippet, source: 'google' })
    );
  } catch (e) {
    console.error('[serp] query failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

// ── News (NewsAPI + GNews) ──────────────────────────────────────────────────

async function newsApi(query: string, key: string): Promise<ResearchResult[]> {
  try {
    const res = await axios.get('https://newsapi.org/v2/everything', {
      params: { q: query, language: 'en', sortBy: 'relevancy', pageSize: 5 },
      headers: { 'X-Api-Key': key },
      timeout: 12000,
    });
    return (res.data.articles || []).slice(0, 5).map((a: any) =>
      cleanResult({ title: a.title, link: a.url, snippet: a.description, source: 'newsapi' })
    );
  } catch (e) {
    console.error('[newsapi] query failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

async function gnews(query: string, key: string): Promise<ResearchResult[]> {
  try {
    const res = await axios.get('https://gnews.io/api/v4/search', {
      params: { q: query, lang: 'en', max: 5, apikey: key },
      timeout: 12000,
    });
    return (res.data.articles || []).slice(0, 5).map((a: any) =>
      cleanResult({ title: a.title, link: a.url, snippet: a.description, source: 'gnews' })
    );
  } catch (e) {
    console.error('[gnews] query failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

/** Query whichever news providers are configured for a company's scam coverage. */
async function newsScamSearch(company: string): Promise<ResearchResult[]> {
  const query = `${company} scam OR fraud OR warning OR complaint`;
  const tasks: Promise<ResearchResult[]>[] = [];
  if (process.env.NEWSAPI_API_KEY) tasks.push(newsApi(query, process.env.NEWSAPI_API_KEY));
  if (process.env.GNEWS_API_KEY) tasks.push(gnews(query, process.env.GNEWS_API_KEY));
  if (!tasks.length) return [];
  const results = await Promise.all(tasks);
  // Merge + de-dupe by URL.
  const seen = new Set<string>();
  const out: ResearchResult[] = [];
  for (const article of results.flat()) {
    if (article.link && !seen.has(article.link)) {
      seen.add(article.link);
      out.push(article);
    }
  }
  return out;
}

function isOfficialListing(r: ResearchResult, company: string, domain?: string): boolean {
  try {
    const host = new URL(r.link).hostname.toLowerCase();
    const text = `${r.title} ${r.snippet}`.toLowerCase();
    // A scam-warning post is never a job listing, whatever site it sits on.
    if (SCAM_RE.test(text)) return false;
    // The company's own site: any careers/jobs path counts.
    if (hostMatchesDomain(host, domain)) return /careers|jobs/i.test(r.link);
    if (hostContainsCompany(host, company) && /careers|jobs/i.test(r.link)) return true;
    // Job boards: must be an actual jobs path AND mention the company —
    // a random LinkedIn post or Reddit thread is not a listing.
    const onJobBoard = /(linkedin\.com\/jobs|indeed\.|glassdoor\.|greenhouse\.|lever\.|workday\.|careers24\.|pnet\.)/.test(
      r.link.toLowerCase()
    );
    return onJobBoard && mentionsCompany(`${text} ${r.link}`, company);
  } catch {
    return false;
  }
}

export async function researchCompany(
  company: string,
  role?: string,
  domain?: string
): Promise<CompanyResearch> {
  const serpKey = process.env.SERPAPI_API_KEY;

  // SerpAPI (Google) — careers + scam queries, when configured.
  let careers: ResearchResult[] = [];
  let serpScam: ResearchResult[] = [];
  if (serpKey) {
    const careersQuery = `${company} ${role || ''} careers OR jobs`.replace(/\s+/g, ' ').trim();
    const scamQuery = `"${company}" recruiter scam OR fraud OR warning OR complaint`;
    [careers, serpScam] = await Promise.all([serp(careersQuery, serpKey), serp(scamQuery, serpKey)]);
  }

  // News providers — independent scam/fraud coverage.
  const news = await newsScamSearch(company);

  const all = [...careers, ...serpScam, ...news];
  const listingHit = careers.find((r) => isOfficialListing(r, company, domain));
  // A scam mention must actually mention THIS company, not just contain the
  // word "scam" somewhere in a generic result.
  const scamHit = [...serpScam, ...news].find((r) => {
    const text = `${r.title} ${r.snippet}`.toLowerCase();
    return SCAM_RE.test(text) && JOB_CONTEXT_RE.test(text) && mentionsCompany(text, company);
  });
  // Prefer scam/news hits in the surfaced citations (they explain a red verdict).
  const top = [...serpScam, ...news, ...careers].slice(0, 6);

  return {
    officialListingFound: Boolean(listingHit),
    scamMentions: Boolean(scamHit),
    resultCount: all.length,
    citations: top.map((r) => r.link).filter(Boolean),
    topResults: top,
    officialListingUrl: listingHit?.link,
    scamMentionUrl: scamHit?.link,
  };
}
