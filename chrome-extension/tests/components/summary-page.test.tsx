import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React 18 act() warns unless the test env opts in via this global flag.
// jsdom doesn't set it by default; setting it silences the "not configured
// to support act(...)" warnings without affecting assertion behavior.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { SummaryPage, __resetSummaryStreams__ } from '../../reader/components/summary-page';
import type { Paper } from '../../reader/types';
import { emptyMemory } from '../../reader/types';
import * as storage from '../../reader/lib/storage';
import * as ai from '../../reader/lib/ai';

function minimalPaper(): Paper {
  return {
    urlHash: 'abcdef012345',
    title: 'Test Paper',
    authors: ['A. Author'],
    abstract: 'Short abstract.',
    outline: [],
    paragraphs: [{ id: 'sec0-p0', sectionId: 's0', section: 'Intro', text: 'Body text.' }],
    memory: emptyMemory(),
  };
}

describe('SummaryPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.restoreAllMocks();
    __resetSummaryStreams__();  // isolate module-level stream registry between tests
    // SummaryPage now falls back to getItem('config_outputLanguage') which
    // touches chrome.storage.local — jsdom has no chrome global, so shim it
    // (matches the pattern in storage-schema.test.ts / byok-sync.test.ts).
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: (_k: unknown) => Promise.resolve({}),
          set: (_o: unknown) => Promise.resolve(),
          remove: (_k: unknown) => Promise.resolve(),
          clear: () => Promise.resolve(),
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
  });

  it('shows unauthenticated error when no API key and no session', async () => {
    vi.spyOn(storage, 'getConfig').mockResolvedValue(null);
    vi.spyOn(storage, 'getVariantSummary').mockResolvedValue(null);
    vi.spyOn(ai, 'callAI').mockRejectedValue(new ai.ProxyError('UNAUTHENTICATED', {}));

    await act(async () => { root.render(<SummaryPage paper={minimalPaper()} />); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });

    // After moving messages to i18n, the rendered string follows the active
    // locale (default 'en' under jsdom). Assert on text that's stable across
    // locales — every translation contains "API".
    expect(container.textContent).toMatch(/API/);
    expect(container.textContent).toMatch(/Summary failed|摘要生成失败/);
  });

  it('renders cached ready body without streaming when cache hits', async () => {
    vi.spyOn(storage, 'getConfig').mockResolvedValue({
      baseURL: 'https://x', apiKey: 'k', model: 'm', outputLanguage: 'auto',
    });
    vi.spyOn(storage, 'getVariantSummary').mockResolvedValue('# Cached summary\n\nbody');
    const spy = vi.spyOn(ai, 'callAI');

    await act(async () => { root.render(<SummaryPage paper={minimalPaper()} />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(container.textContent).toMatch(/Cached summary/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('streams when cache miss (via callAI router)', async () => {
    vi.spyOn(storage, 'getConfig').mockResolvedValue({
      baseURL: 'https://x', apiKey: 'k', model: 'm', outputLanguage: 'auto',
    });
    vi.spyOn(storage, 'getVariantSummary').mockResolvedValue(null);
    vi.spyOn(storage, 'setVariantSummary').mockResolvedValue(undefined);
    vi.spyOn(ai, 'callAI').mockImplementation(async (_m, _k, onChunk) => {
      onChunk('# Hello\n\n');
      onChunk('world.');
    });

    await act(async () => { root.render(<SummaryPage paper={minimalPaper()} />); });
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toMatch(/Hello/);
    expect(container.textContent).toMatch(/world/);
  });

  it('dispatches open-upgrade-prompt on QUOTA_EXCEEDED ProxyError', async () => {
    vi.spyOn(storage, 'getConfig').mockResolvedValue(null);
    vi.spyOn(storage, 'getVariantSummary').mockResolvedValue(null);
    vi.spyOn(ai, 'callAI').mockRejectedValue(
      new ai.ProxyError('QUOTA_EXCEEDED', { tier: 'free', used: 20, limit: 20, upgrade_url: 'x' }),
    );
    const listener = vi.fn();
    window.addEventListener('open-upgrade-prompt', listener);

    await act(async () => { root.render(<SummaryPage paper={minimalPaper()} />); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });

    expect(listener).toHaveBeenCalledTimes(1);
    const e = listener.mock.calls[0][0] as CustomEvent<{ trigger: string }>;
    expect(e.detail.trigger).toBe('trial');
    window.removeEventListener('open-upgrade-prompt', listener);
  });
});
