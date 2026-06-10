// Tool result type definitions and schemas

/**
 * Standard result envelope returned by every tool adapter and the
 * ToolOrchestrator. This is the de-facto contract used across the backend
 * (adapters, orchestrator, Foundry investigator), so keep it stable.
 */
export interface ToolResult {
  /** Tool name, e.g. "lookup_company_registry" */
  tool: string;
  /** Whether the tool executed successfully */
  success: boolean;
  /** Tool-specific payload (only present on success) */
  data?: Record<string, any>;
  /** Error message when success is false */
  error?: string;
  /** Wall-clock execution time in milliseconds */
  duration?: number;
  /** True when the result was served from the orchestrator cache */
  cached?: boolean;
}

export interface ToolCache {
  [key: string]: {
    result: Record<string, any>;
    timestamp: Date;
    ttl_ms: number;
  };
}

export interface ToolBudget {
  max_calls: number;
  max_searches: number;
  max_url_scans: number;
  calls_used: number;
  searches_used: number;
  url_scans_used: number;
}

export interface ToolExecutionPlan {
  tools_to_call: string[];
  call_order: string[];
  parallelizable: {
    [group: number]: string[];
  };
  budget_estimate: number;
}
