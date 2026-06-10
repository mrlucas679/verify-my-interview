import { motion } from 'framer-motion';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import type { RiskReport } from '../lib/types';
import { riskStyle } from '../lib/risk';

function RiskIcon({ level, color }: { level: string; color: string }) {
  const cls = 'h-6 w-6';
  if (level === 'Likely Scam' || level === 'Suspicious')
    return <ShieldAlert className={cls} style={{ color }} />;
  if (level === 'Low Risk') return <ShieldCheck className={cls} style={{ color }} />;
  return <ShieldQuestion className={cls} style={{ color }} />;
}

function Meter({
  value,
  color,
  label,
  display,
}: {
  value: number;
  color: string;
  label: string;
  display: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[72px] text-xs text-faint">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-900">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>
      <span className="w-12 text-right font-mono text-xs text-muted">{display}</span>
    </div>
  );
}

export function VerdictCard({ report }: { report: RiskReport }) {
  const style = riskStyle(report.risk_level);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border p-5"
      style={{ background: style.bg, borderColor: `${style.color}44` }}
    >
      <div className="flex items-center gap-4">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl"
          style={{ background: `${style.color}1f` }}
        >
          <RiskIcon level={report.risk_level} color={style.color} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-xl font-semibold" style={{ color: style.color }}>
            {report.risk_level}
          </div>
          <div className="mt-2 space-y-1.5">
            <Meter
              value={report.risk_score}
              color={style.color}
              label="Risk score"
              display={`${report.risk_score}/100`}
            />
            <Meter
              value={Math.round(report.confidence * 100)}
              color="#4d7cfe"
              label="Confidence"
              display={`${Math.round(report.confidence * 100)}%`}
            />
          </div>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-slate-200">{report.case_summary}</p>
    </motion.div>
  );
}
