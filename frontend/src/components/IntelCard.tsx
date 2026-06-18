import { useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Copy, Check, type LucideIcon } from 'lucide-react';

/** Icon tint by risk emphasis — uses only the Sentinel risk palette. */
const TINT: Record<string, string> = {
  scam: 'text-risk-scam',
  suspicious: 'text-risk-suspicious',
  needs: 'text-risk-needs',
  low: 'text-risk-low',
  inconclusive: 'text-risk-inconclusive',
  accent: 'text-accent',
  default: 'text-muted',
};

export interface IntelCardProps {
  icon: LucideIcon;
  title: string;
  /** Small right-aligned metadata (e.g. an engine badge or count). */
  meta?: ReactNode;
  tint?: keyof typeof TINT;
  defaultExpanded?: boolean;
  /** When set, a Copy control is shown that writes this text to the clipboard. */
  copyText?: string;
  /** Extra header actions (e.g. Share/Save), rendered before the chevron. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * The workspace's core primitive: one collapsible, copyable intelligence card.
 * Header = type icon + title + meta + actions + collapse toggle; body reveals on
 * expand. Motion is opacity-only (Sentinel rule); fully keyboard-operable with a
 * labelled expand button controlling the body region.
 */
export function IntelCard({
  icon: Icon,
  title,
  meta,
  tint = 'default',
  defaultExpanded = true,
  copyText,
  actions,
  children,
}: IntelCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const reduceMotion = useReducedMotion();
  const bodyId = useId();

  async function copy() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — non-fatal, the content is still on screen */
    }
  }

  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <Icon className={`h-4 w-4 shrink-0 ${TINT[tint]}`} strokeWidth={1.75} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">{title}</h3>
        {meta && <span className="shrink-0 font-mono text-[11px] text-faint">{meta}</span>}
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {copyText && (
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? 'Copied' : `Copy ${title}`}
              className="rounded-md p-1.5 text-faint transition hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-risk-low" strokeWidth={1.75} />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={bodyId}
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            className="rounded-md p-1.5 text-faint transition hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? '' : '-rotate-90'}`}
              strokeWidth={1.75}
            />
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={bodyId}
            {...(reduceMotion
              ? {}
              : {
                  initial: { opacity: 0 },
                  animate: { opacity: 1 },
                  exit: { opacity: 0 },
                  transition: { duration: 0.16, ease: 'easeOut' as const },
                })}
            className="border-t border-line px-5 py-4"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
