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
import { ApiError, analyze, getCase, listCases, loadSharedReport, type ServerCase } from '../lib/api';
import { useAuth } from '../lib/auth';

const HISTORY_KEY = 'vmi.history.v1';
const HISTORY_LIMIT = 60;
const MAX_HISTORY_STORAGE_CHARS = 4_500_000;

/** One submission in the workspace timeline — a verify run that renders as a
 *  group of intelligence cards. Each entry tracks its own lifecycle so several
 *  can sit stacked (running / done / error) without clobbering one another. */
export interface CaseEntry {
  id: string;
  evidence: string;
  status: 'running' | 'done' | 'error';
  result: AnalyzeResponse | null;
  error: string | null;
  errorCode?: string;
  createdAt: number;
}

export interface HistoryItem {
  id: string;
  kind: 'check' | 'report';
  title: string;
  evidence: string;
  summary: string;
  createdAt: number;
  source?: 'local' | 'server';
  result?: AnalyzeResponse;
  caseId?: string;
  reportId?: string;
  evidenceIds?: string[];
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
  /** Latest completed result — drives follow-up chat, Share, and the /s/:id route. */
  result: AnalyzeResponse | null;
  /** True while any entry is still running. */
  loading: boolean;
  error: string | null;
  lastEvidence: string;
  runAnalysis: (evidence: string, options?: AnalyzeRunOptions) => Promise<AnalyzeResponse | null>;
  loadShared: (id: string) => Promise<AnalyzeResponse | null>;
  recordReport: (input: ReportHistoryInput) => void;
  openHistoryItem: (id: string) => Promise<boolean>;
  clearHistory: () => void;
  /** Clear the whole workspace stack (the "New check" action). */
  newCase: () => void;
  reset: () => void;
}

interface AnalyzeRunOptions {
  evidenceIds?: string[];
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

function cleanAnalyzeResponse(value: unknown): AnalyzeResponse | undefined {
  if (!isRecord(value) || !isRecord(value.report)) return undefined;
  if (!Array.isArray(value.signals) || !Array.isArray(value.matches) || !isRecord(value.trace)) {
    return undefined;
  }
  return value as unknown as AnalyzeResponse;
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
    source: value.source === 'server' ? 'server' : 'local',
    result: cleanAnalyzeResponse(value.result),
    caseId: caseId || undefined,
    reportId: reportId || undefined,
    evidenceIds: Array.isArray(value.evidenceIds)
      ? value.evidenceIds.map((item) => cleanString(item, 192)).filter(Boolean).slice(0, 20)
      : undefined,
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
    let next = items.filter((item) => item.source !== 'server').slice(0, HISTORY_LIMIT);
    let serialized = JSON.stringify(next);
    while (next.length > 0 && serialized.length > MAX_HISTORY_STORAGE_CHARS) {
      next = next.slice(0, -1);
      serialized = JSON.stringify(next);
    }
    window.localStorage.setItem(HISTORY_KEY, serialized);
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

function sharedEvidenceLabel(result: AnalyzeResponse): string {
  const entities = result.report.entities;
  const parts = [
    entities.companies[0],
    entities.job_titles[0],
    entities.emails[0],
    entities.domains[0],
  ].filter(Boolean);
  return parts.length ? `Shared investigation: ${parts.join(' · ')}` : 'Shared investigation';
}

function upsertHistory(items: HistoryItem[], item: HistoryItem): HistoryItem[] {
  return [item, ...items.filter((current) => current.id !== item.id)].slice(0, HISTORY_LIMIT);
}

function serverCaseTitle(item: ServerCase): string {
  const result = cleanAnalyzeResponse(item.result);
  const company = result?.report.entities.companies[0]?.trim();
  if (company) return company.slice(0, 120);
  return item.caseSummary.split(/[.!?]/)[0]?.trim().slice(0, 120) || 'Saved check';
}

function serverCaseToHistory(item: ServerCase): HistoryItem {
  const result = cleanAnalyzeResponse(item.result);
  const created = Date.parse(item.createdAt);
  return {
    id: `server-${item._id}`,
    kind: 'check',
    title: serverCaseTitle(item),
    evidence: result ? sharedEvidenceLabel(result) : `Saved investigation snapshot ${item._id}`,
    summary: item.caseSummary,
    createdAt: Number.isFinite(created) ? created : Date.now(),
    source: 'server',
    result,
    caseId: item._id,
    evidenceIds: item.evidenceIds.slice(0, 20),
    riskLevel: cleanRiskLevel(item.riskLevel),
    riskScore: cleanNumber(item.riskScore),
  };
}

function mergeServerHistory(current: HistoryItem[], serverCases: ServerCase[]): HistoryItem[] {
  const byCaseId = new Set(current.map((item) => item.caseId).filter((id): id is string => Boolean(id)));
  const merged = [...current];
  for (const item of serverCases.slice(0, HISTORY_LIMIT)) {
    if (byCaseId.has(item._id)) continue;
    merged.push(serverCaseToHistory(item));
  }
  return merged.sort((a, b) => b.createdAt - a.createdAt).slice(0, HISTORY_LIMIT);
}

export function CaseProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [entries, setEntries] = useState<CaseEntry[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastEvidence, setLastEvidence] = useState('');
  // One AbortController per in-flight entry, so each can be cancelled
  // independently and all can be torn down on newCase/unmount.
  const aborters = useRef<Map<string, AbortController>>(new Map());
  const inFlightEvidence = useRef<Map<string, Promise<AnalyzeResponse | null>>>(new Map());
  // Guards the shared-report load against a stale response overwriting a newer one.
  const sharedRequestRef = useRef(0);

  const updateEntry = useCallback((id: string, patch: Partial<CaseEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const runAnalysis = useCallback(
    (evidence: string, options: AnalyzeRunOptions = {}) => {
      const key = evidence.trim();
      const existing = inFlightEvidence.current.get(key);
      if (existing) return existing;
      const id = newId();
      const controller = new AbortController();
      aborters.current.set(id, controller);
      setEntries((prev) => [
        ...prev,
        { id, evidence, status: 'running', result: null, error: null, createdAt: Date.now() },
      ]);
      setLastEvidence(evidence);
      setError(null);
      const work = (async () => {
      try {
        const data = await analyze(evidence, { signal: controller.signal, evidenceIds: options.evidenceIds });
        updateEntry(id, { status: 'done', result: data });
        setResult(data); // latest completed result for chat/share
        setHistory((prev) =>
          upsertHistory(prev, {
            id,
            kind: 'check',
            source: 'local',
            title: historyTitleFromResult(data, evidence),
            evidence,
            summary: data.report.case_summary,
            createdAt: Date.now(),
            result: data,
            caseId: data.case_id,
            evidenceIds: options.evidenceIds?.slice(0, 20),
            riskLevel: data.report.risk_level,
            riskScore: data.report.risk_score,
            confidence: data.report.confidence,
          })
        );
        return data;
      } catch (e) {
        if (controller.signal.aborted) {
          // Cancelled (e.g. New check) — drop the entry quietly.
          setEntries((prev) => prev.filter((entry) => entry.id !== id));
          return null;
        }
        const message = e instanceof Error ? e.message : 'Investigation failed';
        updateEntry(id, { status: 'error', error: message, errorCode: e instanceof ApiError ? e.code : undefined });
        setError(message);
        return null;
      } finally {
        aborters.current.delete(id);
        inFlightEvidence.current.delete(key);
      }
      })();
      inFlightEvidence.current.set(key, work);
      return work;
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
          evidence: sharedEvidenceLabel(data),
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
        source: 'local',
        title: input.company || 'Scam report',
        evidence: input.evidence,
        summary: 'Report received. You can run a check on the same evidence any time.',
        createdAt: Date.now(),
        reportId,
      })
    );
  }, []);

