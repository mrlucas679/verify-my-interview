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
}

const SCAM_RE = /\b(scam|fraud|warning|complaint|reported|fake|phishing|blacklist)\b/i;

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

function isOfficialListing(link: string, company: string, domain?: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase();
    const token = company.toLowerCase().split(/\s+/)[0];
    if (domain && host.includes(domain.toLowerCase())) return /careers|jobs/i.test(link);
    const onJobBoard = /(linkedin|indeed|glassdoor|greenhouse|lever|workday)\./.test(host);
    return (host.includes(token) && /careers|jobs/.test(link)) || (onJobBoard && /careers|jobs|company/.test(link));
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
  const officialListingFound = careers.some((r) => isOfficialListing(r.link, company, domain));
  const scamMentions = [...serpScam, ...news].some((r) => SCAM_RE.test(`${r.title} ${r.snippet}`));
  // Prefer scam/news hits in the surfaced citations (they explain a red verdict).
  const top = [...serpScam, ...news, ...careers].slice(0, 6);

  return {
    officialListingFound,
    scamMentions,
    resultCount: all.length,
    citations: top.map((r) => r.link).filter(Boolean),
    topResults: top,
  };
}
