// Unit tests for the Cosmos (MongoDB API) data-access layer
// (src/backend/data/cosmos.ts). The mongodb driver is mocked so we test the
// LOGIC — boundary validation, id generation, query/update shaping, result
// mapping, the anon-trial threshold, and the erasure cascade — not a live DB.

jest.mock('mongodb', () => {
  const coll = {
    createIndex: jest.fn().mockResolvedValue(undefined),
    insertOne: jest.fn().mockResolvedValue({}),
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    find: jest.fn(),
  };
  const db = { collection: jest.fn(() => coll) };
  const client = { connect: jest.fn().mockResolvedValue(undefined), db: jest.fn(() => db) };
  return { MongoClient: jest.fn(() => client), __mock: { coll } };
});

import * as mongodb from 'mongodb';
import {
  consumeAnonTrial,
  cosmosEnabled,
  deletePendingReport,
  deleteReport,
  deleteUserData,
  getCase,
  getGraphRevision,
  getPendingReport,
  getSharedReport,
  getUsage,
  listPendingReports,
  listReports,
  recordUsage,
  rollbackAnonTrial,
  savePendingReport,
  saveReport,
  saveSharedReport,
  touchGraphRevision,
  upsertUser,
} from '../../src/backend/data/cosmos';
import type { NetworkReport } from '../../src/backend/network/types';

const coll = (mongodb as unknown as { __mock: { coll: Record<string, jest.Mock> } }).__mock.coll;
const PERIOD_RE = /^\d{4}-\d{2}$/;
const HEX24 = /^[a-f0-9]{24}$/;

let findResult: unknown[];

beforeAll(() => {
  process.env.COSMOS_CONNECTION_STRING = 'mongodb://localhost:10255/?ssl=true';
});

beforeEach(() => {
  findResult = [];
  const chain: Record<string, jest.Mock> = {};
  chain.sort = jest.fn(() => chain as never);
  chain.limit = jest.fn(() => chain as never);
  chain.toArray = jest.fn(() => Promise.resolve(findResult));
  coll.find.mockReturnValue(chain);
  coll.findOne.mockReset();
  coll.findOneAndUpdate.mockReset();
  coll.insertOne.mockReset().mockResolvedValue({});
  coll.updateOne.mockReset().mockResolvedValue({});
  coll.deleteOne.mockReset().mockResolvedValue({ deletedCount: 1 });
  coll.deleteMany.mockReset().mockResolvedValue({ deletedCount: 0 });
});

describe('cosmosEnabled', () => {
  it('reflects the connection string', () => {
    const saved = process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_CONNECTION_STRING;
    expect(cosmosEnabled()).toBe(false);
    process.env.COSMOS_CONNECTION_STRING = saved;
    expect(cosmosEnabled()).toBe(true);
  });
});

