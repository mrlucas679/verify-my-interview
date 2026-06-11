// Official guidance citations (FTC / FBI IC3 / BBB) matched to the signals
// this case actually triggered. Every card links to the original source so
// the user can verify the guidance themselves.

import { motion } from 'framer-motion';
import { BookOpenCheck, ExternalLink } from 'lucide-react';
import type { GuidanceCitation } from '../lib/types';

/** Defense-in-depth: only allow http(s) links to become a real href (blocks
 *  javascript:/data: even if a malformed citation ever reaches the client). */
function safeHref(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

export function GuidanceCitations({ citations }: { citations: GuidanceCitation[] }) {
  if (!citations.length) return null;

  return (
    <div className="space-y-2">
      {citations.map((c, i) => (
        <motion.a
          key={c.url}
          href={safeHref(c.url)}
          target="_blank"
          rel="noopener noreferrer"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.07 }}
          className="surface-2 group block p-3.5 transition hover:border-accent/50"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <BookOpenCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
                  {c.source}
                </span>
                <span className="truncate text-sm font-medium text-slate-100">{c.title}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-faint transition group-hover:text-accent" />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{c.excerpt}</p>
              <p className="mt-1.5 font-mono text-[10px] text-faint">
                cited for: {c.matched_signals.join(' · ')}
              </p>
            </div>
          </div>
        </motion.a>
      ))}
    </div>
  );
}
