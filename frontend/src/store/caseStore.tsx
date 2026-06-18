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
import type { AnalyzeResponse, RiskLevel } from '../lib/types';
import { analyze, loadSharedReport } from '../lib/api';

const HISTORY_KEY = 'vmi.history.v1';
const HISTORY_LIMIT = 60;

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

export interface HistoryItem {
  id: string;
  kind: 'check' | 'report';
  title: string;
  evidence: string;
  summary: string;
  createdAt: number;
  caseId?: string;
  reportId?: string;
  riskLevel?: RiskLevel;
  riskScore?: number;
  confidence?: number;
}

export interface ReportHistoryInput {
  company: string;
  evidence: string;
  reportId: string | null;
}

interface CaseState {
  /** The workspace stack (newest last). */
  entries: CaseEntry[];
  /** Completed checks and filed reports saved locally for the History page. */
  history: HistoryItem[];
  /** Latest completed result — drives ChatPanel, Share, and the /s/:id route. */
  result: AnalyzeResponse | null;
  /** True while any entry is still running. */
  loading: boolean;
  error: string | null;
  lastEvidence: string;
  runAnalysis: (evidence: string) => Promise<AnalyzeResponse | null>;
  loadShared: (id: string) => Promise<AnalyzeResponse | null>;
  recordReport: (input: ReportHistoryInput) => void;
  clearHistory: () => void;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function cleanCreatedAt(value: unknown): number {
  const timestamp = cleanNumber(value);
  return timestamp && timestamp > 0 ? timestamp : Date.now();
}

function cleanRiskLevel(value: unknown): RiskLevel | undefined {
  if (
    value === 'Low Risk' ||
    value === 'Needs More Verification' ||
    value === 'Suspicious' ||
    value === 'Likely Scam' ||
    value === 'Inconclusive'
  ) {
    return value;
  }
  return undefined;
}

function parseHistoryItem(value: unknown): HistoryItem | null {
  if (!isRecord(value)) return null;
  const kind = value.kind === 'check' || value.kind === 'report' ? value.kind : null;
  const id = cleanString(value.id, 96);
  const evidence = cleanString(value.evidence, 40_000);
  const title = cleanString(value.title, 140);
  if (!kind || !id || !evidence || !title) return null;

  const caseId = cleanString(value.caseId, 96);
  const reportId = cleanString(value.reportId, 96);
  return {
    id,
    kind,
    title,
    evidence,
    summary: cleanString(value.summary, 500),
    createdAt: cleanCreatedAt(value.createdAt),
    caseId: caseId || undefined,
    reportId: reportId || undefined,
    riskLevel: cleanRiskLevel(value.riskLevel),
    riskScore: cleanNumber(value.riskScore),
    confidence: cleanNumber(value.confidence),
  };
}

function loadHistory(): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseHistoryItem).filter((item): item is HistoryItem => !!item).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
  } catch {
    // Local history is helpful, but storage failures should never block a check.
  }
}

function compactEvidence(evidence: string): string {
  return evidence.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function historyTitleFromResult(result: AnalyzeResponse, evidence: string): string {
  const company = result.report.entities.companies[0]?.trim();
  if (company) return company.slice(0, 120);
  return compactEvidence(evidence) || 'Untitled check';
}

function upsertHistory(items: HistoryItem[], item: HistoryItem): HistoryItem[] {
  return [item, ...items.filter((current) => current.id !== item.id)].slice(0, HISTORY_LIMIT);
}

export function CaseProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<CaseEntry[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
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
        setHistory((prev) =>
          upsertHistory(prev, {
            id,
            kind: 'check',
            title: historyTitleFromResult(data, evidence),
            evidence,
            summary: data.report.case_summary,
            createdAt: Date.now(),
            caseId: data.case_id,
            riskLevel: data.report.risk_level,
            riskScore: data.report.risk_score,
            confidence: data.report.confidence,
          })
        );
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
    setEntries([]);
    try {
      const data = await loadSharedReport(id);
      if (requestId !== sharedRequestRef.current) return null;
      setResult(data);
      setEntries([
        {
          id: `shared-${id}`,
          evidence: 'Shared investigation dossier',
          status: 'done',
          result: data,
          error: null,
          createdAt: Date.now(),
        },
      ]);
      setLastEvidence('');
      return data;
    } catch (e) {
      if (requestId !== sharedRequestRef.current) return null;
      setError(e instanceof Error ? e.message : 'Could not load this shared report');
      return null;
    }
  }, []);

  const recordReport = useCallback((input: ReportHistoryInput) => {
    const reportId = input.reportId ?? newId();
    setHistory((prev) =>
      upsertHistory(prev, {
        id: `report-${reportId}`,
        kind: 'report',
        title: input.company || 'Scam report',
        evidence: input.evidence,
        summary: 'Report received. You can run a check on the same evidence any time.',
        createdAt: Date.now(),
        reportId,
      })
    );
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
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
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    const live = aborters.current;
    return () => {
      for (const c of live.values()) c.abort();
      live.clear();
    };
  }, []);

  const loading = useMemo(() => entries.some((e) => e.status === 'running'), [entries]);

  const value = useMemo(
    () => ({
      entries,
      history,
      result,
      loading,
      error,
      lastEvidence,
      runAnalysis,
      loadShared,
      recordReport,
      clearHistory,
      newCase,
      reset,
    }),
    [
      entries,
      history,
      result,
      loading,
      error,
      lastEvidence,
      runAnalysis,
      loadShared,
      recordReport,
      clearHistory,
      newCase,
      reset,
    ]
  );

  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>;
}

export function useCase(): CaseState {
  const ctx = useContext(CaseContext);
  if (!ctx) throw new Error('useCase must be used within a CaseProvider');
  return ctx;
}
