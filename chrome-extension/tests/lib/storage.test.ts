import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCachedParsed, setCachedParsed, getMemory, setMemory, clearPaper,
  getHighlights, setHighlights, addHighlight, getConfig,
  getNotes, setNotes, addNote,
  getChat, setChat, appendChatMessage,
  getSummarySection, setSummarySection, clearSummarySection,
} from '../../reader/lib/storage';
import { setItem } from '../../reader/lib/storage-schema';
import type { ParsedCache } from '../../reader/lib/storage';
import type { Highlight } from '../../reader/types';
import type { MarginResult, ChatMessage } from '../../reader/types';

type StorageArea = {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};

function makeMockStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: async (keys) => {
      // Simulate chrome.storage.local's cross-IPC latency so read-then-write
      // race conditions are observable in tests.
      await new Promise((r) => setTimeout(r, 0));
      const keyList = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(keyList.filter(k => data.has(k)).map(k => [k, data.get(k)]));
    },
    set: async (items) => {
      // Matching microtask delay on set so concurrent read-modify-write
      // sequences truly interleave (caller A suspends between its get and
      // its set, letting caller B's get see the pre-A state).
      await new Promise((r) => setTimeout(r, 0));
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) data.delete(k);
    },
  };
}

beforeEach(() => {
  const local = makeMockStorage();
  (globalThis as any).chrome = { storage: { local } };
});

describe('parsed cache', () => {
  it('round-trips title/authors/abstract/venue/outline/paragraphs', async () => {
    const parsed: ParsedCache = {
      title: 'Contextual Residuals',
      authors: ['Khan, Y.', 'Voigt, R.'],
      abstract: 'We propose…',
      venue: 'arXiv:2402.18413  [cs.LG]  14 Feb 2026',
      outline: [{ id: 'o1', label: 'Introduction', level: 0 }],
      paragraphs: [{ id: 'sec0-p0', sectionId: 'o1', section: 'Introduction', text: 'foo' }],
    };
    await setCachedParsed('2402.18413', parsed);
    const got = await getCachedParsed('2402.18413');
    expect(got).toEqual(parsed);
  });

  it('returns null when key absent', async () => {
    expect(await getCachedParsed('missing-key')).toBeNull();
  });

  it('returns null when cached record has stale version (forces re-parse)', async () => {
    // Simulate a pre-versioning cache record: same shape as today but no
    // `version` field. getCachedParsed must treat it as a miss so the next
    // load re-parses via the current (fixed) parser.
    await chrome.storage.local.set({
      'paper:stale-key:parsed': {
        title: 'Old', authors: [], abstract: '', venue: '',
        outline: [], paragraphs: [],
      },
    });
    expect(await getCachedParsed('stale-key')).toBeNull();
  });

  it('strips the internal version field from returned payload', async () => {
    await setCachedParsed('fresh-key', {
      title: 'T', authors: [], abstract: '', venue: '',
      outline: [], paragraphs: [],
    });
    const got = await getCachedParsed('fresh-key');
    expect(got).not.toBeNull();
    expect(got).not.toHaveProperty('version');
  });
});

describe('memory', () => {
  it('round-trips memory', async () => {
    await setMemory('k1', { whyItMatters: 'foo', role: '', judgment: '', linked: [], nextActions: [] });
    const got = await getMemory('k1');
    expect(got?.whyItMatters).toBe('foo');
  });

  it('returns null when absent', async () => {
    expect(await getMemory('missing')).toBeNull();
  });
});

describe('clearPaper', () => {
  it('removes all paper:{key}:* entries', async () => {
    // Cast to any: the plan's test uses a partial ParsedCache (missing title/authors/abstract).
    // The point of this test is clearPaper's key-prefix sweep, not cache shape validation.
    await setCachedParsed('k1', { outline: [], paragraphs: [] } as any);
    await setMemory('k1', { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] });
    await clearPaper('k1');
    expect(await getCachedParsed('k1')).toBeNull();
    expect(await getMemory('k1')).toBeNull();
  });
});

