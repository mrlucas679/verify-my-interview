import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Upload, Link2, ArrowRight, FileText, Loader2 } from 'lucide-react';
import { SAMPLES } from '../lib/samples';
import { useCase } from '../store/caseStore';
import { uploadDocument } from '../lib/api';

type Tab = 'email' | 'upload' | 'link';

const TABS: { id: Tab; label: string; icon: typeof Mail }[] = [
  { id: 'email', label: 'Paste email', icon: Mail },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'link', label: 'Link', icon: Link2 },
];

export function NewCase() {
  const [tab, setTab] = useState<Tab>('email');
  const [email, setEmail] = useState('');
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { runAnalysis } = useCase();
  const navigate = useNavigate();

  function buildEvidence(): string {
    if (tab === 'email') return email.trim();
    if (tab === 'link') return url.trim() ? `Suspicious recruiter link: ${url.trim()}` : '';
    return email.trim(); // upload writes extracted text into `email`
  }

  function submit() {
    const evidence = buildEvidence();
    if (!evidence) return;
    void runAnalysis(evidence);
    navigate('/report');
  }

  async function onFile(file: File) {
    setFileName(file.name);
    setFileNote(null);
    const isText = file.type.startsWith('text') || /\.(eml|txt|md)$/i.test(file.name);
    if (isText) {
      const text = await file.text();
      setEmail(text);
      setFileNote(`Loaded ${file.name} — text ready to investigate.`);
      return;
    }
    // PDF / image → Azure Document Intelligence OCR on the server
    setUploading(true);
    try {
      const { text, pages } = await uploadDocument(file);
      setEmail(text);
      setFileNote(
        text.trim()
          ? `Extracted ${text.length} characters from ${file.name} (${pages} page${pages === 1 ? '' : 's'}) via Document Intelligence.`
          : `No text could be extracted from ${file.name}.`
      );
    } catch (e) {
      setFileNote(e instanceof Error ? e.message : 'Could not process this file.');
    } finally {
      setUploading(false);
    }
  }

  const canSubmit = buildEvidence().length > 0 && !uploading;

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <span className="eyebrow">New case</span>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white">
        Submit evidence
      </h1>
      <p className="mt-2 text-sm text-muted">
        Give the detective whatever you have — a recruiter email, a document, or a link.
      </p>

      <div className="mt-7 inline-flex rounded-xl border border-line bg-ink-850 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition ${
                active ? 'bg-ink-700 text-white' : 'text-muted hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5 surface p-5">
        {tab === 'email' && (
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setEmail(s.text)}
                  className="rounded-full border border-line bg-ink-800 px-3 py-1.5 text-xs text-muted transition hover:border-accent/60 hover:text-white"
                >
                  {s.label}
                </button>
              ))}
            </div>
            <textarea
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
              }}
              rows={11}
              placeholder="Paste the full email — headers and body. Include the sender address and any links."
              className="w-full resize-y rounded-lg border border-line bg-ink-900 p-3.5 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
        )}

        {tab === 'upload' && (
          <div>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-ink-900 py-12 text-center transition hover:border-accent/60 disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-7 w-7 animate-spin text-accent" />
              ) : (
                <FileText className="h-7 w-7 text-faint" />
              )}
              <span className="text-sm text-slate-200">
                {uploading ? 'Reading document…' : fileName ?? 'Click to choose a file'}
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
              }}
            />
            {fileNote && <p className="mt-3 text-xs text-muted">{fileNote}</p>}
            {email && tab === 'upload' && (
              <p className="mt-2 text-xs text-faint">Extracted text is ready — investigate below.</p>
            )}
          </div>
        )}

        {tab === 'link' && (
          <div>
            <label className="text-xs text-faint">Recruiter or careers-portal URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="https://careers-portal-example.net/apply"
              className="mt-1.5 w-full rounded-lg border border-line bg-ink-900 p-3 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
        )}

        <button onClick={submit} disabled={!canSubmit} className="btn-primary mt-5 w-full">
          Open the investigation <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
