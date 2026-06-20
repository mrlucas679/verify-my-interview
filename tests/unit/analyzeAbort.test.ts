import { AgentOrchestrator } from '../../src/backend/agent/orchestrator';
import { analyzeEvidenceLocal } from '../../src/backend/local/appTools';
import { ToolOrchestrator } from '../../src/backend/tools';

describe('analysis cancellation regressions', () => {
  it('rejects an already-aborted local analysis before the pipeline runs', async () => {
    const controller = new AbortController();
    controller.abort(new Error('client cancelled'));

    await expect(
      analyzeEvidenceLocal('Acme recruiter asked for a training fee.', 'case-abort', {
        signal: controller.signal,
      })
    ).rejects.toThrow('client cancelled');
  });

  it('rejects an already-aborted orchestrator run before any stage work', async () => {
    const controller = new AbortController();
    controller.abort(new Error('deadline reached'));

    await expect(
      AgentOrchestrator.analyze('Acme recruiter asked for a training fee.', 'case-abort', {
        signal: controller.signal,
      })
    ).rejects.toThrow('deadline reached');
  });

  it('does not call a provider tool when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('request closed'));

    const result = await new ToolOrchestrator().execute(
      'lookup_domain_rdap',
      { domain: 'example.com' },
      controller.signal
    );

    expect(result).toMatchObject({
      tool: 'lookup_domain_rdap',
      success: false,
      error: 'Tool call aborted before execution',
    });
  });
});
