// Azure OpenAI embeddings for the scam-intelligence network.

import axios from 'axios';

function base(): string {
  return (process.env.AZURE_OPENAI_ENDPOINT || '')
    .replace(/\/openai\/v1\/?$/, '')
    .replace(/\/+$/, '');
}

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.AZURE_OPENAI_KEY && base());
}

/** Embed a single text into a vector using the Azure OpenAI embedding deployment. */
export async function embed(text: string): Promise<number[]> {
  const deployment = process.env.AZURE_OPENAI_EMBED_DEPLOYMENT || 'text-embedding-3-small';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-01';
  const url = `${base()}/openai/deployments/${deployment}/embeddings?api-version=${apiVersion}`;
  const res = await axios.post(
    url,
    { input: text.slice(0, 8000) },
    {
      headers: { 'api-key': process.env.AZURE_OPENAI_KEY as string, 'Content-Type': 'application/json' },
      timeout: 20000,
    }
  );
  return res.data.data[0].embedding as number[];
}
