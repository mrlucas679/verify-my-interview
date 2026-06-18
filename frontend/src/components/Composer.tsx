import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowUp,
  AtSign,
  Banknote,
  CheckCircle2,
  FileAudio,
  FileText,
  Flag,
  Image,
  Link2,
  Loader2,
  Mail,
  Mic,
  Paperclip,
  Phone,
  ShieldQuestion,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { transcribeAudio, uploadDocument } from '../lib/api';
import {
  detectEntities,
  extractReportIOCs,
  inferCompanyName,
  looksLikeVictimReport,
  type DetectedEntity,
} from '../lib/evidenceScan';
import { VoiceRecorder } from './VoiceRecorder';

type Intent = 'verify' | 'report';
type AttachmentKind = 'audio' | 'document' | 'email' | 'image' | 'text';
type AttachmentStatus = 'reading' | 'done' | 'error';

const MAX_ATTACHMENTS = 8;
const MAX_TEXT_UPLOAD_BYTES = 256 * 1024;
const MAX_EVIDENCE_CHARS = 40_000;

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
  reporting?: boolean;
  docked?: boolean;
}

interface EvidenceAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  detail: string;
  text: string;
  error: string | null;
}

const CHIP_ICON: Record<DetectedEntity['kind'], LucideIcon> = {
  email: AtSign,
  link: Link2,
  phone: Phone,
  amount: Banknote,
};

const ATTACHMENT_ICON: Record<AttachmentKind, LucideIcon> = {
  audio: FileAudio,
  document: FileText,
  email: Mail,
  image: Image,
  text: FileText,
};

function newId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileKind(file: File): AttachmentKind {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('audio/') || /\.(amr|m4a|mp3|ogg|wav|webm)$/i.test(name)) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  if (/\.(eml|msg)$/i.test(name)) return 'email';
  if (file.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(name)) return 'text';
  return 'document';
}

function attachmentLabel(kind: AttachmentKind): string {
  if (kind === 'audio') return 'Audio';
  if (kind === 'email') return 'Email';
  if (kind === 'image') return 'Image';
  if (kind === 'text') return 'Text';
  return 'Document';
}

function compactBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function doneText(attachment: EvidenceAttachment): string {
  const text = attachment.text.trim();
  if (!text) return '';
  return `Attachment: ${attachment.name}\nType: ${attachmentLabel(attachment.kind)}\n\n${text}`;
}

function buildEvidence(text: string, attachments: EvidenceAttachment[]): string {
  const sections: string[] = [];
  const trimmed = text.trim();
  if (trimmed) sections.push(`User message\n\n${trimmed}`);

  for (const attachment of attachments.slice(0, MAX_ATTACHMENTS)) {
    if (attachment.status !== 'done') continue;
    const section = doneText(attachment);
    if (section) sections.push(section);
  }

  return sections.join('\n\n---\n\n').slice(0, MAX_EVIDENCE_CHARS);
}

function EvidenceChips({ entities }: { entities: DetectedEntity[] }) {
  const reduceMotion = useReducedMotion();
  if (entities.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-live="polite">
      {entities.map((entity, index) => {
        const Icon = CHIP_ICON[entity.kind];
        return (
          <motion.span
            key={`${entity.kind}-${entity.value}`}
            {...(reduceMotion
              ? {}
              : {
                  initial: { opacity: 0, scale: 0.96 },
                  animate: { opacity: 1, scale: 1 },
                  transition: { duration: 0.16, ease: 'easeOut' as const, delay: index * 0.03 },
                })}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-accent/30 bg-ink-900 px-2 py-1 font-mono text-[11px] text-slate-300"
          >
            <Icon className="h-3 w-3 shrink-0 text-accent" strokeWidth={1.75} />
            <span className="truncate" style={{ maxWidth: '14rem' }}>
              {entity.value}
            </span>
          </motion.span>
        );
      })}
    </div>
  );
}

