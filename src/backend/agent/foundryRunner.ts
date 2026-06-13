// Shared Microsoft Foundry (Azure AI Foundry) agent runner.
//
// Encapsulates the one piece of machinery every specialist agent needs: create
// an ephemeral Foundry agent with a set of function tools, drive a single
// reasoning turn (thread -> message -> run loop satisfying `requires_action`
// tool calls), and return the agent's final text plus the tool calls it made.
//
// Each specialist (Investigator, Verifier, Reporter) supplies its own
// instructions, tool set, and tool executor, so this stays domain-agnostic.

import { AgentsClient, ToolUtility } from '@azure/ai-agents';
import { DefaultAzureCredential } from '@azure/identity';

import { ToolResult } from '../../types/tool_results';
import { AgentToolCall } from './types';

const ACTIVE_RUN_STATUSES = ['queued', 'in_progress', 'requires_action'];
const MAX_RUN_CYCLES = 30;
const MAX_TURN_ATTEMPTS = 2;
const MAX_PROMPT_TOKENS = 20_000;
const MAX_COMPLETION_TOKENS = 4_096;
const DEFAULT_TURN_DEADLINE_MS = 10_000;

class FoundryDeadlineError extends Error {
  constructor(label: string) {
    super(`Foundry deadline reached for "${label}"`);
    this.name = 'FoundryDeadlineError';
  }
}

