import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Pause, Play, Loader2, Upload, RotateCcw, FileAudio } from 'lucide-react';
import { transcribeAudio } from '../lib/api';

interface VoiceRecorderProps {
  onTranscript: (text: string, meta: { durationSec: number; locale: string }) => void;
}

type RecState = 'idle' | 'recording' | 'paused' | 'recorded';

// Probed in priority order; first supported codec wins.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

// Client-side guardrails (server enforces its own 25 MB cap independently).
const MAX_RECORD_SEC = 5 * 60; // 5 minutes
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
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

export function VoiceRecorder({ onTranscript }: VoiceRecorderProps) {
  const recorderSupported = typeof MediaRecorder !== 'undefined';

  const [state, setState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioUrlRef = useRef<string | null>(null); // mirrors audioUrl for unmount revoke
  const fileInput = useRef<HTMLInputElement>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Cleanup on unmount: stop timer, release the mic, revoke the blob URL.
  // Reads refs (not state) so the teardown always sees current values.
  useEffect(() => {
    return () => {
      stopTimer();
      stopTracks();
      const r = mediaRecorderRef.current;
      if (r && r.state !== 'inactive') {
        try {
          r.stop();
        } catch {
          /* recorder already torn down */
        }
      }
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [stopTimer, stopTracks]);

  // Replace the current playback URL, revoking the previous object URL.
  const swapUrl = useCallback((next: string | null) => {
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next;
    });
    audioUrlRef.current = next;
  }, []);

  async function startRecording() {
    setError(null);
    setNotice(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('Allow microphone access in your browser, or upload a voice note instead.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No microphone was found. Upload a voice note, or type your story instead.');
      } else {
        setError(
          e instanceof Error
            ? e.message
            : 'Could not start recording. Upload a voice note instead.'
        );
      }
      return;
    }

    streamRef.current = stream;
    const mime = pickMimeType();
    mimeRef.current = mime;
    chunksRef.current = [];
    swapUrl(null);
    blobRef.current = null;

    let recorder: MediaRecorder;
    try {
      try {
        recorder = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
      } catch {
        recorder = new MediaRecorder(stream);
      }
    } catch {
      // Even the bare constructor failed — release the mic so the browser's
      // recording indicator doesn't stay lit, and offer the upload path.
      stopTracks();
      setError('Recording is not supported in this browser. Upload a voice note instead.');
      return;
    }
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
      blobRef.current = blob;
      swapUrl(URL.createObjectURL(blob));
      stopTracks();
      setState('recorded');
    };

    recorder.start();
    setElapsed(0);
    startTimer();
    setState('recording');
  }

  // One tick per second; auto-stops at the 5-minute cap with a calm notice.
  function startTimer() {
    stopTimer();
    timerRef.current = setInterval(() => {
      setElapsed((e) => {
        const next = e + 1;
        if (next >= MAX_RECORD_SEC) {
          stopRecording();
          setNotice('Recording stopped at the 5-minute limit. Review it, then transcribe.');
          return MAX_RECORD_SEC;
        }
        return next;
      });
    }, 1000);
  }

  function pauseRecording() {
    const r = mediaRecorderRef.current;
    if (r && r.state === 'recording') {
      r.pause();
      stopTimer();
      setState('paused');
    }
  }

  function resumeRecording() {
    const r = mediaRecorderRef.current;
    if (r && r.state === 'paused') {
      r.resume();
      startTimer();
      setState('recording');
    }
  }

  function stopRecording() {
    const r = mediaRecorderRef.current;
    stopTimer();
    if (r && r.state !== 'inactive') {
      r.stop(); // onstop builds the blob + flips state to 'recorded'
    } else {
      stopTracks();
      setState('recorded');
    }
  }

  function reRecord() {
    swapUrl(null);
    blobRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setError(null);
    setNotice(null);
    setState('idle');
  }

  async function runTranscription(blob: Blob, fileName: string, fallbackDuration: number) {
    setError(null);
    setTranscribing(true);
    try {
      const { text, durationSec, locale } = await transcribeAudio(blob, fileName);
      if (!text.trim()) {
        setError('No speech was recognised. Try again, or type your story instead.');
        return;
      }
      onTranscript(text, { durationSec: durationSec || fallbackDuration, locale });
    } catch (e) {
      // api.ts surfaces the server's message verbatim (503/415/422/network).
      setError(
        e instanceof Error ? e.message : 'Transcription failed. Type or paste the message instead.'
      );
    } finally {
      setTranscribing(false);
    }
  }

  function transcribeRecording() {
    const blob = blobRef.current;
    if (!blob) return;
    if (blob.size > MAX_UPLOAD_BYTES) {
      setError('That recording is over 25 MB. Record a shorter clip, or type your story instead.');
      return;
    }
    void runTranscription(blob, `recording.${extForMime(mimeRef.current)}`, elapsed);
  }

  function onUpload(file: File) {
    setNotice(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That file is over 25 MB. Upload a shorter voice note, or type your story instead.');
      return;
    }
    void runTranscription(file, file.name, 0);
  }

  const showRecorderPanel = state === 'idle' || state === 'recording' || state === 'paused';

  return (
    <div>
      <div className="rounded-lg border border-line bg-ink-900 p-4">
        <p className="text-sm text-slate-200">Tell us what happened, in your own words.</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          For the strongest investigation, try to say:
        </p>
        <ul className="mt-1.5 space-y-1 text-xs text-faint">
          <li>— The company or recruiter name, and where they contacted you.</li>
          <li>— The exact email address or phone number they used.</li>
          <li>— What they asked you to do (interview, forms, downloads).</li>
          <li>— Any payment, fees, gift cards, or banking details requested.</li>
          <li>— Any documents or personal information they wanted.</li>
        </ul>
      </div>

      {recorderSupported && (
        <div className="mt-4">
          {/* Recording controls */}
          {showRecorderPanel && (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-line bg-ink-850 py-8">
              {state !== 'idle' && (
                <div className="flex items-center gap-2.5" role="status" aria-live="polite">
                  {state === 'recording' && (
                    <span className="h-2.5 w-2.5 rounded-full bg-risk-scam" aria-hidden="true" />
                  )}
                  <span className="font-mono text-2xl tabular-nums text-slate-100">
                    {fmt(elapsed)}
                  </span>
                  <span className="text-xs text-faint">
                    {state === 'paused' ? 'Paused' : 'Recording'}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3">
                {state === 'idle' && (
                  <button
                    type="button"
                    onClick={() => void startRecording()}
                    aria-label="Start recording your story"
                    className="btn-primary"
                  >
                    <Mic className="h-4 w-4" strokeWidth={1.75} /> Record your story
                  </button>
                )}

                {state === 'recording' && (
                  <button
                    type="button"
                    onClick={pauseRecording}
                    aria-label="Pause recording"
                    className="btn-ghost"
                  >
                    <Pause className="h-4 w-4" strokeWidth={1.75} /> Pause
                  </button>
                )}

                {state === 'paused' && (
                  <button
                    type="button"
                    onClick={resumeRecording}
                    aria-label="Resume recording"
                    className="btn-ghost"
                  >
                    <Play className="h-4 w-4" strokeWidth={1.75} /> Resume
                  </button>
                )}

                {(state === 'recording' || state === 'paused') && (
                  <button
                    type="button"
                    onClick={stopRecording}
                    aria-label="Stop recording"
                    className="btn-primary"
                  >
                    <Square className="h-4 w-4" strokeWidth={1.75} /> Stop
                  </button>
                )}
              </div>

              {state === 'idle' && (
                <p className="text-xs text-faint">Up to 5 minutes. Nothing is sent until you transcribe.</p>
              )}
            </div>
          )}

          {/* Playback + transcribe */}
          {state === 'recorded' && (
            <div className="flex flex-col gap-4 rounded-lg border border-line bg-ink-850 p-4">
              <div className="flex items-center gap-2 text-xs text-muted">
                <FileAudio className="h-4 w-4" strokeWidth={1.75} />
                Recorded {fmt(elapsed)} — review it, then transcribe.
              </div>
              {audioUrl && (
                <audio controls src={audioUrl} className="w-full">
                  Your browser does not support audio playback.
                </audio>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={reRecord}
                  disabled={transcribing}
                  aria-label="Discard and re-record your story"
                  className="btn-ghost"
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={1.75} /> Re-record
                </button>
                <button
                  type="button"
                  onClick={transcribeRecording}
                  disabled={transcribing}
                  aria-label="Transcribe recording"
                  className="btn-primary"
                >
                  {transcribing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> Transcribing…
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4" strokeWidth={1.75} /> Transcribe recording
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload a voice note (always available — covers WhatsApp notes + no-mic browsers) */}
      <div className="mt-4 flex flex-col items-center gap-2 text-center">
        {recorderSupported && <span className="text-xs text-faint">or upload a voice note</span>}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={transcribing}
          aria-label="Upload a voice note"
          className="btn-ghost"
        >
          {transcribing && !recorderSupported ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <Upload className="h-4 w-4" strokeWidth={1.75} />
          )}
          Upload a voice note
        </button>
        {!recorderSupported && (
          <p className="text-xs text-faint">
            Recording isn&#39;t available in this browser — upload an audio file instead.
          </p>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.amr"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = '';
          }}
        />
      </div>

      {transcribing && (
        <p className="sr-only" role="status" aria-live="assertive">
          Transcribing your audio. This can take a few seconds.
        </p>
      )}

      {notice && !error && (
        <p className="mt-4 rounded-lg border border-line bg-ink-800 p-3 text-xs text-muted" role="status">
          {notice}
        </p>
      )}

      {error && (
        <p
          className="mt-4 rounded-lg border border-risk-needs/40 bg-risk-needs/10 p-3 text-xs text-risk-needs"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
