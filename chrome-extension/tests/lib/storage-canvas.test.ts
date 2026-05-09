import { describe, it, expect, beforeEach } from 'vitest';
import { getCanvasLayout, setCanvasLayout } from '../../reader/lib/storage';

const storageMock: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string) => Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {}),
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve(); },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

describe('canvas layout storage', () => {
  it('returns null when no layout is saved', async () => {
    const layout = await getCanvasLayout('pk1');
    expect(layout).toBeNull();
  });

  it('round-trips through set/get', async () => {
    await setCanvasLayout('pk1', { nodes: [{ id: 'paper', x: 100, y: 200 }] });
    const layout = await getCanvasLayout('pk1');
    expect(layout).toEqual({ nodes: [{ id: 'paper', x: 100, y: 200 }] });
  });

  it('isolates layouts by paper key', async () => {
    await setCanvasLayout('pk1', { nodes: [{ id: 'paper', x: 10, y: 10 }] });
    await setCanvasLayout('pk2', { nodes: [{ id: 'paper', x: 99, y: 99 }] });
    expect(await getCanvasLayout('pk1')).toEqual({ nodes: [{ id: 'paper', x: 10, y: 10 }] });
    expect(await getCanvasLayout('pk2')).toEqual({ nodes: [{ id: 'paper', x: 99, y: 99 }] });
  });
});
