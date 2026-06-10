// Knowledge layer: official job-scam guidance (FTC / FBI IC3 / BBB).
//
// Citations are matched deterministically against the evidence-backed signals
// a case actually triggered — the report never cites guidance that does not
// apply. The curated corpus in src/data/guidance.json carries real source
// URLs so users (and judges) can verify every citation themselves. A Foundry
// IQ knowledge base can replace the local corpus behind the same interface.

import { StructuredSignal, GuidanceCitation } from '../../types/report';
import guidanceCorpus from '../../data/guidance.json';

interface GuidanceEntry {
  id: string;
  source: string;
  title: string;
  url: string;
  excerpt: string;
  signal_ids: string[];
}

const CORPUS = guidanceCorpus as GuidanceEntry[];

/**
 * Return the official guidance most relevant to the triggered signals,
 * strongest overlap first. Red signals only — reassuring findings need no
 * federal citation.
 */
export function matchGuidance(signals: StructuredSignal[], maxCitations = 3): GuidanceCitation[] {
  const triggered = new Set(signals.filter((s) => s.category === 'red').map((s) => s.id));
  if (triggered.size === 0) return [];

  const labelById = new Map(signals.map((s) => [s.id, s.label]));

  return CORPUS.map((entry) => {
    const matched = entry.signal_ids.filter((id) => triggered.has(id));
    return { entry, matched };
  })
    .filter(({ matched }) => matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length)
    .slice(0, maxCitations)
    .map(({ entry, matched }) => ({
      title: entry.title,
      source: entry.source,
      url: entry.url,
      excerpt: entry.excerpt,
      matched_signals: matched.map((id) => labelById.get(id) ?? id),
    }));
}
