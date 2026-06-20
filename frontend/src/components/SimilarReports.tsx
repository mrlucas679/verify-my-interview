import { motion } from 'framer-motion';
import { FileSearch } from 'lucide-react';
import type { NetworkMatch } from '../lib/types';

/** Prior reported scams matched semantically or by shared identifiers. */
export function SimilarReports({ matches }: { matches: NetworkMatch[] }) {
  if (!matches.length) return null;
  return (
    <div className="space-y-2">
      {matches.map((match, index) => (
        <motion.div
          key={match.reportId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.06 }}
          className="surface-2 p-3.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <FileSearch className="h-4 w-4 text-muted" strokeWidth={1.75} />
            <span className="font-mono text-xs text-faint">{match.reportId}</span>
            <span className="text-sm text-slate-100">{match.scamType}</span>
            <span className="ml-auto font-mono text-xs text-muted">
              {Math.round(match.similarity * 100)}% similar
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{match.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {match.reasons.map((reason) => (
              <span
                key={reason}
                className="rounded-md border border-line bg-ink-900 px-2 py-0.5 text-[11px] text-slate-300"
              >
                {reason}
              </span>
            ))}
          </div>
          <p className="mt-2 font-mono text-[11px] text-faint">
            reported {match.reportedAt} - {match.location}
          </p>
        </motion.div>
      ))}
    </div>
  );
}
