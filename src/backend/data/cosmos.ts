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
const USERS = 'users';
const CASES = 'cases';
const USAGE = 'usage';
const ANON_TRIALS = 'anon_trials';
const MAX_REPORTS = 2_000;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_CASES = 500;
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

/** Consented-evidence/case retention window (POPIA: default 12 months). */
function caseRetentionSeconds(): number {
  const days = Number(process.env.COSMOS_CASE_RETENTION_DAYS);
  const clamped = Number.isFinite(days) && days > 0 ? Math.min(3650, days) : 365;
  return Math.round(clamped * 24 * 3600);
}

/** Anonymous-trial memory window: how long a hashed IP is remembered. */
function anonTrialSeconds(): number {
  const days = Number(process.env.AUTH_ANON_TRIAL_DAYS);
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

// Cached connection promises (singletons). Reset to null on failure so a
// transient outage doesn't permanently disable the feature.
//
// Two logical databases honour the locked PII-residency decision (see
// docs/DATA_ARCHITECTURE.md §2): the NON-PII corpus (reports, shared reports,
// anon trials) lives on the main connection (co-located with Search/Foundry IQ),
// while PII stores (users, cases, usage) use COSMOS_PII_CONNECTION_STRING when
// set — a Cosmos account in South Africa North. When that var is unset both fall
// back to the single main account, so a one-account dev setup still works.
let dbPromise: Promise<Db> | null = null;
let piiDbPromise: Promise<Db> | null = null;

async function openDb(conn: string): Promise<Db> {
  const client = new MongoClient(conn, { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS });
  await client.connect();
  return client.db(process.env.COSMOS_DB || 'vmi');
}

/** Best-effort TTL index on a Date field (Cosmos for MongoDB honours these). */
async function ensureTtl(db: Db, collection: string, expireAfterSeconds: number): Promise<void> {
  try {
    await db
      .collection(collection)
      .createIndex({ createdAtDate: 1 }, { expireAfterSeconds, name: 'ttl_createdAt' });
  } catch {
    /* index may already exist with different options — non-fatal */
  }
}

async function connect(): Promise<Db> {
  const conn = process.env.COSMOS_CONNECTION_STRING;
  if (!conn) throw new Error('COSMOS_CONNECTION_STRING is not set');
  const database = await openDb(conn);
  await ensureTtl(database, SHARED_REPORTS, ttlSeconds());
  await ensureTtl(database, ANON_TRIALS, anonTrialSeconds());
  return database;
}

async function connectPii(): Promise<Db> {
  const conn = process.env.COSMOS_PII_CONNECTION_STRING || process.env.COSMOS_CONNECTION_STRING;
  if (!conn) throw new Error('COSMOS_CONNECTION_STRING is not set');
  const database = await openDb(conn);
  // Consented cases auto-expire at the retention window; users/usage persist
  // until explicit erasure.
  await ensureTtl(database, CASES, caseRetentionSeconds());
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

async function getPiiDb(): Promise<Db> {
  if (!piiDbPromise) {
    piiDbPromise = connectPii().catch((error) => {
      piiDbPromise = null;
      throw error;
    });
  }
  return piiDbPromise;
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

/**
 * Delete a community report from the durable store (admin moderation — e.g. a
 * false or abusive submission). Returns true if a document was removed. The
 * caller is responsible for the authorization check (requireAdmin) and for
 * re-indexing the derived Search index.
 */
export async function deleteReport(reportId: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.collection<ReportDoc>(REPORTS).deleteOne({ _id: reportId });
  return res.deletedCount > 0;
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

// ── Accounts (PII stores) ────────────────────────────────────────────────────
// `users` + `cases` + `usage` are PII (consented) and live on the PII connection
// (South Africa North when configured). The deterministic scorer/eval path never
// touches these; they exist only for signed-in users on the canonical HTTP runtime.

export interface UserConsent {
  /** User agreed to store evidence files / case history. */
  store_evidence: boolean;
  at: string;
}

export interface UserDoc {
  _id: string;
  email?: string;
  name?: string;
  provider?: string;
  consent: UserConsent;
  plan: 'free';
  createdAt: string;
  updatedAt: string;
}

export interface CaseDoc {
  _id: string;
  userId: string;
  createdAt: string;
  createdAtDate: Date;
  riskLevel: string;
  riskScore: number;
  caseSummary: string;
  evidenceType?: string;
  /** Blob paths of consented evidence files for this case (never raw text). */
  evidenceIds: string[];
}

/** Create or update a user's profile from a verified identity. Free plan only. */
export async function upsertUser(
  user: { id: string; email?: string; name?: string; provider?: string },
  consent?: Partial<UserConsent>
): Promise<UserDoc> {
  const db = await getPiiDb();
  const now = new Date().toISOString();
  const set: Record<string, unknown> = { updatedAt: now };
  if (user.email) set.email = user.email;
  if (user.name) set.name = user.name;
  if (user.provider) set.provider = user.provider;
  if (consent && typeof consent.store_evidence === 'boolean') {
    set.consent = { store_evidence: consent.store_evidence, at: now };
  }
  await db.collection<UserDoc>(USERS).updateOne(
    { _id: user.id },
    {
      $set: set,
      $setOnInsert: {
        plan: 'free',
        createdAt: now,
        consent: { store_evidence: false, at: now },
      },
    },
    { upsert: true }
  );
  const doc = await db.collection<UserDoc>(USERS).findOne({ _id: user.id });
  return doc as UserDoc;
}

export async function getUser(id: string): Promise<UserDoc | null> {
  const db = await getPiiDb();
  return db.collection<UserDoc>(USERS).findOne({ _id: id });
}

/** Persist a redacted case snapshot for a signed-in user (history). */
export async function saveCase(c: {
  id: string;
  userId: string;
  riskLevel: string;
  riskScore: number;
  caseSummary: string;
  evidenceType?: string;
  evidenceIds?: string[];
}): Promise<void> {
  const db = await getPiiDb();
  const now = new Date();
  await db.collection<CaseDoc>(CASES).updateOne(
    { _id: c.id },
    {
      $set: {
        userId: c.userId,
        createdAt: now.toISOString(),
        createdAtDate: now,
        riskLevel: c.riskLevel.slice(0, 40),
        riskScore: c.riskScore,
        caseSummary: c.caseSummary.slice(0, 2_000),
        evidenceType: c.evidenceType?.slice(0, 40),
        evidenceIds: (c.evidenceIds ?? []).slice(0, 20),
      },
    },
    { upsert: true }
  );
}

export async function listCases(userId: string): Promise<CaseDoc[]> {
  const db = await getPiiDb();
  return db
    .collection<CaseDoc>(CASES)
    .find({ userId })
    .sort({ createdAtDate: -1 })
    .limit(MAX_CASES)
    .toArray();
}

export async function getCase(userId: string, caseId: string): Promise<CaseDoc | null> {
  if (!SHARE_ID_RE.test(caseId) && !/^[\w-]{1,64}$/.test(caseId)) return null;
  const db = await getPiiDb();
  return db.collection<CaseDoc>(CASES).findOne({ _id: caseId, userId });
}

/**
 * POPIA right to erasure: delete the user and cascade-delete their cases + usage.
 * Returns the evidence blob paths that the caller must also remove from storage.
 * Community `reports` are de-identified and intentionally retained.
 */
export async function deleteUserData(userId: string): Promise<{ evidenceIds: string[] }> {
  const db = await getPiiDb();
  const cases = await db
    .collection<CaseDoc>(CASES)
    .find({ userId }, { projection: { evidenceIds: 1 } })
    .limit(MAX_CASES)
    .toArray();
  const evidenceIds = cases.flatMap((c) => c.evidenceIds ?? []);
  await db.collection<CaseDoc>(CASES).deleteMany({ userId });
  await db.collection(USAGE).deleteMany({ userId });
  await db.collection<UserDoc>(USERS).deleteOne({ _id: userId });
  return { evidenceIds };
}

// ── Usage metering (free tier) ───────────────────────────────────────────────
// Per-user, per-calendar-month counter. Today usage is METERED but NOT capped
// (free tier = unlimited for now); the count is recorded so a hard cap can be
// switched on later without a migration.

function usagePeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

interface UsageDoc {
  _id: string;
  userId: string;
  period: string;
  count: number;
}

/** Increment and return the user's check count for the current period. */
export async function recordUsage(userId: string): Promise<{ period: string; count: number }> {
  const db = await getPiiDb();
  const period = usagePeriod();
  const res = await db.collection<UsageDoc>(USAGE).findOneAndUpdate(
    { _id: `${userId}:${period}` },
    { $inc: { count: 1 }, $set: { userId, period } },
    { upsert: true, returnDocument: 'after' }
  );
  return { period, count: res?.count ?? 1 };
}

export async function getUsage(userId: string): Promise<{ period: string; count: number }> {
  const db = await getPiiDb();
  const period = usagePeriod();
  const doc = await db.collection<UsageDoc>(USAGE).findOne({ _id: `${userId}:${period}` });
  return { period, count: doc?.count ?? 0 };
}

// ── Anonymous trial gate (non-PII; hashed IP only) ───────────────────────────

interface AnonTrialDoc {
  _id: string;
  count: number;
  createdAtDate: Date;
}

/**
 * Consume one anonymous trial for a hashed key. Returns true if the caller may
 * proceed (was under maxTrials), false once the free trial(s) are exhausted.
 * Best-effort: a Cosmos hiccup fails OPEN (allows the check) rather than locking
 * a legitimate visitor out — abuse is still bounded by the per-IP rate limiter.
 */
export async function consumeAnonTrial(key: string, maxTrials: number): Promise<boolean> {
  const db = await getDb();
  const res = await db.collection<AnonTrialDoc>(ANON_TRIALS).findOneAndUpdate(
    { _id: key },
    { $inc: { count: 1 }, $setOnInsert: { createdAtDate: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
  const count = (res as AnonTrialDoc | null)?.count ?? 1;
  return count <= maxTrials;
}
