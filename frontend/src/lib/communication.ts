import type { RiskReport, StageTrace } from './types';
import type { InvestigationLayer } from './investigation';

const SOURCE_LABELS: Record<string, string> = {
  parser: 'Submitted evidence',
  text: 'Message text',
  email_headers: 'Email headers',
  lookup_company_registry: 'Company registry',
  lookup_domain_rdap: 'Domain records',
  lookup_phone_intel: 'Phone check',
  detect_scam_patterns: 'Scam-pattern check',
  research_company_web: 'Public web search',
  scam_network: 'Intelligence network',
  entity_graph: 'Entity graph',
  critic: 'Evidence review',
  entities: 'Extracted details',
  network_match: 'Prior report match',
};

const TOOL_LABELS: Record<string, string> = {
  lookup_company_registry: 'Company registry',
  lookup_domain_rdap: 'Domain and email records',
  lookup_phone_intel: 'Phone reputation',
  detect_scam_patterns: 'Message pattern check',
  research_company_web: 'Public web search',
};

export function proofSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');
}

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? proofSourceLabel(tool);
}

export function stageEngineLabel(layer: InvestigationLayer): string {
  if (layer.fallbackReason) return 'Backup review';
  if (layer.engine === 'foundry') {
    return layer.id === 'research' ? 'Research-assisted' : 'Investigator review';
  }
  switch (layer.id) {
    case 'evidence':
      return 'Evidence parser';
    case 'verification':
      return 'Direct checks';
    case 'research':
      return 'Public search';
    case 'network':
      return 'Intelligence graph';
    case 'adjudication':
      return 'Evidence review';
  }
}

export function engineModeLabel(mode: StageTrace['engine'] | 'mixed', degraded: boolean): string {
  if (mode === 'foundry') return 'Investigator review';
  if (mode === 'mixed') return degraded ? 'Assisted with backup checks' : 'Assisted investigation';
  return 'Rules and evidence checks';
}

export function reportNarration(report: RiskReport): string {
  const flags = report.red_flags.slice(0, 4);
  const flagLine =
    flags.length > 0
      ? `The main warning signs are: ${flags.join('. ')}.`
      : 'No major warning signs were found in the evidence provided.';
  const confidence = `Confidence is ${Math.round(report.confidence * 100)} percent.`;
  return [`Verdict: ${report.risk_level}.`, confidence, report.case_summary, flagLine]
    .filter(Boolean)
    .join(' ');
}
