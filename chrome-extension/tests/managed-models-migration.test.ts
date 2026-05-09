// Phase 15 Plan 15-03 Task 1 — boot-time migration unit coverage.
// Mirrors the chrome.storage.local mock pattern from byok-migration.test.ts:47-74.
// Covers Tests 1-7 in plan <behavior> for migrateAnthropicViaProxyToManaged:
//   1. idempotent (flag='done' → no-op)
//   2. Pro user → set config_active_managed_model_id='claude-haiku-4-5-20251001'
//   3. Free user → set ''
//   4. no anthropic-via-proxy row present (Pro vs Free)
//   5. cross-tab race (config_active_managed_model_id already set)
//   6. preserves non-matching entries
//   7. logged-out user

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock supabase: tier read + auth.getSession are configured per-test via the
// `subTier` and `loggedIn` mutable references below.
const mockState = {
  loggedIn: true as boolean,
  userId: 'user-1' as string,
  tier: 'free' as 'free' | 'sync' | 'pro',
};

vi.mock('../reader/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({
        data: {
          session: mockState.loggedIn
            ? { user: { id: mockState.userId } }
            : null,
        },
      }),
    },
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: () => Promise.resolve({ data: { tier: mockState.tier }, error: null }),
        }),
      }),
    }),
  },
}));

// chrome.storage.local in-memory shim — verbatim from byok-migration.test.ts.
const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  // Reset mock state defaults each test.
  mockState.loggedIn = true;
  mockState.userId = 'user-1';
  mockState.tier = 'free';
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
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve(); },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k];
          for (const key of keys) delete storageMock[key];
          return Promise.resolve();
        },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve(); },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper — build an anthropic-via-proxy-shaped config_byok_configs row.
function aviaRow(id: string): Record<string, unknown> {
  return {
    id,
    user_id: '',
    name: 'Anthropic (via PaperFlow proxy)',
    base_url: 'https://example.supabase.co/functions/v1/ai-proxy',
    model: 'claude-sonnet-4-5',
    is_active: false,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
  };
}

function plainRow(id: string, name: string, base_url: string): Record<string, unknown> {
  return {
    id,
    user_id: '',
    name,
    base_url,
    model: 'gpt-4o-mini',
    is_active: false,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
  };
}

