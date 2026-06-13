---
name: evidence-graph
description: The scam-intelligence entity graph — schema, entity-resolution rules, trust-level promotion, API contract, and react-force-graph-2d rendering conventions. Use when working on src/backend/network/ (entityGraph, scamNetwork, seedData), the /network/* endpoints, the Network agent, or frontend graph components (EvidenceGraph embedded in the report dossier).
---

# Evidence Graph

The graph is the platform's moat: scammers rename companies and recruiters but reuse infrastructure (domains, phones, wallets). The graph makes that reuse visible and clickable.

## Architecture

- **Source of truth:** the Azure AI Search index (`scam-reports-v2`) of `NetworkReport` docs; when Azure Search is unconfigured, `seedData.ts` reports are used directly.
- **Graph is derived, in memory:** `src/backend/network/entityGraph.ts` builds nodes/edges deterministically from all reports. Cached singleton; rebuilt on server start and `refresh()`ed after `POST /report`. No graph database.
- Vector search (`scamNetwork.search`) = semantic matching. Entity graph = structural matching. The Network agent uses both.

## Schema (`src/backend/network/types.ts`)

```ts
export type NodeType = 'report' | 'company' | 'domain' | 'email' | 'phone' | 'payment_handle' | 'recruiter_alias';
export type TrustLevel = 'unverified' | 'verified' | 'corroborated' | 'trusted';

export interface GraphNode {
  id: string;            // `${type}:${normalizedValue}` e.g. "domain:nimbus-talent-hr.com", "report:RPT-014"
  type: NodeType;
  label: string;         // display value (un-normalized ok)
  trust?: TrustLevel;    // report nodes only
  reportCount: number;   // entity nodes: distinct reports touching this entity (reports: 1)
  firstSeen: string;     // ISO date
  lastSeen: string;
  scamType?: string;     // report nodes
}

export interface GraphEdge {
  source: string;        // node id
  target: string;        // node id
  type: 'uses_domain' | 'uses_email' | 'uses_phone' | 'requests_payment' | 'impersonates' | 'alias_of';
  weight: number;        // # of co-occurrences (>=1)
}

export interface EntityGraph { nodes: GraphNode[]; edges: GraphEdge[]; generatedAt: string; }
```

Edges run report → entity (`uses_domain`, `uses_email`, `uses_phone`, `requests_payment`, `impersonates` for company nodes, `alias_of` recruiter alias → email when derivable).

## Entity resolution (hard identifiers only)

- Normalize: lowercase + trim everything. Domains: strip `www.` and reduce to registrable domain. Emails: exact after lowercase. Phones: digits only, keep country code (`+27 82 555 1234` → `27825551234`). Payment handles: prefix-normalize (`usdt:<addr>`, `zelle:<email/phone>`, `cashapp:$tag`).
- **Hard identifiers** (may merge/link cases): domain, email, phone, payment_handle.
- **Company names are NEVER hard identifiers** — they only create `impersonates` edges. "Acme Jobs"/"Acme Careers" stay separate unless they share a hard identifier. (Demo talking point: scammers rotate brand names, reuse infrastructure.)

## Trust levels (computed in the builder, stored on the index doc)

| Level | Rule |
|---|---|
| `unverified` | lone report, no corroboration |
| `verified` | originating analysis had tool-confirmed signals, or seeded from a vetted scenario |
| `corroborated` | report shares ≥1 hard-identifier node with ≥1 other report (promotion is automatic in the builder) |
| `trusted` | `sourceType: 'authoritative'` (FTC/FBI/BBB-style seeded entries) — never demoted |

Trust weights network signals in the scorer: trusted/corroborated match > verified > unverified (an unverified lone match must NOT add heavy points — poisoning resistance).

## API contract

- `GET /network/graph?type=<NodeType>&minTrust=<TrustLevel>` → `EntityGraph` (filters optional).
- `GET /network/stats` → `{ reportCount, byTrust, topScamTypes[], topDomains[], topHandles[], monthlyTrend[] }` (derived from reports' `reportedAt`).
- `/analyze` response includes `graph`: the **case subgraph** — `entityGraph.caseSubgraph(entities, depth=2)`: seed nodes = case's normalized hard identifiers, expand 2 hops (entity → reports → their entities).
- Chat tool `graph_lookup({ identifier })` → matching node + neighbors + report summaries.

## Rendering (react-force-graph-2d, `frontend/src/components/EvidenceGraph.tsx`)

- Colors/sizes/trust-rings per the **sentinel-ui** skill graph section. Draw labels in `nodeCanvasObject` (10px JetBrains Mono, only when zoom > 1.2 or node hovered/selected).
- `onNodeClick` → side detail panel (report node: summary, scamType, trust badge, date; entity node: linked-report list). Never navigate away.
- `cooldownTicks={80}`, then `zoomToFit(400, 40)`. Disable physics after settle for stability in the embedded report graph.
- Empty state: surface-2 panel "No network connections found for this case" — never a blank canvas.

## Seeding (the demo ring)

`seedData.ts` must contain the "Nimbus Talent" ring: ~6 reports impersonating DIFFERENT brands but sharing 2 domains (`nimbus-talent-hr.com`, `nimbustalent-careers.net`), 1 USDT wallet, 1 Zelle handle, 1 phone, 2 recruiter emails. Plus contrast: unrelated single reports and legit-adjacent entries. The frontend demo sample references one ring domain + the wallet so the match is **computed live**, never hardcoded. `npm run seed:network` pushes to the index.
