import { describe, it, expect, beforeEach } from 'vitest';
import { listNotes, upsertNote, deleteNote, byKind, patchNote } from '../../reader/lib/notes';
import type { Note } from '../../reader/types';

// jsdom doesn't provide chrome.storage — stand up an in-memory shim.
const storageMock: Record<string, unknown> = {};
beforeEach(async () => {
  for (const key of Object.keys(storageMock)) delete storageMock[key];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) return Promise.resolve({ ...storageMock });
          if (Array.isArray(k)) {
            const result: Record<string, unknown> = {};
            for (const key of k) result[key] = storageMock[key];
            return Promise.resolve(result);
          }
          return Promise.resolve({ [k]: storageMock[k] });
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

const baseNote = (over: Partial<Note> = {}): Note => ({
  id: over.id ?? 'a', kind: over.kind ?? 'note',
  quote: 'q', loc: { page: 1 },
  createdAt: 1, updatedAt: 1, ...over,
});

describe('notes', () => {
  it('upsert+list 4 kinds', async () => {
    for (const kind of ['highlight','note','explain','translate'] as const) {
      await upsertNote('P', baseNote({ id: kind, kind }));
    }
    expect((await listNotes('P')).length).toBe(4);
  });
  it('byKind filters', async () => {
    await upsertNote('P', baseNote({ id: 'h', kind: 'highlight' }));
    await upsertNote('P', baseNote({ id: 'n', kind: 'note' }));
    expect((await byKind('P', 'highlight')).length).toBe(1);
  });
  it('upsert by id replaces', async () => {
    await upsertNote('P', baseNote({ id: 'a', userText: 'one' }));
    await upsertNote('P', baseNote({ id: 'a', userText: 'two' }));
    const list = await listNotes('P');
    expect(list.length).toBe(1);
    expect(list[0].userText).toBe('two');
  });
  it('patchNote merges and bumps updatedAt', async () => {
    await upsertNote('P', baseNote({ id: 'a', updatedAt: 1 }));
    await new Promise((r) => setTimeout(r, 5));
    await patchNote('P', 'a', { aiAnswer: 'final' });
    const n = (await listNotes('P'))[0];
    expect(n.aiAnswer).toBe('final');
    expect(n.updatedAt).toBeGreaterThan(1);
  });
  it('deleteNote removes by id', async () => {
    await upsertNote('P', baseNote({ id: 'a' }));
    await deleteNote('P', 'a');
    expect(await listNotes('P')).toEqual([]);
  });
  it('legacy notes without kind default to note', async () => {
    await chrome.storage.local.set({ 'paper:P:notes': [{ id: 'x', quote: 'q', loc: {}, createdAt: 1, updatedAt: 1 }] });
    const list = await listNotes('P');
    expect(list[0].kind).toBe('note');
  });
});
