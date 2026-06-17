// Cosmos DB (MongoDB API) data access — slice 1 of the data platform.
//
// Today this powers OPT-IN shareable report results: a finished report can be
// saved under an unguessable id and revisited / shared via a link. What is
// stored is the REDACTED, derived report (verdict, signals, narrative) that the
// pipeline already produced — NEVER the raw evidence text.
//
// Conventions (CLAUDE.md): env-gated — with COSMOS_CONNECTION_STRING unset the
// feature is simply off and the app behaves exactly as before (rule 2, graceful
// degradation; offline evals scrub COSMOS_* so they stay deterministic, rule 3).
// Input is bounded (rule 3) and validated at the boundary (rule 5). Retention is
// a TTL index (COSMOS_SHARE_TTL_DAYS, default 30) — POPIA data minimisation.

import { randomBytes } from 'crypto';
import { Db, MongoClient } from 'mongodb';
import type { NetworkReport } from '../network/types';

const SHARED_REPORTS = 'shared_reports';
const REPORTS = 'reports';
const MAX_REPORTS = 2_000;
const MAX_RESULT_BYTES = 256 * 1024;
const CONNECT_TIMEOUT_MS = 8_000;
const SHARE_ID_RE = /^[a-f0-9]{24}$/;

export function cosmosEnabled(): boolean {
  return Boolean(process.env.COSMOS_CONNECTION_STRING);
}

function ttlSeconds(): number {
  const days = Number(process.env.COSMOS_SHARE_TTL_DAYS);
  const clamped = Number.isFinite(days) && days > 0 ? Math.min(365, days) : 30;
  return Math.round(clamped * 24 * 3600);
}

interface SharedReportDoc {
  _id: string;
  createdAt: string;
  /** BSON Date that drives the TTL index for auto-expiry. */
  createdAtDate: Date;
  result: unknown;
}

// Cached connection promise (singleton). Reset to null on failure so a transient
// outage doesn't permanently disable the feature.
let dbPromise: Promise<Db> | null = null;

async function connect(): Promise<Db> {
  const conn = process.env.COSMOS_CONNECTION_STRING;
  if (!conn) throw new Error('COSMOS_CONNECTION_STRING is not set');
  const client = new MongoClient(conn, { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS });
  await client.connect();
  const database = client.db(process.env.COSMOS_DB || 'vmi');
  // TTL retention: Cosmos for MongoDB honours an index on a Date field with
  // expireAfterSeconds, auto-deleting shared reports past the retention window.
  try {
    await database
      .collection(SHARED_REPORTS)
      .createIndex({ createdAtDate: 1 }, { expireAfterSeconds: ttlSeconds(), name: 'ttl_createdAt' });
  } catch {
    /* index may already exist with different options — non-fatal */
  }
  return database;
}

async function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = connect().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Persist a redacted report result; returns its unguessable share id. */
export async function saveSharedReport(
  result: unknown
): Promise<{ id: string; expiresInDays: number }> {
  const serialized = JSON.stringify(result ?? null);
  if (serialized === 'null') throw new Error('result is required');
  if (serialized.length > MAX_RESULT_BYTES) throw new Error('result too large to share');

  const id = randomBytes(12).toString('hex'); // 96-bit, 24 hex chars
  const db = await getDb();
  await db.collection<SharedReportDoc>(SHARED_REPORTS).insertOne({
    _id: id,
    createdAt: new Date().toISOString(),
    createdAtDate: new Date(),
    result: JSON.parse(serialized),
  });
  return { id, expiresInDays: Math.round(ttlSeconds() / 86_400) };
}

/** Fetch a shared report result by id, or null if missing / expired / malformed. */
export async function getSharedReport(id: string): Promise<unknown | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  const db = await getDb();
  const doc = await db.collection<SharedReportDoc>(SHARED_REPORTS).findOne({ _id: id });
  return doc?.result ?? null;
}

// ── Scam-report corpus (durable system of record) ───────────────────────────
// User-submitted community reports persist here so they survive restarts and are
// the durable source the entity graph builds from (Azure AI Search remains the
// derived vector index). Upsert by reportId keeps it idempotent.

interface ReportDoc extends NetworkReport {
  _id: string;
}

/** Persist (upsert) a community scam report as the durable system of record. */
export async function saveReport(report: NetworkReport): Promise<void> {
  const db = await getDb();
  await db
    .collection<ReportDoc>(REPORTS)
    .updateOne({ _id: report.reportId }, { $set: report }, { upsert: true });
}

/** List durable community reports (bounded). */
export async function listReports(): Promise<NetworkReport[]> {
  const db = await getDb();
  const docs = await db
    .collection<ReportDoc>(REPORTS)
    .find({}, { projection: { _id: 0 } })
    .limit(MAX_REPORTS)
    .toArray();
  return docs as unknown as NetworkReport[];
}
