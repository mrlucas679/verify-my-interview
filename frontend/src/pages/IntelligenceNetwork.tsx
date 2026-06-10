// Intelligence Network page — the full scam-intelligence graph plus threat
// statistics: known domains, payment handles, scam types, trust levels and a
// monthly trend. All data is synthetic demo data (banner below) and every
// number is computed from the report corpus, never hardcoded.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Database } from 'lucide-react';
import { fetchNetworkGraph, fetchNetworkStats } from '../lib/api';
import type { EntityGraph, NetworkStats, TrustLevel } from '../lib/types';
import { EvidenceGraph } from '../components/EvidenceGraph';

const TRUST_COLORS: Record<TrustLevel, string> = {
  unverified: '#8a93a6',
  verified: '#2fbf71',
  corroborated: '#f0544f',
  trusted: '#4d7cfe',
};

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="surface-2 p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-0.5 font-mono text-xs text-faint">{hint}</p>}
    </div>
  );
}

function RankedTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; count: number }>;
}) {
  return (
    <div className="surface-2 p-4">
      <p className="eyebrow">{title}</p>
      <table className="mt-2 w-full text-[13px]">
        <tbody>
          {rows.slice(0, 6).map((r) => (
            <tr key={r.name} className="border-b border-line/50 last:border-0 hover:bg-ink-800/60">
              <td className="max-w-0 truncate py-1.5 pr-2 font-mono text-slate-300" title={r.name}>
                {r.name}
              </td>
              <td className="py-1.5 text-right font-mono text-faint">{r.count}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="py-1.5 text-faint">No data</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TrendSparkline({ trend }: { trend: NetworkStats['monthlyTrend'] }) {
  if (trend.length < 2) return null;
  const w = 260;
  const h = 56;
  const max = Math.max(...trend.map((t) => t.count), 1);
  const pts = trend
    .map(
      (t, i) =>
        `${(i / (trend.length - 1)) * (w - 8) + 4},${h - 6 - (t.count / max) * (h - 14)}`
    )
    .join(' ');
  return (
    <div className="surface-2 p-4">
      <p className="eyebrow">Reports per month</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full" role="img" aria-label="Monthly report trend">
        <polyline points={pts} fill="none" stroke="#4d7cfe" strokeWidth="1.5" />
        {trend.map((t, i) => (
          <circle
            key={t.month}
            cx={(i / (trend.length - 1)) * (w - 8) + 4}
            cy={h - 6 - (t.count / max) * (h - 14)}
            r="2"
            fill="#4d7cfe"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
        <span>{trend[0].month}</span>
        <span>{trend[trend.length - 1].month}</span>
      </div>
    </div>
  );
}

export function IntelligenceNetwork() {
  const [graph, setGraph] = useState<EntityGraph | null>(null);
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchNetworkGraph(), fetchNetworkStats()])
      .then(([g, s]) => {
        setGraph(g);
        setStats(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load network'));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <p className="eyebrow">Fraud intelligence network</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
            Known scam infrastructure
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-800 px-2.5 py-1 font-mono text-[11px] text-faint">
            <Database className="h-3.5 w-3.5" />
            Synthetic demo data
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Scammers rotate company and recruiter names but reuse domains, phone numbers and payment
          handles. Reports that share infrastructure are linked and promoted to{' '}
          <span className="font-mono text-risk-scam">corroborated</span> — click any node to
          inspect the proof.
        </p>
      </motion.div>

      {error && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-risk-scam/40 bg-risk-scam/10 p-4 text-sm text-risk-scam">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {graph ? (
            <EvidenceGraph graph={graph} height={560} />
          ) : (
            !error && (
              <div className="surface grid h-[560px] place-items-center text-sm text-muted">
                Building entity graph…
              </div>
            )
          )}
        </div>

        <div className="space-y-4">
          {stats && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <StatTile label="Reports" value={stats.reportCount} />
                <StatTile
                  label="Corroborated"
                  value={stats.byTrust.corroborated + stats.byTrust.trusted}
                  hint="linked by shared infrastructure"
                />
              </div>

              <div className="surface-2 p-4">
                <p className="eyebrow">Trust levels</p>
                <ul className="mt-2 space-y-1.5">
                  {(Object.keys(TRUST_COLORS) as TrustLevel[]).map((t) => (
                    <li key={t} className="flex items-center gap-2 text-[13px]">
                      <span className="h-2 w-2 rounded-full" style={{ background: TRUST_COLORS[t] }} />
                      <span className="text-slate-300">{t}</span>
                      <span className="ml-auto font-mono text-faint">{stats.byTrust[t]}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <TrendSparkline trend={stats.monthlyTrend} />
              <RankedTable title="Top scam types" rows={stats.topScamTypes} />
              <RankedTable title="Known malicious domains" rows={stats.topDomains} />
              <RankedTable title="Known payment handles" rows={stats.topHandles} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
