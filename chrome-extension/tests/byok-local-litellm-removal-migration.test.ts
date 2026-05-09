// chrome-extension/tests/byok-local-litellm-removal-migration.test.ts
//
// Quick task 260507 — boot-time migration unit coverage for
// migrateLocalLitellmRemoval(). 1:1 mirror of byok-openai-compat-migration.test.ts
// shape (chrome.storage.local in-memory shim) with Phase 25-supersession specifics:
//   1. flag=done → early-exit, no writes
//   2. preset='local-litellm' rewrite → preset='openai-compatible' (other fields preserved)
//   3. preset='openai-compatible' NOT touched (idempotent — second-boot scenario)
//   4. preset='openai' / 'openrouter' / 'custom' NOT touched (handed off to
//      migrateOpenAICompatV16 — disjoint id sets)
//   5. empty config_byok_configs → no write, sets flag=done
//   6. mixed rows: only local-litellm row rewritten, others preserved
//   7. row WITHOUT a top-level preset field is a no-op
//   8. setItem throws → catch sets flag=done, helper does not propagate
//
// Helper signature: Promise<{ migratedCount: number }>; spread
// `{ ...r, preset: 'openai-compatible' }` preserves every other field
// (T-260507-01 mirrored from Phase 16 T-16-01-01 mitigation).

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// chrome.storage.local in-memory shim — verbatim from byok-openai-compat-migration.test.ts.
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
    base_url: 'http://localhost:8000/v1',
    model: 'claude-sonnet-4-5-20250929',
    is_active: false,
    created_at: '2026-04-29T00:00:00Z',
    updated_at: '2026-04-29T00:00:00Z',
    preset,
  };
}

// Row WITHOUT preset field — Phase 12 default schema has no top-level preset column.
function rowWithoutPreset(id: string, name: string): Record<string, unknown> {
  return {
    id,
    user_id: '',
    name,
    base_url: 'http://localhost:8000/v1',
    model: 'claude-sonnet-4-5-20250929',
    is_active: false,
    created_at: '2026-04-29T00:00:00Z',
    updated_at: '2026-04-29T00:00:00Z',
  };
}

