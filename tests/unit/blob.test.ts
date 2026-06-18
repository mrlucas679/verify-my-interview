// Unit tests for evidence storage (src/backend/storage/blob.ts): env-gating, the
// boundary validation in putEvidence, the IDOR-scoped getEvidence, and best-effort
// delete. @azure/storage-blob + @azure/identity are mocked — no account is touched.

jest.mock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.mock('@azure/storage-blob', () => {
  const uploadData = jest.fn().mockResolvedValue(undefined);
  const exists = jest.fn().mockResolvedValue(true);
  const downloadToBuffer = jest.fn().mockResolvedValue(Buffer.from('evidence-bytes'));
  const getProperties = jest.fn().mockResolvedValue({ contentType: 'image/png' });
  const deleteIfExists = jest.fn().mockResolvedValue(undefined);
  const blockBlob = { uploadData, exists, downloadToBuffer, getProperties, deleteIfExists };
  const getBlockBlobClient = jest.fn(() => blockBlob);
  const createIfNotExists = jest.fn().mockResolvedValue(undefined);
  const container = { createIfNotExists, getBlockBlobClient };
  const getContainerClient = jest.fn(() => container);
  const svc = { getContainerClient };
  const BlobServiceClient = jest.fn(() => svc) as unknown as { fromConnectionString: jest.Mock };
  BlobServiceClient.fromConnectionString = jest.fn(() => svc);
  return {
    BlobServiceClient,
    ContainerClient: jest.fn(),
    __mock: { uploadData, exists, downloadToBuffer, getProperties, deleteIfExists, getBlockBlobClient },
  };
});

import * as blobSdk from '@azure/storage-blob';
import { blobEnabled, deleteEvidence, getEvidence, putEvidence } from '../../src/backend/storage/blob';

const mock = (blobSdk as unknown as { __mock: Record<string, jest.Mock> }).__mock;
const GUID = '4f8e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b';

const savedConn = process.env.AZURE_STORAGE_CONNECTION_STRING;
const savedAcct = process.env.AZURE_STORAGE_ACCOUNT;
beforeEach(() => {
  process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=k;EndpointSuffix=core.windows.net';
  delete process.env.AZURE_STORAGE_ACCOUNT;
  jest.clearAllMocks();
});
afterEach(() => {
  if (savedConn === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  else process.env.AZURE_STORAGE_CONNECTION_STRING = savedConn;
  if (savedAcct === undefined) delete process.env.AZURE_STORAGE_ACCOUNT;
  else process.env.AZURE_STORAGE_ACCOUNT = savedAcct;
});

describe('blobEnabled', () => {
  it('is true with a connection string or an account name', () => {
    expect(blobEnabled()).toBe(true);
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    expect(blobEnabled()).toBe(false);
    process.env.AZURE_STORAGE_ACCOUNT = 'vmistore';
    expect(blobEnabled()).toBe(true);
  });
});

describe('putEvidence', () => {
  it('throws when storage is unconfigured', async () => {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    await expect(putEvidence(GUID, Buffer.from('x'), 'image/png', 'png')).rejects.toThrow(/not configured/);
  });

  it('rejects an empty buffer and an invalid userId before any SDK call', async () => {
    await expect(putEvidence(GUID, Buffer.alloc(0), 'image/png', 'png')).rejects.toThrow(/empty/);
    await expect(putEvidence('bad user!', Buffer.from('x'), 'image/png', 'png')).rejects.toThrow(/invalid userId/);
    expect(mock.uploadData).not.toHaveBeenCalled();
  });

  it('rejects an oversized buffer', async () => {
    const tooBig = Buffer.alloc(25 * 1024 * 1024 + 1);
    await expect(putEvidence(GUID, tooBig, 'image/png', 'png')).rejects.toThrow(/too large/);
  });

  it('stores under {userId}/{hex}.{ext} and uploads the bytes', async () => {
    const id = await putEvidence(GUID, Buffer.from('x'), 'image/png', 'png');
    expect(id).toMatch(new RegExp(`^${GUID}/[a-f0-9]{32}\\.png$`));
    expect(mock.uploadData).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed extension (no dotted suffix)', async () => {
    const id = await putEvidence(GUID, Buffer.from('x'), 'image/png', 'NOT AN EXT');
    expect(id).toMatch(new RegExp(`^${GUID}/[a-f0-9]{32}$`));
  });
});

describe('getEvidence (IDOR-scoped)', () => {
  it('returns null for an id the user does not own — without hitting storage', async () => {
    const other = '00000000-0000-0000-0000-000000000000';
    const res = await getEvidence(GUID, `${other}/0123456789abcdef0123456789abcdef.png`);
    expect(res).toBeNull();
    expect(mock.downloadToBuffer).not.toHaveBeenCalled();
  });

  it('downloads the buffer + content-type for an owned, existing blob', async () => {
    const ownId = `${GUID}/0123456789abcdef0123456789abcdef.png`;
    const res = await getEvidence(GUID, ownId);
    expect(res).toEqual({ buffer: Buffer.from('evidence-bytes'), contentType: 'image/png' });
  });

  it('returns null when the owned blob does not exist', async () => {
    mock.exists.mockResolvedValueOnce(false);
    const ownId = `${GUID}/0123456789abcdef0123456789abcdef.png`;
    expect(await getEvidence(GUID, ownId)).toBeNull();
  });
});

describe('deleteEvidence', () => {
  it('no-ops on a malformed id', async () => {
    await deleteEvidence('../../etc/passwd');
    expect(mock.deleteIfExists).not.toHaveBeenCalled();
  });
  it('deletes a well-formed id', async () => {
    await deleteEvidence(`${GUID}/0123456789abcdef0123456789abcdef.png`);
    expect(mock.deleteIfExists).toHaveBeenCalledTimes(1);
  });
});
