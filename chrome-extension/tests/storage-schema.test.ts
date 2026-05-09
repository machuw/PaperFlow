import { describe, it, expect, beforeEach } from 'vitest';
import { getItem, setItem, removeItem } from '../reader/lib/storage-schema';
import type { LibraryCatalogEntry } from '../reader/types';

const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string) => Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {}),
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve(); },
        remove: (k: string) => { delete storageMock[k]; return Promise.resolve(); },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve(); },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

describe('storage-schema', () => {
  beforeEach(async () => {
    // chrome.storage mock is globally set up in existing test setup;
    // clear between tests to avoid bleed-through.
    await chrome.storage.local.clear();
  });

  it('getItem returns null for unset key', async () => {
    const v = await getItem('churnModalSeen');
    expect(v).toBeNull();
  });

  it('round-trip primitive', async () => {
    await setItem('migrationState', 'in-progress');
    const v = await getItem('migrationState');
    expect(v).toBe('in-progress');
  });

  it('round-trip object', async () => {
    // Phase 17: config_prefs retired; round-trip via config_apikeys (still-extant
    // typed object key) to verify the same getItem/setItem path.
    await setItem('config_apikeys', { 'cfg-id-1': 'sk-x', 'cfg-id-2': 'sk-y' });
    const v = await getItem('config_apikeys');
    expect(v).toEqual({ 'cfg-id-1': 'sk-x', 'cfg-id-2': 'sk-y' });
  });

  it('round-trip array', async () => {
    const q = [{ table: 'highlights', op: 'upsert' as const, row: { id: 'h1' }, ts: 1 }];
    await setItem('sync:queue', q);
    const v = await getItem('sync:queue');
    expect(v).toEqual(q);
  });

  it('removeItem clears the value', async () => {
    await setItem('libraryCapBannerDismissed', 12345);
    await removeItem('libraryCapBannerDismissed');
    const v = await getItem('libraryCapBannerDismissed');
    expect(v).toBeNull();
  });
});

describe('Phase 15 typed keys', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it('round-trips config_active_managed_model_id', async () => {
    await setItem('config_active_managed_model_id', 'claude-haiku-4-5-20251001');
    expect(await getItem('config_active_managed_model_id')).toBe('claude-haiku-4-5-20251001');
    await setItem('config_active_managed_model_id', '');
    expect(await getItem('config_active_managed_model_id')).toBe('');
  });

  it('round-trips managedModelsCache shape', async () => {
    const entry = {
      ts: 1234567890,
      models: [{
        id: 'claude-haiku-4-5-20251001',
        display_name: 'claude-4.5-haiku',
        min_tier: 'pro' as const,
        locked: false,
        provider: 'newapi',
        upstream_model: 'claude-haiku-4-5-20251001',
      }],
    };
    await setItem('managedModelsCache', entry);
    expect(await getItem('managedModelsCache')).toEqual(entry);
  });

  it('round-trips migrationState:managed-models-v13', async () => {
    await setItem('migrationState:managed-models-v13', 'done');
    expect(await getItem('migrationState:managed-models-v13')).toBe('done');
  });

  it('round-trips migrationState:managed-models-v13-toast-shown', async () => {
    await setItem('migrationState:managed-models-v13-toast-shown', 'done');
    expect(await getItem('migrationState:managed-models-v13-toast-shown')).toBe('done');
  });
});

describe('Library v2 storage keys', () => {
  it('LIBRARIES_KEY round-trips a catalog list', async () => {
    const cat: LibraryCatalogEntry[] = [{ id: 'a', name: 'Q4', createdAt: 1 }];
    await setItem('pf:libraries', cat);
    const got = await getItem('pf:libraries');
    expect(got).toEqual(cat);
  });
  it('LIBRARY_INTRO_SEEN_KEY round-trips boolean', async () => {
    await setItem('pf:librariesIntroSeen', true);
    expect(await getItem('pf:librariesIntroSeen')).toBe(true);
  });
  it('LIB_PENDING_DELETES_KEY round-trips array of pending entries', async () => {
    const pending = [{ id: 'p1', kind: 'library' as const, deletedEntry: { id: 'a', name: 'Q4', createdAt: 1 }, affectedRows: [], commitAt: 100, ts: 50 }];
    await setItem('pf:lib:pendingDeletes', pending);
    expect(await getItem('pf:lib:pendingDeletes')).toEqual(pending);
  });
});
