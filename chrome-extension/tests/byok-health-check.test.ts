// chrome-extension/tests/byok-health-check.test.ts
//
// Phase 12 PROVIDER-03: localhost LiteLLM/wrapper health check (D-C1 + D-C2).
// Pure async function — no chrome.storage / supabase deps.
//
// DV-1 (cross-AI review iter 2): retry-once with 200ms backoff. Both
// timeout and network-error cases assert fetchMock was called EXACTLY 2
// times. Case 5b confirms retry rescues a transient failure.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
}

describe('checkBYOKHealth', () => {
  it('returns unchecked for remote https URLs (D-C1: localhost-only)', async () => {
    const { checkBYOKHealth } = await import('../reader/lib/byok-health-check');
    const r1 = await checkBYOKHealth('https://api.openai.com/v1');
    const r2 = await checkBYOKHealth('https://openrouter.ai/api/v1');
    expect(r1).toEqual({ status: 'unchecked' });
    expect(r2).toEqual({ status: 'unchecked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('healthy localhost with N models', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }),
    );
    const { checkBYOKHealth } = await import('../reader/lib/byok-health-check');
    const result = await checkBYOKHealth('http://localhost:4000/v1');
    expect(result.status).toBe('healthy');
    if (result.status === 'healthy') {
      expect(result.modelCount).toBe(3);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4000/v1/models');
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('timeout returns unreachable AFTER retry-once (DV-1)', async () => {
    const abortErr = new DOMException('signal timed out', 'AbortError');
    fetchMock.mockRejectedValue(abortErr);
    const { checkBYOKHealth } = await import('../reader/lib/byok-health-check');
    const start = Date.now();
    const result = await checkBYOKHealth('http://localhost:4000/v1');
    const elapsed = Date.now() - start;
    expect(result.status).toBe('unreachable');
    if (result.status === 'unreachable') {
      expect(result.error).toBeTruthy();
    }
    // DV-1: exactly 2 attempts (initial + 1 retry)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 200ms backoff between attempts; rejection is synchronous in mock so
    // total wall time is dominated by the backoff (not the 1.5s timeout).
    expect(elapsed).toBeLessThan(3500);
  });

  it('5xx response returns unreachable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('error', { status: 500 }));
    const { checkBYOKHealth } = await import('../reader/lib/byok-health-check');
    const result = await checkBYOKHealth('http://localhost:4000/v1');
    expect(result.status).toBe('unreachable');
    if (result.status === 'unreachable') {
      expect(result.error).toBeTruthy();
    }
  });

  it('network error returns unreachable AFTER retry-once (DV-1)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { checkBYOKHealth } = await import('../reader/lib/byok-health-check');
    const result = await checkBYOKHealth('http://localhost:4000/v1');
    expect(result.status).toBe('unreachable');
    // DV-1: exactly 2 attempts (initial + 1 retry)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on transient failure and succeeds on retry (DV-1 case 5b)', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'm1' }] }));
    const { checkBYOKHealth } = await import('../reader/lib/byok-health-check');
    const start = Date.now();
    const result = await checkBYOKHealth('http://localhost:4000/v1');
    const elapsed = Date.now() - start;
    expect(result.status).toBe('healthy');
    if (result.status === 'healthy') {
      expect(result.modelCount).toBe(1);
    }
    // DV-1: exactly 2 attempts; second one rescued the probe.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 200ms backoff (with scheduler tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  it('127.0.0.1 treated as localhost', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const { checkBYOKHealth } = await import('../reader/lib/byok-health-check');
    const result = await checkBYOKHealth('http://127.0.0.1:4000/v1');
    expect(result.status).toBe('healthy');
    if (result.status === 'healthy') {
      expect(result.modelCount).toBe(0);
    }
  });

  it('normalizes trailing slash so URL has no double slash', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const { checkBYOKHealth } = await import('../reader/lib/byok-health-check');
    await checkBYOKHealth('http://localhost:4000/v1/');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4000/v1/models');
  });

  it('handles unparseable JSON as healthy with modelCount 0', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    const { checkBYOKHealth } = await import('../reader/lib/byok-health-check');
    const result = await checkBYOKHealth('http://localhost:4000/v1');
    expect(result.status).toBe('healthy');
    if (result.status === 'healthy') {
      expect(result.modelCount).toBe(0);
    }
  });
});

describe('isLocalhostURL', () => {
  it('recognizes localhost + 127.0.0.1, rejects remote and unparseable', async () => {
    const { isLocalhostURL } = await import('../reader/lib/byok-health-check');
    expect(isLocalhostURL('http://localhost:4000/v1')).toBe(true);
    expect(isLocalhostURL('http://localhost:8000/v1')).toBe(true);
    expect(isLocalhostURL('http://127.0.0.1:4000/v1')).toBe(true);
    // hostname-exact match — 'localhost.example.com' is NOT localhost
    expect(isLocalhostURL('https://localhost.example.com/v1')).toBe(false);
    expect(isLocalhostURL('https://api.openai.com/v1')).toBe(false);
    expect(isLocalhostURL('not a url')).toBe(false);
  });
});
