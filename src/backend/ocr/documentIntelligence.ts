// OCR for uploaded evidence via Azure AI Document Intelligence (prebuilt-read).
// Extracts text from PDFs and screenshots so the pipeline can investigate them.

import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';

export function ocrEnabled(): boolean {
  return Boolean(process.env.AZURE_DOCINT_ENDPOINT && process.env.AZURE_DOCINT_KEY);
}

export async function extractText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const client = new DocumentAnalysisClient(
    process.env.AZURE_DOCINT_ENDPOINT as string,
    new AzureKeyCredential(process.env.AZURE_DOCINT_KEY as string)
  );
  const poller = await client.beginAnalyzeDocument('prebuilt-read', buffer);
  const result = await poller.pollUntilDone();
  return { text: result?.content ?? '', pages: result?.pages?.length ?? 0 };
}
