import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
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

  const runAnalysis = useCallback(async (evidence: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setLastEvidence(evidence);
    try {
      const data = await analyze(evidence);
      setResult(data);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Investigation failed');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

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
