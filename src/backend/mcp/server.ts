#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  MAX_LOCAL_EVIDENCE_CHARS,
  analyzeEvidenceLocal,
  executeVerificationToolLocal,
  graphLookupLocal,
  healthSnapshot,
  networkStatsLocal,
  withLogsOnStderr,
} from '../local/appTools';

function textJson(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function compactAnalysis(value: Awaited<ReturnType<typeof analyzeEvidenceLocal>>): unknown {
  return {
    case_id: value.case_id,
    report: value.report,
    multiPass: value.multiPass,
    signals: value.signals,
    matches: value.matches.slice(0, 5),
    graph: { nodes: value.graph.nodes.length, edges: value.graph.edges.length },
  };
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'verify-my-interview', version: '0.1.0' });

  server.registerTool(
    'vmi_analyze_evidence',
    {
      title: 'Analyze job/interview evidence',
      description: 'Run Verify My Interview locally and return report, signals, and multi-pass adjudication.',
      inputSchema: {
        evidence: z.string().min(1).max(MAX_LOCAL_EVIDENCE_CHARS),
        caseId: z.string().min(1).max(120).optional(),
      },
    },
    async ({ evidence, caseId }) => textJson(compactAnalysis(await analyzeEvidenceLocal(evidence, caseId)))
  );

  server.registerTool(
    'vmi_graph_lookup',
    {
      title: 'Look up scam-network identifier',
      description: 'Look up a domain, email, phone, or payment handle in the local scam-intelligence graph.',
      inputSchema: { identifier: z.string().min(1).max(300) },
    },
    async ({ identifier }) => textJson(await graphLookupLocal(identifier))
  );

  server.registerTool(
    'vmi_network_stats',
    {
      title: 'Get scam-network statistics',
      description: 'Return aggregate stats from the scam-intelligence graph.',
    },
    async () => textJson(await networkStatsLocal())
  );

  server.registerTool(
    'vmi_run_verification_tool',
    {
      title: 'Run one verification tool',
      description: 'Raw read-only escape hatch for a single allowlisted verification tool.',
      inputSchema: {
        toolName: z.enum([
          'lookup_company_registry',
          'lookup_domain_rdap',
          'lookup_phone_intel',
          'detect_scam_patterns',
          'research_company_web',
        ]),
        input: z.record(z.string(), z.unknown()),
      },
    },
    async ({ toolName, input }) => textJson(await executeVerificationToolLocal(toolName, input))
  );

  server.registerResource(
    'vmi-health',
    'vmi://health',
    { title: 'Verify My Interview health', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(healthSnapshot(), null, 2) }],
    })
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  console.log = (...args: unknown[]) => console.error(...args);
  const server = createServer();
  await withLogsOnStderr(() => server.connect(new StdioServerTransport()));
}

if (require.main === module) {
  startMcpServer().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`vmi-mcp: ${message}\n`);
    process.exit(1);
  });
}
