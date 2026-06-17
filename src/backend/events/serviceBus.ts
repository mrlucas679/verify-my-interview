// Event backbone — Azure Service Bus (publisher + in-process consumer).
//
// Decouples reactions to domain events (a new report, a trust change, a fraud
// signal) from the request path. Env-gated on SERVICEBUS_CONNECTION_STRING: unset
// ⇒ no-op (everything still works synchronously). Publishing is best-effort and
// never throws. The consumer runs in-process (deployable in the same Container
// App); a dedicated Azure Functions consumer is the scale-up path. Uses a single
// `vmi-events` QUEUE (Basic tier — no base cost); move to a topic + subscriptions
// when fan-out to multiple independent consumers is needed.

import { ServiceBusClient, ServiceBusReceiver, ServiceBusSender } from '@azure/service-bus';
import { logger } from '../observability/logger';

export type AppEventType = 'report.created' | 'trustscore.updated' | 'fraud.detected';

export function serviceBusEnabled(): boolean {
  return Boolean(process.env.SERVICEBUS_CONNECTION_STRING);
}

function queueName(): string {
  return process.env.SERVICEBUS_QUEUE || 'vmi-events';
}

let client: ServiceBusClient | null = null;
let sender: ServiceBusSender | null = null;
let receiver: ServiceBusReceiver | null = null;

function getClient(): ServiceBusClient {
  if (!client) client = new ServiceBusClient(process.env.SERVICEBUS_CONNECTION_STRING as string);
  return client;
}

/** Publish an app event. Fire-and-forget; never throws (best-effort backbone). */
export async function publishEvent(type: AppEventType, payload: Record<string, unknown>): Promise<void> {
  if (!serviceBusEnabled()) return;
  try {
    if (!sender) sender = getClient().createSender(queueName());
    await sender.sendMessages({ subject: type, body: payload, contentType: 'application/json' });
  } catch (e) {
    logger.warn(`[Events] publish ${type} failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Start an in-process subscriber. No-op when unconfigured. Errors are logged, not
 * thrown, so a Service Bus outage never takes the server down.
 */
export function startEventConsumer(handler: (type: string, body: unknown) => Promise<void> | void): void {
  if (!serviceBusEnabled()) return;
  try {
    receiver = getClient().createReceiver(queueName());
    receiver.subscribe({
      processMessage: async (msg) => {
        await handler(String(msg.subject ?? ''), msg.body);
      },
      processError: async (args) => {
        logger.warn(`[Events] consumer error: ${args.error instanceof Error ? args.error.message : args.error}`);
      },
    });
    logger.info(`[Events] consumer subscribed to queue ${queueName()}`);
  } catch (e) {
    logger.warn(`[Events] consumer start failed: ${e instanceof Error ? e.message : e}`);
  }
}
