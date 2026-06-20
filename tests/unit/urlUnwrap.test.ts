jest.mock('axios');
jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

import axios from 'axios';
import { lookup } from 'dns/promises';
import { expandShortenedUrls } from '../../src/backend/research/urlUnwrap';
import type { Entities } from '../../src/types/entities';

const head = axios.head as jest.Mock;
const dnsLookup = lookup as jest.Mock;

function entities(url: string): Entities {
  return {
    companies: ['Acme'],
    people: [],
    emails: [],
    domains: [],
    urls: [url],
    phones: [],
    money_requests: [],
    job_titles: [],
  };
}

describe('expandShortenedUrls SSRF guard', () => {
  const saved = process.env.URL_UNWRAP_ENABLED;

  beforeEach(() => {
    process.env.URL_UNWRAP_ENABLED = '1';
    head.mockReset();
    dnsLookup.mockReset();
    dnsLookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.URL_UNWRAP_ENABLED;
    else process.env.URL_UNWRAP_ENABLED = saved;
  });

  it('does not follow a short-link redirect into localhost or private networks', async () => {
    const parsed = entities('https://bit.ly/example');
    head.mockResolvedValue({ headers: { location: 'http://127.0.0.1/latest/meta-data' } });

    await expandShortenedUrls(parsed);

    expect(parsed.domains).toEqual([]);
  });

  it('adds a safe public final domain', async () => {
    const parsed = entities('https://bit.ly/example');
    head
      .mockResolvedValueOnce({ headers: { location: 'https://careers.acme.co.za/job/1' } })
      .mockResolvedValueOnce({ headers: {} });

    await expandShortenedUrls(parsed);

    expect(parsed.domains).toEqual(['acme.co.za']);
  });
});
