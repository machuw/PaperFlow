import { describe, it, expect, beforeEach } from 'vitest';
import {
  setChatSessions, getChatSessions,
  appendChatSessionMessage, getChatSessionMessages,
  getNotesV2,
  setOverviewSection, getOverviewSection,
} from '../../reader/lib/storage';

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

describe('storage per-paper helpers', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('chatSessions round-trip', async () => {
    await setChatSessions('P1', [{ id: 'a', seq: 1, title: 't', createdAt: 1, updatedAt: 1 }]);
    expect(await getChatSessions('P1')).toHaveLength(1);
  });

  it('appendChatSessionMessage serializes concurrent appends', async () => {
    await Promise.all([
      appendChatSessionMessage('P', 's', { id: '1', role: 'user', text: 'a', createdAt: 1 }),
      appendChatSessionMessage('P', 's', { id: '2', role: 'user', text: 'b', createdAt: 2 }),
    ]);
    expect((await getChatSessionMessages('P', 's')).length).toBe(2);
  });

  it('getNotesV2 defaults missing kind to "note"', async () => {
    await chrome.storage.local.set({ 'paper:P:notes': [{ id: 'n', quote: 'q' }] });
    expect((await getNotesV2('P'))[0].kind).toBe('note');
  });

  it('overview section keyed by model+lang', async () => {
    await setOverviewSection('P', 'contributions', 'gpt-4o-mini', 'en', '- bullet');
    expect(await getOverviewSection('P', 'contributions', 'gpt-4o-mini', 'en')).toBe('- bullet');
    expect(await getOverviewSection('P', 'contributions', 'gpt-4o-mini', 'zh-CN')).toBeNull();
  });
});