describe('migrateLocalLitellmRemoval', () => {
  // Test 1 — idempotent
  it('flag=done → early-exits without writes', async () => {
    storageMock['migrationState:byok-local-litellm-removal'] = 'done';
    const before = [rowWithPreset('l-1', 'Old wrapper', 'local-litellm')];
    storageMock['config_byok_configs'] = before;

    const { migrateLocalLitellmRemoval } = await import('../reader/lib/byok-configs');
    const out = await migrateLocalLitellmRemoval();

    expect(out).toEqual({ migratedCount: 0 });
    // Pre-state untouched — preset NOT rewritten on second boot.
    expect(storageMock['config_byok_configs']).toEqual(before);
    expect(storageMock['migrationState:byok-local-litellm-removal']).toBe('done');
  });

  // Test 2 — preset='local-litellm' rewrite, all other fields preserved
  it('rewrites preset=local-litellm → preset=openai-compatible, all other fields preserved', async () => {
    const original = {
      id: 'l-1',
      user_id: '',
      name: 'My Local Claude',
      base_url: 'http://localhost:8000/v1',
      model: 'claude-sonnet-4-5-20250929',
      is_active: true,
      created_at: '2026-04-29T00:00:00Z',
      updated_at: '2026-04-29T00:00:00Z',
      preset: 'local-litellm',
    };
    storageMock['config_byok_configs'] = [original];

    const { migrateLocalLitellmRemoval } = await import('../reader/lib/byok-configs');
    const out = await migrateLocalLitellmRemoval();

    expect(out.migratedCount).toBe(1);
    const after = (storageMock['config_byok_configs'] as any[])[0];
    expect(after.preset).toBe('openai-compatible');
    // Every other field byte-identical — wrapper config still works.
    expect(after.id).toBe('l-1');
    expect(after.name).toBe('My Local Claude');
    expect(after.base_url).toBe('http://localhost:8000/v1');
    expect(after.model).toBe('claude-sonnet-4-5-20250929');
    expect(after.is_active).toBe(true);
    expect(after.created_at).toBe('2026-04-29T00:00:00Z');
    expect(after.updated_at).toBe('2026-04-29T00:00:00Z');
    expect(storageMock['migrationState:byok-local-litellm-removal']).toBe('done');
  });

  // Test 3 — preset='openai-compatible' NOT touched (idempotent on second boot)
  it('does NOT touch preset=openai-compatible rows (idempotent)', async () => {
    const already = rowWithPreset('o-1', 'Already Migrated', 'openai-compatible');
    storageMock['config_byok_configs'] = [already];

    const { migrateLocalLitellmRemoval } = await import('../reader/lib/byok-configs');
    const out = await migrateLocalLitellmRemoval();

    expect(out.migratedCount).toBe(0);
    expect((storageMock['config_byok_configs'] as any[])[0].preset).toBe('openai-compatible');
  });

  // Test 4 — preset='openai' / 'openrouter' / 'custom' NOT touched (Phase 16 disjoint set)
  it('does NOT touch preset=openai/openrouter/custom rows (disjoint with migrateOpenAICompatV16)', async () => {
    storageMock['config_byok_configs'] = [
      rowWithPreset('a', 'A', 'openai'),
      rowWithPreset('b', 'B', 'openrouter'),
      rowWithPreset('c', 'C', 'custom'),
    ];

    const { migrateLocalLitellmRemoval } = await import('../reader/lib/byok-configs');
    const out = await migrateLocalLitellmRemoval();

    expect(out.migratedCount).toBe(0);
    const rows = storageMock['config_byok_configs'] as any[];
    expect(rows[0].preset).toBe('openai');
    expect(rows[1].preset).toBe('openrouter');
    expect(rows[2].preset).toBe('custom');
  });

  // Test 5 — empty config_byok_configs → no write, sets flag=done
  it('empty config_byok_configs → no write, sets flag=done', async () => {
    const { migrateLocalLitellmRemoval } = await import('../reader/lib/byok-configs');
    const out = await migrateLocalLitellmRemoval();

    expect(out.migratedCount).toBe(0);
    expect(storageMock['migrationState:byok-local-litellm-removal']).toBe('done');
    // The helper must not have created an empty config_byok_configs key.
    expect('config_byok_configs' in storageMock).toBe(false);
  });

  // Test 6 — mixed rows: only local-litellm rewritten
  it('mixed rows: only local-litellm rewritten; others preserved', async () => {
    const r1 = rowWithPreset('a', 'A', 'openai');
    const r2 = rowWithPreset('b', 'B', 'local-litellm');
    const r3 = rowWithPreset('c', 'C', 'openai-compatible');
    const r4 = rowWithPreset('d', 'D', 'custom');
    storageMock['config_byok_configs'] = [r1, r2, r3, r4];

    const { migrateLocalLitellmRemoval } = await import('../reader/lib/byok-configs');
    const out = await migrateLocalLitellmRemoval();

    expect(out.migratedCount).toBe(1);
    const rows = storageMock['config_byok_configs'] as any[];
    expect(rows[0].preset).toBe('openai');
    expect(rows[1].preset).toBe('openai-compatible'); // rewritten
    expect(rows[2].preset).toBe('openai-compatible');
    expect(rows[3].preset).toBe('custom');
    // Row count and identity preserved.
    expect(rows.length).toBe(4);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D']);
  });

  // Test 7 — row WITHOUT top-level preset field is a no-op (Phase 12 default schema)
  it('row without preset field is a no-op — does NOT throw, does NOT add preset', async () => {
    const noPresetRow = rowWithoutPreset('np-1', 'No Preset');
    storageMock['config_byok_configs'] = [noPresetRow];

    const { migrateLocalLitellmRemoval } = await import('../reader/lib/byok-configs');
    const out = await migrateLocalLitellmRemoval();

    expect(out.migratedCount).toBe(0);
    const after = (storageMock['config_byok_configs'] as any[])[0];
    expect(after.id).toBe('np-1');
    expect(after.name).toBe('No Preset');
    // No spurious preset field invented.
    expect('preset' in after).toBe(false);
    expect(storageMock['migrationState:byok-local-litellm-removal']).toBe('done');
  });

  // Test 8 — catch path: setItem throws → flag=done set in catch block
  it('catch block sets flag=done even when an inner setItem throws (non-blocking)', async () => {
    storageMock['config_byok_configs'] = [rowWithPreset('l-1', 'L', 'local-litellm')];

    // Make the FIRST chrome.storage.local.set call throw to force the catch
    // path. The helper writes flag='in-progress' first, then the row payload.
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

    const { migrateLocalLitellmRemoval } = await import('../reader/lib/byok-configs');
    // Helper must NOT propagate the error.
    const out = await migrateLocalLitellmRemoval();

    expect(out).toEqual({ migratedCount: 0 });
    // Catch block must still mark flag=done so user is not stuck on next boot.
    expect(storageMock['migrationState:byok-local-litellm-removal']).toBe('done');
    expect(warn).toHaveBeenCalled();
  });
});
