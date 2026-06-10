import type { RiskLevel } from './types';

interface RiskStyle {
  color: string; // hex
  bg: string; // rgba bg
  label: string;
}

export const RISK_STYLES: Record<RiskLevel, RiskStyle> = {
  'Low Risk': { color: '#3fb950', bg: 'rgba(63,185,80,0.14)', label: 'Low Risk' },
  'Needs More Verification': {
    color: '#d29922',
    bg: 'rgba(210,153,34,0.14)',
    label: 'Needs Verification',
  },
  Suspicious: { color: '#db7035', bg: 'rgba(219,112,53,0.16)', label: 'Suspicious' },
  'Likely Scam': { color: '#f85149', bg: 'rgba(248,81,73,0.16)', label: 'Likely Scam' },
  Inconclusive: { color: '#8b949e', bg: 'rgba(139,148,158,0.14)', label: 'Inconclusive' },
};

export function riskStyle(level: RiskLevel): RiskStyle {
  return RISK_STYLES[level] ?? RISK_STYLES.Inconclusive;
}
