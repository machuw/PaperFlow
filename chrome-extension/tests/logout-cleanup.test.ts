// Phase 15 logout-cleanup unit coverage. Verifies clearLogoutKeys()
// removes all 4 Phase 15 storage keys (D-E1 / D-C3 / D-F1 / D-F2) so
// managed-model state does not leak across accounts on a shared device.
// Also asserts pre-existing Phase 12 keys are still cleared.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Storage shim verbatim from byok-migration.test.ts:47-74. Track every
// remove() call (single-key + array-key) so assertions can scan the call log.
const storageMock: Record<string, unknown> = {};
const removeCalls: string[] = [];

beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  removeCalls.length = 0;
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
          for (const key of keys) {
            removeCalls.push(key);
            delete storageMock[key];
          }
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

describe('clearLogoutKeys — Phase 15 keys', () => {
  it('removes config_active_managed_model_id (D-E1)', async () => {
    vi.resetModules();
    const { clearLogoutKeys } = await import('../reader/lib/logout-cleanup');
    await clearLogoutKeys();
    expect(removeCalls).toContain('config_active_managed_model_id');
  });

  it('removes managedModelsCache (D-C3)', async () => {
    vi.resetModules();
    const { clearLogoutKeys } = await import('../reader/lib/logout-cleanup');
    await clearLogoutKeys();
    expect(removeCalls).toContain('managedModelsCache');
  });

  it('removes migrationState:managed-models-v13 (D-F1)', async () => {
    vi.resetModules();
    const { clearLogoutKeys } = await import('../reader/lib/logout-cleanup');
    await clearLogoutKeys();
    expect(removeCalls).toContain('migrationState:managed-models-v13');
  });

  it('removes migrationState:managed-models-v13-toast-shown (D-F2)', async () => {
    vi.resetModules();
    const { clearLogoutKeys } = await import('../reader/lib/logout-cleanup');
    await clearLogoutKeys();
    expect(removeCalls).toContain('migrationState:managed-models-v13-toast-shown');
  });
});

describe('clearLogoutKeys — Slice 1 #8 codex auth keys', () => {
  it('removes codex_auth_tokens (shared-device session leakage prevention)', async () => {
    vi.resetModules();
    const { clearLogoutKeys } = await import('../reader/lib/logout-cleanup');
    await clearLogoutKeys();
    expect(removeCalls).toContain('codex_auth_tokens');
  });

  it('removes codex_auth_user (orphaned user identity prevention)', async () => {
    vi.resetModules();
    const { clearLogoutKeys } = await import('../reader/lib/logout-cleanup');
    await clearLogoutKeys();
    expect(removeCalls).toContain('codex_auth_user');
  });

  it('#22 cycle 8: removes codex_available_models (auth-lifecycle cleanup per ADR-0002)', async () => {
    vi.resetModules();
    const { clearLogoutKeys } = await import('../reader/lib/logout-cleanup');
    await clearLogoutKeys();
    expect(removeCalls).toContain('codex_available_models');
  });
});

describe('clearLogoutKeys — pre-existing Phase 12 keys preserved', () => {
  it('still removes config_apikeys (Phase 12 D-A2)', async () => {
    vi.resetModules();
    const { clearLogoutKeys } = await import('../reader/lib/logout-cleanup');
    await clearLogoutKeys();
    expect(removeCalls).toContain('config_apikeys');
  });

  it('still removes byokHealthCache (Phase 12 D-C1/D-C2)', async () => {
    vi.resetModules();
    const { clearLogoutKeys } = await import('../reader/lib/logout-cleanup');
    await clearLogoutKeys();
    expect(removeCalls).toContain('byokHealthCache');
  });
});
