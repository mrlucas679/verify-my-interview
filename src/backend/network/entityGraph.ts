// In-memory scam-intelligence entity graph.
//
// Derived deterministically from the report corpus (Azure AI Search index when
// configured, seed data otherwise). Nodes are reports plus the HARD identifiers
// they use (domains, emails, phones, payment handles); company names only get
// `impersonates` edges and never merge entities — scammers rotate brands but
// reuse infrastructure. Reports that share a hard identifier are promoted to
// `corroborated`; `authoritative` sources are `trusted`.

import { Entities } from '../../types/entities';
import {
  EntityGraph,
  GraphEdge,
  GraphNode,
  NetworkReport,
  NetworkStats,
  NodeType,
  TrustLevel,
} from './types';
import { SEED_REPORTS } from './seedData';
import { scamNetwork } from './scamNetwork';
import {
  cosmosEnabled,
  getGraphRevision,
  listReports,
  saveReport,
  touchGraphRevision,
} from '../data/cosmos';
import { logger } from '../observability/logger';

// --- Normalization (hard identifiers only) ----------------------------------

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
  'com.br',
]);

export function normalizeDomain(raw: string): string {
  const host = raw.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\.$/, '').split(/[/:?#]/)[0];
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const suffix = labels.slice(-2).join('.');
  if (MULTI_PART_PUBLIC_SUFFIXES.has(suffix) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

export function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function normalizeHandle(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function normalizePaymentHandle(raw: string): string | null {
  const value = normalizeHandle(raw);
  const named = value.match(/\b(zelle|cash\s?app|venmo|paypal|interac)\b\s*[:\s]\s*(\$?[a-z0-9][\w.-]{3,})/i);
  if (named) return `${named[1].replace(/\s+/g, '')}:${named[2].toLowerCase()}`;

  const wallet = value.match(/\b(?:wallet|usdt|btc|eth|crypto)\b[^a-z0-9]{0,12}([a-z0-9][a-z0-9.:-]{7,})/i);
  if (wallet) return `wallet:${wallet[1].toLowerCase()}`;

  return null;
}

/**
 * Identifier-shaped payment tokens in free text: crypto wallet addresses after
 * a wallet/coin cue, and Zelle / Cash App / Venmo style tags. Deliberately
 * narrow — brand or method words ("gift card: Microsoft") are NOT identifiers
 * and must never link cases (that is how name-based false positives happen).
 */
export function extractHandleTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of text.matchAll(/\b(?:wallet|usdt|btc|eth|crypto)\b[^a-z0-9]{0,12}([a-z0-9]{8,})/gi)) {
    tokens.add(m[1].toLowerCase());
  }
  for (const m of text.matchAll(
    /\b(?:zelle|cash\s?app|venmo|paypal)\b\s*[:\s]\s*(\$?[a-z0-9][\w.-]{3,})/gi
  )) {
    tokens.add(m[1].toLowerCase());
  }
  return tokens;
}

function nodeId(type: NodeType, value: string): string {
  return `${type}:${value}`;
}

const TRUST_RANK: Record<TrustLevel, number> = {
  unverified: 0,
  verified: 1,
  corroborated: 2,
  trusted: 3,
};

function baseTrust(r: NetworkReport): TrustLevel {
  if (r.sourceType === 'authoritative') return 'trusted';
  if (r.trustLevel) return r.trustLevel;
  if (r.sourceType === 'seed' || !r.sourceType) return 'verified';
  return 'unverified';
}

function trustedForPromotion(r: NetworkReport): boolean {
  const trust = baseTrust(r);
  return r.sourceType === 'seed' || r.sourceType === 'authoritative' || trust === 'verified' || trust === 'trusted';
}

// --- Builder ------------------------------------------------------------------

interface BuiltGraph {
  graph: EntityGraph;
  /** report node id -> ids of its hard-identifier entity nodes */
  reportEntities: Map<string, Set<string>>;
  /** entity node id -> report node ids touching it */
  entityReports: Map<string, Set<string>>;
  reports: NetworkReport[];
}

function build(reports: NetworkReport[]): BuiltGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const reportEntities = new Map<string, Set<string>>();
  const entityReports = new Map<string, Set<string>>();

  const touch = (id: string, type: NodeType, label: string, date: string, scamType?: string) => {
    const existing = nodes.get(id);
    if (existing) {
      existing.reportCount += type === 'report' ? 0 : 1;
      if (date < existing.firstSeen) existing.firstSeen = date;
      if (date > existing.lastSeen) existing.lastSeen = date;
      return existing;
    }
    const node: GraphNode = {
      id,
      type,
      label,
      reportCount: 1,
      firstSeen: date,
      lastSeen: date,
      ...(scamType ? { scamType } : {}),
    };
    nodes.set(id, node);
    return node;
  };

  const link = (source: string, target: string, type: GraphEdge['type']) => {
    const key = `${source}|${type}|${target}`;
    const existing = edges.get(key);
    if (existing) existing.weight += 1;
    else edges.set(key, { source, target, type, weight: 1 });
  };

  for (const r of reports) {
    const rid = nodeId('report', r.reportId);
    const rNode = touch(rid, 'report', r.reportId, r.reportedAt, r.scamType);
    rNode.trust = baseTrust(r);
    reportEntities.set(rid, new Set());

    const attach = (
      type: NodeType,
      values: string[] | undefined,
      normalize: (v: string) => string,
      edgeType: GraphEdge['type'],
      hard: boolean
    ) => {
      const attached = new Set<string>();
      for (const raw of values ?? []) {
        const norm = normalize(raw);
        if (!norm || attached.has(`${type}:${norm}`)) continue;
        attached.add(`${type}:${norm}`);
        const id = nodeId(type, norm);
        touch(id, type, raw.trim(), r.reportedAt);
        link(rid, id, edgeType);
        if (hard) {
          reportEntities.get(rid)!.add(id);
          if (!entityReports.has(id)) entityReports.set(id, new Set());
          entityReports.get(id)!.add(rid);
        }
      }
    };

    attach('domain', r.domains, normalizeDomain, 'uses_domain', true);
    attach('email', r.emails, normalizeEmail, 'uses_email', true);
    attach('phone', r.phones, normalizePhone, 'uses_phone', true);
    attach(
      'payment_handle',
      r.paymentHandles,
      (value) => normalizePaymentHandle(value) ?? '',
      'requests_payment',
      true
    );
    // Soft: brands and aliases — never merge, only annotate.
    attach('company', [r.companyName], (v) => v.toLowerCase().trim(), 'impersonates', false);
    attach('recruiter_alias', r.aliases, (v) => v.toLowerCase().trim(), 'alias_of', false);
  }

  // Trust promotion: reports sharing any hard identifier become corroborated.
  const reportById = new Map(reports.map((report) => [nodeId('report', report.reportId), report]));
  for (const [, reportIds] of entityReports) {
    if (reportIds.size < 2) continue;
    const hasIndependentAnchor = [...reportIds].some((rid) => {
      const report = reportById.get(rid);
      return report ? trustedForPromotion(report) : false;
    });
    if (!hasIndependentAnchor) continue;
    for (const rid of reportIds) {
      const node = nodes.get(rid)!;
      if (node.trust && TRUST_RANK[node.trust] < TRUST_RANK.corroborated) {
        node.trust = 'corroborated';
      }
    }
  }

  return {
    graph: {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      generatedAt: new Date().toISOString(),
    },
    reportEntities,
    entityReports,
    reports,
  };
}

// --- Service ------------------------------------------------------------------

const MAX_LOCAL_REPORTS = 500;
const GRAPH_REFRESH_TTL_MS = 30_000;
const GRAPH_REVISION_CHECK_TTL_MS = 3_000;

function mergeReports(...groups: NetworkReport[][]): NetworkReport[] {
  const byId = new Map<string, NetworkReport>();
  for (const reports of groups) {
    for (const report of reports) byId.set(report.reportId, report);
  }
  return [...byId.values()];
}

export class EntityGraphService {
  private built: BuiltGraph | null = null;
  private refreshPromise: Promise<void> | null = null;
  private dirtyWhileRefreshing = false;
  private lastRefreshAt = 0;
  private lastRevisionCheckAt = 0;
  private lastGraphRevision = -1;
  /** Reports submitted while Azure Search is unconfigured (in-memory fallback). */
  private localReports: NetworkReport[] = [];

  /** Rebuild from the current corpus. Cheap (≤ a few hundred reports). */
  async refresh(force = true): Promise<void> {
    if (
      !force &&
      this.built &&
      Date.now() - this.lastRefreshAt < GRAPH_REFRESH_TTL_MS &&
      !(await this.remoteRevisionChanged())
    ) {
      return;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshInternal().finally(() => {
        this.refreshPromise = null;
      });
    } else if (force) {
      this.dirtyWhileRefreshing = true;
    }
    await this.refreshPromise;
    if (force && this.dirtyWhileRefreshing) {
      this.dirtyWhileRefreshing = false;
      await this.refresh();
    }
  }

  /** Mark the durable report corpus as changed so other replicas refresh. */
  async markDirty(reason: string): Promise<void> {
    this.lastRefreshAt = 0;
    if (!cosmosEnabled()) return;
    try {
      const rev = await touchGraphRevision(reason);
      this.lastGraphRevision = Math.max(this.lastGraphRevision, rev);
      this.lastRevisionCheckAt = Date.now();
    } catch (e) {
      logger.warn(`[Graph] revision update failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async remoteRevisionChanged(): Promise<boolean> {
    if (!cosmosEnabled()) return false;
    const now = Date.now();
    if (now - this.lastRevisionCheckAt < GRAPH_REVISION_CHECK_TTL_MS) return false;
    this.lastRevisionCheckAt = now;
    try {
      const rev = await getGraphRevision();
      if (rev > this.lastGraphRevision) {
        this.lastGraphRevision = rev;
        return true;
      }
    } catch (e) {
      logger.warn(`[Graph] revision check failed: ${e instanceof Error ? e.message : e}`);
    }
    return false;
  }

  private async refreshInternal(): Promise<void> {
    let searchReports: NetworkReport[] = [];
    if (scamNetwork.enabled) {
      try {
        searchReports = await scamNetwork.listAll();
      } catch (e) {
        logger.warn(
          `[Graph] listAll failed, using seed data: ${e instanceof Error ? e.message : e}`
        );
      }
    }
    const submitted = cosmosEnabled()
      ? await listReports().catch((e) => {
          logger.warn(`[Graph] Cosmos listReports failed: ${e instanceof Error ? e.message : e}`);
          return this.localReports;
        })
      : this.localReports;
    const reports = searchReports.length
      ? mergeReports(searchReports, submitted)
      : mergeReports(SEED_REPORTS, submitted);
    this.built = build(reports);
    this.lastRefreshAt = Date.now();
    if (cosmosEnabled()) {
      this.lastGraphRevision = await getGraphRevision().catch((e) => {
        logger.warn(`[Graph] revision read failed: ${e instanceof Error ? e.message : e}`);
        return this.lastGraphRevision;
      });
      this.lastRevisionCheckAt = Date.now();
    }
    logger.debug(
      `[Graph] Built entity graph: ${this.built.graph.nodes.length} nodes, ${this.built.graph.edges.length} edges from ${reports.length} reports.`
    );
  }

  private async ensure(): Promise<BuiltGraph> {
    if (!this.built) await this.refresh();
    return this.built!;
  }

  /** Add a report when the indexed network is unavailable, then rebuild. */
  async addLocalReport(report: NetworkReport): Promise<void> {
    if (cosmosEnabled()) {
      try {
        await saveReport(report); // durable system of record
        await this.markDirty('report.created');
      } catch (e) {
        logger.warn(`[Graph] Cosmos saveReport failed, keeping in memory: ${e instanceof Error ? e.message : e}`);
        this.localReports.push(report);
      }
    } else {
      this.localReports.push(report);
      if (this.localReports.length > MAX_LOCAL_REPORTS) {
        this.localReports = this.localReports.slice(-MAX_LOCAL_REPORTS);
      }
    }
    await this.refresh();
  }

  async getGraph(filter?: { type?: NodeType; minTrust?: TrustLevel }): Promise<EntityGraph> {
    if (scamNetwork.enabled) await this.refresh(false);
    const { graph } = await this.ensure();
    if (!filter?.type && !filter?.minTrust) return graph;

    const minRank = filter.minTrust ? TRUST_RANK[filter.minTrust] : 0;
    const keptReports = new Set(
      graph.nodes
        .filter((n) => n.type === 'report' && (!n.trust || TRUST_RANK[n.trust] >= minRank))
        .map((n) => n.id)
    );
    const nodes = graph.nodes.filter((n) =>
      n.type === 'report' ? keptReports.has(n.id) : !filter.type || n.type === filter.type
    );
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { nodes, edges, generatedAt: graph.generatedAt };
  }

  /** Trust level of a specific report, after graph promotion. */
  async trustOf(reportId: string): Promise<TrustLevel | undefined> {
    const { graph } = await this.ensure();
    return graph.nodes.find((n) => n.id === nodeId('report', reportId))?.trust;
  }

  /**
   * Case subgraph: seed with the case's hard identifiers, expand 2 hops
   * (identifier -> reports -> the reports' other identifiers). A synthetic
   * `case` report node anchors the view.
   */
  async caseSubgraph(
    entities: Entities,
    evidenceText = '',
    caseLabel = 'This case'
  ): Promise<EntityGraph> {
    const built = await this.ensure();
    const { graph } = built;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    const seedIds = this.seedIdsFor(entities, evidenceText).filter((id) => byId.has(id));
    const keep = new Set<string>(seedIds);

    // Hop 1: reports touching a seed identifier.
    const hitReports = new Set<string>();
    for (const id of seedIds) {
      for (const rid of built.entityReports.get(id) ?? []) hitReports.add(rid);
    }
    for (const rid of hitReports) keep.add(rid);

    // Hop 2: those reports' other hard identifiers (reveals the ring).
    for (const rid of hitReports) {
      for (const eid of built.reportEntities.get(rid) ?? []) keep.add(eid);
    }
    // Plus soft nodes (brands/aliases) directly connected to kept reports.
    for (const e of graph.edges) {
      if (hitReports.has(e.source) && (e.type === 'impersonates' || e.type === 'alias_of')) {
        keep.add(e.target);
      }
    }

    const nodes = graph.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n }));
    const edges = graph.edges
      .filter((e) => keep.has(e.source) && keep.has(e.target))
      .map((e) => ({ ...e }));

    // Anchor node for the case itself, linked to its matched identifiers.
    const caseId = 'report:case-current';
    nodes.push({
      id: caseId,
      type: 'report',
      label: caseLabel,
      reportCount: 1,
      firstSeen: new Date().toISOString().slice(0, 10),
      lastSeen: new Date().toISOString().slice(0, 10),
      scamType: 'Under investigation',
    });
    for (const id of seedIds) {
      const type = byId.get(id)!.type;
      const edgeType =
        type === 'domain'
          ? 'uses_domain'
          : type === 'email'
            ? 'uses_email'
            : type === 'phone'
              ? 'uses_phone'
              : 'requests_payment';
      edges.push({ source: caseId, target: id, type: edgeType, weight: 1 });
    }

    return { nodes, edges, generatedAt: graph.generatedAt };
  }

  /** Look up one identifier (domain/email/phone/handle) and its neighborhood. */
  async lookup(identifier: string): Promise<{
    node?: GraphNode;
    reports: Array<{ reportId: string; companyName: string; scamType: string; trust?: TrustLevel }>;
  }> {
    const built = await this.ensure();
    const candidates = [
      nodeId('domain', normalizeDomain(identifier)),
      nodeId('email', normalizeEmail(identifier)),
      nodeId('phone', normalizePhone(identifier)),
      nodeId('payment_handle', normalizeHandle(identifier)),
    ];
    // Payment handles often partially quoted — also substring-match handles.
    const byId = new Map(built.graph.nodes.map((n) => [n.id, n]));
    let node = candidates.map((c) => byId.get(c)).find(Boolean);
    if (!node) {
      const needle = identifier.toLowerCase().trim();
      node = built.graph.nodes.find(
        (n) => n.type !== 'report' && needle.length >= 4 && n.label.toLowerCase().includes(needle)
      );
    }
    if (!node) return { reports: [] };

    const reportIds = built.entityReports.get(node.id) ?? new Set();
    const reports = [...reportIds].map((rid) => {
      const reportId = rid.replace(/^report:/, '');
      const r = built.reports.find((x) => x.reportId === reportId);
      const trust = byId.get(rid)?.trust;
      return {
        reportId,
        companyName: r?.companyName ?? '',
        scamType: r?.scamType ?? '',
        trust,
      };
    });
    return { node, reports };
  }

  async stats(): Promise<NetworkStats> {
    if (scamNetwork.enabled) await this.refresh(false);
    const built = await this.ensure();
    const { graph, reports } = built;

    const byTrust: NetworkStats['byTrust'] = {
      unverified: 0,
      verified: 0,
      corroborated: 0,
      trusted: 0,
    };
    for (const n of graph.nodes) {
      if (n.type === 'report' && n.trust) byTrust[n.trust]++;
    }

    const count = (values: string[]): Array<{ name: string; count: number }> => {
      const m = new Map<string, number>();
      for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
      return [...m.entries()]
        .map(([name, c]) => ({ name, count: c }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    };

    const months = new Map<string, number>();
    for (const r of reports) {
      const month = r.reportedAt.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + 1);
    }

    return {
      reportCount: reports.length,
      byTrust,
      topScamTypes: count(reports.map((r) => r.scamType)),
      topDomains: count(reports.flatMap((r) => r.domains.map(normalizeDomain))),
      topHandles: count(reports.flatMap((r) => r.paymentHandles.map(normalizePaymentHandle).filter((v): v is string => !!v))),
      monthlyTrend: [...months.entries()]
        .map(([month, c]) => ({ month, count: c }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  private seedIdsFor(entities: Entities, evidenceText = ''): string[] {
    const ids = [
      ...entities.domains.map((d) => nodeId('domain', normalizeDomain(d))),
      ...entities.emails.map((e) => nodeId('email', normalizeEmail(e))),
      ...entities.phones.map((p) => nodeId('phone', normalizePhone(p))),
    ];
    // Payment handles (wallets, Zelle/CashApp tags) appear as free text in the
    // evidence. Extract identifier-shaped tokens and EXACT-match them against
    // known handle nodes — substring/brand matching would link every email
    // that merely mentions a company name.
    if (this.built) {
      const caseTokens = extractHandleTokens(
        `${evidenceText} ${entities.money_requests.join(' ')}`
      );
      if (caseTokens.size) {
        for (const n of this.built.graph.nodes) {
          if (n.type !== 'payment_handle') continue;
          const token = n.label.toLowerCase().split(/[:\s]+/).pop() ?? '';
          if (caseTokens.has(token)) ids.push(n.id);
        }
      }
    }
    return [...new Set(ids)];
  }
}

export const entityGraph = new EntityGraphService();
