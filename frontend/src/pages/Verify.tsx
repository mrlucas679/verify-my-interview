import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  MessageSquareText,
  Upload,
  Mic,
  ArrowRight,
  FileText,
  Loader2,
  RotateCcw,
  ScaleIcon,
  BookCheck,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { SAMPLES } from '../lib/samples';
import { useCase } from '../store/caseStore';
import { uploadDocument } from '../lib/api';
import { VoiceRecorder } from '../components/VoiceRecorder';

type Mode = 'message' | 'upload' | 'voice';

const MODES: { id: Mode; label: string; icon: LucideIcon }[] = [
  { id: 'message', label: 'Paste message', icon: MessageSquareText },
  { id: 'upload', label: 'Upload evidence', icon: Upload },
  { id: 'voice', label: 'Tell us what happened', icon: Mic },
];

// Three factual trust markers — no marketing claims, each maps to a real
// capability of the pipeline (deterministic scorer, cited guidance, redaction).
const TRUST_MARKERS: { icon: LucideIcon; label: string }[] = [
  { icon: ScaleIcon, label: 'Deterministic risk scoring' },
  { icon: BookCheck, label: 'Cites FTC / IC3 / BBB guidance' },
  { icon: ShieldCheck, label: 'POPIA-safe — sensitive identifiers redacted' },
];

export function Verify() {
  const [mode, setMode] = useState<Mode>('message');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [voiceMeta, setVoiceMeta] = useState<{ durationSec: number; locale: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  const { runAnalysis } = useCase();
  const navigate = useNavigate();

  // All three modes write the evidence string into `text`; the pipeline stays
  // unchanged (pasted link is parsed by the Evidence agent like any other text).
  function evidence(): string {
    return text.trim();
  }

  // Voice transcript joins the SAME evidence channel as paste/upload, so the
  // user can edit it before running verification.
  function onTranscript(value: string, meta: { durationSec: number; locale: string }) {
    setText(value);
    setVoiceMeta(meta);
  }

  function submit() {
    const value = evidence();
    if (!value) return;
    void runAnalysis(value);
    navigate('/report');
  }

  async function onFile(file: File) {
    setFileName(file.name);
    setFileNote(null);
    const isText = file.type.startsWith('text') || /\.(eml|txt|md)$/i.test(file.name);
    if (isText) {
      const loaded = await file.text();
      setText(loaded);
      setFileNote(`Loaded ${file.name} — text ready to verify.`);
      return;
    }
    // PDF / image → Azure Document Intelligence OCR on the server
    setUploading(true);
    try {
      const { text: extracted, pages } = await uploadDocument(file);
      setText(extracted);
      setFileNote(
        extracted.trim()
          ? `Extracted ${extracted.length} characters from ${file.name} (${pages} page${pages === 1 ? '' : 's'}) via Document Intelligence.`
          : `No text could be extracted from ${file.name}.`
      );
    } catch (e) {
      setFileNote(e instanceof Error ? e.message : 'Could not process this file.');
    } finally {
      setUploading(false);
    }
  }

  const canSubmit = evidence().length > 0 && !uploading;
  const reveal = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.22, ease: 'easeOut' as const },
      };

  return (
    <div className="bg-grid">
      <div className="mx-auto flex max-w-2xl flex-col px-6 pb-20 pt-16 sm:pt-24">
        {/* Hero — calm and confident, no marketing fluff */}
        <motion.header {...reveal}>
          <span className="eyebrow">Fraud intelligence platform</span>
          <h1 className="mt-3 font-display text-3xl font-semibold leading-[1.12] tracking-tight text-white sm:text-[2.6rem]">
            Know if a job offer is real — before you reply.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            A team of specialist agents verifies the recruiter, the sending domain, and the
            scam-network intelligence behind the message — then shows you the proof.
          </p>
        </motion.header>

        {/* The single verification slot */}
        <motion.section
          {...(reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 10 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.24, ease: 'easeOut' as const, delay: 0.06 },
              })}
          aria-label="Submit evidence to verify"
          className="surface mt-9 p-4 sm:p-5"
        >
          {/* Mode selector — segmented pills */}
          <div
            role="tablist"
            aria-label="Evidence type"
            className="flex flex-col gap-1 rounded-xl border border-line bg-ink-900 p-1 sm:flex-row"
          >
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
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                    active
                      ? 'bg-ink-700 text-white shadow-card'
                      : 'text-muted hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            {mode === 'message' && (
              <div>
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
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
                  }}
                  rows={10}
                  aria-label="Paste the message — email, SMS, or link"
                  placeholder="Paste the message — an email (with headers if you have them), an SMS, or a link. Include the sender address."
                  className="w-full resize-y rounded-lg border border-line bg-ink-900 p-3.5 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
            )}

            {mode === 'upload' && (
              <div>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-ink-900 py-12 text-center transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
                >
                  {uploading ? (
                    <Loader2 className="h-7 w-7 animate-spin text-accent" strokeWidth={1.75} />
                  ) : (
                    <FileText className="h-7 w-7 text-faint" strokeWidth={1.75} />
                  )}
                  <span className="text-sm text-slate-200">
                    {uploading ? 'Reading document…' : (fileName ?? 'Click to choose a file')}
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
                {text && (
                  <p className="mt-2 text-xs text-faint">
                    Extracted text is ready — run verification below.
                  </p>
                )}
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
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
                      }}
                      rows={8}
                      aria-label="Transcript — edit before verifying"
                      placeholder="Your transcribed account appears here. Edit it before verifying."
                      className="w-full resize-y rounded-lg border border-line bg-ink-900 p-3.5 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <p className="mt-2 text-xs text-faint">
                      Review and correct the transcript above, then run verification.
                    </p>
                  </div>
                ) : (
                  <VoiceRecorder onTranscript={onTranscript} />
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="btn-primary mt-4 w-full"
          >
            Run verification <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </motion.section>

        {/* One quiet row of factual trust markers */}
        <motion.ul
          {...(reduceMotion
            ? {}
            : {
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: { duration: 0.24, ease: 'easeOut' as const, delay: 0.14 },
              })}
          className="mt-6 flex flex-col gap-x-6 gap-y-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center"
        >
          {TRUST_MARKERS.map((t) => {
            const Icon = t.icon;
            return (
              <li key={t.label} className="flex items-center gap-2 text-xs text-faint">
                <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
                {t.label}
              </li>
            );
          })}
        </motion.ul>
      </div>
    </div>
  );
}