describe('highlights', () => {
  it('round-trips highlight array', async () => {
    const hs: Highlight[] = [
      { paragraphId: 'sec0-p0', text: 'foo', color: 'yellow' },
      { paragraphId: 'sec0-p1', text: 'bar', color: 'yellow' },
    ];
    await setHighlights('k1', hs);
    expect(await getHighlights('k1')).toEqual(hs);
  });

  it('returns empty array when absent', async () => {
    expect(await getHighlights('missing')).toEqual([]);
  });

  it('addHighlight appends and dedupes on paragraphId+text', async () => {
    await addHighlight('k1', { paragraphId: 'sec0-p0', text: 'foo', color: 'yellow' });
    await addHighlight('k1', { paragraphId: 'sec0-p1', text: 'bar', color: 'yellow' });
    // Duplicate (same paragraphId + text) — should not be added
    await addHighlight('k1', { paragraphId: 'sec0-p0', text: 'foo', color: 'yellow' });
    const got = await getHighlights('k1');
    expect(got).toHaveLength(2);
  });
});

describe('highlight write serialization', () => {
  it('two concurrent addHighlight calls both land without loss', async () => {
    const a = addHighlight('kc', { paragraphId: 'sec0-p0', text: 'A', color: 'yellow' });
    const b = addHighlight('kc', { paragraphId: 'sec0-p1', text: 'B', color: 'yellow' });
    await Promise.all([a, b]);
    const final = await getHighlights('kc');
    expect(final).toHaveLength(2);
    expect(final.map((h) => h.text).sort()).toEqual(['A', 'B']);
  });
});

describe('config', () => {
  it('getConfig returns null when no active multi-config row', async () => {
    expect(await getConfig()).toBeNull();
  });

  it('getConfig composes from Phase 12 multi-config (active row + apiKey map)', async () => {
    // Phase 17: v1.1 split keys (config_apikey + config_prefs) retired —
    // getConfig now exclusively reads via getActiveBYOKConfig() which composes
    // config_byok_configs + config_apikeys + config_active_byok_config_id.
    await setItem('config_byok_configs', [{
      id: 'cfg-1',
      user_id: '',
      name: 'Test',
      base_url: 'https://example.com/v1',
      model: 'm',
      is_active: true,
      created_at: '2026-05-04T00:00:00.000Z',
      updated_at: '2026-05-04T00:00:00.000Z',
    }]);
    await setItem('config_apikeys', { 'cfg-1': 'x' });
    await setItem('config_active_byok_config_id', 'cfg-1');
    await setItem('config_outputLanguage', 'zh-CN');
    expect(await getConfig()).toEqual({
      baseURL: 'https://example.com/v1',
      apiKey: 'x',
      model: 'm',
      outputLanguage: 'zh-CN',
    });
  });

  it('getConfig returns undefined outputLanguage when slot empty', async () => {
    await setItem('config_byok_configs', [{
      id: 'cfg-1',
      user_id: '',
      name: 'Test',
      base_url: 'https://example.com/v1',
      model: 'm',
      is_active: true,
      created_at: '2026-05-04T00:00:00.000Z',
      updated_at: '2026-05-04T00:00:00.000Z',
    }]);
    await setItem('config_apikeys', { 'cfg-1': 'x' });
    await setItem('config_active_byok_config_id', 'cfg-1');
    const got = await getConfig();
    expect(got?.outputLanguage).toBeUndefined();
  });
});

describe('notes', () => {
  const sample: MarginResult = {
    id: 'r-1', kind: 'explain', source: 's', body: 'b',
    paragraphId: 'sec0-p0', createdAt: 1000,
  };

  it('round-trips notes array', async () => {
    await setNotes('n1', [sample]);
    expect(await getNotes('n1')).toEqual([sample]);
  });

  it('returns empty array when absent', async () => {
    expect(await getNotes('missing')).toEqual([]);
  });

  it('addNote appends to the end', async () => {
    await addNote('n1', sample);
    await addNote('n1', { ...sample, id: 'r-2', body: 'b2' });
    const got = await getNotes('n1');
    expect(got.map((n) => n.id)).toEqual(['r-1', 'r-2']);
  });

  it('addNote serializes concurrent calls', async () => {
    const a = addNote('nc', { ...sample, id: 'r-a' });
    const b = addNote('nc', { ...sample, id: 'r-b' });
    await Promise.all([a, b]);
    const final = await getNotes('nc');
    expect(final).toHaveLength(2);
    expect(final.map((n) => n.id).sort()).toEqual(['r-a', 'r-b']);
  });
});

