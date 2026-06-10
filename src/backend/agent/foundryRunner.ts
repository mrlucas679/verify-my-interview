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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  toolExecutor?: (toolName: string, args: Record<string, any>) => Promise<ToolResult>;
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
    try {
      const agent = await client.createAgent(this.settings.modelDeployment, {
        name: options.name,
        instructions: options.instructions,
        tools: toolDefinitions,
      });
      agentId = agent.id;

      const thread = await client.threads.create();
      if (options.messages && options.messages.length) {
        for (const m of options.messages) {
          await client.messages.create(thread.id, m.role, m.content);
        }
      } else {
        await client.messages.create(thread.id, 'user', options.userMessage ?? '');
      }

      let run = await client.runs.create(thread.id, agentId);
      let cycles = 0;

      while (ACTIVE_RUN_STATUSES.includes(run.status)) {
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

            const result = options.toolExecutor
              ? await options.toolExecutor(toolName, args)
              : { tool: toolName, success: false, error: 'No tool executor configured' };

            toolsUsed.push({ tool: toolName, input: args, result });
            toolOutputs.push({ toolCallId: toolCall.id, output: JSON.stringify(result) });
          }

          run = await client.runs.submitToolOutputs(thread.id, run.id, toolOutputs);
        } else {
          await delay(1000);
          run = await client.runs.get(thread.id, run.id);
        }
      }

      if (run.status !== 'completed') {
        const lastError = (run as any).lastError;
        throw new Error(
          `Foundry run for "${options.name}" ended with status "${run.status}"${
            lastError?.message ? `: ${lastError.message}` : ''
          }`
        );
      }

      const finalText = await this.readLatestAssistantMessage(client, thread.id);
      return { finalText, toolsUsed };
    } finally {
      if (agentId) {
        try {
          await client.deleteAgent(agentId);
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
    threadId: string
  ): Promise<string> {
    const messages = client.messages.list(threadId, { order: 'desc' });
    for await (const message of messages) {
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
