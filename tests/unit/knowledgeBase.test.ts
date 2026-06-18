// Unit tests for Foundry IQ grounding (src/backend/network/knowledgeBase.ts):
// env-gating, prompt-line formatting, and the parse/cap/degrade logic of the
// agentic-retrieve call. axios is mocked so no network is touched.

jest.mock('axios');
import axios from 'axios';
import {
  groundingPromptLines,
  knowledgeBaseEnabled,
  retrieveGrounding,
} from '../../src/backend/network/knowledgeBase';

const post = axios.post as jest.Mock;

const ENV = ['AZURE_SEARCH_ENDPOINT', 'AZURE_SEARCH_API_KEY', 'AZURE_SEARCH_KNOWLEDGE_BASE'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  post.mockReset();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function enable(): void {
  process.env.AZURE_SEARCH_ENDPOINT = 'https://search.example.net';
  process.env.AZURE_SEARCH_API_KEY = 'key';
  process.env.AZURE_SEARCH_KNOWLEDGE_BASE = 'vmi-scam-kb';
}

function passagesPayload(passages: unknown): { data: unknown } {
  return { data: { response: [{ content: [{ text: JSON.stringify(passages) }] }] } };
}

describe('groundingPromptLines (pure)', () => {
  it('returns [] for empty/undefined', () => {
    expect(groundingPromptLines(undefined)).toEqual([]);
    expect(groundingPromptLines([])).toEqual([]);
  });
  it('formats a labelled block with one bullet per passage', () => {
    const lines = groundingPromptLines([
      { ref_id: 1, content: 'alpha' },
      { ref_id: 2, content: 'beta' },
    ]);
    expect(lines[0]).toBe('');
    expect(lines[1]).toContain('PRIOR REPORTED SCAMS');
    expect(lines).toContain('- alpha');
    expect(lines).toContain('- beta');
  });
});

describe('knowledgeBaseEnabled', () => {
  it('requires endpoint + key + knowledge base', () => {
    for (const k of ENV) delete process.env[k];
    expect(knowledgeBaseEnabled()).toBe(false);
    enable();
    expect(knowledgeBaseEnabled()).toBe(true);
  });
});

describe('retrieveGrounding', () => {
  it('returns [] without calling out when disabled', async () => {
    for (const k of ENV) delete process.env[k];
    expect(await retrieveGrounding('anything')).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  it('returns [] for an empty query', async () => {
    enable();
    expect(await retrieveGrounding('   ')).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  it('parses the nested response into passages', async () => {
    enable();
    post.mockResolvedValue(
      passagesPayload([
        { ref_id: 1, content: 'first' },
        { ref_id: 2, content: 'second' },
      ])
    );
    const result = await retrieveGrounding('acme recruiter scam');
    expect(result).toEqual([
      { ref_id: 1, content: 'first' },
      { ref_id: 2, content: 'second' },
    ]);
  });

  it('caps passage count to 5 and content length to 500', async () => {
    enable();
    const many = Array.from({ length: 9 }, (_, i) => ({ ref_id: i, content: 'x'.repeat(900) }));
    post.mockResolvedValue(passagesPayload(many));
    const result = await retrieveGrounding('q');
    expect(result).toHaveLength(5);
    expect(result[0].content).toHaveLength(500);
  });

  it('defaults a non-numeric ref_id to 0 and drops empty content', async () => {
    enable();
    post.mockResolvedValue(passagesPayload([{ ref_id: 'nope', content: 'kept' }, { content: '' }]));
    const result = await retrieveGrounding('q');
    expect(result).toEqual([{ ref_id: 0, content: 'kept' }]);
  });

  it('degrades to [] on a transport error (never throws)', async () => {
    enable();
    post.mockRejectedValue(new Error('network down'));
    await expect(retrieveGrounding('q')).resolves.toEqual([]);
  });

  it('returns [] when the payload shape is unexpected', async () => {
    enable();
    post.mockResolvedValue({ data: { nothing: true } });
    expect(await retrieveGrounding('q')).toEqual([]);
  });
});
