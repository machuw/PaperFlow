const k = {
  oldChat:        (pk: string) => `paper:${pk}:chat`,
  chatSessions:   (pk: string) => `paper:${pk}:chatSessions`,
  chatMessages:   (pk: string, sid: string) => `paper:${pk}:chatSessionMessages:${sid}`,
  activeChat:     (pk: string) => `paper:${pk}:activeChatSession`,
  notes:          (pk: string) => `paper:${pk}:notes`,
  highlights:     (pk: string) => `paper:${pk}:highlights`,
  workspaceTab:   (pk: string) => `paper:${pk}:workspace:tab`,
  scroll:         (pk: string) => `paper:${pk}:scroll`,
  lastVisit:      (pk: string) => `paper:${pk}:lastVisit`,
  noteSubtab:     (pk: string) => `paper:${pk}:note:activeSubtab`,
  versionChat:    (pk: string) => `schemaMigrationVersion:260424:chatSessions:${pk}`,
  versionDropAbs: 'schemaMigrationVersion:260424:dropAbstract',
};

function uuid(): string { return crypto.randomUUID(); }

export async function runSchemaMigrations_260424(paperKey: string): Promise<void> {
  // Step A — chat → sessions
  const verA = (await chrome.storage.local.get(k.versionChat(paperKey)))[k.versionChat(paperKey)];
  if (!verA) {
    const oldArr = (await chrome.storage.local.get(k.oldChat(paperKey)))[k.oldChat(paperKey)];
    let messages: any[] | null = null;
    if (Array.isArray(oldArr) && oldArr.length > 0) {
      messages = oldArr;
    } else if (oldArr && typeof oldArr === 'object' && Array.isArray((oldArr as any).turns) && (oldArr as any).turns.length > 0) {
      // Per spec §14.7.7.2: cloud-sync may write the {turns: [...]} shape locally.
      // Normalize each turn { id, role, content, ts } → { id, role, text, createdAt }.
      messages = (oldArr as any).turns.map((t: any) => ({
        id: t.id,
        role: t.role,
        text: t.content,
        createdAt: t.ts,
      }));
    }
    if (messages) {
      const sid = uuid();
      const firstUser = messages.find((m: any) => m.role === 'user');
      const title = (firstUser?.text ?? '原对话').slice(0, 30);
      const now = Date.now();
      await chrome.storage.local.set({
        [k.chatSessions(paperKey)]: [{ id: sid, seq: 1, title, createdAt: now, updatedAt: now }],
        [k.chatMessages(paperKey, sid)]: messages,
        [k.activeChat(paperKey)]: sid,
      });
    }
    await chrome.storage.local.set({ [k.versionChat(paperKey)]: 1 });
  }
  // Step B — drop summary_* (global, idempotent)
  const verB = (await chrome.storage.local.get(k.versionDropAbs))[k.versionDropAbs];
  if (!verB) {
    const all = await chrome.storage.local.get(null);
    const drop = Object.keys(all).filter((kk) => /^summary_(threeLine|detailed|keyTerms)_/.test(kk));
    if (drop.length > 0) await chrome.storage.local.remove(drop);
    await chrome.storage.local.set({ [k.versionDropAbs]: 1 });
  }
}

export interface RestoreContext {
  tab: 'overview' | 'note' | 'memory';
  scroll: number | null;
  activeSubtab: 'explain' | 'highlight' | 'note' | 'translate';
  activeChatSession: string | null;
  ghostRail: { notes: number; highlights: number; chats: number } | null;
}

export async function runRestoreContext_260424(paperKey: string): Promise<RestoreContext> {
  const all = await chrome.storage.local.get([
    k.workspaceTab(paperKey), k.scroll(paperKey), k.noteSubtab(paperKey),
    k.activeChat(paperKey), k.lastVisit(paperKey),
    k.notes(paperKey), k.highlights(paperKey), k.chatSessions(paperKey),
  ]);
  const notes = all[k.notes(paperKey)] ?? [];
  const highlights = all[k.highlights(paperKey)] ?? [];
  const sessions = all[k.chatSessions(paperKey)] ?? [];
  const lastVisit = all[k.lastVisit(paperKey)] ?? null;
  const ctx: RestoreContext = {
    tab: (all[k.workspaceTab(paperKey)] as any) ?? 'overview',
    scroll: typeof all[k.scroll(paperKey)] === 'number' ? all[k.scroll(paperKey)] : null,
    activeSubtab: (all[k.noteSubtab(paperKey)] as any) ?? 'explain',
    activeChatSession: all[k.activeChat(paperKey)] ?? null,
    ghostRail: null,
  };
  if (lastVisit && (notes.length + highlights.length + sessions.length) > 0) {
    ctx.ghostRail = { notes: notes.length, highlights: highlights.length, chats: sessions.length };
  }
  return ctx;
}

export const k_schemaMigration = k;
