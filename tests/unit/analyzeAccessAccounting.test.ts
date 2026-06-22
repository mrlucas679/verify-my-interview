jest.mock('../../src/backend/data/cosmos', () => ({
  cosmosEnabled: jest.fn(),
  consumeAnonTrial: jest.fn(),
  recordUsage: jest.fn(),
  reserveUsage: jest.fn(),
  rollbackAnonTrial: jest.fn(),
  rollbackUsage: jest.fn(),
  upsertUser: jest.fn(),
}));

import type { AuthedRequest } from '../../src/backend/auth/middleware';
import {
  commitAnalyzeAccess,
  rollbackAnalyzeAccess,
} from '../../src/backend/auth/middleware';
import {
  cosmosEnabled,
  recordUsage,
  rollbackAnonTrial,
  rollbackUsage,
} from '../../src/backend/data/cosmos';

const mockedCosmosEnabled = cosmosEnabled as jest.MockedFunction<typeof cosmosEnabled>;
const mockedRecordUsage = recordUsage as jest.MockedFunction<typeof recordUsage>;
const mockedRollbackAnonTrial = rollbackAnonTrial as jest.MockedFunction<typeof rollbackAnonTrial>;
const mockedRollbackUsage = rollbackUsage as jest.MockedFunction<typeof rollbackUsage>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedCosmosEnabled.mockReturnValue(true);
  mockedRecordUsage.mockResolvedValue({ period: '2026-06', count: 1 });
  mockedRollbackAnonTrial.mockResolvedValue(undefined);
  mockedRollbackUsage.mockResolvedValue(undefined);
});

describe('analyze access accounting', () => {
  it('meters signed-in usage only when the analysis is committed', async () => {
    const req = {
      analyzeAccess: { kind: 'signed_in', userId: 'user-1' },
    } as AuthedRequest;

    expect(mockedRecordUsage).not.toHaveBeenCalled();
    await commitAnalyzeAccess(req);

    expect(mockedRecordUsage).toHaveBeenCalledTimes(1);
    expect(mockedRecordUsage).toHaveBeenCalledWith('user-1');
  });

  it('does not meter signed-in usage when Cosmos accounting is disabled', async () => {
    mockedCosmosEnabled.mockReturnValue(false);
    const req = {
      analyzeAccess: { kind: 'signed_in', userId: 'user-1' },
    } as AuthedRequest;

    await commitAnalyzeAccess(req);

    expect(mockedRecordUsage).not.toHaveBeenCalled();
  });

  it('does not double-meter a signed-in quota reservation', async () => {
    const req = {
      analyzeAccess: {
        kind: 'signed_in',
        userId: 'user-1',
        reserved: true,
        durable: true,
        period: '2026-06',
        quotaMax: 20,
      },
    } as AuthedRequest;

    await commitAnalyzeAccess(req);

    expect(mockedRecordUsage).not.toHaveBeenCalled();
  });

  it('rolls back a durable signed-in quota reservation once', async () => {
    const req = {
      analyzeAccess: {
        kind: 'signed_in',
        userId: 'user-1',
        reserved: true,
        durable: true,
        period: '2026-06',
        quotaMax: 20,
      },
    } as AuthedRequest;

    await rollbackAnalyzeAccess(req);
    await rollbackAnalyzeAccess(req);

    expect(mockedRollbackUsage).toHaveBeenCalledTimes(1);
    expect(mockedRollbackUsage).toHaveBeenCalledWith('user-1', '2026-06');
    expect(req.analyzeAccess).toMatchObject({ reserved: false });
  });

  it('rolls back a durable anonymous reservation once and marks it released', async () => {
    const req = {
      analyzeAccess: {
        kind: 'anonymous',
        key: 'anon-hash',
        reserved: true,
        durable: true,
      },
    } as AuthedRequest;

    await rollbackAnalyzeAccess(req);
    await rollbackAnalyzeAccess(req);

    expect(mockedRollbackAnonTrial).toHaveBeenCalledTimes(1);
    expect(mockedRollbackAnonTrial).toHaveBeenCalledWith('anon-hash');
    expect(req.analyzeAccess).toMatchObject({ reserved: false });
  });
});
