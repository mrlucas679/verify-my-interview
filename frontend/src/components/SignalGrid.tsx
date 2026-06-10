import { motion } from 'framer-motion';
import { Flag, ShieldCheck, BadgeCheck } from 'lucide-react';
import type { RiskReport } from '../lib/types';

interface Column {
  title: string;
  icon: typeof Flag;
  color: string;
  items: string[];
  empty: string;
}

export function SignalGrid({ report }: { report: RiskReport }) {
  const columns: Column[] = [
    { title: 'Red flags', icon: Flag, color: '#f0544f', items: report.red_flags, empty: 'None found' },
    {
      title: 'Positive signals',
      icon: ShieldCheck,
      color: '#2fbf71',
      items: report.positive_signals,
      empty: 'None found',
    },
    {
      title: 'Verified facts',
      icon: BadgeCheck,
      color: '#4d7cfe',
      items: report.verified_facts,
      empty: 'None yet',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {columns.map((col, i) => {
        const Icon = col.icon;
        return (
          <motion.div
            key={col.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.07 }}
            className="surface-2 p-3.5"
          >
            <div className="mb-2 flex items-center gap-2">
              <Icon className="h-4 w-4" style={{ color: col.color }} />
              <span className="text-sm font-medium text-slate-100">{col.title}</span>
              <span className="ml-auto font-mono text-xs text-faint">{col.items.length}</span>
            </div>
            {col.items.length === 0 ? (
              <p className="text-xs italic text-faint">{col.empty}</p>
            ) : (
              <ul className="space-y-1.5">
                {col.items.map((item, idx) => (
                  <li key={idx} className="flex gap-2 text-xs text-slate-300">
                    <span style={{ color: col.color }}>—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
