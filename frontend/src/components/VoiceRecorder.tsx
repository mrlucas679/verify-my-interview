import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Square, X } from 'lucide-react';
import { transcribeAudio } from '../lib/api';

interface VoiceRecorderProps {
  onTranscript: (text: string, meta: { durationSec: number; locale: string }, file?: File) => void;
  onCancel?: () => void;
}

type RecState = 'starting' | 'recording' | 'transcribing' | 'error';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

const MAX_RECORD_SEC = 5 * 60;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((mime) => {
    try {
      return MediaRecorder.isTypeSupported(mime);
    } catch {
      return false;
    }
  });
}

function extForMime(mime: string | undefined): string {
  if (!mime) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  return 'webm';
}

function fmt(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-8 items-center gap-1" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, index) => (
        <span
          key={index}
          className={`w-1 rounded-full bg-accent/80 ${active ? 'motion-safe:animate-pulse' : ''}`}
          style={{ height: `${8 + ((index * 7) % 22)}px`, animationDelay: `${index * 45}ms` }}
        />
      ))}
    </div>
  );
}

export function VoiceRecorder({ onTranscript, onCancel }: VoiceRecorderProps) {
  const [state, setState] = useState<RecState>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const runTranscription = useCallback(
    async (blob: Blob) => {
      if (blob.size > MAX_UPLOAD_BYTES) {
        setState('error');
        setError('That recording is over 25 MB. Record a shorter clip, or type your story instead.');
        return;
      }
      const controller = new AbortController();
      transcribeAbortRef.current = controller;
      setState('transcribing');
      try {
        const result = await transcribeAudio(blob, `recording.${extForMime(mimeRef.current)}`, {
          signal: controller.signal,
        });
        if (!result.text.trim()) {
          setState('error');
          setError('No speech was recognised. Try again, or type your story instead.');
          return;
        }
        const file = new File([blob], `recording.${extForMime(mimeRef.current)}`, {
          type: blob.type || mimeRef.current || 'audio/webm',
        });
        onTranscript(result.text, {
          durationSec: result.durationSec || elapsedRef.current,
          locale: result.locale,
        }, file);
      } catch (event) {
        if (controller.signal.aborted) return;
        setState('error');
        setError(event instanceof Error ? event.message : 'Transcription failed. Type or paste the message instead.');
      } finally {
        if (transcribeAbortRef.current === controller) transcribeAbortRef.current = null;
      }
    },
    [onTranscript]
  );

  const stopRecording = useCallback(() => {
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    stopTracks();
  }, [stopTimer, stopTracks]);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= MAX_RECORD_SEC) stopRecording();
    }, 1000);
  }, [stopRecording, stopTimer]);

  const startRecording = useCallback(async () => {
    if (typeof MediaRecorder === 'undefined') {
      setState('error');
      setError('Recording is not available in this browser. Use the attachment button to upload a voice note.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (event) {
      const name = event instanceof DOMException ? event.name : '';
      setState('error');
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Allow microphone access in your browser, or use the attachment button to upload a voice note.'
          : 'Could not start recording. Use the attachment button to upload a voice note instead.'
      );
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    elapsedRef.current = 0;
    setElapsed(0);
    mimeRef.current = pickMimeType();

    try {
      recorderRef.current = mimeRef.current
        ? new MediaRecorder(stream, { mimeType: mimeRef.current })
        : new MediaRecorder(stream);
    } catch {
      stopTracks();
      setState('error');
      setError('Recording is not supported in this browser. Use the attachment button to upload a voice note.');
      return;
    }

    recorderRef.current.ondataavailable = (event) => {
      if (event.data?.size) chunksRef.current.push(event.data);
    };
    recorderRef.current.onstop = () => {
      stopTracks();
      if (cancelledRef.current) return;
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
      void runTranscription(blob);
    };

    recorderRef.current.start();
    setState('recording');
    startTimer();
  }, [runTranscription, startTimer, stopTracks]);

  useEffect(() => {
    void startRecording();
    return () => {
      cancelledRef.current = true;
      stopTimer();
      transcribeAbortRef.current?.abort();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
      }
      stopTracks();
    };
  }, [startRecording, stopTimer, stopTracks]);

  return (
    <div className="relative flex items-center justify-between gap-3 rounded-xl border border-line bg-ink-900 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        {state === 'transcribing' || state === 'starting' ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" strokeWidth={1.75} />
        ) : (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-risk-scam" aria-hidden="true" />
        )}
        <Waveform active={state === 'recording'} />
        <span className="font-mono text-sm tabular-nums text-slate-100">{fmt(elapsed)}</span>
        <span className="sr-only" role="status" aria-live="polite">
          {state === 'recording' ? 'Recording' : state === 'transcribing' ? 'Transcribing recording' : 'Starting recorder'}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {state === 'recording' && (
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Stop and transcribe recording"
            className="rounded-full bg-accent p-2 text-white shadow-glow transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Square className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={() => {
              cancelledRef.current = true;
              onCancel();
            }}
            aria-label="Close voice recorder"
            className="rounded-full p-2 text-muted transition hover:bg-ink-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {error && (
        <p className="absolute left-3 right-3 top-full mt-2 rounded-lg border border-risk-needs/40 bg-risk-needs/10 p-2 text-xs text-risk-needs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