function AttachmentPill({
  attachment,
  onRemove,
}: {
  attachment: EvidenceAttachment;
  onRemove: (id: string) => void;
}) {
  const Icon = ATTACHMENT_ICON[attachment.kind];
  const status =
    attachment.status === 'reading'
      ? 'Reading evidence'
      : attachment.status === 'error'
        ? attachment.error ?? 'Could not read'
        : attachment.detail;

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-ink-800 px-2.5 py-2">
      {attachment.status === 'reading' ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" strokeWidth={1.75} />
      ) : attachment.status === 'error' ? (
        <AlertTriangle className="h-4 w-4 shrink-0 text-risk-needs" strokeWidth={1.75} />
      ) : (
        <Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px] text-slate-200">{attachment.name}</p>
        <p className="truncate text-[11px] text-faint">{status}</p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        aria-label={`Remove ${attachment.name}`}
        className="rounded-md p-1 text-faint transition hover:bg-ink-700 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function Composer({ onVerify, onReport, reporting = false, docked = false }: ComposerProps) {
  const [intent, setIntent] = useState<Intent>('verify');
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<EvidenceAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const aborters = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    return () => {
      for (const controller of aborters.current.values()) controller.abort();
      aborters.current.clear();
    };
  }, []);

  const evidence = useMemo(() => buildEvidence(text, attachments), [text, attachments]);
  const detected = useMemo(() => detectEntities(evidence), [evidence]);
  const processing = useMemo(() => attachments.some((a) => a.status === 'reading'), [attachments]);
  const suggestReport = useMemo(
    () => intent === 'verify' && looksLikeVictimReport(evidence),
    [evidence, intent]
  );
  const hasEvidence = evidence.trim().length > 0;
  const canSubmit = hasEvidence && !processing && !reporting;
  const evidenceAtLimit = hasEvidence && evidence.length >= MAX_EVIDENCE_CHARS;

  function patchAttachment(id: string, patch: Partial<EvidenceAttachment>) {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function removeAttachment(id: string) {
    aborters.current.get(id)?.abort();
    aborters.current.delete(id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function clearAll() {
    for (const controller of aborters.current.values()) controller.abort();
    aborters.current.clear();
    setText('');
    setAttachments([]);
    setNotice(null);
    setRecorderOpen(false);
  }

  async function processTextFile(id: string, file: File) {
    if (file.size > MAX_TEXT_UPLOAD_BYTES) {
      patchAttachment(id, {
        status: 'error',
        error: 'Text file is too large. Paste the relevant excerpt instead.',
        detail: compactBytes(file.size),
      });
      return;
    }
    const loaded = await file.text();
    patchAttachment(id, {
      status: 'done',
      text: loaded,
      detail: `${loaded.trim().length} chars extracted`,
      error: null,
    });
  }

  async function processRemoteFile(id: string, file: File, kind: AttachmentKind, signal: AbortSignal) {
    if (kind === 'audio') {
      const { text: transcript, durationSec, locale } = await transcribeAudio(file, file.name, { signal });
      patchAttachment(id, {
        status: 'done',
        text: transcript,
        detail: `Transcribed ${durationSec}s (${locale})`,
        error: null,
      });
      return;
    }

    const { text: extracted, pages } = await uploadDocument(file, { signal });
    patchAttachment(id, {
      status: 'done',
      text: extracted,
      detail: extracted.trim()
        ? `${extracted.length} chars from ${pages} page${pages === 1 ? '' : 's'}`
        : 'No readable text found',
      error: extracted.trim() ? null : 'No readable text found',
    });
  }

  async function processFile(file: File) {
    const id = newId('a');
    const kind = fileKind(file);
    setAttachments((prev) => [
      ...prev,
      {
        id,
        name: file.name || `${attachmentLabel(kind).toLowerCase()}-${prev.length + 1}`,
        kind,
        status: 'reading',
        detail: compactBytes(file.size),
        text: '',
        error: null,
      },
    ]);

    const controller = new AbortController();
    aborters.current.set(id, controller);
    try {
      if (kind === 'text' || kind === 'email') {
        await processTextFile(id, file);
      } else {
        await processRemoteFile(id, file, kind, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      patchAttachment(id, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not read this file.',
      });
    } finally {
      aborters.current.delete(id);
    }
  }

  async function processFiles(files: FileList | File[]) {
    const remaining = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (remaining === 0) {
      setNotice(`This packet can hold up to ${MAX_ATTACHMENTS} attachments. Remove one to add another.`);
      return;
    }

    const selected: File[] = [];
    for (let index = 0; index < files.length && selected.length < remaining; index += 1) {
      const file = files[index];
      if (file) selected.push(file);
    }
    if (files.length > selected.length) {
      setNotice(`Added ${selected.length} files. The packet limit is ${MAX_ATTACHMENTS} attachments.`);
    } else {
      setNotice(null);
    }

    for (const file of selected) {
      await processFile(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void processFiles(event.dataTransfer.files);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData.items;
    const files: File[] = [];
    for (let index = 0; index < items.length && files.length < MAX_ATTACHMENTS; index += 1) {
      const item = items[index];
      if (item?.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length > 0) void processFiles(files);
  }

  function addRecordingTranscript(value: string, meta: { durationSec: number; locale: string }) {
    const id = newId('voice');
    setAttachments((prev) =>
      [
        ...prev,
        {
          id,
          name: `recording-${prev.length + 1}.txt`,
          kind: 'audio' as const,
          status: 'done' as const,
          detail: `Recorded ${meta.durationSec}s (${meta.locale})`,
          text: value,
          error: null,
        },
      ].slice(0, MAX_ATTACHMENTS)
    );
    setRecorderOpen(false);
  }

  function submit() {
    if (!canSubmit) return;
    if (intent === 'report') {
      const iocs = extractReportIOCs(evidence);
      onReport({
        company: inferCompanyName(evidence),
        location: 'Unknown',
        evidence,
        ...iocs,
      });
    } else {
      onVerify(evidence);
    }
    clearAll();
  }

  function submitLabel(): string {
    if (processing) return 'Reading evidence';
    if (intent === 'report') return reporting ? 'Filing report' : 'File report';
    return 'Check evidence';
  }

  return (
    <section
      aria-label={intent === 'verify' ? 'Submit evidence to check' : 'Submit evidence as a scam report'}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`surface relative overflow-hidden p-3 transition sm:p-4 ${
        dragging ? 'border-accent/70 ring-2 ring-accent/30' : ''
      }`}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-ink-900/90">
          <div className="rounded-xl border border-accent/50 bg-ink-850 px-4 py-3 text-sm text-slate-100">
            Drop evidence into this packet
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-1 rounded-lg border border-line bg-ink-900 p-1">
          {([
            { id: 'verify' as const, label: 'Check', icon: ShieldQuestion },
            { id: 'report' as const, label: 'Report', icon: Flag },
          ]).map((option) => {
            const Icon = option.icon;
            const active = intent === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setIntent(option.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  active ? 'bg-ink-700 text-slate-100' : 'text-muted hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="font-mono text-[11px] text-faint">
          {evidence.length.toLocaleString()}/{MAX_EVIDENCE_CHARS.toLocaleString()} chars
        </p>
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={handlePaste}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submit();
        }}
        rows={docked ? 3 : 6}
        aria-label="Paste messages, links, emails, or the full story"
        placeholder="Paste the job offer, recruiter chat, email, website, WhatsApp message, or describe the whole situation..."
        className="max-h-[42vh] min-h-[96px] w-full resize-y rounded-xl border border-line bg-ink-900 p-3.5 text-sm leading-relaxed text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      />

      {(attachments.length > 0 || detected.length > 0 || notice || evidenceAtLimit) && (
        <div className="mt-3 space-y-2.5">
          {attachments.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {attachments.slice(0, MAX_ATTACHMENTS).map((attachment) => (
                <AttachmentPill key={attachment.id} attachment={attachment} onRemove={removeAttachment} />
              ))}
            </div>
          )}
          <EvidenceChips entities={detected} />
          {notice && (
            <p className="rounded-lg border border-line bg-ink-800 px-3 py-2 text-xs text-muted" role="status">
              {notice}
            </p>
          )}
          {evidenceAtLimit && (
            <p className="rounded-lg border border-risk-needs/40 bg-risk-needs/10 px-3 py-2 text-xs text-risk-needs">
              This packet is at the safe analysis limit. Only the first relevant 40,000 characters will be sent.
            </p>
          )}
        </div>
      )}

      {suggestReport && (
        <button
          type="button"
          onClick={() => setIntent('report')}
          className="mt-3 flex w-full items-start gap-2 rounded-lg border border-risk-needs/40 bg-risk-needs/10 px-3 py-2 text-left text-xs text-risk-needs transition hover:border-risk-needs/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span>This reads like something that may have happened already. File it as a report to protect others.</span>
        </button>
      )}

      <AnimatePresence initial={false}>
        {recorderOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="mt-3 rounded-xl border border-line bg-ink-900 p-3"
          >
            <VoiceRecorder onTranscript={addRecordingTranscript} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title="Attach files"
            aria-label="Attach files"
            className="rounded-lg border border-line bg-ink-800 p-2 text-muted transition hover:border-accent/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setRecorderOpen((open) => !open)}
            title={recorderOpen ? 'Close recorder' : 'Record voice'}
            aria-label={recorderOpen ? 'Close recorder' : 'Record voice'}
            className={`rounded-lg border p-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              recorderOpen
                ? 'border-accent/60 bg-accent-soft text-accent'
                : 'border-line bg-ink-800 text-muted hover:border-accent/60 hover:text-slate-100'
            }`}
          >
            <Mic className="h-4 w-4" strokeWidth={1.75} />
          </button>
          {(text || attachments.length > 0) && (
            <button
              type="button"
              onClick={clearAll}
              title="Clear packet"
              aria-label="Clear packet"
              className="rounded-lg border border-line bg-ink-800 p-2 text-muted transition hover:border-risk-needs/60 hover:text-risk-needs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".eml,.msg,.txt,.md,.csv,.pdf,image/*,audio/*,.amr"
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void processFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="btn-primary min-w-[9.5rem] px-3"
        >
          {processing || reporting ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : intent === 'report' ? (
            <Flag className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <ArrowUp className="h-4 w-4" strokeWidth={1.75} />
          )}
          {submitLabel()}
        </button>
      </div>

      {intent === 'report' && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-ink-900 px-3 py-2 text-xs text-muted">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-risk-low" strokeWidth={1.75} />
          <span>
            Reports save the evidence and give you a reference ID. You will not get a verdict unless you also ask us to
            check it.
          </span>
        </div>
      )}
    </section>
  );
}
