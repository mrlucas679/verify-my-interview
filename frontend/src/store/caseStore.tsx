import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AnalyzeResponse } from '../lib/types';
import { analyze, loadSharedReport } from '../lib/api';

/** One submission in the workspace timeline — a verify run that renders as a
 *  group of intelligence cards. Each entry tracks its own lifecycle so several
 *  can sit stacked (running / done / error) without clobbering one another. */
export interface CaseEntry {
  id: string;
  evidence: string;
  status: 'running' | 'done' | 'error';
  result: AnalyzeResponse | null;
  error: string | null;
  createdAt: number;
}

interface CaseState {
  /** The workspace stack (newest last). */
  entries: CaseEntry[];
  /** Latest completed result — drives ChatPanel, Share, and the /s/:id route. */
  result: AnalyzeResponse | null;
  /** True while any entry is still running. */
  loading: boolean;
  error: string | null;
  lastEvidence: string;
  runAnalysis: (evidence: string) => Promise<AnalyzeResponse | null>;
  loadShared: (id: string) => Promise<AnalyzeResponse | null>;
  /** Clear the whole workspace stack (the "New case" action). */
  newCase: () => void;
  reset: () => void;
}

const CaseContext = createContext<CaseState | null>(null);

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CaseProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<CaseEntry[]>([]);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastEvidence, setLastEvidence] = useState('');
  // One AbortController per in-flight entry, so each can be cancelled
  // independently and all can be torn down on newCase/unmount.
  const aborters = useRef<Map<string, AbortController>>(new Map());
  // Guards the shared-report load against a stale response overwriting a newer one.
  const sharedRequestRef = useRef(0);

  const updateEntry = useCallback((id: string, patch: Partial<CaseEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const runAnalysis = useCallback(
    async (evidence: string) => {
      const id = newId();
      const controller = new AbortController();
      aborters.current.set(id, controller);
      setEntries((prev) => [
        ...prev,
        { id, evidence, status: 'running', result: null, error: null, createdAt: Date.now() },
      ]);
      setLastEvidence(evidence);
      setError(null);
      try {
        const data = await analyze(evidence, { signal: controller.signal });
        updateEntry(id, { status: 'done', result: data });
        setResult(data); // latest completed result for chat/share
        return data;
      } catch (e) {
        if (controller.signal.aborted) {
          // Cancelled (e.g. New case) — drop the entry quietly.
          setEntries((prev) => prev.filter((entry) => entry.id !== id));
          return null;
        }
        const message = e instanceof Error ? e.message : 'Investigation failed';
        updateEntry(id, { status: 'error', error: message });
        setError(message);
        return null;
      } finally {
        aborters.current.delete(id);
      }
    },
    [updateEntry]
  );

  // Load a previously shared report by id (the /s/:id route). Kept separate from
  // the workspace stack: it sets `result` directly for the read-only dossier.
  const loadShared = useCallback(async (id: string) => {
    const requestId = sharedRequestRef.current + 1;
    sharedRequestRef.current = requestId;
    setError(null);
    setResult(null);
    try {
      const data = await loadSharedReport(id);
      if (requestId !== sharedRequestRef.current) return null;
      setResult(data);
      return data;
    } catch (e) {
      if (requestId !== sharedRequestRef.current) return null;
      setError(e instanceof Error ? e.message : 'Could not load this shared report');
      return null;
    }
  }, []);

  const newCase = useCallback(() => {
    for (const c of aborters.current.values()) c.abort();
    aborters.current.clear();
    setEntries([]);
    setResult(null);
    setError(null);
    setLastEvidence('');
  }, []);

  // `reset` retained for API compatibility (shared route, error recovery).
  const reset = useCallback(() => {
    sharedRequestRef.current += 1;
    setResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    const live = aborters.current;
    return () => {
      for (const c of live.values()) c.abort();
      live.clear();
    };
  }, []);

  const loading = useMemo(() => entries.some((e) => e.status === 'running'), [entries]);

  const value = useMemo(
    () => ({ entries, result, loading, error, lastEvidence, runAnalysis, loadShared, newCase, reset }),
    [entries, result, loading, error, lastEvidence, runAnalysis, loadShared, newCase, reset]
  );

  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>;
}

export function useCase(): CaseState {
  const ctx = useContext(CaseContext);
  if (!ctx) throw new Error('useCase must be used within a CaseProvider');
  return ctx;
}
