// Speech-to-text for the Voice Investigation feature ("Tell Us What Happened").
//
// Transcribes a user's spoken account of a suspected job scam via Azure AI
// Speech (Fast Transcription REST API), so victims who have no email/screenshot
// can still report in their own words. The transcript then flows into the SAME
// deterministic investigation pipeline as typed/uploaded evidence.
//
// Degrades gracefully: `speechEnabled()` is false without credentials, and the
// endpoint returns 503 rather than failing — the rest of the app is unaffected.

import axios from 'axios';

export function speechEnabled(): boolean {
  return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

/** Transcription failure carrying the HTTP status the CLIENT should receive. */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly clientStatus: number
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

export interface Transcription {
  text: string;
  durationSec: number;
  locale: string;
}

/**
 * Transcribe an audio buffer with Azure Speech Fast Transcription. Candidate
 * locales bias the recognizer toward South African + global English; Azure
 * auto-selects the best match. Throws on transport/credential errors so the
 * caller can return a clean 5xx — never returns partial/garbage text silently.
 */
export async function transcribeAudio(
  buffer: Buffer,
  contentType: string,
  fileName = 'audio'
): Promise<Transcription> {
  const region = process.env.AZURE_SPEECH_REGION as string;
  const key = process.env.AZURE_SPEECH_KEY as string;
  const url = `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;

  const locales = (process.env.AZURE_SPEECH_LOCALES || 'en-ZA,en-US,en-GB')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // multipart/form-data: the audio part + a JSON "definition" part.
  const boundary = `----vmiAudioBoundary${Date.now()}`;
  const enc = (s: string) => Buffer.from(s, 'utf8');
  const definition = JSON.stringify({ locales, profanityFilterMode: 'None' });
  const body = Buffer.concat([
    enc(`--${boundary}\r\n`),
    enc(`Content-Disposition: form-data; name="audio"; filename="${fileName}"\r\n`),
    enc(`Content-Type: ${contentType || 'application/octet-stream'}\r\n\r\n`),
    buffer,
    enc(`\r\n--${boundary}\r\n`),
    enc('Content-Disposition: form-data; name="definition"\r\n'),
    enc('Content-Type: application/json\r\n\r\n'),
    enc(definition),
    enc(`\r\n--${boundary}--\r\n`),
  ]);

  let res;
  try {
    res = await axios.post(url, body, {
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  } catch (e) {
    // Map the provider failure to an actionable client status. Log status +
    // Azure error code only — never audio content (POPIA content-free logs).
    if (axios.isAxiosError(e) && e.response) {
      const status = e.response.status;
      const code = (e.response.data as { error?: { code?: string } } | undefined)?.error?.code;
      console.error(`[speech] Azure transcription failed: HTTP ${status}${code ? ` (${code})` : ''}`);
      if (status === 400) {
        throw new TranscriptionError(
          'The transcription service could not decode this audio. Re-record in the browser, or upload a WAV, MP3, or M4A file.',
          415
        );
      }
      if (status === 401 || status === 403) {
        throw new TranscriptionError(
          'Voice transcription is not configured correctly on this server.',
          503
        );
      }
      if (status === 429) {
        throw new TranscriptionError(
          'The transcription service is busy — try again in a minute.',
          503
        );
      }
    }
    console.error('[speech] Azure transcription transport error');
    throw new TranscriptionError('Transcription failed — try again.', 500);
  }

  const data = res.data || {};
  // Prefer the combined phrases; fall back to concatenating per-phrase text.
  const combined: string =
    data.combinedPhrases?.map((p: any) => p.text).join(' ').trim() ||
    (data.phrases || []).map((p: any) => p.text).join(' ').trim() ||
    '';
  const durationMs: number = typeof data.durationMilliseconds === 'number' ? data.durationMilliseconds : 0;

  return {
    text: combined,
    durationSec: Math.round(durationMs / 1000),
    locale: data.phrases?.[0]?.locale || locales[0] || 'en-ZA',
  };
}