describe('chat', () => {
  const msg: ChatMessage = {
    id: 'u-1', role: 'user', text: 'hi', createdAt: 1000,
  };

  it('round-trips chat array', async () => {
    await setChat('c1', [msg]);
    expect(await getChat('c1')).toEqual([msg]);
  });

  it('returns empty array when absent', async () => {
    expect(await getChat('missing')).toEqual([]);
  });

  it('appendChatMessage adds to the end', async () => {
    await appendChatMessage('c1', msg);
    await appendChatMessage('c1', { ...msg, id: 'a-1', role: 'assistant', text: 'hello' });
    const got = await getChat('c1');
    expect(got.map((m) => m.id)).toEqual(['u-1', 'a-1']);
  });

  it('appendChatMessage serializes concurrent calls', async () => {
    const a = appendChatMessage('cc', { ...msg, id: 'u-a' });
    const b = appendChatMessage('cc', { ...msg, id: 'u-b' });
    await Promise.all([a, b]);
    const got = await getChat('cc');
    expect(got).toHaveLength(2);
    expect(got.map((m) => m.id).sort()).toEqual(['u-a', 'u-b']);
  });
});

describe('summary cache', () => {
  it('round-trips a summary section keyed by (paperKey, section, model)', async () => {
    await setSummarySection('p1', 'threeLine', 'gpt-4.1-mini', 'the 3-line summary');
    expect(await getSummarySection('p1', 'threeLine', 'gpt-4.1-mini')).toBe('the 3-line summary');
  });

  it('isolates by model — different models get different cached strings', async () => {
    await setSummarySection('p1', 'threeLine', 'gpt-4.1-mini', 'mini version');
    await setSummarySection('p1', 'threeLine', 'gpt-4o', '4o version');
    expect(await getSummarySection('p1', 'threeLine', 'gpt-4.1-mini')).toBe('mini version');
    expect(await getSummarySection('p1', 'threeLine', 'gpt-4o')).toBe('4o version');
  });

  it('isolates by section', async () => {
    await setSummarySection('p1', 'threeLine', 'm', '3-line');
    await setSummarySection('p1', 'keyTerms', 'm', 'terms');
    await setSummarySection('p1', 'detailed', 'm', 'detailed');
    expect(await getSummarySection('p1', 'threeLine', 'm')).toBe('3-line');
    expect(await getSummarySection('p1', 'keyTerms', 'm')).toBe('terms');
    expect(await getSummarySection('p1', 'detailed', 'm')).toBe('detailed');
  });

  it('returns null when section is absent', async () => {
    expect(await getSummarySection('missing', 'threeLine', 'm')).toBeNull();
  });

  it('clearSummarySection drops one model+section tuple without touching others', async () => {
    await setSummarySection('p1', 'threeLine', 'm1', 'a');
    await setSummarySection('p1', 'threeLine', 'm2', 'b');
    await clearSummarySection('p1', 'threeLine', 'm1');
    expect(await getSummarySection('p1', 'threeLine', 'm1')).toBeNull();
    expect(await getSummarySection('p1', 'threeLine', 'm2')).toBe('b');
  });
});

import { QuotaError, setQuotaHandler } from '../../reader/lib/storage';

describe('storage set — QuotaError + handler', () => {
  // Handler is module-level state; reset between tests so ordering doesn't matter.
  beforeEach(() => setQuotaHandler(null));

  it('throws QuotaError when chrome.storage.local.set rejects with a QUOTA message', async () => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.reject(new Error('QUOTA_BYTES quota exceeded')),
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
    let captured: unknown;
    try {
      const { setMemory } = await import('../../reader/lib/storage');
      await setMemory('pk-quota', { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(QuotaError);
    expect((captured as QuotaError).message).toContain('QUOTA_BYTES');
  });

  it('fires the registered handler on QuotaError', async () => {
    const calls: number[] = [];
    setQuotaHandler(() => calls.push(1));
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM exceeded')),
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
    const { setMemory } = await import('../../reader/lib/storage');
    try {
      await setMemory('pk-handler', { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] });
    } catch { /* expected */ }
    expect(calls).toEqual([1]);
  });

  it('passes non-quota errors through as the raw error (not QuotaError)', async () => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.reject(new Error('Unknown disk failure')),
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
    let captured: unknown;
    try {
      const { setMemory } = await import('../../reader/lib/storage');
      await setMemory('pk-other', { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] });
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeInstanceOf(QuotaError);
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('Unknown disk failure');
  });
});
