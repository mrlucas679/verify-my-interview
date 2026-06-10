import type { AnalyzeResponse, EntityGraph, NetworkStats } from './types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CaseContext {
  evidence: string;
  risk_level: string;
  risk_score: number;
  case_summary: string;
  red_flags: string[];
  matches: Array<{ reportId: string; scamType: string; similarity: number }>;
}

export async function chat(
  caseContext: CaseContext,
  messages: ChatMessage[]
): Promise<{ reply: string; engine: string }> {
  const res = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseContext, messages }),
  });
  if (!res.ok) throw new Error(`Chat failed (${res.status})`);
  return res.json();
}

export async function uploadDocument(
  file: File
): Promise<{ text: string; pages: number; fileName: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  if (!res.ok) {
    let detail = `Upload failed (${res.status})`;
    try {
      const b = await res.json();
      if (b?.error) detail = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function fetchNetworkGraph(): Promise<EntityGraph> {
  const res = await fetch('/network/graph');
  if (!res.ok) throw new Error(`Failed to load network graph (${res.status})`);
  return res.json();
}

export async function fetchNetworkStats(): Promise<NetworkStats> {
  const res = await fetch('/network/stats');
  if (!res.ok) throw new Error(`Failed to load network stats (${res.status})`);
  return res.json();
}

export async function analyze(evidence: string): Promise<AnalyzeResponse> {
  const res = await fetch('/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidence }),
  });
  if (!res.ok) {
    let detail = `Server responded ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}
