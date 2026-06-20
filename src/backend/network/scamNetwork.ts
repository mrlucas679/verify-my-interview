// Scam-intelligence network backed by Azure AI Search (vector + entity matching).
//
// Seeds a corpus of (synthetic) scam reports with embeddings, then matches a new
// case against them semantically AND by shared entities (domain, email, brand,
// payment method) to flag reworded/renamed repeats. Degrades to a no-op when
// Azure Search / embeddings aren't configured.

import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';
import { Entities } from '../../types/entities';
import { NetworkReport, NetworkMatch } from './types';
import { embed, embeddingsEnabled } from './embeddings';

const SEARCH_TIMEOUT_MS = 10_000;
const MAX_GRAPH_REPORTS = 5_000;

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  'co.za',
  'org.za',
  'ac.za',
  'gov.za',
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
]);

interface IndexedReport extends NetworkReport {
  id: string;
  descriptionVector?: number[];
}

function timeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Search operation exceeded ${ms}ms`)), ms);
  timer.unref?.();
  if (parent?.aborted) {
    controller.abort(parent.reason instanceof Error ? parent.reason : new Error('Search operation aborted'));
  } else {
    parent?.addEventListener(
      'abort',
      () => controller.abort(parent.reason instanceof Error ? parent.reason : new Error('Search operation aborted')),
      { once: true }
    );
  }
  return controller.signal;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalDomain(raw: string): string {
  const host = raw.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\.$/, '').split(/[/:?#]/)[0];
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const suffix = labels.slice(-2).join('.');
  if (MULTI_PART_PUBLIC_SUFFIXES.has(suffix) && labels.length >= 3) return labels.slice(-3).join('.');
  return labels.slice(-2).join('.');
}

function normalizePaymentHandle(raw: string): string | null {
  const value = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  const named = value.match(/\b(zelle|cash\s?app|venmo|paypal|interac)\b\s*[:\s]\s*(\$?[a-z0-9][\w.-]{3,})/i);
  if (named) return `${named[1].replace(/\s+/g, '')}:${named[2].toLowerCase()}`;
  const wallet = value.match(/\b(?:wallet|usdt|btc|eth|crypto)\b[^a-z0-9]{0,12}([a-z0-9][a-z0-9.:-]{7,})/i);
  return wallet ? `wallet:${wallet[1].toLowerCase()}` : null;
}

function evidencePaymentHandles(text: string): Set<string> {
  const handles = new Set<string>();
  for (const m of text.matchAll(/\b(?:wallet|usdt|btc|eth|crypto)\b[^a-z0-9]{0,12}([a-z0-9][a-z0-9.:-]{7,})/gi)) {
    handles.add(`wallet:${m[1].toLowerCase()}`);
  }
  for (const m of text.matchAll(/\b(zelle|cash\s?app|venmo|paypal|interac)\b\s*[:\s]\s*(\$?[a-z0-9][\w.-]{3,})/gi)) {
    handles.add(`${m[1].toLowerCase().replace(/\s+/g, '')}:${m[2].toLowerCase()}`);
  }
  return handles;
}

export class ScamNetworkService {
  private readonly endpoint = process.env.AZURE_SEARCH_ENDPOINT || '';
  private readonly apiKey = process.env.AZURE_SEARCH_API_KEY || '';
  // v2 adds phones/trustLevel/sourceType; never mutate the old index in place.
  private readonly indexName = process.env.AZURE_SEARCH_INDEX || 'scam-reports-v2';

  get enabled(): boolean {
    return Boolean(this.endpoint && this.apiKey && embeddingsEnabled());
  }

  private indexClient(): SearchIndexClient {
    return new SearchIndexClient(this.endpoint, new AzureKeyCredential(this.apiKey));
  }

  private searchClient(): SearchClient<IndexedReport> {
    return new SearchClient<IndexedReport>(
      this.endpoint,
      this.indexName,
      new AzureKeyCredential(this.apiKey)
    );
  }

  async ensureIndex(): Promise<void> {
    const client = this.indexClient();
    try {
      await client.getIndex(this.indexName);
      return; // already exists
    } catch {
      // create below
    }
    const index: any = {
      name: this.indexName,
      fields: [
        { name: 'id', type: 'Edm.String', key: true },
        { name: 'reportId', type: 'Edm.String', filterable: true },
        { name: 'companyName', type: 'Edm.String', searchable: true, filterable: true },
        { name: 'aliases', type: 'Collection(Edm.String)', searchable: true, filterable: true },
        { name: 'scamType', type: 'Edm.String', searchable: true, filterable: true, facetable: true },
        { name: 'description', type: 'Edm.String', searchable: true },
        { name: 'domains', type: 'Collection(Edm.String)', searchable: true, filterable: true },
        { name: 'emails', type: 'Collection(Edm.String)', filterable: true },
        { name: 'phones', type: 'Collection(Edm.String)', filterable: true },
        { name: 'paymentHandles', type: 'Collection(Edm.String)', searchable: true, filterable: true },
        { name: 'trustLevel', type: 'Edm.String', filterable: true, facetable: true },
        { name: 'sourceType', type: 'Edm.String', filterable: true, facetable: true },
        { name: 'location', type: 'Edm.String', searchable: true, filterable: true },
        { name: 'reportedAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
        {
          name: 'descriptionVector',
          type: 'Collection(Edm.Single)',
          searchable: true,
          vectorSearchDimensions: 1536,
          vectorSearchProfileName: 'vprofile',
        },
      ],
      vectorSearch: {
        algorithms: [{ name: 'hnsw-algo', kind: 'hnsw' }],
        profiles: [{ name: 'vprofile', algorithmConfigurationName: 'hnsw-algo' }],
      },
    };
    await client.createIndex(index);
  }

  /** Normalize optional fields so v2 documents are always complete. */
  private toDoc(r: NetworkReport, descriptionVector?: number[]): IndexedReport {
    return {
      ...r,
      phones: r.phones ?? [],
      trustLevel: r.trustLevel ?? (r.sourceType === 'authoritative' ? 'trusted' : 'unverified'),
      sourceType: r.sourceType ?? 'user',
      id: r.reportId,
      descriptionVector,
    };
  }

  async seed(reports: NetworkReport[]): Promise<number> {
    const client = this.searchClient();
    const docs: IndexedReport[] = [];
    for (const r of reports) {
      const descriptionVector = await embed(this.embedText(r));
      docs.push(this.toDoc(r, descriptionVector));
    }
    for (let i = 0; i < docs.length; i += 50) {
      await client.mergeOrUploadDocuments(docs.slice(i, i + 50), {
        abortSignal: timeoutSignal(SEARCH_TIMEOUT_MS),
      });
    }
    return docs.length;
  }

  async add(report: NetworkReport): Promise<void> {
    if (!this.enabled) return;
    const client = this.searchClient();
    const descriptionVector = await embed(this.embedText(report));
    await client.mergeOrUploadDocuments([this.toDoc(report, descriptionVector)], {
      abortSignal: timeoutSignal(SEARCH_TIMEOUT_MS),
    });
  }

  async delete(reportId: string): Promise<boolean> {
    if (!this.endpoint || !this.apiKey || !reportId.trim()) return false;
    const client = this.searchClient();
    await client.deleteDocuments([{ id: reportId.trim() } as IndexedReport], {
      abortSignal: timeoutSignal(SEARCH_TIMEOUT_MS),
    });
    return true;
  }

  async waitForReport(reportId: string, maxWaitMs = 2_500): Promise<boolean> {
    if (!this.enabled) return false;
    const client = this.searchClient();
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      try {
        await client.getDocument(reportId, { abortSignal: timeoutSignal(2_000) });
        return true;
      } catch {
        await wait(250);
      }
    }
    return false;
  }

  /** Page through every report (no vectors) — feeds the entity-graph builder. */
  async listAll(): Promise<NetworkReport[]> {
    if (!this.enabled) return [];
    const client = this.searchClient();
    const response = await client.search('*', {
      select: [
        'reportId',
        'companyName',
        'aliases',
        'scamType',
        'description',
        'domains',
        'emails',
        'phones',
        'paymentHandles',
        'location',
        'reportedAt',
        'trustLevel',
        'sourceType',
      ],
      abortSignal: timeoutSignal(SEARCH_TIMEOUT_MS),
    } as any);
    const reports: NetworkReport[] = [];
    for await (const r of response.results) {
      if (reports.length >= MAX_GRAPH_REPORTS) break;
      const d = r.document as IndexedReport;
      reports.push({
        reportId: d.reportId,
        companyName: d.companyName,
        aliases: d.aliases ?? [],
        scamType: d.scamType,
        description: d.description,
        domains: d.domains ?? [],
        emails: d.emails ?? [],
        phones: d.phones ?? [],
        paymentHandles: d.paymentHandles ?? [],
        location: d.location,
        reportedAt: typeof d.reportedAt === 'string' ? d.reportedAt.slice(0, 10) : String(d.reportedAt).slice(0, 10),
        trustLevel: d.trustLevel,
        sourceType: d.sourceType,
      });
    }
    return reports;
  }

  async search(
    evidence: string,
    entities: Entities,
    k = 4,
    signal?: AbortSignal
  ): Promise<NetworkMatch[]> {
    if (!this.enabled) return [];
    try {
      const vector = await embed(this.queryText(evidence, entities), signal);
      const client = this.searchClient();
      const response = await client.search('*', {
        vectorSearchOptions: {
          queries: [
            { kind: 'vector', vector, fields: ['descriptionVector'], kNearestNeighborsCount: k + 2 },
          ],
        },
        select: [
          'reportId',
          'companyName',
          'scamType',
          'description',
          'domains',
          'emails',
          'phones',
          'paymentHandles',
          'location',
          'aliases',
          'reportedAt',
          'trustLevel',
        ],
        top: k,
        abortSignal: timeoutSignal(SEARCH_TIMEOUT_MS, signal),
      } as any);

      const matches: NetworkMatch[] = [];
      for await (const r of response.results) {
        const doc = r.document as IndexedReport;
        matches.push({
          reportId: doc.reportId,
          companyName: doc.companyName,
          scamType: doc.scamType,
          description: doc.description,
          location: doc.location,
          reportedAt: doc.reportedAt,
          similarity: Math.max(0, Math.min(1, (r as any).score ?? 0)),
          reasons: this.reasons(entities, evidence, doc),
          trustLevel: doc.trustLevel,
        });
      }
      return matches;
    } catch (err) {
      console.error(
        `[Network] search failed: ${err instanceof Error ? err.message : err}`
      );
      return [];
    }
  }

  private embedText(r: NetworkReport): string {
    return `${r.companyName} ${r.aliases.join(' ')} ${r.scamType} ${r.description} ${r.domains.join(
      ' '
    )} ${r.paymentHandles.join(' ')} ${r.location}`;
  }

  private queryText(evidence: string, e: Entities): string {
    return `${e.companies.join(' ')} ${e.domains.join(' ')} ${e.money_requests.join(' ')} ${evidence}`.slice(
      0,
      8000
    );
  }

  private reasons(e: Entities, evidence: string, doc: IndexedReport): string[] {
    const reasons: string[] = [];
    const text = evidence.toLowerCase();

    const docDomains = new Set(doc.domains.map(canonicalDomain).filter(Boolean));
    const sharedDomain = e.domains.find((d) => docDomains.has(canonicalDomain(d)));
    if (sharedDomain) reasons.push(`Shared / related domain: ${sharedDomain}`);

    const sharedEmail = e.emails.find((em) =>
      doc.emails.some((de) => de.toLowerCase() === em.toLowerCase())
    );
    if (sharedEmail) reasons.push(`Same recruiter email: ${sharedEmail}`);

    const sharedPhone = e.phones.find((p) => {
      const digits = p.replace(/\D/g, '');
      return (
        digits.length >= 7 &&
        (doc.phones ?? []).some((dp) => dp.replace(/\D/g, '') === digits)
      );
    });
    if (sharedPhone) reasons.push(`Same phone number: ${sharedPhone}`);

    const company = (e.companies[0] || '').toLowerCase();
    if (
      company.length >= 3 &&
      (doc.companyName.toLowerCase().includes(company) ||
        doc.aliases.some((a) => a.toLowerCase().includes(company)))
    ) {
      reasons.push(`Same impersonated brand: ${doc.companyName}`);
    }

    const caseHandles = evidencePaymentHandles(text);
    const docHandles = new Set(doc.paymentHandles.map(normalizePaymentHandle).filter((value): value is string => !!value));
    const sharedPay = [...caseHandles].find((handle) => docHandles.has(handle));
    if (sharedPay) reasons.push(`Same payment handle: ${sharedPay}`);

    if (reasons.length === 0) reasons.push('Semantically similar scam wording');
    return reasons;
  }
}

export const scamNetwork = new ScamNetworkService();
