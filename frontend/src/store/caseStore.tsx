import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AnalyzeResponse } from '../lib/types';
import { analyze } from '../lib/api';

interface CaseState {
  result: AnalyzeResponse | null;
  loading: boolean;
  error: string | null;
  lastEvidence: string;
  runAnalysis: (evidence: string) => Promise<AnalyzeResponse | null>;
  reset: () => void;
}

const CaseContext = createContext<CaseState | null>(null);

export function CaseProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvidence, setLastEvidence] = useState('');
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const runAnalysis = useCallback(async (evidence: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResult(null);
    setLastEvidence(evidence);
    try {
      const data = await analyze(evidence, { signal: controller.signal });
      if (requestId !== requestIdRef.current) return null;
      setResult(data);
      return data;
    } catch (e) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return null;
      setError(e instanceof Error ? e.message : 'Investigation failed');
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <CaseContext.Provider value={{ result, loading, error, lastEvidence, runAnalysis, reset }}>
      {children}
    </CaseContext.Provider>
  );
}

export function useCase(): CaseState {
  const ctx = useContext(CaseContext);
  if (!ctx) throw new Error('useCase must be used within a CaseProvider');
  return ctx;
}
