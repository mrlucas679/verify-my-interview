// Deep web / OSINT research via SerpAPI.
//
// Corroborates or contradicts a job offer by searching the public web for the
// company/role (official listings) and for scam/fraud warnings. Degrades to a
// no-op when SERPAPI_API_KEY is absent.

import axios from 'axios';

export function webResearchEnabled(): boolean {
  return Boolean(process.env.SERPAPI_API_KEY);
}

export interface ResearchResult {
  title: string;
  link: string;
  snippet: string;
}

export interface CompanyResearch {
  officialListingFound: boolean;
  scamMentions: boolean;
  resultCount: number;
  citations: string[];
  topResults: ResearchResult[];
}

async function serp(query: string, key: string): Promise<ResearchResult[]> {
  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { engine: 'google', q: query, api_key: key, num: 5 },
      timeout: 15000,
    });
    return (res.data.organic_results || []).slice(0, 5).map((o: any) => ({
      title: o.title || '',
      link: o.link || '',
      snippet: o.snippet || '',
    }));
  } catch (e) {
    console.error('[serp] query failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

function isOfficialListing(link: string, company: string, domain?: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase();
    const token = company.toLowerCase().split(/\s+/)[0];
    if (domain && host.includes(domain.toLowerCase())) return /careers|jobs|/.test(link);
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
  const key = process.env.SERPAPI_API_KEY;
  if (!key) {
    return { officialListingFound: false, scamMentions: false, resultCount: 0, citations: [], topResults: [] };
  }
  const careersQuery = `${company} ${role || ''} careers OR jobs`.replace(/\s+/g, ' ').trim();
  const scamQuery = `"${company}" recruiter scam OR fraud OR warning OR complaint`;

  const [careers, scam] = await Promise.all([serp(careersQuery, key), serp(scamQuery, key)]);
  const all = [...careers, ...scam];

  const officialListingFound = careers.some((r) => isOfficialListing(r.link, company, domain));
  const scamMentions = scam.some((r) =>
    /\b(scam|fraud|warning|complaint|reported|fake)\b/i.test(`${r.title} ${r.snippet}`)
  );
  const top = all.slice(0, 5);

  return {
    officialListingFound,
    scamMentions,
    resultCount: all.length,
    citations: top.map((r) => r.link).filter(Boolean),
    topResults: top,
  };
}