function abortError(signal: AbortSignal, fallback: string): Error {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error(fallback);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal, 'Foundry operation aborted');
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Operation exceeded ${ms}ms`)), ms);
  timer.unref?.();
  return controller.signal;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal, 'Foundry delay aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError(signal, 'Foundry delay aborted'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function turnDeadlineMs(): number {
  const configured = Number(process.env.VMI_FOUNDRY_TURN_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_TURN_DEADLINE_MS;
  return Math.max(2_000, Math.min(60_000, configured));
}

async function withDeadline<T>(
  workFactory: (signal: AbortSignal) => Promise<T>,
  label: string
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const work = workFactory(controller.signal);
  const deadline = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      const error = new FoundryDeadlineError(label);
      controller.abort(error);
      reject(error);
    }, turnDeadlineMs());
    timer.unref?.();
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    void work.catch((error) => {
      console.warn(
        `[FoundryRunner] Late completion after deadline for ${label}: ${
          error instanceof Error ? error.message : error
        }`
      );
    });
  }
}

function operationOptions(signal: AbortSignal): { abortSignal: AbortSignal } {
  return { abortSignal: signal };
}

export interface FoundrySettings {
  endpoint: string;
  modelDeployment: string;
}

/** Read Foundry config from the environment. `enabled` is false when no endpoint. */
export function getFoundrySettings(): FoundrySettings & { enabled: boolean } {
  const endpoint =
    process.env.AZURE_AI_PROJECT_ENDPOINT ?? process.env.PROJECT_ENDPOINT ?? '';
  const modelDeployment = process.env.AZURE_AI_MODEL_DEPLOYMENT ?? 'gpt-4o';
  return { endpoint, modelDeployment, enabled: Boolean(endpoint) };
}

/** A plain function-tool spec ({ name, description, parameters }). */
export interface FunctionToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentTurnOptions {
  /** Agent display name (also used in logs). */
  name: string;
  /** System instructions for this agent. */
  instructions: string;
  /** The user turn content (used when `messages` is not provided). */
  userMessage?: string;
  /** Full conversation to replay into the thread (for multi-turn chat). */
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Function tools the agent may call (empty for pure-reasoning agents). */
  tools?: FunctionToolSpec[];
  /** Executes a tool call requested by the agent. Required if `tools` is set. */
  toolExecutor?: (
    toolName: string,
    args: Record<string, any>,
    signal: AbortSignal
  ) => Promise<ToolResult>;
}

export interface AgentTurnResult {
  finalText: string;
  toolsUsed: AgentToolCall[];
}

/**
 * Drives one or more specialist agents against a single Foundry project.
 * Reuses a single AgentsClient across turns within a case.
 */
export class FoundryRunner {
  private readonly settings: FoundrySettings;
  private client: AgentsClient | null = null;

  constructor(settings: FoundrySettings) {
    this.settings = settings;
  }

  private getClient(): AgentsClient {
    if (!this.client) {
      this.client = new AgentsClient(this.settings.endpoint, new DefaultAzureCredential());
    }
    return this.client;
  }

  /** Run a single agent turn end-to-end and return its final message + tool calls. */
  async runTurn(options: AgentTurnOptions): Promise<AgentTurnResult> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt++) {
      try {
        return await withDeadline((signal) => this.runTurnOnce(options, signal), options.name);
      } catch (error) {
        const captured = error instanceof Error ? error : new Error(String(error));
        lastError = captured;
        if (!this.shouldRetry(captured) || attempt === MAX_TURN_ATTEMPTS) break;
        console.warn(
          `[FoundryRunner] ${options.name} attempt ${attempt} failed (${captured.message}); retrying once.`
        );
      }
    }
    throw lastError ?? new Error(`Foundry run for "${options.name}" failed`);
  }

  private shouldRetry(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('incomplete') ||
      message.includes('timeout') ||
      message.includes('exceeded') ||
      message.includes('429') ||
      message.includes('temporarily')
    );
  }

  private async runTurnOnce(
    options: AgentTurnOptions,
    signal: AbortSignal
  ): Promise<AgentTurnResult> {
    const client = this.getClient();
    const toolsUsed: AgentToolCall[] = [];

    const toolDefinitions = (options.tools ?? []).map(
      (spec) =>
        ToolUtility.createFunctionTool({
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
        }).definition
    );

    let agentId: string | undefined;
    let threadId: string | undefined;
    let runId: string | undefined;
    let runStatus: string | undefined;
    try {
      throwIfAborted(signal);
      const agent = await client.createAgent(this.settings.modelDeployment, {
        name: options.name,
        instructions: options.instructions,
        tools: toolDefinitions,
        ...operationOptions(signal),
      });
      agentId = agent.id;

      throwIfAborted(signal);
      const thread = await client.threads.create(operationOptions(signal));
      threadId = thread.id;
      if (options.messages && options.messages.length) {
        for (const m of options.messages) {
          throwIfAborted(signal);
          await client.messages.create(thread.id, m.role, m.content, operationOptions(signal));
        }
      } else {
        throwIfAborted(signal);
        await client.messages.create(
          thread.id,
          'user',
          options.userMessage ?? '',
          operationOptions(signal)
        );
      }

      throwIfAborted(signal);
      let run = await client.runs.create(thread.id, agentId, {
        maxPromptTokens: MAX_PROMPT_TOKENS,
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
        parallelToolCalls: false,
        temperature: 0.1,
        ...operationOptions(signal),
      });
      runId = run.id;
      runStatus = run.status;
      let cycles = 0;

      while (ACTIVE_RUN_STATUSES.includes(run.status)) {
        throwIfAborted(signal);
        if (cycles++ >= MAX_RUN_CYCLES) {
          throw new Error(`Run exceeded ${MAX_RUN_CYCLES} cycles without completing`);
        }

        if (run.status === 'requires_action') {
          const requiredAction = run.requiredAction as any;
          const toolCalls: any[] = requiredAction?.submitToolOutputs?.toolCalls ?? [];
          const toolOutputs: Array<{ toolCallId: string; output: string }> = [];

          for (const toolCall of toolCalls) {
            if (toolCall?.type !== 'function') continue;

            const toolName: string = toolCall.function?.name;
            let args: Record<string, any> = {};
            try {
              args = JSON.parse(toolCall.function?.arguments ?? '{}');
            } catch {
              args = {};
            }

            throwIfAborted(signal);
            const result = options.toolExecutor
              ? await options.toolExecutor(toolName, args, signal)
              : { tool: toolName, success: false, error: 'No tool executor configured' };
            throwIfAborted(signal);

            toolsUsed.push({ tool: toolName, input: args, result });
            toolOutputs.push({ toolCallId: toolCall.id, output: JSON.stringify(result) });
          }

          throwIfAborted(signal);
          run = await client.runs.submitToolOutputs(
            thread.id,
            run.id,
            toolOutputs,
            operationOptions(signal)
          );
        } else {
          await delay(1000, signal);
          throwIfAborted(signal);
          run = await client.runs.get(thread.id, run.id, operationOptions(signal));
        }
        runId = run.id;
        runStatus = run.status;
      }

      if (run.status !== 'completed') {
        const lastError = (run as any).lastError;
        const incompleteDetails = (run as any).incompleteDetails;
        throw new Error(
          `Foundry run for "${options.name}" ended with status "${run.status}"${
            lastError?.message ? `: ${lastError.message}` : ''
          }${incompleteDetails?.reason ? ` (${incompleteDetails.reason})` : ''}`
        );
      }

      throwIfAborted(signal);
      const finalText = await this.readLatestAssistantMessage(client, thread.id, signal);
      return { finalText, toolsUsed };
    } finally {
      if (signal.aborted && threadId && runId && runStatus && ACTIVE_RUN_STATUSES.includes(runStatus)) {
        try {
          await client.runs.cancel(threadId, runId, operationOptions(timeoutSignal(2_000)));
        } catch (cancelError) {
          console.warn(
            `[FoundryRunner] Failed to cancel timed-out run ${runId} (${options.name}): ${
              cancelError instanceof Error ? cancelError.message : cancelError
            }`
          );
        }
      }
      if (agentId) {
        try {
          await client.deleteAgent(agentId, operationOptions(timeoutSignal(2_000)));
        } catch (cleanupError) {
          console.warn(
            `[FoundryRunner] Failed to delete agent ${agentId} (${options.name}): ${
              cleanupError instanceof Error ? cleanupError.message : cleanupError
            }`
          );
        }
      }
    }
  }

  private async readLatestAssistantMessage(
    client: AgentsClient,
    threadId: string,
    signal: AbortSignal
  ): Promise<string> {
    const messages = client.messages.list(threadId, { order: 'desc', ...operationOptions(signal) });
    for await (const message of messages) {
      throwIfAborted(signal);
      if (message.role !== 'assistant') continue;
      const textPart: any = message.content.find((part: any) => part.type === 'text');
      return textPart?.text?.value ?? '';
    }
    return '';
  }
}

/** Best-effort extraction of the first JSON object from a model response. */
export function extractJsonObject(text: string): any | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Coerce an unknown value into a clean string array. */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}
