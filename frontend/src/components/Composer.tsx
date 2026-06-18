import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  MessageSquareText,
  Upload,
  Mic,
  ArrowRight,
  FileText,
  Loader2,
  RotateCcw,
  ShieldQuestion,
  Flag,
  AtSign,
  Link2,
  Phone,
  Banknote,
  type LucideIcon,
} from 'lucide-react';
import { SAMPLES } from '../lib/samples';
import { uploadDocument } from '../lib/api';
import { VoiceRecorder } from './VoiceRecorder';
import {
  detectEntities,
  extractReportIOCs,
  looksLikeVictimReport,
  type DetectedEntity,
} from '../lib/evidenceScan';

type Mode = 'message' | 'upload' | 'voice';
type Intent = 'verify' | 'report';
const MAX_TEXT_UPLOAD_BYTES = 256 * 1024;

export interface ReportInput {
  company: string;
  location: string;
  evidence: string;
  emails: string[];
  domains: string[];
  phones: string[];
}

interface ComposerProps {
  onVerify: (evidence: string) => void;
  onReport: (input: ReportInput) => void;
  /** true while a report submission is in flight (disables the report button). */
  reporting?: boolean;
  /** Compact framing when docked beneath an active stack. */
  docked?: boolean;
}

const MODES: { id: Mode; label: string; icon: LucideIcon }[] = [
  { id: 'message', label: 'Paste', icon: MessageSquareText },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'voice', label: 'Tell us', icon: Mic },
];

const CHIP_ICON: Record<DetectedEntity['kind'], LucideIcon> = {
  email: AtSign,
  link: Link2,
  phone: Phone,
  amount: Banknote,
};

