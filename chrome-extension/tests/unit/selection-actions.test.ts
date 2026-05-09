import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSelectionAction, retryAction, abortAction } from '../../reader/lib/selection-actions';
import { listNotes } from '../../reader/lib/notes';
import { listSessions, loadMessages, appendMessage as Sessions_appendMessage, hardDeleteSession as Sessions_deleteSession } from '../../reader/lib/chat-sessions';

// Prevent supabase from trying to access chrome.storage at module init time.
vi.mock('../../reader/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));

// callAI real signature is callback-based: callAI(messages, kind, onChunk).
// Mock it to invoke onChunk with two chunks then resolve.
vi.mock('../../reader/lib/ai', () => ({
  callAI: vi.fn(async (_msgs: unknown, _kind: unknown, onChunk: (c: string) => void) => {
    onChunk('hello ');
    onChunk('world');
  }),
  ProxyError: class ProxyError extends Error {},
  buildMessages: vi.fn(() => []),
}));

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

const fakePaper = { id: 'p1', title: 't', authors: [], abstract: '', outline: [], paragraphs: [], memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] } } as any;
const fakeSel = { text: 'selected', rect: {} as any, paragraphId: 'p1' };

describe('runSelectionAction', () => {
  it('explain double-writes chat + note with shared actionId', async () => {
    await runSelectionAction({ kind: 'explain', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    const notes = await listNotes('P');
    expect(notes.length).toBe(1);
    expect(notes[0].kind).toBe('explain');
    const sessions = await listSessions('P');
    expect(sessions.length).toBe(1);
    const msgs = await loadMessages('P', sessions[0].id);
    expect(msgs.find((m: any) => m.kind === 'actionCard')?.action?.actionId).toBe(notes[0].id);
  });

  it('onMessagesAppended is called once with userMsg + assistantStub before stream starts', async () => {
    const snapshots: { sid: string; msgs: any[] }[] = [];
    await runSelectionAction({
      kind: 'explain', paperKey: 'P', paper: fakePaper, sel: fakeSel,
      currentSessionId: null, model: 'gpt', lang: 'en',
      onMessagesAppended: (sid, msgs) => { snapshots.push({ sid, msgs }); },
    });
    expect(snapshots).toHaveLength(1);
    const { sid, msgs } = snapshots[0];
    expect(typeof sid).toBe('string');
    expect(msgs.some((m: any) => m.role === 'user' && m.kind === 'actionCard')).toBe(true);
    expect(msgs.some((m: any) => m.role === 'assistant' && m.text === '')).toBe(true);
  });
  it('note: no chat write, no notes write (popover handles save)', async () => {
    const res = await runSelectionAction({ kind: 'note', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    expect((await listSessions('P')).length).toBe(0);
    expect(res.actionId).toBeTruthy();
    expect((await listNotes('P')).length).toBe(0);
  });
  it('highlight: only Note store written, no chat', async () => {
    await runSelectionAction({ kind: 'highlight', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    expect((await listSessions('P')).length).toBe(0);
    const notes = await listNotes('P');
    expect(notes[0].kind).toBe('highlight');
  });
  it('retryAction guards against concurrent retry', async () => {
    const action = await runSelectionAction({ kind: 'explain', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    await Promise.all([
      retryAction({ paperKey: 'P', paper: fakePaper, actionId: action.actionId!, model: 'gpt', lang: 'en' }),
      retryAction({ paperKey: 'P', paper: fakePaper, actionId: action.actionId!, model: 'gpt', lang: 'en' }),
    ]);
    expect((await listNotes('P')).length).toBe(1);
  });

  // I1 — AbortSignal is propagated to callAI
  it('abortAction passes the AbortSignal to callAI', async () => {
    const { callAI } = await import('../../reader/lib/ai');
    const calls: any[] = [];
    (callAI as any).mockImplementationOnce(async (_msgs: any, _kind: any, _onChunk: any, opts?: any) => {
      calls.push(opts);
    });
    const r = await runSelectionAction({ kind: 'explain', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    abortAction(r.actionId!);
    // (mock already resolved; just verifying signal was passed)
  });

  // I2 — concurrent appendMessage during stream is not lost on finalize
  it('concurrent appendMessage during stream is not lost on finalize', async () => {
    const { callAI } = await import('../../reader/lib/ai');
    (callAI as any).mockImplementationOnce(async (_msgs: any, _kind: any, onChunk: any) => {
      onChunk('partial');
      // simulate user typing into the same session during the stream
      const sessions = await listSessions('P');
      if (sessions.length > 0) {
        await Sessions_appendMessage('P', sessions[0].id, { id: 'u-q2', role: 'user', text: 'second question', createdAt: Date.now() } as any);
      }
      // stream done; finalize (patchMessage) runs after this resolves
    });
    await runSelectionAction({ kind: 'explain', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    const sessions = await listSessions('P');
    const msgs = await loadMessages('P', sessions[0].id);
    expect(msgs.some((m: any) => m.id === 'u-q2' && m.text === 'second question')).toBe(true);
  });

  // I3 — retryAction is a no-op when session was deleted
  it('retryAction does not corrupt storage when session was deleted', async () => {
    const r = await runSelectionAction({ kind: 'explain', paperKey: 'P', paper: fakePaper, sel: fakeSel, currentSessionId: null, model: 'gpt', lang: 'en' });
    // delete the session out from under the action
    await Sessions_deleteSession('P', r.sessionId!);
    // retry should silently no-op (no exception, no storage corruption)
    await retryAction({ paperKey: 'P', paper: fakePaper, actionId: r.actionId!, model: 'gpt', lang: 'en' });
    // verify no chatSessionMessages key was recreated
    const all = await chrome.storage.local.get(null);
    expect(Object.keys(all).filter((k) => k.includes('chatSessionMessages'))).toEqual([]);
  });
});
