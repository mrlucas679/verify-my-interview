// OCR for uploaded evidence via Azure AI Document Intelligence (prebuilt-read).
// Extracts text from PDFs and screenshots so the pipeline can investigate them.

import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';

let client: DocumentAnalysisClient | null = null;

export function ocrEnabled(): boolean {
  return Boolean(process.env.AZURE_DOCINT_ENDPOINT && process.env.AZURE_DOCINT_KEY);
}

function ocrTimeoutMs(): number {
  const configured = Number(process.env.VMI_OCR_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return 60_000;
  return Math.max(5_000, Math.min(120_000, configured));
}

function getClient(): DocumentAnalysisClient {
  if (!ocrEnabled()) throw new Error('Document Intelligence is not configured');
  if (!client) {
    client = new DocumentAnalysisClient(
      process.env.AZURE_DOCINT_ENDPOINT as string,
      new AzureKeyCredential(process.env.AZURE_DOCINT_KEY as string)
    );
  }
  return client;
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`OCR exceeded ${ms}ms`)), ms);
  timer.unref?.();
  return controller.signal;
}

export async function extractText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const signal = timeoutSignal(ocrTimeoutMs());
  const poller = await getClient().beginAnalyzeDocument('prebuilt-read', buffer, {
    abortSignal: signal,
  });
  const result = await poller.pollUntilDone({ abortSignal: signal });
  return { text: result?.content ?? '', pages: result?.pages?.length ?? 0 };
}
