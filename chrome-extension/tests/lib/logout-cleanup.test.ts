// chrome-extension/tests/lib/logout-cleanup.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { clearLogoutKeys } from '../../reader/lib/logout-cleanup';

const storageMock: Record<string, unknown> = {};

beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null) return Promise.resolve({ ...storageMock });
          const keys = Array.isArray(k) ? k : [k];
          return Promise.resolve(
            Object.fromEntries(
              keys.filter((x) => x in storageMock).map((x) => [x, storageMock[x]]),
            ),
          );
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(storageMock, obj);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete storageMock[k];
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

describe('clearLogoutKeys', () => {
  it('clears pf:lib:pendingDeletes', async () => {
    await chrome.storage.local.set({
      'pf:lib:pendingDeletes': [
        {
          id: 'p',
          kind: 'library',
          deletedEntry: { id: 'a', name: 'Q4', createdAt: 1 },
          affectedRows: [],
          commitAt: 0,
          ts: 0,
        },
      ],
    });
    await clearLogoutKeys();
    expect(
      (await chrome.storage.local.get('pf:lib:pendingDeletes'))['pf:lib:pendingDeletes'],
    ).toBeUndefined();
  });

  it('does NOT clear pf:librariesIntroSeen or pf:libraryV2Migrated (device-local UI state)', async () => {
    await chrome.storage.local.set({
      'pf:librariesIntroSeen': true,
      'pf:libraryV2Migrated': true,
    });
    await clearLogoutKeys();
    expect(
      (await chrome.storage.local.get('pf:librariesIntroSeen'))['pf:librariesIntroSeen'],
    ).toBe(true);
    expect(
      (await chrome.storage.local.get('pf:libraryV2Migrated'))['pf:libraryV2Migrated'],
    ).toBe(true);
  });

  it('clears all v1 cross-account-leak keys (sync:queue, paperIdMap, etc.)', async () => {
    // Phase 17 D-E2: config_apikey + config_prefs are NO LONGER cleared by
    // logout (they are physically removed by the boot-time retire migration
    // in byok-configs.ts so logout doesn't need to). The remaining v1 keys
    // listed below are still cleared on logout.
    await chrome.storage.local.set({
      'sync:queue': [{ table: 'papers', op: 'upsert', row: {}, ts: 0 }],
      migrationState: 'done',
      paperIdMap: { foo: 'bar' },
      churnModalSeen: true,
      libraryCapBannerDismissed: 100,
    });
    await clearLogoutKeys();
    const remaining = await chrome.storage.local.get(null);
    expect(remaining['sync:queue']).toBeUndefined();
    expect(remaining.migrationState).toBeUndefined();
    expect(remaining.paperIdMap).toBeUndefined();
    expect(remaining.churnModalSeen).toBeUndefined();
    expect(remaining.libraryCapBannerDismissed).toBeUndefined();
  });

  it('Phase 17 D-A1: clears migrationState:byok-v11-retire-v17 on logout (shared-device hygiene)', async () => {
    await chrome.storage.local.set({
      'migrationState:byok-v11-retire-v17': 'done',
    });
    await clearLogoutKeys();
    const remaining = await chrome.storage.local.get(null);
    expect(remaining['migrationState:byok-v11-retire-v17']).toBeUndefined();
  });

  it('clears paper:* keys except :parsed and :summary:* (regenerable caches preserved)', async () => {
    await chrome.storage.local.set({
      'paper:abc:highlights': [],
      'paper:abc:notes': [],
      'paper:abc:memory': {},
      'paper:abc:parsed': { keep: true },
      'paper:abc:summary:v1': { keep: true },
    });
    await clearLogoutKeys();
    const remaining = await chrome.storage.local.get(null);
    expect(remaining['paper:abc:highlights']).toBeUndefined();
    expect(remaining['paper:abc:notes']).toBeUndefined();
    expect(remaining['paper:abc:memory']).toBeUndefined();
    expect(remaining['paper:abc:parsed']).toEqual({ keep: true });
    expect(remaining['paper:abc:summary:v1']).toEqual({ keep: true });
  });

  it('removes config_apikeys on logout (NIT-5 explicit assertion + MED-5 byokHealthCache)', async () => {
    // Phase 12 T-12-02-01 mitigation: place the 4 Phase 12 keys
    // (config_apikeys, config_active_byok_config_id, the migration flag,
    // and byokHealthCache) into chrome.storage.local, call clearLogoutKeys,
    // and assert each one is gone. Explicit per-key assertion (NIT-5) so
    // the regression slips through neither prop-enumeration loops nor a
    // future refactor of the v1 generic test above.
    await chrome.storage.local.set({
      config_apikeys: { 'cfg-A': 'sk-A', 'cfg-B': 'sk-B' },
      config_active_byok_config_id: 'cfg-A',
      'migrationState:byok-configs-v12': 'done',
      byokHealthCache: {
        'cfg-A': { ts: Date.now(), healthy: true, modelCount: 3 },
      },
    });

    await clearLogoutKeys();

    const remaining = await chrome.storage.local.get(null);
    expect(remaining.config_apikeys).toBeUndefined();
    expect(remaining.config_active_byok_config_id).toBeUndefined();
    expect(remaining['migrationState:byok-configs-v12']).toBeUndefined();
    expect(remaining.byokHealthCache).toBeUndefined(); // MED-5: health cache must clear
  });
});
