import { motion } from 'framer-motion';
import { Network } from 'lucide-react';
import type { NetworkMatch } from '../lib/types';

/** Prior reported scams matched semantically + by shared entities. */
export function NetworkMatches({ matches }: { matches: NetworkMatch[] }) {
  if (!matches.length) return null;
  return (
    <div className="space-y-2">
      {matches.map((m, i) => (
        <motion.div
          key={m.reportId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className="surface-2 p-3.5"
        >
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-accent" />
            <span className="font-mono text-xs text-faint">{m.reportId}</span>
            <span className="text-sm text-slate-100">{m.scamType}</span>
            <span className="ml-auto font-mono text-xs text-accent">
              {Math.round(m.similarity * 100)}% match
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{m.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.reasons.map((r, idx) => (
              <span
                key={idx}
                className="rounded-md border border-line bg-ink-900 px-2 py-0.5 text-[11px] text-slate-300"
              >
                {r}
              </span>
            ))}
          </div>
          <p className="mt-2 font-mono text-[11px] text-faint">
            reported {m.reportedAt} · {m.location}
          </p>
        </motion.div>
      ))}
    </div>
  );
}
