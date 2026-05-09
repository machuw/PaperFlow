import { describe, it, expect, beforeEach } from 'vitest';
import { runSchemaMigrations_260424 } from '../../reader/lib/schema-migration';

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

describe('runSchemaMigrations_260424', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('migrates old chat array to ChatSession + messages', async () => {
    const k = '2017.0001';
    await chrome.storage.local.set({
      [`paper:${k}:chat`]: [
        { id: 'u1', role: 'user', text: 'Hello world', createdAt: 100 },
        { id: 'a1', role: 'assistant', text: 'Hi', createdAt: 200 },
      ],
    });
    await runSchemaMigrations_260424(k);
    const sessions = (await chrome.storage.local.get(`paper:${k}:chatSessions`))[`paper:${k}:chatSessions`];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].seq).toBe(1);
    expect(sessions[0].title).toContain('Hello world');
    const sid = sessions[0].id;
    const msgs = (await chrome.storage.local.get(`paper:${k}:chatSessionMessages:${sid}`))[`paper:${k}:chatSessionMessages:${sid}`];
    expect(msgs).toHaveLength(2);
    const active = (await chrome.storage.local.get(`paper:${k}:activeChatSession`))[`paper:${k}:activeChatSession`];
    expect(active).toBe(sid);
  });

  it('skips migration on second run (idempotent)', async () => {
    const k = '2017.0001';
    await chrome.storage.local.set({
      [`paper:${k}:chat`]: [{ id: 'u1', role: 'user', text: 'a', createdAt: 1 }],
    });
    await runSchemaMigrations_260424(k);
    const before = await chrome.storage.local.get(null);
    await runSchemaMigrations_260424(k);
    const after = await chrome.storage.local.get(null);
    expect(after).toEqual(before);
  });

  it('migrates the {turns: [...]} legacy shape (cloud-sync derived)', async () => {
    const k = 'P-turns';
    await chrome.storage.local.set({
      [`paper:${k}:chat`]: {
        turns: [
          { id: 'u1', role: 'user', content: 'My question', ts: 1000 },
          { id: 'a1', role: 'assistant', content: 'My answer', ts: 2000 },
        ],
      },
    });
    await runSchemaMigrations_260424(k);
    const sessions = (await chrome.storage.local.get(`paper:${k}:chatSessions`))[`paper:${k}:chatSessions`];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toContain('My question');
    const sid = sessions[0].id;
    const msgs = (await chrome.storage.local.get(`paper:${k}:chatSessionMessages:${sid}`))[`paper:${k}:chatSessionMessages:${sid}`];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].text).toBe('My question');
    expect(msgs[0].createdAt).toBe(1000);
  });

  it('uses 原对话 fallback title when no user message exists', async () => {
    const k = 'P-no-user';
    await chrome.storage.local.set({
      [`paper:${k}:chat`]: [
        { id: 'a1', role: 'assistant', text: 'Just an assistant message', createdAt: 100 },
      ],
    });
    await runSchemaMigrations_260424(k);
    const sessions = (await chrome.storage.local.get(`paper:${k}:chatSessions`))[`paper:${k}:chatSessions`];
    expect(sessions[0].title).toBe('原对话');
  });

  it('clears summary_* keys globally and stamps version flag', async () => {
    await chrome.storage.local.set({
      'summary_threeLine_X': 'data',
      'summary_keyTerms_Y': 'data',
      'summary_detailed_Z': 'data',
    });
    await runSchemaMigrations_260424('any');
    const all = await chrome.storage.local.get(null);
    expect(Object.keys(all).filter((k) => k.startsWith('summary_'))).toHaveLength(0);
    expect(all['schemaMigrationVersion:260424:dropAbstract']).toBe(1);
  });
});
