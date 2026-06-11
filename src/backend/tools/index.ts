import { ToolResult } from '../../types/tool_results';
import { companyLookupAdapter } from './adapters/companyLookup.adapter';
import { domainLookupAdapter } from './adapters/domainLookup.adapter';
import { scamPatternDetectorAdapter } from './adapters/scamPatternDetector.adapter';
import { webResearchAdapter } from './adapters/webResearch.adapter';
import { phoneIntelAdapter } from './adapters/phoneIntel.adapter';

export class ToolOrchestrator {
  private cache: Map<string, { result: ToolResult; timestamp: number }> = new Map();
  private callCount = 0;
  private maxCalls = 10;
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour

  async execute(toolName: string, input: any): Promise<ToolResult> {
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
      console.log(`[Tool] Cache hit: ${toolName}`);
      return { ...cached.result, cached: true };
    }

    // Execute tool
    console.log(`[Tool] Calling ${toolName} (${this.callCount + 1}/${this.maxCalls})`);
    this.callCount++;
    let result: ToolResult;

    try {
      switch (toolName) {
        case 'lookup_company_registry':
          result = await companyLookupAdapter(input);
          break;
        case 'lookup_domain_rdap':
          result = await domainLookupAdapter(input);
          break;
        case 'detect_scam_patterns':
          result = await scamPatternDetectorAdapter(input);
          break;
        case 'research_company_web':
          result = await webResearchAdapter(input);
          break;
        case 'lookup_phone_intel':
          result = await phoneIntelAdapter(input);
          break;
        default:
          result = {
            tool: toolName,
            success: false,
            error: `Unknown tool: ${toolName}`,
          };
      }
    } catch (error) {
      result = {
        tool: toolName,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Cache result if successful
    if (result.success) {
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
    }

    return result;
  }

  getCallCount(): number {
    return this.callCount;
  }

  getRemainingBudget(): number {
    return Math.max(0, this.maxCalls - this.callCount);
  }

  reset(): void {
    this.cache.clear();
    this.callCount = 0;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export { ToolResult } from '../../types/tool_results';
