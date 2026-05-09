// chrome-extension/tests/byok-openai-compat-migration.test.ts
//
// Phase 16 Plan 16-01 Task 2 — boot-time migration unit coverage for
// migrateOpenAICompatV16(). 1:1 mirror of managed-models-migration.test.ts
// shape (chrome.storage.local in-memory shim) with Phase 16 specifics:
//   1. flag=done → early-exit, no writes
//   2. preset='openai' rewrite → preset='openai-compatible' (other fields preserved)
//   3. preset='openrouter' rewrite
//   4. preset='custom' rewrite
//   5. preset='local-litellm' NOT touched by THIS migration (handled by quick
//      task 260507's migrateLocalLitellmRemoval — disjoint id sets)
//   6. preset='openai-compatible' NOT touched (idempotent — second-boot scenario)
//   7. empty config_byok_configs → no write, sets flag=done
//   8. mixed rows: 3 rewrites + 2 preserves, migratedCount===3
//   9. row WITHOUT a top-level preset field is a no-op (cast `(r as any).preset`)
//  10. setItem throws → catch sets flag=done, helper does not propagate
//
// Helper signature: Promise<{ migratedCount: number }>; static OLD_IDS Set
// covers 'openai' | 'openrouter' | 'custom'; spread `{ ...r, preset: 'openai-compatible' }`
// preserves every other field (T-16-01-01 mitigation per threat register).

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// chrome.storage.local in-memory shim — verbatim from managed-models-migration.test.ts.
const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) return Promise.resolve({ ...storageMock });
          if (Array.isArray(k)) {
            const out: Record<string, unknown> = {};
            for (const key of k) if (key in storageMock) out[key] = storageMock[key];
            return Promise.resolve(out);
          }
          return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {});
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(storageMock, obj);
          return Promise.resolve();
        },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k];
          for (const key of keys) delete storageMock[key];
          return Promise.resolve();
        },
        clear: () => {
          for (const key of Object.keys(storageMock)) delete storageMock[key];
          return Promise.resolve();
        },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper — build a Phase 12 byok_configs row with a `preset` hint.
function rowWithPreset(id: string, name: string, preset: string): Record<string, unknown> {
  return {
    id,
    user_id: '',
    name,
    base_url: 'https://api.example.com/v1',
    model: 'gpt-4o',
    is_active: false,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
    preset,
  };
}

// Row WITHOUT preset field — Phase 12 default schema has no top-level preset column.
function rowWithoutPreset(id: string, name: string): Record<string, unknown> {
  return {
    id,
    user_id: '',
    name,
    base_url: 'https://api.example.com/v1',
    model: 'gpt-4o',
    is_active: false,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
  };
}

