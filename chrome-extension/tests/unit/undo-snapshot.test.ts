import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushSnapshot, tryUndo, flushOnPaperChange, _resetForTest } from '../../reader/lib/undo-snapshot';

beforeEach(() => { vi.useFakeTimers(); _resetForTest(); });

describe('undo-snapshot', () => {
  it('tryUndo returns false when nothing pushed', async () => {
    expect(await tryUndo()).toBe(false);
  });
  it('pushSnapshot then tryUndo within 5s calls onRestore once', async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    pushSnapshot({ paperKey: 'P1', kind: 'note-card', payload: { x: 1 }, onExpire: () => {}, onRestore: restore });
    vi.advanceTimersByTime(2000);
    expect(await tryUndo()).toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
  });
  it('snapshot expires at 5s', async () => {
    pushSnapshot({ paperKey: 'P1', kind: 'note-card', payload: {}, onExpire: () => {}, onRestore: vi.fn() });
    vi.advanceTimersByTime(5001);
    expect(await tryUndo()).toBe(false);
  });
  it('second push overwrites first; only last restorable', async () => {
    const r1 = vi.fn(), r2 = vi.fn();
    pushSnapshot({ paperKey: 'P', kind: 'chat-session', payload: {}, onExpire: () => {}, onRestore: r1 });
    pushSnapshot({ paperKey: 'P', kind: 'chat-session', payload: {}, onExpire: () => {}, onRestore: r2 });
    await tryUndo();
    expect(r1).not.toHaveBeenCalled();
    expect(r2).toHaveBeenCalledTimes(1);
  });
  it('flushOnPaperChange wipes snapshot when key differs', async () => {
    pushSnapshot({ paperKey: 'P1', kind: 'note-card', payload: {}, onExpire: () => {}, onRestore: vi.fn() });
    flushOnPaperChange('P2');
    expect(await tryUndo()).toBe(false);
  });
  it('flushOnPaperChange noop when key same', async () => {
    const r = vi.fn();
    pushSnapshot({ paperKey: 'P1', kind: 'note-card', payload: {}, onExpire: () => {}, onRestore: r });
    flushOnPaperChange('P1');
    await tryUndo();
    expect(r).toHaveBeenCalled();
  });
  it('oversize push preserves prior snapshot AND its 5s expiry timer', async () => {
    const r = vi.fn().mockResolvedValue(undefined);
    const onExp1 = vi.fn();
    pushSnapshot({ paperKey: 'P', kind: 'note-card', payload: { ok: 1 }, onExpire: onExp1, onRestore: r });
    // Try to push an oversize snapshot — should be rejected, prior should still be live.
    pushSnapshot({
      paperKey: 'P', kind: 'note-card',
      payload: 'x'.repeat(1_100_000),    // >1MB
      onExpire: () => {},
      onRestore: vi.fn(),
    });
    // Prior snapshot still restorable
    vi.advanceTimersByTime(2000);
    expect(await tryUndo()).toBe(true);
    expect(r).toHaveBeenCalledTimes(1);
    // Now push another normal snapshot, advance past 5s — its expiry must fire,
    // proving the timer is still wired (i.e. clearTimeout wasn't called by the failed push).
    const onExp2 = vi.fn();
    pushSnapshot({ paperKey: 'P', kind: 'note-card', payload: { ok: 2 }, onExpire: onExp2, onRestore: vi.fn() });
    vi.advanceTimersByTime(5001);
    expect(onExp2).toHaveBeenCalledTimes(1);
  });
});
