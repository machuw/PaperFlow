// chrome-extension/tests/byok-presets.test.ts
//
// Quick task 260507 hard cutover: 1-preset registry — local-litellm
// removed (claude-code-openai-wrapper BYOK path retired). The only
// remaining preset is openai-compatible; applyPreset rejects retired
// ids via the existing 'unknown BYOK preset' throw path. NIT-3
// fill-empty-only semantics retained.
//
// Phase 16 lineage: openai/openrouter/custom were collapsed to
// openai-compatible by D-A1. Quick task 260507 finishes the cleanup
// by removing the last non-openai-compatible preset.

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('BYOK_PRESETS', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('contains exactly 1 entry — openai-compatible (quick task 260507: local-litellm removed)', async () => {
    const { BYOK_PRESETS } = await import('../reader/lib/byok-presets');
    expect(BYOK_PRESETS.map((p) => p.id)).toEqual(['openai-compatible']);
  });

  it('does NOT contain local-litellm (quick task 260507 hard cutover)', async () => {
    const { BYOK_PRESETS } = await import('../reader/lib/byok-presets');
    expect(BYOK_PRESETS.find((x) => x.id === ('local-litellm' as never))).toBeUndefined();
  });

  it('does NOT contain old openai/openrouter/custom ids (Phase 16 D-A1 hard cutover)', async () => {
    const { BYOK_PRESETS } = await import('../reader/lib/byok-presets');
    for (const oldId of ['openai', 'openrouter', 'custom'] as const) {
      expect(BYOK_PRESETS.find((x) => x.id === (oldId as never))).toBeUndefined();
    }
  });

  it('does NOT contain anthropic-via-proxy (Phase 15 D-F4 hard cutover — invariant preserved)', async () => {
    const { BYOK_PRESETS } = await import('../reader/lib/byok-presets');
    expect(BYOK_PRESETS.find((x) => x.id === ('anthropic-via-proxy' as never))).toBeUndefined();
  });

  it('each preset has required shape', async () => {
    const { BYOK_PRESETS } = await import('../reader/lib/byok-presets');
    for (const p of BYOK_PRESETS) {
      expect(p).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        defaultBaseURL: expect.any(String),
        defaultModel: expect.any(String),
        apiKeyPlaceholder: expect.any(String),
        helpText: expect.any(String),
      });
    }
  });

  it('openai-compatible has empty defaults (Phase 16 D-B3 — user fills via template chip or hand)', async () => {
    const { BYOK_PRESETS } = await import('../reader/lib/byok-presets');
    const p = BYOK_PRESETS.find((x) => x.id === 'openai-compatible')!;
    expect(p.defaultBaseURL).toBe('');
    expect(p.defaultModel).toBe('');
    expect(p.apiKeyPlaceholder).toBe('');
  });
});

describe('applyPreset', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('preserves user-edited fields (no overwrite) under openai-compatible', async () => {
    const { applyPreset } = await import('../reader/lib/byok-presets');
    const current = { baseURL: 'https://my.custom.url', model: 'my-model', apiKey: 'sk-xxx' };
    expect(applyPreset('openai-compatible', current)).toEqual(current);
  });

  it('openai-compatible no-op when current values empty (Phase 16 D-B3 — no defaults to fill)', async () => {
    // openai-compatible defaults are all empty strings; applyPreset's
    // fill-empty-only semantics means an empty current stays empty.
    const { applyPreset } = await import('../reader/lib/byok-presets');
    expect(applyPreset('openai-compatible', { baseURL: '', model: '', apiKey: '' })).toEqual({
      baseURL: '',
      model: '',
      apiKey: '',
    });
  });

  it('openai-compatible preserves user-edited values (NIT-3 invariant carried forward)', async () => {
    const { applyPreset } = await import('../reader/lib/byok-presets');
    expect(
      applyPreset('openai-compatible', {
        baseURL: 'https://x.com',
        model: 'm',
        apiKey: 'sk',
      }),
    ).toEqual({
      baseURL: 'https://x.com',
      model: 'm',
      apiKey: 'sk',
    });
  });

  it('throws on retired local-litellm preset id (quick task 260507 hard cutover)', async () => {
    const { applyPreset } = await import('../reader/lib/byok-presets');
    expect(() =>
      applyPreset('local-litellm' as never, { baseURL: '', model: '', apiKey: '' }),
    ).toThrow('unknown BYOK preset: local-litellm');
  });

  it('throws on retired openai/openrouter/custom preset ids (Phase 16 D-A2 hard cutover)', async () => {
    const { applyPreset } = await import('../reader/lib/byok-presets');
    for (const oldId of ['openai', 'openrouter', 'custom'] as const) {
      expect(() =>
        applyPreset(oldId as never, { baseURL: '', model: '', apiKey: '' }),
      ).toThrow(/unknown BYOK preset/);
    }
  });

  it('throws on retired anthropic-via-proxy preset id (Phase 15 D-F3 invariant preserved)', async () => {
    const { applyPreset } = await import('../reader/lib/byok-presets');
    expect(() =>
      applyPreset('anthropic-via-proxy' as never, { baseURL: '', model: '', apiKey: '' }),
    ).toThrow('unknown BYOK preset: anthropic-via-proxy');
  });

  it('throws on unknown preset id', async () => {
    const { applyPreset } = await import('../reader/lib/byok-presets');
    expect(() =>
      applyPreset('nonexistent' as never, { baseURL: '', model: '', apiKey: '' }),
    ).toThrow();
  });
});
