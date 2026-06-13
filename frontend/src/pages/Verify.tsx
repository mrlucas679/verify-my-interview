import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  MessageSquareText,
  Upload,
  Mic,
  ArrowRight,
  FileText,
  FileSearch,
  Loader2,
  RotateCcw,
  ScaleIcon,
  BookCheck,
  ShieldCheck,
  Globe,
  Network,
  Gavel,
  AtSign,
  Link2,
  Phone,
  Banknote,
  type LucideIcon,
} from 'lucide-react';
import { SAMPLES } from '../lib/samples';
import { useCase } from '../store/caseStore';
import { uploadDocument } from '../lib/api';
import { VoiceRecorder } from '../components/VoiceRecorder';

type Mode = 'message' | 'upload' | 'voice';
const MAX_TEXT_UPLOAD_BYTES = 256 * 1024;

const MODES: { id: Mode; label: string; icon: LucideIcon }[] = [
  { id: 'message', label: 'Paste message', icon: MessageSquareText },
  { id: 'upload', label: 'Upload evidence', icon: Upload },
  { id: 'voice', label: 'Tell us what happened', icon: Mic },
];

// Three factual trust markers — no marketing claims, each maps to a real
// capability of the pipeline (deterministic scorer, cited guidance, redaction).
const TRUST_MARKERS: { icon: LucideIcon; label: string }[] = [
  { icon: ScaleIcon, label: 'Score comes from evidence, not guesswork' },
  { icon: BookCheck, label: 'Advice cites FTC, IC3, and BBB guidance' },
  { icon: ShieldCheck, label: 'Sensitive identifiers are redacted before analysis' },
];

// The five investigation layers, mirrored from the report page — the hero
// visual stacks them the way the final dossier stacks evidence.
const STACK: { label: string; icon: LucideIcon }[] = [
  { label: 'Evidence', icon: FileSearch },
  { label: 'Verification', icon: ShieldCheck },
  { label: 'Research', icon: Globe },
  { label: 'Network', icon: Network },
  { label: 'Verdict', icon: Gavel },
];

/* ── Live evidence detection (client-side preview only) ─────────────────────
   The real parsing happens server-side; these bounded regexes exist purely so
   the slot visibly "understands" what you paste, chip by chip. */

const SCAN_CAP = 20_000; // never scan more than the server accepts
const CHIP_CAP = 4; // per kind

interface DetectedEntity {
  kind: 'email' | 'link' | 'phone' | 'amount';
  value: string;
}

function dedupeCap(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values.slice(0, 40)) {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
      if (out.length >= CHIP_CAP) break;
    }
  }
  return out;
}

