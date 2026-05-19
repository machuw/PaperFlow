import type { Paper, TextSelection, ChatMessage, Note } from '../types';
import * as Sessions from './chat-sessions';
import * as Notes from './notes';
import { callAI, buildMessages } from './ai';
import { surfaceCodexError } from './toast-helpers';
import { shouldSyncNote } from './sync-queue';

const inflight = new Map<string, AbortController>();
const retryGuard = new Set<string>();

type StreamKind = 'explain' | 'translate';

interface ActionParams {
  kind: 'explain' | 'highlight' | 'note' | 'translate';
  paperKey: string;
  paper: Paper;
  sel: TextSelection;
  currentSessionId: string | null;
  model: string;
  lang: string;
  onChatPatch?: (sid: string, msgId: string, text: string) => void;
  onNotePatch?: (id: string, body: string) => void;
  onMessagesAppended?: (sid: string, messages: ChatMessage[]) => void;
  onActionStreamStart?: (assistantMsgId: string) => void;
  onActionStreamEnd?: (assistantMsgId: string) => void;
}

interface StreamParams extends Omit<ActionParams, 'kind'> {
  kind: StreamKind;
}
interface ActionResult {
  actionId: string;
  sessionId: string | null;
  assistantMsgId: string | null;
}

export async function runSelectionAction(p: ActionParams): Promise<ActionResult> {
  const actionId = crypto.randomUUID();
  const now = Date.now();
  // `paragraphId` is the full DOM anchor (e.g. 'sec0-p2'); the legacy
  // `paragraph` numeric is a lossy fallback (Number('02')=2, collides across
  // sections) but kept for back-compat with older Note consumers. New code
  // should prefer `paragraphId` — it's what links a highlight Note back to
  // its row in `paper:{pk}:highlights`.
  const loc = {
    paragraph: p.sel.paragraphId ? Number(p.sel.paragraphId.replace(/\D/g, '')) || undefined : undefined,
    paragraphId: p.sel.paragraphId ?? undefined,
  };

  if (p.kind === 'note') {
    return { actionId, sessionId: null, assistantMsgId: null };
  }
  if (p.kind === 'highlight') {
    const n: Note = { id: actionId, kind: 'highlight', quote: p.sel.text, loc, createdAt: now, updatedAt: now };
    await Notes.upsertNote(p.paperKey, n);
    return { actionId, sessionId: null, assistantMsgId: null };
  }

  // explain or translate
  let sid = p.currentSessionId;
  if (!sid) sid = (await Sessions.createSession(p.paperKey)).id;
  await Sessions.setActive(p.paperKey, sid);
  const userMsg: ChatMessage = {
    id: 'u-' + actionId, role: 'user', kind: 'actionCard',
    action: { kind: p.kind, actionId, quote: p.sel.text, loc },
    text: p.sel.text, createdAt: now,
  };
  const assistantId = 'a-' + actionId;
  const assistantStub: ChatMessage = { id: assistantId, role: 'assistant', text: '', createdAt: now + 1 };
  await Sessions.appendMessage(p.paperKey, sid, userMsg);
  await Sessions.appendMessage(p.paperKey, sid, assistantStub);
  const noteStub: Note = {
    id: actionId, kind: p.kind, quote: p.sel.text, loc,
    chatSessionId: sid, chatMessageId: assistantId, aiAnswer: '',
    createdAt: now, updatedAt: now,
  };
  await Notes.upsertNote(p.paperKey, noteStub);

  if (p.onMessagesAppended) {
    p.onMessagesAppended(sid, await Sessions.loadMessages(p.paperKey, sid));
  }
  p.onActionStreamStart?.(assistantId);
  await streamAndPersist(p as StreamParams, sid, assistantId, actionId);
  return { actionId, sessionId: sid, assistantMsgId: assistantId };
}

async function streamAndPersist(p: StreamParams, sid: string, assistantId: string, actionId: string): Promise<void> {
  const ctrl = new AbortController();
  inflight.set(actionId, ctrl);
  let buf = '';
  const messages = buildMessages(p.kind, p.paper, p.sel.text, p.lang);
  try {
    await callAI(messages, p.kind, (chunk: string) => {
      buf += chunk;
      p.onChatPatch?.(sid, assistantId, buf);
      p.onNotePatch?.(actionId, buf);
    }, { signal: ctrl.signal });
    await Sessions.patchMessage(p.paperKey, sid, assistantId, { text: buf });
    await Notes.patchNote(p.paperKey, actionId, { aiAnswer: buf });
  } catch (err) {
    // PR #15 review fix: classify the error BEFORE the partial-persist
    // branch. AbortError preserves partial buffer (user-initiated abort —
    // keep what they got). Codex errors clear the half-written assistant
    // message + note instead — the toast tells them what happened, and a
    // half-written reply with no error indicator would be confusing.
    if (err instanceof Error && err.name === 'AbortError') {
      if (buf) {
        await Sessions.patchMessage(p.paperKey, sid, assistantId, { text: buf });
        await Notes.patchNote(p.paperKey, actionId, { aiAnswer: buf });
      }
      return;
    }
    if (surfaceCodexError(err)) {
      // Mirror main.tsx chat path: remove the assistant placeholder + note
      // entirely so the toast is the only signal. Otherwise a partial buffer
      // would sit forever in the chat history with no error context.
      await Sessions.removeMessage(p.paperKey, sid, assistantId);
      await Notes.deleteNote(p.paperKey, actionId);
      return;
    }
    // Non-codex / non-abort errors: keep partial buffer (same as legacy
    // behavior) and rethrow so caller's catch path (if any) handles it.
    if (buf) {
      await Sessions.patchMessage(p.paperKey, sid, assistantId, { text: buf });
      await Notes.patchNote(p.paperKey, actionId, { aiAnswer: buf });
    }
    throw err;
  } finally {
    inflight.delete(actionId);
    p.onActionStreamEnd?.(assistantId);
  }
}

export function abortAction(actionId: string): void {
  inflight.get(actionId)?.abort();
}
export function abortAllForPaper(): void {
  for (const c of inflight.values()) c.abort();
  inflight.clear();
}

interface RetryParams {
  paperKey: string;
  paper: Paper;
  actionId: string;
  model: string;
  lang: string;
}
export async function retryAction(p: RetryParams): Promise<void> {
  if (retryGuard.has(p.actionId)) return;
  retryGuard.add(p.actionId);
  try {
    const list = await Notes.listNotes(p.paperKey);
    const note = list.find((n) => n.id === p.actionId);
    if (!note || (note.kind !== 'explain' && note.kind !== 'translate')) return;
    if (!note.chatSessionId || !note.chatMessageId) return;
    const sessions = await Sessions.listSessions(p.paperKey);
    if (!sessions.some((s) => s.id === note.chatSessionId)) return;   // orphan — session was deleted
    const sel: TextSelection = { text: note.quote, rect: {} as any, paragraphId: null };
    await streamAndPersist({
      kind: note.kind, paperKey: p.paperKey, paper: p.paper, sel,
      currentSessionId: note.chatSessionId, model: p.model, lang: p.lang,
    }, note.chatSessionId, note.chatMessageId, p.actionId);
  } finally {
    retryGuard.delete(p.actionId);
  }
}

export { shouldSyncNote };