function EvidenceChips({ entities }: { entities: DetectedEntity[] }) {
  const reduceMotion = useReducedMotion();
  if (entities.length === 0) return null;
  return (
    <div className="mt-3" aria-live="polite">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        Details found for checking
      </p>
      <div className="flex flex-wrap gap-1.5">
        {entities.map((e, i) => {
          const Icon = CHIP_ICON[e.kind];
          return (
            <motion.span
              key={`${e.kind}-${e.value}`}
              {...(reduceMotion
                ? {}
                : {
                    initial: { opacity: 0, scale: 0.96 },
                    animate: { opacity: 1, scale: 1 },
                    transition: { duration: 0.16, ease: 'easeOut' as const, delay: i * 0.03 },
                  })}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-accent/30 bg-ink-900 px-2 py-1 font-mono text-[11px] text-slate-300"
            >
              <Icon className="h-3 w-3 shrink-0 text-accent" strokeWidth={1.75} />
              <span className="truncate" style={{ maxWidth: '14rem' }}>
                {e.value}
              </span>
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The single multimodal input. Verify (default) runs a full investigation;
 * Report files a community scam report. Paste / Upload / Voice all write into one
 * evidence string. A non-blocking suggestion offers Report when the text reads
 * like the scam already happened — it never auto-switches.
 */
export function Composer({ onVerify, onReport, reporting = false, docked = false }: ComposerProps) {
  const [intent, setIntent] = useState<Intent>('verify');
  const [mode, setMode] = useState<Mode>('message');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [voiceMeta, setVoiceMeta] = useState<{ durationSec: number; locale: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => uploadAbortRef.current?.abort(), []);

  const evidence = text.trim();
  const detected = useMemo(() => detectEntities(text), [text]);
  const suggestReport = useMemo(
    () => intent === 'verify' && looksLikeVictimReport(text),
    [intent, text]
  );

  function clearAll() {
    setText('');
    setCompany('');
    setLocation('');
    setVoiceMeta(null);
    setFileName(null);
    setFileNote(null);
  }

  function submitVerify() {
    if (!evidence || uploading) return;
    onVerify(evidence);
    clearAll();
  }

  function submitReport() {
    if (!evidence || !company.trim() || uploading || reporting) return;
    const iocs = extractReportIOCs(text);
    onReport({ company: company.trim(), location: location.trim(), evidence, ...iocs });
    clearAll();
  }

  function submit() {
    if (intent === 'verify') submitVerify();
    else submitReport();
  }

  async function onFile(file: File) {
    uploadAbortRef.current?.abort();
    setMode('upload');
    setFileName(file.name);
    setFileNote(null);
    const isText = file.type.startsWith('text') || /\.(eml|txt|md)$/i.test(file.name);
    if (isText) {
      if (file.size > MAX_TEXT_UPLOAD_BYTES) {
        setFileNote('That text file is too large to load safely. Paste only the relevant message instead.');
        return;
      }
      setText(await file.text());
      setFileNote(`Loaded ${file.name}. The text is ready to check.`);
      return;
    }
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploading(true);
    try {
      const { text: extracted, pages } = await uploadDocument(file, { signal: controller.signal });
      setText(extracted);
      setFileNote(
        extracted.trim()
          ? `Extracted ${extracted.length} characters from ${file.name} (${pages} page${pages === 1 ? '' : 's'}). Review before checking.`
          : `No readable text was found in ${file.name}. Try a clearer image or paste the message.`
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      setFileNote(e instanceof Error ? e.message : 'Could not process this file.');
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
        setUploading(false);
      }
    }
  }

  const canVerify = evidence.length > 0 && !uploading;
  const canReport = evidence.length > 0 && company.trim().length > 0 && !uploading && !reporting;

  return (
    <section
      aria-label={intent === 'verify' ? 'Submit evidence to verify' : 'Describe the scam to report'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void onFile(f);
      }}
      className={`surface p-4 transition sm:p-5 ${dragging ? 'border-accent/70 ring-2 ring-accent/30' : ''}`}
    >
      {/* Intent */}
      <div role="tablist" aria-label="What would you like to do?" className="mb-3 flex gap-2">
        {([
          { id: 'verify' as const, label: 'Verify', icon: ShieldQuestion },
          { id: 'report' as const, label: 'Report a scam', icon: Flag },
        ]).map((opt) => {
          const Icon = opt.icon;
          const active = intent === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setIntent(opt.id)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                active ? 'border-accent/60 bg-ink-800 text-white' : 'border-line bg-ink-900 text-muted hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} /> {opt.label}
            </button>
          );
        })}
      </div>

      {/* Mode */}
      <div role="tablist" aria-label="Evidence type" className="flex gap-1 rounded-xl border border-line bg-ink-900 p-1">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setMode(m.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                active ? 'bg-ink-700 text-white shadow-card' : 'text-muted hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} /> {m.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        {mode === 'message' && (
          <div>
            {!docked && (
              <div className="mb-3 flex flex-wrap gap-2">
                {SAMPLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setText(s.text)}
                    className="rounded-full border border-line bg-ink-800 px-3 py-1.5 text-xs text-muted transition hover:border-accent/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
              }}
              rows={docked ? 4 : 8}
              aria-label="Paste the message — email, SMS, or link"
              placeholder="Paste an email, SMS, recruiter message, or link. You can also drop a screenshot or PDF anywhere on this card."
              className="w-full resize-y rounded-lg border border-line bg-ink-900 p-3.5 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <EvidenceChips entities={detected} />
          </div>
        )}

        {mode === 'upload' && (
          <div>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-ink-900 py-10 text-center transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-7 w-7 animate-spin text-accent" strokeWidth={1.75} />
              ) : (
                <FileText className="h-7 w-7 text-faint" strokeWidth={1.75} />
              )}
              <span className="text-sm text-slate-200">
                {uploading ? 'Reading document...' : (fileName ?? 'Click to choose a file, or drop it here')}
              </span>
              <span className="text-xs text-faint">.eml, .txt, PDF or screenshot</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".eml,.txt,.md,.pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = '';
              }}
            />
            {fileNote && <p className="mt-3 text-xs text-muted">{fileNote}</p>}
            {text && <EvidenceChips entities={detected} />}
          </div>
        )}

        {mode === 'voice' && (
          <div>
            {voiceMeta ? (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs text-faint">
                    Transcribed {voiceMeta.durationSec}s of audio · {voiceMeta.locale}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setVoiceMeta(null);
                      setText('');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} /> Re-record
                  </button>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  aria-label="Transcript — edit before verifying"
                  className="w-full resize-y rounded-lg border border-line bg-ink-900 p-3.5 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <EvidenceChips entities={detected} />
              </div>
            ) : (
              <VoiceRecorder onTranscript={(value, meta) => { setText(value); setVoiceMeta(meta); }} />
            )}
          </div>
        )}
      </div>

      {/* Non-blocking suggestion: looks like it already happened → offer Report */}
      {suggestReport && (
        <button
          type="button"
          onClick={() => setIntent('report')}
          className="mt-3 flex w-full items-start gap-2 rounded-lg border border-risk-needs/40 bg-risk-needs/10 px-3 py-2 text-left text-xs text-risk-needs transition hover:border-risk-needs/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span>It sounds like this may have already happened to you. You can report it to protect others — tap to switch to Report.</span>
        </button>
      )}

      {/* Report-only fields */}
      {intent === 'report' && (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="report-company" className="mb-1.5 block text-xs font-medium text-muted">
              Company or brand they claimed to be <span className="text-risk-scam">*</span>
            </label>
            <input
              id="report-company"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Microsoft, Standard Bank, or the agency's name"
              className="w-full rounded-lg border border-line bg-ink-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div>
            <label htmlFor="report-location" className="mb-1.5 block text-xs font-medium text-muted">
              Where did this happen? <span className="text-faint">(optional)</span>
            </label>
            <input
              id="report-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Cape Town, or 'WhatsApp / remote'"
              className="w-full rounded-lg border border-line bg-ink-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={intent === 'verify' ? !canVerify : !canReport}
        className="btn-primary mt-4 w-full"
      >
        {intent === 'verify' ? (
          <>Check this evidence <ArrowRight className="h-4 w-4" strokeWidth={1.75} /></>
        ) : reporting ? (
          <><Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> Filing report…</>
        ) : (
          <>File scam report <Flag className="h-4 w-4" strokeWidth={1.75} /></>
        )}
      </button>
    </section>
  );
}
