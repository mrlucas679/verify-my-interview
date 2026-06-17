// Evidence storage — Azure Blob (private container, consented files only).
//
// Stores the ORIGINAL evidence file (screenshot / document / audio) for a
// signed-in user who has consented to history, under `{userId}/{fileId}` in a
// private `evidence` container. Downloads are proxied through the API (audited)
// using these helpers — never via public SAS — and every read is scoped to the
// caller's own userId prefix, so one user can never fetch another's evidence.
//
// Conventions (CLAUDE.md): env-gated (rule 2) — unset ⇒ blobEnabled() is false
// and the analyze/upload flow stays ephemeral (OCR in memory → discard), exactly
// as today. Offline evals scrub AZURE_STORAGE_* (rule 3). Auth = managed identity
// (DefaultAzureCredential) when AZURE_STORAGE_ACCOUNT is set, else a connection
// string; no keys in code (rule: security posture). POPIA retention is a Blob
// lifecycle rule on the container (infra), plus erasure via deleteEvidence().

import { randomBytes } from 'crypto';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { logger } from '../observability/logger';

const CONTAINER = 'evidence';
const MAX_BYTES = 25 * 1024 * 1024; // matches the largest upload cap (audio)
const ID_RE = /^[a-f0-9]{1,128}\/[a-f0-9]{32}(?:\.[a-z0-9]{1,8})?$/;

export function blobEnabled(): boolean {
  return Boolean(process.env.AZURE_STORAGE_ACCOUNT || process.env.AZURE_STORAGE_CONNECTION_STRING);
}

let containerPromise: Promise<ContainerClient> | null = null;

function serviceClient(): BlobServiceClient {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (conn) return BlobServiceClient.fromConnectionString(conn);
  const account = process.env.AZURE_STORAGE_ACCOUNT as string;
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
}

async function getContainer(): Promise<ContainerClient> {
  if (!containerPromise) {
    containerPromise = (async () => {
      const container = serviceClient().getContainerClient(CONTAINER);
      // Private by default (no public access argument) — never publicly readable.
      await container.createIfNotExists();
      return container;
    })().catch((error) => {
      containerPromise = null;
      throw error;
    });
  }
  return containerPromise;
}

/**
 * Store an evidence buffer for a user. Returns an evidenceId (`{userId}/{file}`)
 * that doubles as the blob path. The userId prefix is what scopes later reads.
 */
export async function putEvidence(
  userId: string,
  buffer: Buffer,
  contentType: string,
  ext?: string
): Promise<string> {
  if (!blobEnabled()) throw new Error('blob storage is not configured');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('empty evidence buffer');
  if (buffer.length > MAX_BYTES) throw new Error('evidence file too large to store');
  if (!/^[a-f0-9]{1,128}$/.test(userId)) throw new Error('invalid userId');
  const safeExt = ext && /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : '';
  const evidenceId = `${userId}/${randomBytes(16).toString('hex')}${safeExt}`;
  const container = await getContainer();
  await container.getBlockBlobClient(evidenceId).uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType.slice(0, 100) },
  });
  return evidenceId;
}

/**
 * Download an evidence file, but ONLY if it belongs to the requesting user
 * (the id must be under their `{userId}/` prefix). Returns null when missing or
 * not owned — callers map that to 404 (never reveal another user's blob exists).
 */
export async function getEvidence(
  userId: string,
  evidenceId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!blobEnabled()) return null;
  if (!ID_RE.test(evidenceId) || !evidenceId.startsWith(`${userId}/`)) return null;
  try {
    const container = await getContainer();
    const blob = container.getBlockBlobClient(evidenceId);
    if (!(await blob.exists())) return null;
    const buffer = await blob.downloadToBuffer();
    const props = await blob.getProperties();
    return { buffer, contentType: props.contentType || 'application/octet-stream' };
  } catch (error) {
    logger.warn(`[Blob] download failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Delete an evidence file (POPIA erasure). Best-effort; never throws. */
export async function deleteEvidence(evidenceId: string): Promise<void> {
  if (!blobEnabled() || !ID_RE.test(evidenceId)) return;
  try {
    const container = await getContainer();
    await container.getBlockBlobClient(evidenceId).deleteIfExists();
  } catch (error) {
    logger.warn(`[Blob] delete failed: ${error instanceof Error ? error.message : error}`);
  }
}
