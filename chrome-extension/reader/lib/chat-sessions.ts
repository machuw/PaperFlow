import {
  getChatSessions, setChatSessions,
  getChatSessionMessages, setChatSessionMessages,
  appendChatSessionMessage,
  getActiveChatSession, setActiveChatSession,
  withKeyLock,
} from './storage';
import type { ChatSession, ChatMessage } from '../types';

export const MAX_ACTIVE_SESSIONS = 3;

/** Thrown by createSession when the per-paper active-session cap is hit.
 *  Caller (UI) should surface a toast and skip creation. */
export class SessionCapError extends Error {
  constructor() { super('session-cap-exhausted'); this.name = 'SessionCapError'; }
}

const sessionsLockKey = (pk: string) => `paper:${pk}:chatSessions`;

// (compactSeqs below covers what renumberIfLegacy used to do — and more.)

export async function listSessions(pk: string): Promise<ChatSession[]> {
  return getChatSessions(pk);
}
export async function getActive(pk: string): Promise<string | null> {
  return getActiveChatSession(pk);
}
export async function setActive(pk: string, sid: string | null): Promise<void> {
  await setActiveChatSession(pk, sid);
}
/**
 * Compact active session seqs to consecutive 1..N in createdAt order. Called
 * after any operation that can leave gaps (delete, restore, hard-delete) and
 * lazily on list to clean legacy data. Idempotent — only writes when changes
 * are needed. Also enforces the MAX cap by soft-deleting the oldest overflow.
 */
async function compactSeqs(pk: string): Promise<void> {
  await withKeyLock(sessionsLockKey(pk), async () => {
    const list = await getChatSessions(pk);
    const active = list
      .filter((s) => s.deletedAt == null)
      .sort((a, b) => a.createdAt - b.createdAt);
    const keep = active.slice(0, MAX_ACTIVE_SESSIONS);
    const drop = active.slice(MAX_ACTIVE_SESSIONS);
    const newSeqById = new Map(keep.map((s, i) => [s.id, i + 1]));
    const dropIds = new Set(drop.map((s) => s.id));
    const now = Date.now();

    let changed = false;
    const next = list.map((s) => {
      if (dropIds.has(s.id)) {
        changed = true;
        return { ...s, deletedAt: now, updatedAt: now };
      }
      const want = newSeqById.get(s.id);
      if (want != null && want !== s.seq) {
        changed = true;
        return { ...s, seq: want, updatedAt: now };
      }
      return s;
    });
    if (changed) await setChatSessions(pk, next);
  });
}

export async function createSession(pk: string): Promise<ChatSession> {
  return withKeyLock(sessionsLockKey(pk), async () => {
    const list = await getChatSessions(pk);
    const active = list.filter((s) => s.deletedAt == null);
    if (active.length >= MAX_ACTIVE_SESSIONS) throw new SessionCapError();
    // Compact mode: new session always gets next consecutive seq. compactSeqs
    // runs after every delete/restore so active seqs are always 1..N — the
    // next slot is just (count + 1).
    const seq = active.length + 1;
    const now = Date.now();
    const s: ChatSession = { id: crypto.randomUUID(), seq, title: '', createdAt: now, updatedAt: now };
    await setChatSessions(pk, [...list, s]);
    return s;
  });
}
export async function deleteSession(pk: string, sid: string): Promise<void> {
  await withKeyLock(sessionsLockKey(pk), async () => {
    const list = await getChatSessions(pk);
    const now = Date.now();
    const next = list.map((s) => s.id === sid ? { ...s, deletedAt: now, updatedAt: now } : s);
    await setChatSessions(pk, next);
  });
  // messages are kept — soft-delete preserves content for history graveyard
  if ((await getActiveChatSession(pk)) === sid) await setActiveChatSession(pk, null);
  await compactSeqs(pk);  // shift higher seqs down to fill the gap
}
export async function restoreSession(pk: string, sid: string): Promise<void> {
  await withKeyLock(sessionsLockKey(pk), async () => {
    const list = await getChatSessions(pk);
    const activeCount = list.filter((s) => s.deletedAt == null).length;
    if (activeCount >= MAX_ACTIVE_SESSIONS) throw new SessionCapError();
    const next = list.map((s) => {
      if (s.id !== sid) return s;
      const { deletedAt, ...rest } = s;
      return { ...rest, updatedAt: Date.now() };
    });
    await setChatSessions(pk, next);
  });
  await compactSeqs(pk);  // restored session slots in by createdAt
}
export async function hardDeleteSession(pk: string, sid: string): Promise<void> {
  await withKeyLock(sessionsLockKey(pk), async () => {
    const list = await getChatSessions(pk);
    await setChatSessions(pk, list.filter((s) => s.id !== sid));
  });
  await chrome.storage.local.remove(`paper:${pk}:chatSessionMessages:${sid}`);
  if ((await getActiveChatSession(pk)) === sid) await setActiveChatSession(pk, null);
  await compactSeqs(pk);  // covers hard-delete of an active session too
}
export async function listActiveSessions(pk: string): Promise<ChatSession[]> {
  // Lazy migration: any legacy seqs (e.g. >MAX from the old monotonic counter,
  // or gaps from this branch's old LIFO behavior) get compacted to 1..N on
  // first read. Idempotent — no-op once seqs are already consecutive.
  await compactSeqs(pk);
  const all = await listSessions(pk);
  return all.filter((s) => s.deletedAt == null);
}
export async function clearSession(pk: string, sid: string): Promise<void> {
  await setChatSessionMessages(pk, sid, []);
}
export async function renameSession(pk: string, sid: string, title: string): Promise<void> {
  await withKeyLock(sessionsLockKey(pk), async () => {
    const list = await getChatSessions(pk);
    const next = list.map((s) => s.id === sid ? { ...s, title, updatedAt: Date.now() } : s);
    await setChatSessions(pk, next);
  });
}
export async function appendMessage(pk: string, sid: string, m: ChatMessage): Promise<void> {
  await appendChatSessionMessage(pk, sid, m);
  await withKeyLock(sessionsLockKey(pk), async () => {
    const list = await getChatSessions(pk);
    const next = list.map((s) => {
      if (s.id !== sid) return s;
      const title = s.title || (m.role === 'user' ? m.text.slice(0, 30) : s.title);
      return { ...s, title, updatedAt: Date.now() };
    });
    await setChatSessions(pk, next);
  });
}
export async function loadMessages(pk: string, sid: string): Promise<ChatMessage[]> {
  return getChatSessionMessages(pk, sid);
}

/**
 * Patch a single message in a session under withKeyLock to prevent
 * concurrent writes from racing with streaming finalize (§17.A.3).
 */
export async function patchMessage(pk: string, sid: string, msgId: string, patch: Partial<ChatMessage>): Promise<void> {
  await withKeyLock(`paper:${pk}:chatSessionMessages:${sid}`, async () => {
    const list = await getChatSessionMessages(pk, sid);
    const next = list.map((m) => m.id === msgId ? { ...m, ...patch } : m);
    await setChatSessionMessages(pk, sid, next);
  });
}

/**
 * Remove a single message from a session. Used by the chat send error path
 * to roll back an assistant placeholder we already persisted before
 * discovering the request failed.
 */
export async function removeMessage(pk: string, sid: string, msgId: string): Promise<void> {
  await withKeyLock(`paper:${pk}:chatSessionMessages:${sid}`, async () => {
    const list = await getChatSessionMessages(pk, sid);
    await setChatSessionMessages(pk, sid, list.filter((m) => m.id !== msgId));
  });
}
