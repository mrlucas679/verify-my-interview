import { motion } from 'framer-motion';
import type { StructuredSignal } from '../lib/types';

/** Evidence-grounded findings — every signal shows the proof and its score weight. */
export function Findings({ signals }: { signals: StructuredSignal[] }) {
  if (!signals.length) {
    return (
      <p className="surface-2 p-4 text-sm text-faint">
        No signals derived. Provide a fuller email (sender address, links, any payment request) for
        a stronger investigation.
      </p>
    );
  }
  const sorted = [...signals].sort((a, b) => b.points - a.points);

  return (
    <div className="space-y-2">
      {sorted.map((s, i) => {
        const red = s.category === 'red';
        const color = red ? '#f0544f' : '#2fbf71';
        return (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="surface-2 flex items-start gap-3 p-3.5"
            style={{ borderLeft: `2px solid ${color}` }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-100">{s.label}</span>
                <span className="font-mono text-[11px]" style={{ color }}>
                  {s.points > 0 ? `+${s.points}` : s.points}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{s.evidence.detail}</p>
            </div>
            <span className="shrink-0 rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-faint">
              {s.evidence.source}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
