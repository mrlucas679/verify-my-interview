import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, MessageSquare } from 'lucide-react';
import { ApiError, chat, type ChatMessage, type CaseContext } from '../lib/api';
import { useCase } from '../store/caseStore';

const SUGGESTIONS = [
  'Why is this suspicious?',
  'Draft a safe reply',
  'How do I report it?',
];

function detectiveFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'CLIENT_TIMEOUT') {
      return 'I could not finish that reply in time. Ask one shorter question and I will try again.';
    }
    if (error.code === 'CHAT_BAD_PAYLOAD') {
      return 'I could not read this case well enough to answer safely. Start a new check, then ask again.';
    }
    if (error.status >= 500 || error.code === 'CHAT_RUNTIME_ERROR') {
      return 'I cannot answer this follow-up right now. The report is still available, and you can try again in a moment.';
    }
  }
  return error instanceof Error
    ? error.message
    : 'I cannot answer this follow-up right now. Please try again.';
}

export function ChatPanel() {
  const { result, lastEvidence } = useCase();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!result) return null;

  const ctx: CaseContext = {
    evidence: lastEvidence,
    risk_level: result.report.risk_level,
    risk_score: result.report.risk_score,
    case_summary: result.report.case_summary,
    red_flags: result.report.red_flags,
    matches: result.matches.map((m) => ({
      reportId: m.reportId,
      scamType: m.scamType,
      similarity: m.similarity,
    })),
  };

  async function send(text: string) {
    const content = text.trim();
    if (!content || inFlightRef.current) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const { reply } = await chat(ctx, next, { signal: controller.signal });
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessages([...next, { role: 'assistant', content: detectiveFailure(error) }]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <div className="surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-accent" />
        <span className="text-sm font-medium text-slate-100">Ask about this report</span>
      </div>

      {messages.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-line bg-ink-800 px-3 py-1.5 text-xs text-muted transition hover:border-accent/60 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[360px] space-y-2.5 overflow-y-auto">
        {messages.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm ${
                m.role === 'user'
                  ? 'bg-accent text-white'
                  : 'surface-2 text-slate-200'
              }`}
            >
              {m.content}
            </div>
          </motion.div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="surface-2 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reviewing the report...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send(input);
          }}
          placeholder="Ask what this means, what to do next, or how to reply safely..."
          className="flex-1 rounded-lg border border-line bg-ink-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          className="btn-primary px-3"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