describe('migrateAnthropicViaProxyToManaged', () => {
  // Test 1 — idempotent
  it('flag=done → early-exits without writes', async () => {
    storageMock['migrationState:managed-models-v13'] = 'done';
    storageMock['config_byok_configs'] = [aviaRow('a-1')];
    storageMock['config_apikeys'] = { 'a-1': 'sk-x' };

    const { migrateAnthropicViaProxyToManaged } = await import('../reader/lib/managed-models');
    const out = await migrateAnthropicViaProxyToManaged();

    expect(out).toEqual({ migratedRow: false, setActiveModel: false });
    // Pre-state untouched.
    expect(storageMock['config_byok_configs']).toEqual([aviaRow('a-1')]);
    expect(storageMock['config_apikeys']).toEqual({ 'a-1': 'sk-x' });
    expect(storageMock['migrationState:managed-models-v13']).toBe('done');
  });

  // Test 2 — Pro user with anthropic-via-proxy row
  it('Pro user: removes anthropic-via-proxy row + sets active managed = claude-haiku-4-5-20251001', async () => {
    mockState.tier = 'pro';
    storageMock['config_byok_configs'] = [aviaRow('a-1')];
    storageMock['config_apikeys'] = { 'a-1': 'sk-x' };

    const { migrateAnthropicViaProxyToManaged } = await import('../reader/lib/managed-models');
    const out = await migrateAnthropicViaProxyToManaged();

    expect(out.migratedRow).toBe(true);
    expect(out.setActiveModel).toBe(true);
    expect(storageMock['config_byok_configs']).toEqual([]);
    expect(storageMock['config_apikeys']).toEqual({});
    expect(storageMock['config_active_managed_model_id']).toBe('claude-haiku-4-5-20251001');
    expect(storageMock['migrationState:managed-models-v13']).toBe('done');
  });

  // Test 3 — Free user
  it('Free user: removes row + clears active managed (sets empty string)', async () => {
    mockState.tier = 'free';
    storageMock['config_byok_configs'] = [aviaRow('a-1')];
    storageMock['config_apikeys'] = { 'a-1': 'sk-x' };

    const { migrateAnthropicViaProxyToManaged } = await import('../reader/lib/managed-models');
    const out = await migrateAnthropicViaProxyToManaged();

    expect(out.migratedRow).toBe(true);
    expect(out.setActiveModel).toBe(false);
    expect(storageMock['config_byok_configs']).toEqual([]);
    expect(storageMock['config_apikeys']).toEqual({});
    expect(storageMock['config_active_managed_model_id']).toBe('');
    expect(storageMock['migrationState:managed-models-v13']).toBe('done');
  });

  // Test 4 — no anthropic-via-proxy row present (Pro)
  it('no anthropic row + Pro: no removals, sets active managed=claude-haiku-4-5-20251001', async () => {
    mockState.tier = 'pro';
    const openai = plainRow('o-1', 'OpenAI', 'https://api.openai.com/v1');
    const custom = plainRow('c-1', 'My Local', 'https://localhost:8080/v1');
    storageMock['config_byok_configs'] = [openai, custom];
    storageMock['config_apikeys'] = { 'o-1': 'sk-o', 'c-1': 'sk-c' };

    const { migrateAnthropicViaProxyToManaged } = await import('../reader/lib/managed-models');
    const out = await migrateAnthropicViaProxyToManaged();

    expect(out.migratedRow).toBe(false);
    expect(out.setActiveModel).toBe(true);
    expect(storageMock['config_byok_configs']).toEqual([openai, custom]);
    expect(storageMock['config_apikeys']).toEqual({ 'o-1': 'sk-o', 'c-1': 'sk-c' });
    expect(storageMock['config_active_managed_model_id']).toBe('claude-haiku-4-5-20251001');
    expect(storageMock['migrationState:managed-models-v13']).toBe('done');
  });

  // Test 4b — no anthropic-via-proxy row present (Free)
  it('no anthropic row + Free: no removals, sets active managed=""', async () => {
    mockState.tier = 'free';
    storageMock['config_byok_configs'] = [plainRow('o-1', 'OpenAI', 'https://api.openai.com/v1')];
    storageMock['config_apikeys'] = { 'o-1': 'sk-o' };

    const { migrateAnthropicViaProxyToManaged } = await import('../reader/lib/managed-models');
    const out = await migrateAnthropicViaProxyToManaged();

    expect(out.migratedRow).toBe(false);
    expect(out.setActiveModel).toBe(false);
    expect(storageMock['config_active_managed_model_id']).toBe('');
    expect(storageMock['migrationState:managed-models-v13']).toBe('done');
  });

  // Test 5 — cross-tab race
  it('cross-tab race: config_active_managed_model_id already populated → no overwrite', async () => {
    mockState.tier = 'pro';
    storageMock['config_active_managed_model_id'] = 'claude-haiku-4-5-20251001';

    const { migrateAnthropicViaProxyToManaged } = await import('../reader/lib/managed-models');
    const out = await migrateAnthropicViaProxyToManaged();

    expect(out.setActiveModel).toBe(false);
    expect(storageMock['config_active_managed_model_id']).toBe('claude-haiku-4-5-20251001');
    expect(storageMock['migrationState:managed-models-v13']).toBe('done');
  });

  // Test 6 — preserves non-matching entries (T-15-03-T4)
  it('preserves non-matching entries (openai/openrouter/custom)', async () => {
    mockState.tier = 'pro';
    const openai = plainRow('o-1', 'OpenAI', 'https://api.openai.com/v1');
    const avia = aviaRow('a-1');
    const openrouter = plainRow('r-1', 'OpenRouter', 'https://openrouter.ai/api/v1');
    const custom = plainRow('c-1', 'My Custom', 'https://my.example.com/v1');
    storageMock['config_byok_configs'] = [openai, avia, openrouter, custom];
    storageMock['config_apikeys'] = {
      'o-1': 'sk-o',
      'a-1': 'sk-a',
      'r-1': 'sk-r',
      'c-1': 'sk-c',
    };

    const { migrateAnthropicViaProxyToManaged } = await import('../reader/lib/managed-models');
    const out = await migrateAnthropicViaProxyToManaged();

    expect(out.migratedRow).toBe(true);
    // openai / openrouter / custom rows untouched (a-1 dropped).
    expect(storageMock['config_byok_configs']).toEqual([openai, openrouter, custom]);
    expect(storageMock['config_apikeys']).toEqual({
      'o-1': 'sk-o',
      'r-1': 'sk-r',
      'c-1': 'sk-c',
    });
    expect(storageMock['config_active_managed_model_id']).toBe('claude-haiku-4-5-20251001');
  });

  // Test 7 — logged-out user
  it('logged-out user: completes without throwing; sets active managed=""', async () => {
    mockState.loggedIn = false;
    storageMock['config_byok_configs'] = [aviaRow('a-1')];
    storageMock['config_apikeys'] = { 'a-1': 'sk-x' };

    const { migrateAnthropicViaProxyToManaged } = await import('../reader/lib/managed-models');
    const out = await migrateAnthropicViaProxyToManaged();

    // Anthropic row still removed (the local cleanup happens regardless of session).
    expect(out.migratedRow).toBe(true);
    expect(out.setActiveModel).toBe(false);
    expect(storageMock['config_active_managed_model_id']).toBe('');
    expect(storageMock['migrationState:managed-models-v13']).toBe('done');
  });

  // Bonus — active BYOK config that was anthropic-via-proxy is cleared on migration.
  it('clears config_active_byok_config_id when active BYOK was the removed row', async () => {
    mockState.tier = 'pro';
    storageMock['config_byok_configs'] = [aviaRow('a-1')];
    storageMock['config_apikeys'] = { 'a-1': 'sk-x' };
    storageMock['config_active_byok_config_id'] = 'a-1';

    const { migrateAnthropicViaProxyToManaged } = await import('../reader/lib/managed-models');
    await migrateAnthropicViaProxyToManaged();

    expect(storageMock['config_active_byok_config_id']).toBeNull();
  });
});