describe('migrateOpenAICompatV16', () => {
  // Test 1 — idempotent
  it('flag=done → early-exits without writes (D-D3)', async () => {
    storageMock['migrationState:openai-compat-v16'] = 'done';
    const before = [rowWithPreset('a-1', 'Old GPT', 'openai')];
    storageMock['config_byok_configs'] = before;

    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    const out = await migrateOpenAICompatV16();

    expect(out).toEqual({ migratedCount: 0 });
    // Pre-state untouched — preset NOT rewritten on second boot.
    expect(storageMock['config_byok_configs']).toEqual(before);
    expect(storageMock['migrationState:openai-compat-v16']).toBe('done');
  });

  // Test 2 — preset='openai' rewrite, all other fields preserved (T-16-01-01)
  it('rewrites preset=openai → preset=openai-compatible, all other fields preserved (T-16-01-01)', async () => {
    const original = {
      id: 'a-1',
      user_id: '',
      name: 'My GPT-4o',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      is_active: true,
      created_at: '2026-04-24T00:00:00Z',
      updated_at: '2026-04-24T00:00:00Z',
      preset: 'openai',
    };
    storageMock['config_byok_configs'] = [original];

    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    const out = await migrateOpenAICompatV16();

    expect(out.migratedCount).toBe(1);
    const after = (storageMock['config_byok_configs'] as any[])[0];
    expect(after.preset).toBe('openai-compatible');
    // Every other field byte-identical (T-16-01-06 row-shape invariant).
    expect(after.id).toBe('a-1');
    expect(after.name).toBe('My GPT-4o');
    expect(after.base_url).toBe('https://api.openai.com/v1');
    expect(after.model).toBe('gpt-4o');
    expect(after.is_active).toBe(true);
    expect(after.created_at).toBe('2026-04-24T00:00:00Z');
    expect(after.updated_at).toBe('2026-04-24T00:00:00Z');
    expect(storageMock['migrationState:openai-compat-v16']).toBe('done');
  });

  // Test 3 — preset='openrouter' rewrite
  it('rewrites preset=openrouter → preset=openai-compatible', async () => {
    storageMock['config_byok_configs'] = [rowWithPreset('r-1', 'My OR', 'openrouter')];

    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    const out = await migrateOpenAICompatV16();

    expect(out.migratedCount).toBe(1);
    expect((storageMock['config_byok_configs'] as any[])[0].preset).toBe('openai-compatible');
    expect((storageMock['config_byok_configs'] as any[])[0].name).toBe('My OR');
  });

  // Test 4 — preset='custom' rewrite
  it('rewrites preset=custom → preset=openai-compatible', async () => {
    storageMock['config_byok_configs'] = [rowWithPreset('c-1', 'My Custom', 'custom')];

    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    const out = await migrateOpenAICompatV16();

    expect(out.migratedCount).toBe(1);
    expect((storageMock['config_byok_configs'] as any[])[0].preset).toBe('openai-compatible');
    expect((storageMock['config_byok_configs'] as any[])[0].name).toBe('My Custom');
  });

  // Test 5 — preset='local-litellm' NOT touched by THIS migration (disjoint id
  // set — quick task 260507's migrateLocalLitellmRemoval owns the local-litellm
  // → openai-compatible rewrite). The original Phase 16 D-A3 invariant
  // ("preserves local-litellm") is now an explicit contract between the two
  // migrations rather than a permanent invariant.
  it('does NOT touch preset=local-litellm rows (handed off to migrateLocalLitellmRemoval)', async () => {
    const local = rowWithPreset('l-1', 'My Local', 'local-litellm');
    storageMock['config_byok_configs'] = [local];

    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    const out = await migrateOpenAICompatV16();

    expect(out.migratedCount).toBe(0);
    expect((storageMock['config_byok_configs'] as any[])[0].preset).toBe('local-litellm');
    expect(storageMock['migrationState:openai-compat-v16']).toBe('done');
  });

  // Test 6 — preset='openai-compatible' NOT touched (already-migrated, second boot)
  it('does NOT touch preset=openai-compatible rows (idempotent on second boot)', async () => {
    const already = rowWithPreset('o-1', 'Already Migrated', 'openai-compatible');
    storageMock['config_byok_configs'] = [already];

    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    const out = await migrateOpenAICompatV16();

    expect(out.migratedCount).toBe(0);
    expect((storageMock['config_byok_configs'] as any[])[0].preset).toBe('openai-compatible');
  });

  // Test 7 — empty config_byok_configs → no write, sets flag=done
  it('empty config_byok_configs → no write, sets flag=done', async () => {
    // Note: we deliberately DO NOT seed config_byok_configs at all.
    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    const out = await migrateOpenAICompatV16();

    expect(out.migratedCount).toBe(0);
    expect(storageMock['migrationState:openai-compat-v16']).toBe('done');
    // The helper must not have created an empty config_byok_configs key.
    expect('config_byok_configs' in storageMock).toBe(false);
  });

  // Test 8 — mixed rows: 3 rewrites, 2 preserves, migratedCount===3
  it('mixed rows: openai+openrouter+custom rewritten; local-litellm + openai-compatible preserved (T-16-01-06)', async () => {
    const r1 = rowWithPreset('a', 'A', 'openai');
    const r2 = rowWithPreset('b', 'B', 'openrouter');
    const r3 = rowWithPreset('c', 'C', 'custom');
    const r4 = rowWithPreset('d', 'D', 'local-litellm');
    const r5 = rowWithPreset('e', 'E', 'openai-compatible');
    storageMock['config_byok_configs'] = [r1, r2, r3, r4, r5];

    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    const out = await migrateOpenAICompatV16();

    expect(out.migratedCount).toBe(3);
    const rows = storageMock['config_byok_configs'] as any[];
    expect(rows[0].preset).toBe('openai-compatible');
    expect(rows[1].preset).toBe('openai-compatible');
    expect(rows[2].preset).toBe('openai-compatible');
    expect(rows[3].preset).toBe('local-litellm');
    expect(rows[4].preset).toBe('openai-compatible');
    // Row count and identity preserved.
    expect(rows.length).toBe(5);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  // Test 9 — row WITHOUT top-level preset field is a no-op (Phase 12 default schema)
  it('row without preset field is a no-op — does NOT throw, does NOT add preset (Phase 12 schema)', async () => {
    const noPresetRow = rowWithoutPreset('np-1', 'No Preset');
    storageMock['config_byok_configs'] = [noPresetRow];

    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    const out = await migrateOpenAICompatV16();

    expect(out.migratedCount).toBe(0);
    const after = (storageMock['config_byok_configs'] as any[])[0];
    expect(after.id).toBe('np-1');
    expect(after.name).toBe('No Preset');
    // No spurious preset field invented.
    expect('preset' in after).toBe(false);
    expect(storageMock['migrationState:openai-compat-v16']).toBe('done');
  });

  // Test 10 — catch path: setItem throws → flag=done set in catch block
  it('catch block sets flag=done even when an inner setItem throws (T-16-01-02 non-blocking)', async () => {
    storageMock['config_byok_configs'] = [rowWithPreset('a-1', 'A', 'openai')];

    // Make the FIRST chrome.storage.local.set call throw to force the catch
    // path. The helper writes flag='in-progress' first, then the row payload.
    // We arrange a counter so only the row write throws — the in-progress
    // and the catch's flag='done' both succeed.
    let callIndex = 0;
    (globalThis as any).chrome.storage.local.set = (obj: Record<string, unknown>) => {
      callIndex += 1;
      if (callIndex === 2) {
        // The 2nd write is the rewritten config_byok_configs payload — throw to
        // simulate disk write failure mid-migration.
        return Promise.reject(new Error('disk-full simulated'));
      }
      Object.assign(storageMock, obj);
      return Promise.resolve();
    };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { migrateOpenAICompatV16 } = await import('../reader/lib/byok-configs');
    // Helper must NOT propagate the error (D-D1 non-blocking guarantee).
    const out = await migrateOpenAICompatV16();

    expect(out).toEqual({ migratedCount: 0 });
    // Catch block must still mark flag=done so user is not stuck on next boot.
    expect(storageMock['migrationState:openai-compat-v16']).toBe('done');
    expect(warn).toHaveBeenCalled();
  });
});
