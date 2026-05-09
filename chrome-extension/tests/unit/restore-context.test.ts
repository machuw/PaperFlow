import { describe, it, expect, beforeEach } from 'vitest';
import { runRestoreContext_260424 } from '../../reader/lib/schema-migration';

// jsdom doesn't provide chrome.storage — stand up an in-memory shim.
const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const key of Object.keys(storageMock)) delete storageMock[key];
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
});

describe('runRestoreContext_260424', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('returns defaults when nothing persisted (first visit)', async () => {
    const ctx = await runRestoreContext_260424('newpaper');
    expect(ctx.tab).toBe('overview');
    expect(ctx.scroll).toBeNull();
    expect(ctx.activeSubtab).toBe('explain');
    expect(ctx.activeChatSession).toBeNull();
    expect(ctx.ghostRail).toBeNull();
  });

  it('restores tab/scroll/subtab when set', async () => {
    const k = 'P1';
    await chrome.storage.local.set({
      [`paper:${k}:workspace:tab`]: 'note',
      [`paper:${k}:scroll`]: 1234,
      [`paper:${k}:note:activeSubtab`]: 'translate',
      [`paper:${k}:lastVisit`]: Date.now() - 86400000,
      [`paper:${k}:notes`]: [{ id: 'n1', kind: 'note' }],
    });
    const ctx = await runRestoreContext_260424(k);
    expect(ctx.tab).toBe('note');
    expect(ctx.scroll).toBe(1234);
    expect(ctx.activeSubtab).toBe('translate');
    expect(ctx.ghostRail).not.toBeNull();
    expect(ctx.ghostRail!.notes).toBe(1);
  });

  it('skips ghost rail when no prior footprint', async () => {
    const k = 'P1';
    await chrome.storage.local.set({ [`paper:${k}:lastVisit`]: Date.now() - 1000 });
    const ctx = await runRestoreContext_260424(k);
    expect(ctx.ghostRail).toBeNull();
  });
});