  const openHistoryItem = useCallback(
    async (id: string) => {
      const item = history.find((entry) => entry.id === id);
      if (!item || item.kind !== 'check') return false;
      let resultToOpen = item.result;
      if (!resultToOpen && item.caseId) {
        try {
          const serverCase = await getCase(item.caseId);
          const loaded = cleanAnalyzeResponse(serverCase.result);
          resultToOpen = loaded;
          if (loaded) {
            setHistory((prev) =>
              prev.map((entry) =>
                entry.id === id
                  ? {
                      ...entry,
                      result: loaded,
                      title: historyTitleFromResult(loaded, entry.evidence),
                      summary: loaded.report.case_summary,
                      confidence: loaded.report.confidence,
                    }
                  : entry
              )
            );
          }
        } catch {
          return false;
        }
      }
      if (!resultToOpen) return false;
      const opened = resultToOpen;
      for (const c of aborters.current.values()) c.abort();
      aborters.current.clear();
      setEntries([
        {
          id: item.id,
          evidence: item.evidence,
          status: 'done',
          result: opened,
          error: null,
          createdAt: item.createdAt,
        },
      ]);
      setResult(opened);
      setLastEvidence(item.evidence);
      setError(null);
      return true;
    },
    [history]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const newCase = useCallback(() => {
    for (const c of aborters.current.values()) c.abort();
    aborters.current.clear();
    inFlightEvidence.current.clear();
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
    if (!auth.authenticated) return;
    const controller = new AbortController();
    listCases({ signal: controller.signal })
      .then(({ cases }) => setHistory((prev) => mergeServerHistory(prev, cases)))
      .catch(() => {});
    return () => controller.abort();
  }, [auth.authenticated]);

  useEffect(() => {
    const live = aborters.current;
    return () => {
      for (const c of live.values()) c.abort();
      live.clear();
      inFlightEvidence.current.clear();
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
      openHistoryItem,
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
      openHistoryItem,
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
