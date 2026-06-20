import {
  EntityGraphService,
  normalizeDomain,
  normalizePaymentHandle,
} from '../../src/backend/network/entityGraph';
import type { NetworkReport } from '../../src/backend/network/types';

function report(id: string, patch: Partial<NetworkReport> = {}): NetworkReport {
  return {
    reportId: id,
    companyName: 'Example',
    aliases: [],
    scamType: 'job scam',
    description: 'reported scam',
    domains: [],
    emails: [],
    phones: [],
    paymentHandles: [],
    location: 'South Africa',
    reportedAt: '2026-06-20',
    sourceType: 'user',
    trustLevel: 'unverified',
    ...patch,
  };
}

describe('entity graph identity hardening', () => {
  it('normalizes subdomains to the registrable domain without substring matching', () => {
    expect(normalizeDomain('https://www.Careers.Example.co.za/path')).toBe('example.co.za');
    expect(normalizeDomain('jobs.microsoft.com')).toBe('microsoft.com');
    expect(normalizeDomain('evil-example.com')).toBe('evil-example.com');
    expect(normalizeDomain('example.com')).toBe('example.com');
  });

  it('keeps only true payment handles as hard identifiers', () => {
    expect(normalizePaymentHandle('wire transfer')).toBeNull();
    expect(normalizePaymentHandle('gift card: Apple')).toBeNull();
    expect(normalizePaymentHandle('Zelle: nimbus-onboard')).toBe('zelle:nimbus-onboard');
    expect(normalizePaymentHandle('USDT wallet: TQrKp4mNbu77')).toBe('wallet:tqrkp4mnbu77');
  });

  it('does not promote duplicate user-only reports to corroborated', async () => {
    const graph = new EntityGraphService();
    await graph.addLocalReport(report('R-user-1', { domains: ['dupe.example'] }));
    await graph.addLocalReport(report('R-user-2', { domains: ['www.dupe.example'] }));

    expect(await graph.trustOf('R-user-1')).toBe('unverified');
    expect(await graph.trustOf('R-user-2')).toBe('unverified');
  });

  it('promotes user reports when the shared identifier has an independent anchor', async () => {
    const graph = new EntityGraphService();
    await graph.addLocalReport(report('R-seed-anchor', {
      domains: ['anchor.example'],
      sourceType: 'seed',
      trustLevel: 'verified',
    }));
    await graph.addLocalReport(report('R-user-hit', { domains: ['www.anchor.example'] }));

    expect(await graph.trustOf('R-user-hit')).toBe('corroborated');
  });
});
