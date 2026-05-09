import { getNotesV2, setNotesV2, withKeyLock } from './storage';
import type { Note } from '../types';

function lockKey(pk: string): string {
  return `paper:${pk}:notes`;
}

export async function listNotes(pk: string): Promise<Note[]> {
  const list = await getNotesV2(pk);
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export async function byKind(pk: string, kind: Note['kind']): Promise<Note[]> {
  return (await listNotes(pk)).filter((n) => n.kind === kind);
}

export async function upsertNote(pk: string, n: Note): Promise<void> {
  await withKeyLock(lockKey(pk), async () => {
    const list = await getNotesV2(pk);
    const idx = list.findIndex((x) => x.id === n.id);
    if (idx >= 0) list[idx] = n; else list.push(n);
    await setNotesV2(pk, list);
  });
}

export async function patchNote(pk: string, id: string, patch: Partial<Note>): Promise<void> {
  await withKeyLock(lockKey(pk), async () => {
    const list = await getNotesV2(pk);
    const next = list.map((x) => x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x);
    await setNotesV2(pk, next);
  });
}

export async function deleteNote(pk: string, id: string): Promise<void> {
  await withKeyLock(lockKey(pk), async () => {
    const list = await getNotesV2(pk);
    await setNotesV2(pk, list.filter((x) => x.id !== id));
  });
}
