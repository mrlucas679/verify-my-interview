// Unit tests for the event backbone (src/backend/events/serviceBus.ts):
// env-gating, fire-and-forget publish (never throws), and consumer wiring.
// @azure/service-bus is mocked so no broker is contacted.

jest.mock('@azure/service-bus', () => {
  const sendMessages = jest.fn().mockResolvedValue(undefined);
  const subscribe = jest.fn();
  const createSender = jest.fn(() => ({ sendMessages }));
  const createReceiver = jest.fn(() => ({ subscribe }));
  return {
    ServiceBusClient: jest.fn().mockImplementation(() => ({ createSender, createReceiver })),
    __mock: { sendMessages, subscribe, createSender, createReceiver },
  };
});

import * as sb from '@azure/service-bus';
import {
  publishEvent,
  serviceBusEnabled,
  startEventConsumer,
} from '../../src/backend/events/serviceBus';

const mock = (sb as unknown as { __mock: Record<string, jest.Mock> }).__mock;

const savedConn = process.env.SERVICEBUS_CONNECTION_STRING;
afterEach(() => {
  if (savedConn === undefined) delete process.env.SERVICEBUS_CONNECTION_STRING;
  else process.env.SERVICEBUS_CONNECTION_STRING = savedConn;
  jest.clearAllMocks();
});

describe('serviceBusEnabled', () => {
  it('reflects the connection string', () => {
    delete process.env.SERVICEBUS_CONNECTION_STRING;
    expect(serviceBusEnabled()).toBe(false);
    process.env.SERVICEBUS_CONNECTION_STRING = 'Endpoint=sb://x/;SharedAccessKey=k';
    expect(serviceBusEnabled()).toBe(true);
  });
});

describe('publishEvent', () => {
  it('is a no-op when unconfigured (no sender created)', async () => {
    delete process.env.SERVICEBUS_CONNECTION_STRING;
    await publishEvent('report.created', { reportId: 'R-1' });
    expect(mock.createSender).not.toHaveBeenCalled();
    expect(mock.sendMessages).not.toHaveBeenCalled();
  });

  it('sends a message with the event type as subject when configured', async () => {
    process.env.SERVICEBUS_CONNECTION_STRING = 'Endpoint=sb://x/;SharedAccessKey=k';
    await publishEvent('report.created', { reportId: 'R-2' });
    expect(mock.sendMessages).toHaveBeenCalledTimes(1);
    const msg = mock.sendMessages.mock.calls[0][0];
    expect(msg).toMatchObject({
      subject: 'report.created',
      body: { reportId: 'R-2' },
      contentType: 'application/json',
    });
  });

  it('swallows transport errors (best-effort, never throws)', async () => {
    process.env.SERVICEBUS_CONNECTION_STRING = 'Endpoint=sb://x/;SharedAccessKey=k';
    mock.sendMessages.mockRejectedValueOnce(new Error('broker unavailable'));
    await expect(publishEvent('fraud.detected', { x: 1 })).resolves.toBeUndefined();
  });
});

describe('startEventConsumer', () => {
  it('is a no-op when unconfigured', () => {
    delete process.env.SERVICEBUS_CONNECTION_STRING;
    startEventConsumer(jest.fn());
    expect(mock.createReceiver).not.toHaveBeenCalled();
  });

  it('subscribes a receiver when configured', () => {
    process.env.SERVICEBUS_CONNECTION_STRING = 'Endpoint=sb://x/;SharedAccessKey=k';
    startEventConsumer(jest.fn());
    expect(mock.subscribe).toHaveBeenCalledTimes(1);
  });
});
