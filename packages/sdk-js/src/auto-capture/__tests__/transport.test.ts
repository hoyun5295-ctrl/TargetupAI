import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Transport } from '../transport';

describe('Transport (batch + retry + schema_version v1)', () => {
  let fetchSpy: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, accepted: 5 }),
    } as Response);
  });

  it('queue() 안 5 event 모음 시 자동 flush', async () => {
    const t = new Transport({
      apiKey: 'hjl_test',
      endpoint: 'https://app.hanjul.ai/api/cdp',
      batchSize: 5,
      flushIntervalMs: 5000,
    });
    for (let i = 0; i < 5; i++) {
      t.queue({ type: 'pageview', url: `/p${i}` });
    }
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.schema_version).toBe('v1');
    expect(body.events).toHaveLength(5);
  });

  it('X-Hanjullo-Key + X-Hanjullo-Schema-Version 헤더 의무', async () => {
    const t = new Transport({
      apiKey: 'hjl_test',
      endpoint: 'https://app.hanjul.ai/api/cdp',
      batchSize: 1,
      flushIntervalMs: 5000,
    });
    t.queue({ type: 'pageview', url: '/' });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers['X-Hanjullo-Key']).toBe('hjl_test');
    expect(headers['X-Hanjullo-Schema-Version']).toBe('v1');
  });

  it('endpoint 안 trailing slash 자동 제거', async () => {
    const t = new Transport({
      apiKey: 'hjl_test',
      endpoint: 'https://app.hanjul.ai/api/cdp///',
      batchSize: 1,
    });
    t.queue({ type: 'pageview', url: '/' });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toBe('https://app.hanjul.ai/api/cdp/ingest');
  });
});
