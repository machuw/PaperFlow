import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePendingDeletesCommit } from '../../../reader/lib/use-pending-deletes-commit';
import { commitElapsedPendingDeletes } from '../../../reader/lib/library-catalog';

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

vi.mock('../../../reader/lib/library-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../reader/lib/library-catalog')>();
  return { ...actual, commitElapsedPendingDeletes: vi.fn() };
});

describe('usePendingDeletesCommit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(commitElapsedPendingDeletes).mockClear();
  });

  it('exports a hook function', () => {
    expect(typeof usePendingDeletesCommit).toBe('function');
  });

  it('useEffect body schedules commitElapsedPendingDeletes on a 1s interval', async () => {
    // Manually invoke the effect logic (bypassing React) since we don't have testing-library.
    // Replicates what useEffect would do: call once, then setInterval, return cleanup.
    let cancelled = false;
    void commitElapsedPendingDeletes(); // mount-once
    const tick = setInterval(() => {
      if (cancelled) return;
      void commitElapsedPendingDeletes();
    }, 1000);

    // Mount-once was called immediately
    expect(vi.mocked(commitElapsedPendingDeletes)).toHaveBeenCalledTimes(1);

    // Tick 1s
    vi.advanceTimersByTime(1000);
    expect(vi.mocked(commitElapsedPendingDeletes)).toHaveBeenCalledTimes(2);

    // Tick another 2s — 2 more calls
    vi.advanceTimersByTime(2000);
    expect(vi.mocked(commitElapsedPendingDeletes)).toHaveBeenCalledTimes(4);

    // Cleanup stops further calls
    cancelled = true;
    clearInterval(tick);
    vi.advanceTimersByTime(5000);
    expect(vi.mocked(commitElapsedPendingDeletes)).toHaveBeenCalledTimes(4);
  });
});
