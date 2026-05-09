import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scheduleDeleteLibrary, scheduleDeleteTopic, getPendingDeletes, undoPendingDelete, commitElapsedPendingDeletes } from '../../../reader/lib/library-catalog';
import { createLibrary, createTopic } from '../../../reader/lib/library-catalog';

vi.mock('../../../reader/lib/sync-queue', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  drain: vi.fn(),
  clear: vi.fn(),
}));

const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string) => Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {}),
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve(); },
        remove: (k: string) => { delete storageMock[k]; return Promise.resolve(); },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve(); },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

describe('pending-deletes — schedule', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('scheduleDeleteLibrary writes a pending entry, removes catalog row, sets affected paper rows libraryId=null', async () => {
    const lib = await createLibrary('Q4');
    await chrome.storage.local.set({
      library: [
        { urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: lib.id, topicIds: [] },
        { urlHash: 'b', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: [] },
      ],
    });
    await scheduleDeleteLibrary(lib.id);
    expect((await chrome.storage.local.get('pf:libraries'))['pf:libraries']).toEqual([]);
    const lib0 = (await chrome.storage.local.get('library')).library[0];
    expect(lib0.libraryId).toBe(null);
    const pending = await getPendingDeletes();
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe('library');
    expect(pending[0].deletedEntry.id).toBe(lib.id);
    expect(pending[0].affectedRows).toEqual([{ id: 'a', prev: { libraryId: lib.id } }]);
    expect(pending[0].commitAt).toBeGreaterThan(Date.now());
  });

  it('scheduleDeleteTopic snapshots full prevTopicIds (preserves order among other tags)', async () => {
    const t1 = await createTopic('VLA');
    const t2 = await createTopic('Robotics');
    await chrome.storage.local.set({
      library: [
        { urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: null, topicIds: [t1.id, t2.id] },
      ],
    });
    await scheduleDeleteTopic(t1.id);
    const pending = await getPendingDeletes();
    expect(pending[0].kind).toBe('topic');
    expect((pending[0].affectedRows[0].prev as any).topicIds).toEqual([t1.id, t2.id]);
    const lib0 = (await chrome.storage.local.get('library')).library[0];
    expect(lib0.topicIds).toEqual([t2.id]);
  });
});

describe('pending-deletes — undo + commit', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('undoPendingDelete restores catalog entry by original id and paper rows', async () => {
    const lib = await createLibrary('Q4');
    const libId = lib.id;
    await chrome.storage.local.set({
      library: [
        { urlHash: 'a', title: 't', authors: [], role: '', judgment: '', addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false, libraryId: libId, topicIds: [] },
      ],
    });
    await scheduleDeleteLibrary(libId);
    const [pending] = await getPendingDeletes();
    await undoPendingDelete(pending.id);
    const libs = (await chrome.storage.local.get('pf:libraries'))['pf:libraries'];
    expect(libs[0].id).toBe(libId);
    expect(libs[0].name).toBe('Q4');
    const rows = (await chrome.storage.local.get('library')).library;
    expect(rows[0].libraryId).toBe(libId);
    expect(await getPendingDeletes()).toEqual([]);
  });

  it('commitElapsedPendingDeletes fires RPC + removes pending entry when commitAt has passed', async () => {
    const { enqueue } = await import('../../../reader/lib/sync-queue');
    vi.mocked(enqueue).mockClear();
    const lib = await createLibrary('Q4');
    const libId = lib.id;
    await scheduleDeleteLibrary(libId);
    const list = await getPendingDeletes();
    list[0].commitAt = Date.now() - 1;
    await chrome.storage.local.set({ 'pf:lib:pendingDeletes': list });

    await commitElapsedPendingDeletes();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rpc', fn: 'delete-library', args: { id: libId } }));
    expect(await getPendingDeletes()).toEqual([]);
  });

  it('commitElapsedPendingDeletes does NOT fire RPC for not-yet-elapsed entries', async () => {
    const { enqueue } = await import('../../../reader/lib/sync-queue');
    vi.mocked(enqueue).mockClear();
    const lib = await createLibrary('Q4');
    await scheduleDeleteLibrary(lib.id);
    await commitElapsedPendingDeletes();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await getPendingDeletes()).toHaveLength(1);
  });
});
