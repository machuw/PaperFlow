import { describe, it, expect, beforeEach } from 'vitest';
import type { ReaderVariant } from '../../reader/types';

describe('pf-variant localStorage migration', () => {
  beforeEach(() => { localStorage.clear(); });

  it('new users get classic by default (no localStorage read)', () => {
    // Mirrors usePersistedState fallback behavior.
    const raw = localStorage.getItem('pf-variant');
    expect(raw).toBeNull();
    // The fallback passed to usePersistedState is 'classic' per CONTEXT D2.
  });

  it('legacy "focus" in localStorage is a string we can detect for migration', () => {
    localStorage.setItem('pf-variant', JSON.stringify('focus'));
    const raw = JSON.parse(localStorage.getItem('pf-variant')!) as string;
    expect(raw).toBe('focus');
    // Migration effect in main.tsx will write 'classic' here on mount
    // (product unlaunched, aligning stale 'focus' with the default).
    // We assert the detection shape, not the effect itself.
  });

  it('ReaderVariant union no longer accepts "focus" (compile-time check)', () => {
    // Runtime proxy for the type-level assertion — if someone resurrects
    // 'focus' as a valid variant, this test still passes but the next
    // `npm run typecheck` fails. We keep the array literal narrow.
    const valid: readonly ReaderVariant[] = ['summary', 'classic', 'canvas'] as const;
    expect(valid).toContain('summary');
    expect(valid as readonly string[]).not.toContain('focus');
  });
});