function detectEntities(raw: string): DetectedEntity[] {
  const text = raw.slice(0, SCAN_CAP);
  if (!text.trim()) return [];
  const emails = dedupeCap(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []);
  const links = dedupeCap(
    (text.match(/\bhttps?:\/\/[^\s<>"')]+|\bwww\.[^\s<>"')]+/gi) ?? []).map((u) =>
      u.replace(/[.,;]$/, '')
    )
  );
  const phones = dedupeCap(
    (text.match(/\+?\d[\d\s().-]{7,16}\d/g) ?? []).filter((p) => {
      const digits = p.replace(/\D/g, '');
      return digits.length >= 9 && digits.length <= 15;
    })
  );
  const amounts = dedupeCap(text.match(/\b(?:R|ZAR|\$|USD)\s?\d[\d,\s.]{0,11}\d?\b/g) ?? []);

  const chips: DetectedEntity[] = [
    ...emails.map((value): DetectedEntity => ({ kind: 'email', value })),
    ...links.map((value): DetectedEntity => ({ kind: 'link', value })),
    ...phones.map((value): DetectedEntity => ({ kind: 'phone', value })),
    ...amounts.map((value): DetectedEntity => ({ kind: 'amount', value })),
  ];
  return chips.slice(0, 10);
}

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

/* ── The stacked-dossier hero visual ─────────────────────────────────────────
   Five isometric planes — one per investigation layer — with the active layer
   lifting out of the stack. Pure CSS 3D transforms; decorative (aria-hidden);
   static when the user prefers reduced motion. */

function LayerStack() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(STACK.length - 1);

  useEffect(() => {
    if (reduceMotion) return;
    const t = setInterval(() => setActive((a) => (a + 1) % STACK.length), 1800);
    return () => clearInterval(t);
  }, [reduceMotion]);

  return (
    <div aria-hidden="true" className="relative hidden h-[300px] select-none lg:block">
      <div className="absolute inset-0 [perspective:1100px]">
        <div className="absolute left-1/2 top-1/2 h-0 w-0 [transform-style:preserve-3d]">
          {STACK.map((layer, i) => {
            const Icon = layer.icon;
            const isActive = i === active;
            return (
              <div
                key={layer.label}
                className={`absolute flex h-[120px] w-[230px] items-end rounded-xl border p-3 transition-all duration-300 ease-out ${
                  isActive ? 'border-accent/70 bg-ink-800' : 'border-line bg-ink-850/95'
                }`}
                style={{
                  transform: `translate(-50%, -50%) rotateX(56deg) rotateZ(-14deg) translateZ(${
                    i * 34 + (isActive ? 18 : 0)
                  }px)`,
                  boxShadow: isActive
                    ? '0 18px 40px -18px rgba(0,0,0,0.7)'
                    : '0 10px 24px -16px rgba(0,0,0,0.6)',
                }}
              >
                <span
                  className={`inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide ${
                    isActive ? 'text-accent' : 'text-faint'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {layer.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="absolute bottom-0 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
        Evidence checked in layers before a verdict is shown
      </p>
    </div>
  );
}

export function Verify() {
  const [mode, setMode] = useState<Mode>('message');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [voiceMeta, setVoiceMeta] = useState<{ durationSec: number; locale: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const reduceMotion = useReducedMotion();
  const { runAnalysis } = useCase();
  const navigate = useNavigate();

  useEffect(() => () => uploadAbortRef.current?.abort(), []);

  // All three modes write the evidence string into `text`; the pipeline stays
  // unchanged (pasted link is parsed by the Evidence agent like any other text).
  function evidence(): string {
    return text.trim();
  }

  const detected = useMemo(() => detectEntities(text), [text]);

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
    uploadAbortRef.current?.abort();
    setFileName(file.name);
    setFileNote(null);
    const isText = file.type.startsWith('text') || /\.(eml|txt|md)$/i.test(file.name);
    if (isText) {
      if (file.size > MAX_TEXT_UPLOAD_BYTES) {
        setFileNote('That text file is too large to load safely. Paste only the relevant message instead.');
        return;
      }
      const loaded = await file.text();
      setText(loaded);
      setFileNote(`Loaded ${file.name}. The text is ready to check.`);
      return;
    }
    // PDF / image → Azure Document Intelligence OCR on the server
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploading(true);
    try {
      const { text: extracted, pages } = await uploadDocument(file, { signal: controller.signal });
      setText(extracted);
      setFileNote(
        extracted.trim()
          ? `Extracted ${extracted.length} characters from ${file.name} (${pages} page${pages === 1 ? '' : 's'}). Review the text before checking it.`
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
      <div className="mx-auto flex max-w-5xl flex-col px-6 pb-20 pt-14 sm:pt-20">
        {/* Hero — copy left, stacked-dossier visual right */}
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_340px]">
          <motion.header {...reveal}>
            <span className="eyebrow">Job-offer safety check</span>
            <h1 className="mt-3 font-display text-3xl font-semibold leading-[1.12] tracking-tight text-white sm:text-[2.6rem]">
              Know if a job offer is real — before you reply.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
              Paste the message, upload evidence, or tell us what happened. We check the recruiter,
              domain, payment request, and prior scam patterns, then explain what is safe, risky,
              or still uncertain.
            </p>
          </motion.header>
          <motion.div
            {...(reduceMotion
              ? {}
              : {
                  initial: { opacity: 0 },
                  animate: { opacity: 1 },
                  transition: { duration: 0.3, ease: 'easeOut' as const, delay: 0.1 },
                })}
          >
            <LayerStack />
          </motion.div>
        </div>

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
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) {
              setMode('upload');
              void onFile(f);
            }
          }}
          className={`surface mx-auto mt-10 w-full max-w-2xl p-4 transition sm:p-5 ${
            dragging ? 'border-accent/70 ring-2 ring-accent/30' : ''
          }`}
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
                  rows={9}
                  aria-label="Paste the message — email, SMS, or link"
                  placeholder="Paste the message — an email (with headers if you have them), an SMS, or a link. You can also drop a screenshot anywhere on this card."
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
                  className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-ink-900 py-12 text-center transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
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
                {text && (
                  <div>
                    <p className="mt-2 text-xs text-faint">
                      Extracted text is ready. Review it, then run the check.
                    </p>
                    <EvidenceChips entities={detected} />
                  </div>
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
                      Review and correct the transcript above, then run the check.
                    </p>
                    <EvidenceChips entities={detected} />
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
            Check this evidence <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
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
