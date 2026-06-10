// Express API server

import 'dotenv/config';
import path from 'path';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { ocrEnabled, extractText } from './ocr/documentIntelligence';
import { AgentOrchestrator } from './agent/orchestrator';
import { scamNetwork } from './network/scamNetwork';
import { entityGraph } from './network/entityGraph';
import { NetworkReport, NodeType, TrustLevel } from './network/types';
import { getFoundrySettings, FoundryRunner } from './agent/foundryRunner';
import { ToolOrchestrator } from './tools';
import { ConversationalAgent } from './agent/agents/conversationalAgent';
import { webResearchEnabled } from './research/webResearch';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Static web UI (served from <project root>/public)
app.use(express.static(path.join(process.cwd(), 'public')));

// In-memory file upload (8 MB cap) for OCR
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

/**
 * POST /upload
 * Extract text from an uploaded document/screenshot via Azure Document Intelligence.
 */
app.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!ocrEnabled()) {
      return res.status(503).json({ error: 'Document OCR is not configured' });
    }
    const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
    if (!file) return res.status(400).json({ error: 'file is required' });
    const { text, pages } = await extractText(file.buffer);
    res.json({ text, pages, fileName: file.originalname });
  } catch (error) {
    console.error('Upload/OCR error:', error);
    res.status(500).json({ error: 'OCR failed' });
  }
});

/**
 * POST /analyze
 * Analyzes evidence and returns risk report
 */
app.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { evidence } = req.body;

    if (!evidence) {
      return res.status(400).json({
        error: 'Missing required field: evidence'
      });
    }

    const caseId = uuidv4();
    console.log(`[${caseId}] Analyzing evidence...`);

    const { report, trace, signals, matches, graph } = await AgentOrchestrator.analyze(
      evidence,
      caseId
    );

    res.json({
      case_id: caseId,
      report,
      trace,
      signals,
      matches,
      graph
    });
  } catch (error) {
    console.error('Error analyzing evidence:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * POST /chat
 * Continue a conversation with the detective about an investigated case.
 */
app.post('/chat', async (req: Request, res: Response) => {
  try {
    const { caseContext, messages } = req.body || {};
    if (!caseContext || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'caseContext and messages are required' });
    }
    const settings = getFoundrySettings();
    const runner = settings.enabled ? new FoundryRunner(settings) : null;
    const agent = new ConversationalAgent(runner, new ToolOrchestrator());
    const { reply, engine } = await agent.run(caseContext, messages.slice(-12));
    res.json({ reply, engine });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Chat failed' });
  }
});

/**
 * POST /report
 * Submit a scam to the scam-intelligence network.
 */
app.post('/report', async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.companyName || !b.description) {
      return res.status(400).json({ error: 'companyName and description are required' });
    }
    const report: NetworkReport = {
      reportId: b.reportId || `R-${Date.now()}`,
      companyName: String(b.companyName).slice(0, 120),
      aliases: Array.isArray(b.aliases) ? b.aliases : [],
      scamType: b.scamType || 'User-reported scam',
      description: String(b.description).slice(0, 5000),
      domains: Array.isArray(b.domains) ? b.domains : [],
      emails: Array.isArray(b.emails) ? b.emails : [],
      phones: Array.isArray(b.phones) ? b.phones : [],
      paymentHandles: Array.isArray(b.paymentHandles) ? b.paymentHandles : [],
      location: b.location || 'Unknown',
      reportedAt: new Date().toISOString().slice(0, 10),
      sourceType: 'user',
      trustLevel: 'unverified',
    };
    if (scamNetwork.enabled) {
      await scamNetwork.add(report);
      await entityGraph.refresh();
    } else {
      // Indexed network unavailable — keep the report in the in-memory graph
      // so structural matching still works for this session.
      await entityGraph.addLocalReport(report);
    }
    res.status(201).json({ ok: true, reportId: report.reportId });
  } catch (error) {
    console.error('Error submitting report:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

/**
 * GET /network/graph
 * The scam-intelligence entity graph (optionally filtered).
 */
app.get('/network/graph', async (req: Request, res: Response) => {
  try {
    const graph = await entityGraph.getGraph({
      type: req.query.type as NodeType | undefined,
      minTrust: req.query.minTrust as TrustLevel | undefined,
    });
    res.json(graph);
  } catch (error) {
    console.error('Graph error:', error);
    res.status(500).json({ error: 'Failed to build entity graph' });
  }
});

/**
 * GET /network/stats
 * Aggregate threat statistics over the report corpus.
 */
app.get('/network/stats', async (req: Request, res: Response) => {
  try {
    res.json(await entityGraph.stats());
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to compute network stats' });
  }
});

/**
 * GET /health
 * Health check with per-subsystem status — every capability degrades gracefully.
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    subsystems: {
      foundry_agents: getFoundrySettings().enabled,
      scam_network_index: scamNetwork.enabled,
      entity_graph: true, // in-memory; always available (seed-backed fallback)
      document_ocr: ocrEnabled(),
      web_research: webResearchEnabled(),
    }
  });
});

/**
 * GET /docs
 * API documentation
 */
app.get('/docs', (req: Request, res: Response) => {
  res.json({
    service: 'Verify My Interview',
    version: '0.1.0',
    endpoints: {
      'POST /analyze': 'Submit evidence for fraud investigation (returns report + trace + case subgraph)',
      'POST /chat': 'Converse with the case-aware detective',
      'POST /upload': 'OCR a document/screenshot via Azure Document Intelligence',
      'POST /report': 'Submit a scam report to the intelligence network',
      'GET /network/graph': 'Scam-intelligence entity graph (?type=&minTrust=)',
      'GET /network/stats': 'Threat statistics over the report corpus',
      'GET /health': 'Health check with subsystem status',
      'GET /docs': 'API documentation'
    }
  });
});

// SPA fallback: serve the built React app for any non-API GET route
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Server] Verify My Interview API listening on port ${PORT}`);
    console.log(`[Server] Health check: http://localhost:${PORT}/health`);
    console.log(`[Server] Documentation: http://localhost:${PORT}/docs`);
    if (scamNetwork.enabled) {
      scamNetwork
        .ensureIndex()
        .then(() => console.log('[Server] Scam-intelligence network index ready.'))
        .catch((e) => console.warn('[Server] Network index check failed:', e?.message ?? e));
    }
    entityGraph
      .refresh()
      .catch((e) => console.warn('[Server] Entity graph build failed:', e?.message ?? e));
  });
}

export default app;
