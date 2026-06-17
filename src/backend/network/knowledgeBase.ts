// Foundry IQ knowledge-base grounding (Azure AI Search agentic retrieval).
//
// Retrieves grounding passages from prior reported scams so the Report agent can
// reference real precedent. Key-gated on AZURE_SEARCH_KNOWLEDGE_BASE (reuses the
// Search endpoint/key); unset ⇒ no-op (graceful degradation, rule 2). Read-only,
// never throws — failures degrade to "no grounding". The deterministic guidance
// citations (matchGuidance) remain the authority; this only enriches the narrative.

import axios from 'axios';
import { logger } from '../observability/logger';

const API_VERSION = '2026-05-01-preview';
const TIMEOUT_MS = 10_000;
const MAX_PASSAGES = 5;

export interface GroundingPassage {
  ref_id: number;
  content: string;
}

export function knowledgeBaseEnabled(): boolean {
  return Boolean(
    process.env.AZURE_SEARCH_ENDPOINT &&
      process.env.AZURE_SEARCH_API_KEY &&
      process.env.AZURE_SEARCH_KNOWLEDGE_BASE
  );
}

/**
 * Agentic-retrieve grounding passages for a query. Uses minimal reasoning effort
 * (no LLM, zero per-query cost) with `intents` input, matching the knowledge base
 * created on the Search service. Returns [] on any error or when unconfigured.
 */
export async function retrieveGrounding(query: string): Promise<GroundingPassage[]> {
  if (!knowledgeBaseEnabled() || !query.trim()) return [];
  const endpoint = (process.env.AZURE_SEARCH_ENDPOINT as string).replace(/\/+$/, '');
  const kb = process.env.AZURE_SEARCH_KNOWLEDGE_BASE as string;
  const url = `${endpoint}/knowledgebases/${encodeURIComponent(kb)}/retrieve?api-version=${API_VERSION}`;
  try {
    const { data } = await axios.post(
      url,
      { intents: [{ type: 'semantic', search: query.slice(0, 800) }] },
      {
        headers: { 'api-key': process.env.AZURE_SEARCH_API_KEY as string, 'Content-Type': 'application/json' },
        timeout: TIMEOUT_MS,
      }
    );
    const text = data?.response?.[0]?.content?.[0]?.text;
    if (typeof text !== 'string') return [];
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_PASSAGES)
      .map((p): GroundingPassage => ({
        ref_id: typeof (p as any)?.ref_id === 'number' ? (p as any).ref_id : 0,
        content: String((p as any)?.content ?? '').slice(0, 500),
      }))
      .filter((p) => p.content.length > 0);
  } catch (e) {
    logger.warn(`[KnowledgeBase] retrieve failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}
