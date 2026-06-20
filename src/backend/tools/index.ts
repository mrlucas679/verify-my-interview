import { ToolResult } from '../../types/tool_results';
import { companyLookupAdapter } from './adapters/companyLookup.adapter';
import { domainLookupAdapter } from './adapters/domainLookup.adapter';
import { scamPatternDetectorAdapter } from './adapters/scamPatternDetector.adapter';
import { webResearchAdapter } from './adapters/webResearch.adapter';
import { phoneIntelAdapter } from './adapters/phoneIntel.adapter';
import { logger } from '../observability/logger';

// Process-wide tool-result cache. A fresh ToolOrchestrator is created per
// request, so a per-instance cache would never survive across cases. Sharing
// the store at module scope means identical identifier lookups (RDAP, registry,
// phone, web) are reused across requests within the TTL. The per-instance call
// BUDGET below is deliberately NOT shared — each case keeps its own 10-call cap.
const sharedCache = new Map<string, { result: ToolResult; timestamp: number }>();
const sharedInFlight = new Map<string, Promise<ToolResult>>();

export class ToolOrchestrator {
  private cache = sharedCache;
  private callCount = 0;
  private maxCalls = 10;
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour
  private readonly MAX_CACHE_ENTRIES = 200;

  async execute(toolName: string, input: any, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) {
      return {
        tool: toolName,
        success: false,
        error: 'Tool call aborted before execution',
      };
    }

    // Check call budget
    if (this.callCount >= this.maxCalls) {
      return {
        tool: toolName,
        success: false,
        error: `Tool budget exhausted (${this.maxCalls} max calls per case)`,
      };
    }

    // Check cache
    const cacheKey = `${toolName}:${JSON.stringify(input)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      logger.debug(`[Tool] Cache hit: ${toolName}`);
      return { ...cached.result, cached: true };
    }
    const inFlight = sharedInFlight.get(cacheKey);
    if (inFlight) {
      logger.debug(`[Tool] Joining in-flight call: ${toolName}`);
      return { ...(await inFlight), cached: true };
    }

    // Execute tool
    logger.info(`[Tool] Calling ${toolName} (${this.callCount + 1}/${this.maxCalls})`);
    this.callCount++;
    const work = this.executeUncached(toolName, input, signal).finally(() => {
      sharedInFlight.delete(cacheKey);
    });
    sharedInFlight.set(cacheKey, work);
    const result = await work;

    // Cache result if successful
    if (result.success) {
      this.evictExpiredCache();
      this.evictOldestCacheEntry();
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
    }

    return result;
  }

  private async executeUncached(toolName: string, input: any, signal?: AbortSignal): Promise<ToolResult> {
    try {
      if (signal?.aborted) throw new Error('Tool call aborted before provider request');
      let result: ToolResult;
      switch (toolName) {
        case 'lookup_company_registry':
          result = await companyLookupAdapter(input, signal);
          break;
        case 'lookup_domain_rdap':
          result = await domainLookupAdapter(input, signal);
          break;
        case 'detect_scam_patterns':
          result = await scamPatternDetectorAdapter(input);
          break;
        case 'research_company_web':
          result = await webResearchAdapter(input, signal);
          break;
        case 'lookup_phone_intel':
          result = await phoneIntelAdapter(input, signal);
          break;
        default:
          result = {
            tool: toolName,
            success: false,
            error: `Unknown tool: ${toolName}`,
          };
      }
      if (signal?.aborted) {
        return {
          tool: toolName,
          success: false,
          error: 'Tool call aborted after provider request',
        };
      }
      return result;
    } catch (error) {
      return {
        tool: toolName,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  getCallCount(): number {
    return this.callCount;
  }

  getRemainingBudget(): number {
    return Math.max(0, this.maxCalls - this.callCount);
  }

  reset(): void {
    this.cache.clear();
    sharedInFlight.clear();
    this.callCount = 0;
  }

  clearCache(): void {
    this.cache.clear();
    sharedInFlight.clear();
  }

  private evictExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (now - value.timestamp >= this.CACHE_TTL) this.cache.delete(key);
    }
  }

  private evictOldestCacheEntry(): void {
    if (this.cache.size < this.MAX_CACHE_ENTRIES) return;
    const oldest = this.cache.keys().next().value;
    if (oldest) this.cache.delete(oldest);
  }
}

export { ToolResult } from '../../types/tool_results';