describe('saveSharedReport', () => {
  it('rejects a null result before touching the DB', async () => {
    await expect(saveSharedReport(null)).rejects.toThrow(/required/);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('rejects a result that exceeds the size cap', async () => {
    await expect(saveSharedReport({ blob: 'x'.repeat(300_000) })).rejects.toThrow(/too large/);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('generates a 24-hex id and inserts the result', async () => {
    const out = await saveSharedReport({ ok: true });
    expect(out.id).toMatch(HEX24);
    expect(typeof out.expiresInDays).toBe('number');
    expect(coll.insertOne).toHaveBeenCalledTimes(1);
    expect(coll.insertOne.mock.calls[0][0]._id).toBe(out.id);
  });
});

describe('getSharedReport', () => {
  it('returns null for a malformed id without querying', async () => {
    expect(await getSharedReport('not-a-valid-id')).toBeNull();
    expect(coll.findOne).not.toHaveBeenCalled();
  });

  it('returns the stored result for a valid id', async () => {
    coll.findOne.mockResolvedValue({ result: { verdict: 'Likely Scam' } });
    expect(await getSharedReport('0123456789abcdef01234567')).toEqual({ verdict: 'Likely Scam' });
  });
});

describe('getCase', () => {
  it('returns null for a malformed caseId without querying', async () => {
    expect(await getCase('user-1', 'has spaces!')).toBeNull();
    expect(coll.findOne).not.toHaveBeenCalled();
  });

  it('looks up by id scoped to the owning userId', async () => {
    coll.findOne.mockResolvedValue({ _id: 'c1', userId: 'user-1' });
    await getCase('user-1', 'c1');
    expect(coll.findOne).toHaveBeenCalledWith({ _id: 'c1', userId: 'user-1' });
  });
});

describe('reports corpus', () => {
  it('upserts a report by reportId (idempotent system of record)', async () => {
    const report = { reportId: 'R-123', companyName: 'Acme' } as unknown as NetworkReport;
    await saveReport(report);
    expect(coll.updateOne).toHaveBeenCalledWith(
      { _id: 'R-123' },
      { $set: report },
      { upsert: true }
    );
  });

  it('deleteReport reports whether a document was removed', async () => {
    coll.deleteOne.mockResolvedValue({ deletedCount: 1 });
    expect(await deleteReport('R-1')).toBe(true);
    coll.deleteOne.mockResolvedValue({ deletedCount: 0 });
    expect(await deleteReport('R-missing')).toBe(false);
  });

  it('listReports returns the bounded result set', async () => {
    findResult = [{ reportId: 'R-1' }, { reportId: 'R-2' }];
    expect(await listReports()).toHaveLength(2);
  });

  it('stores public reports in a pending moderation queue', async () => {
    const report = { reportId: 'R-pending', companyName: 'Acme' } as unknown as NetworkReport;
    await savePendingReport(report);
    expect(coll.updateOne).toHaveBeenCalledWith(
      { _id: 'R-pending' },
      {
        $set: {
          ...report,
          status: 'pending_review',
        },
        $setOnInsert: expect.objectContaining({ _id: 'R-pending' }),
      },
      { upsert: true }
    );
  });

  it('lists, fetches, and deletes pending reports', async () => {
    findResult = [{ reportId: 'R-pending', status: 'pending_review' }];
    await expect(listPendingReports()).resolves.toHaveLength(1);

    coll.findOne.mockResolvedValue({ reportId: 'R-pending' });
    await expect(getPendingReport('R-pending')).resolves.toEqual({ reportId: 'R-pending' });

    coll.deleteOne.mockResolvedValue({ deletedCount: 1 });
    await expect(deletePendingReport('R-pending')).resolves.toBe(true);
    expect(coll.deleteOne).toHaveBeenCalledWith({ _id: 'R-pending' });
  });
});

describe('upsertUser', () => {
  it('seeds the free plan + default consent on insert and returns the doc', async () => {
    coll.findOne.mockResolvedValue({ _id: 'u-1', plan: 'free', consent: { store_evidence: false, at: 't' } });
    const doc = await upsertUser({ id: 'u-1', email: 'a@b.com' }, { store_evidence: true });
    expect(doc._id).toBe('u-1');
    const [, update, opts] = coll.updateOne.mock.calls[0];
    expect(opts).toEqual({ upsert: true });
    expect(update.$setOnInsert.plan).toBe('free');
    expect(update.$set.consent.store_evidence).toBe(true);
  });
});

describe('usage metering', () => {
  it('records and returns the incremented count for the current period', async () => {
    coll.findOneAndUpdate.mockResolvedValue({ count: 7 });
    const usage = await recordUsage('u-1');
    expect(usage.count).toBe(7);
    expect(usage.period).toMatch(PERIOD_RE);
    expect(coll.findOneAndUpdate.mock.calls[0][0]._id).toBe(`u-1:${usage.period}`);
  });

  it('getUsage returns 0 when no record exists', async () => {
    coll.findOne.mockResolvedValue(null);
    expect((await getUsage('u-1')).count).toBe(0);
  });
});

describe('consumeAnonTrial (threshold)', () => {
  it('allows while at/under the max and blocks once exceeded', async () => {
    coll.findOneAndUpdate.mockResolvedValue({ count: 1 });
    expect(await consumeAnonTrial('ip-hash', 1)).toBe(true);
    coll.findOneAndUpdate.mockResolvedValue({ count: 2 });
    expect(await consumeAnonTrial('ip-hash', 1)).toBe(false);
  });

  it('rolls back a reserved anonymous trial', async () => {
    await rollbackAnonTrial('ip-hash');
    expect(coll.updateOne).toHaveBeenCalledWith(
      { _id: 'ip-hash', count: { $gt: 0 } },
      { $inc: { count: -1 } }
    );
  });
});

describe('graph revision marker', () => {
  it('increments the graph revision after corpus mutations', async () => {
    coll.findOneAndUpdate.mockResolvedValue({ rev: 4 });
    await expect(touchGraphRevision('report.created')).resolves.toBe(4);
    expect(coll.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: 'entity_graph' });
    expect(coll.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({ rev: 1 });
  });

  it('returns 0 before a graph revision exists', async () => {
    coll.findOne.mockResolvedValue(null);
    await expect(getGraphRevision()).resolves.toBe(0);
  });
});

describe('deleteUserData (POPIA erasure cascade)', () => {
  it('returns evidence ids and cascades the deletes', async () => {
    findResult = [{ evidenceIds: ['u/1'] }, { evidenceIds: ['u/2', 'u/3'] }];
    const { evidenceIds } = await deleteUserData('u-1');
    expect(evidenceIds).toEqual(['u/1', 'u/2', 'u/3']);
    expect(coll.deleteMany).toHaveBeenCalledTimes(2); // cases + usage
    expect(coll.deleteOne).toHaveBeenCalledTimes(1); // user
  });
});
