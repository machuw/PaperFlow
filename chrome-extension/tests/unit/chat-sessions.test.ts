import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession, deleteSession, clearSession, renameSession,
  listSessions, listActiveSessions, setActive, getActive, appendMessage,
  restoreSession, hardDeleteSession, loadMessages,
} from '../../reader/lib/chat-sessions';

// jsdom doesn't provide chrome.storage — stand up an in-memory shim.
const storageMock: Record<string, unknown> = {};
beforeEach(async () => {
  for (const key of Object.keys(storageMock)) delete storageMock[key];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) {
            return Promise.resolve({ ...storageMock });
          }
          if (Array.isArray(k)) {
            const result: Record<string, unknown> = {};
            for (const key of k) result[key] = storageMock[key];
            return Promise.resolve(result);
          }
          return Promise.resolve({ [k]: storageMock[k] });
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
    },
  };
});

describe('chat-sessions', () => {
  it('createSession assigns seq=1 first time', async () => {
    const s = await createSession('P');
    expect(s.seq).toBe(1);
    expect(s.title).toBe('');
  });
  it('createSession seq fills next slot (compact mode — gaps from deletes are renumbered)', async () => {
    const a = await createSession('P');
    const b = await createSession('P');
    expect(b.seq).toBe(2);
    await deleteSession('P', a.id);
    // compactSeqs runs after delete → b.seq renumbers from 2 to 1
    // → next createSession picks active.length+1 = 2 (NOT max+1 = 3)
    const c = await createSession('P');
    expect(c.seq).toBe(2);
  });
  it('appendMessage auto-titles from first user message ≤30 chars', async () => {
    const s = await createSession('P');
    await appendMessage('P', s.id, { id: 'u', role: 'user', text: 'A'.repeat(50), createdAt: 1 });
    const list = await listSessions('P');
    expect(list[0].title.length).toBe(30);
  });
  it('clearSession keeps session, drops messages', async () => {
    const s = await createSession('P');
    await appendMessage('P', s.id, { id: 'u', role: 'user', text: 'q', createdAt: 1 });
    await clearSession('P', s.id);
    expect((await listSessions('P')).length).toBe(1);
  });
  it('deleteSession of active resets active to null and keeps messages', async () => {
    const s = await createSession('P');
    await appendMessage('P', s.id, { id: 'u', role: 'user', text: 'q', createdAt: 1 });
    await setActive('P', s.id);
    await deleteSession('P', s.id);
    expect(await getActive('P')).toBeNull();
    // soft-delete: messages are preserved
    const msgs = await loadMessages('P', s.id);
    expect(msgs).toHaveLength(1);
  });
  it('rename updates title + updatedAt', async () => {
    const s = await createSession('P');
    const before = s.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await renameSession('P', s.id, 'My chat');
    const list = await listSessions('P');
    expect(list[0].title).toBe('My chat');
    expect(list[0].updatedAt).toBeGreaterThan(before);
  });
  it('appendMessage does not overwrite an existing title', async () => {
    const s = await createSession('P');
    await renameSession('P', s.id, 'Custom');
    await appendMessage('P', s.id, { id: 'u', role: 'user', text: 'hello', createdAt: 1 });
    expect((await listSessions('P'))[0].title).toBe('Custom');
  });

  it('soft delete sets deletedAt and keeps messages', async () => {
    const s = await createSession('P');
    await appendMessage('P', s.id, { id: 'u', role: 'user', text: 'q', createdAt: 1 });
    await deleteSession('P', s.id);
    const list = await listSessions('P');
    expect(list[0].deletedAt).toBeDefined();
    const msgs = await loadMessages('P', s.id);
    expect(msgs).toHaveLength(1);
  });

  it('restoreSession clears deletedAt', async () => {
    const s = await createSession('P');
    await deleteSession('P', s.id);
    await restoreSession('P', s.id);
    const list = await listSessions('P');
    expect(list[0].deletedAt).toBeUndefined();
  });

  it('hardDeleteSession removes session and messages', async () => {
    const s = await createSession('P');
    await appendMessage('P', s.id, { id: 'u', role: 'user', text: 'q', createdAt: 1 });
    await hardDeleteSession('P', s.id);
    expect(await listSessions('P')).toHaveLength(0);
    const msgs = await loadMessages('P', s.id);
    expect(msgs).toHaveLength(0);
  });

  it('listActiveSessions filters out deletedAt entries', async () => {
    const a = await createSession('P');
    const b = await createSession('P');
    await deleteSession('P', a.id);
    const active = await listActiveSessions('P');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(b.id);
  });
});
