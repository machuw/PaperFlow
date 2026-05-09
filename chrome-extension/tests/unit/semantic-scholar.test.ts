import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchOverviewMeta, _resetForTest } from '../../reader/lib/semantic-scholar';

// jsdom doesn't provide chrome.storage — stand up an in-memory shim.
const storageMock: Record<string, unknown> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: (k: string | string[] | null) => {
        if (k === null || k === undefined) {
          return Promise.resolve({ ...storageMock });
        }
        if (Array.isArray(k)) {
          const out: Record<string, unknown> = {};
          for (const key of k) if (key in storageMock) out[key] = storageMock[key];
          return Promise.resolve(out);
        }
        return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {});
      },
      set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve(); },
      remove: (k: string | string[]) => {
        const keys = Array.isArray(k) ? k : [k];
        for (const key of keys) delete storageMock[key];
        return Promise.resolve();
      },
      clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve(); },
    },
  },
};

beforeEach(async () => {
  await chrome.storage.local.clear();
  _resetForTest();
  global.fetch = vi.fn();
});

describe('semantic-scholar', () => {
  it('returns null + caches negative on 404', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 404 });
    expect(await fetchOverviewMeta('P', '1234.5678')).toBeNull();
    (global.fetch as any).mockClear();
    await fetchOverviewMeta('P', '1234.5678');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('returns null on no arxivId', async () => {
    expect(await fetchOverviewMeta('P', null)).toBeNull();
  });
  it('returns meta on success and caches positive', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true, json: async () => ({ venue: 'NeurIPS 2017', citationCount: 47892, fieldsOfStudy: ['CS'] }),
    });
    const m = await fetchOverviewMeta('P', '1706.03762');
    expect(m?.venue).toBe('NeurIPS 2017');
  });
  it('expiresAt jittered between 5 and 9 days', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });
    const m = await fetchOverviewMeta('P', '1234.5678');
    const days = (m!.expiresAt - m!.fetchedAt) / 86400000;
    expect(days).toBeGreaterThanOrEqual(5);
    expect(days).toBeLessThanOrEqual(9);
  });
  it('serializes concurrent fetches (single-concurrency)', async () => {
    let active = 0, peak = 0;
    (global.fetch as any).mockImplementation(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { ok: true, json: async () => ({}) };
    });
    await Promise.all([
      fetchOverviewMeta('A', '1'), fetchOverviewMeta('B', '2'), fetchOverviewMeta('C', '3'),
    ]);
    expect(peak).toBe(1);
  });
});
