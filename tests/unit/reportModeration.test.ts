jest.mock('../../src/backend/data/cosmos', () => ({
  cosmosEnabled: jest.fn(() => true),
  deletePendingReport: jest.fn(),
  deleteReport: jest.fn(),
  getPendingReport: jest.fn(),
  listPendingReports: jest.fn(),
  savePendingReport: jest.fn(),
  saveReport: jest.fn(),
}));

jest.mock('../../src/backend/network/scamNetwork', () => ({
  scamNetwork: {
    enabled: false,
    add: jest.fn(),
    waitForReport: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../src/backend/network/entityGraph', () => ({
  entityGraph: {
    addLocalReport: jest.fn().mockResolvedValue(undefined),
    markDirty: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/backend/events/serviceBus', () => ({
  publishEvent: jest.fn(),
}));

import {
  LocalHttpError,
  listPendingReportsLocal,
  moderateReportLocal,
  submitReportLocal,
} from '../../src/backend/local/appTools';
import * as cosmos from '../../src/backend/data/cosmos';
import { entityGraph } from '../../src/backend/network/entityGraph';
import { scamNetwork } from '../../src/backend/network/scamNetwork';
import type { NetworkReport } from '../../src/backend/network/types';

const ENV_KEYS = [
  'NODE_ENV',
  'VMI_REPORT_API_KEY',
  'VMI_ALLOW_PUBLIC_REPORTS',
] as const;

let saved: Record<string, string | undefined>;

function pendingReport(): NetworkReport {
  return {
    reportId: 'R-pending',
    companyName: 'Acme',
    aliases: [],
    scamType: 'User-reported scam',
    description: 'Asked me to pay a training fee before interview.',
    domains: ['jobs-acme.example'],
    emails: ['hr@jobs-acme.example'],
    phones: [],
    paymentHandles: [],
    location: 'South Africa',
    reportedAt: '2026-06-20',
    sourceType: 'user',
    trustLevel: 'unverified',
  };
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  jest.clearAllMocks();
  (cosmos.cosmosEnabled as jest.Mock).mockReturnValue(true);
  (scamNetwork as unknown as { enabled: boolean }).enabled = false;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('report moderation flow', () => {
  it('queues public production reports for moderation when public reports are explicitly allowed', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VMI_ALLOW_PUBLIC_REPORTS = '1';

    const result = await submitReportLocal({
      companyName: 'Acme',
      description: 'Asked me to pay a training fee before interview.',
    });

    expect(result.status).toBe('pending_review');
    expect(result.indexed).toBe(false);
    expect(cosmos.savePendingReport).toHaveBeenCalledTimes(1);
    expect(entityGraph.addLocalReport).not.toHaveBeenCalled();
  });

  it('rejects production reports when neither API key nor public policy is configured', async () => {
    process.env.NODE_ENV = 'production';

    await expect(
      submitReportLocal({ companyName: 'Acme', description: 'Asked for money.' })
    ).rejects.toMatchObject({ clientStatus: 401 } satisfies Partial<LocalHttpError>);
  });

  it('indexes trusted API-key submissions immediately', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VMI_REPORT_API_KEY = 'secret-report-key';

    const result = await submitReportLocal(
      { companyName: 'Acme', description: 'Asked for money.' },
      'secret-report-key'
    );

    expect(result.status).toBe('indexed');
    expect(result.indexed).toBe(true);
    expect(cosmos.savePendingReport).not.toHaveBeenCalled();
    expect(entityGraph.addLocalReport).toHaveBeenCalledTimes(1);
  });

  it('lets admins list, approve, and reject pending reports', async () => {
    (cosmos.listPendingReports as jest.Mock).mockResolvedValue([pendingReport()]);
    await expect(listPendingReportsLocal()).resolves.toEqual({ reports: [pendingReport()] });

    (cosmos.getPendingReport as jest.Mock).mockResolvedValue(pendingReport());
    (cosmos.deletePendingReport as jest.Mock).mockResolvedValue(true);
    const approved = await moderateReportLocal('R-pending', 'approve', 'admin-1');
    expect(approved).toEqual({ ok: true, reportId: 'R-pending', action: 'approved', indexed: true });
    expect(cosmos.saveReport).toHaveBeenCalledWith(expect.objectContaining({ trustLevel: 'verified' }));
    expect(cosmos.deletePendingReport).toHaveBeenCalledWith('R-pending');

    const rejected = await moderateReportLocal('R-pending', 'reject', 'admin-1');
    expect(rejected).toEqual({ ok: true, reportId: 'R-pending', action: 'rejected', indexed: false });
  });
});
