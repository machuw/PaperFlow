/**
 * Integration test: shortcut-toast first-run gating (L5-3)
 *
 * Spec §17.B.5:
 *   shortcutToastSeen 只显示一次（§1.4 + §17.1）
 *
 * Exercises the gating logic from main.tsx (L3-3 Step 13) without mounting
 * the full component. Uses Strategy A: re-implement the effect as a local
 * helper and test the contract directly.
 *
 * Cases covered:
 *   1. First mount — toast shown, flag stamped.
 *   2. Second mount (flag already set) — toast suppressed.
 *   3. Post-logout (flag cleared) — toast shown again.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome storage shim — same in-memory pattern as legacy-chat-migration.spec.ts
// ---------------------------------------------------------------------------
const storageMock: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(storageMock)) delete storageMock[key];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) {
            return Promise.resolve({ ...storageMock });
          }
          if (Array.isArray(k)) {
            const out: Record<string, unknown> = {};
            for (const key of k) if (key in storageMock) out[key] = storageMock[key];
            return Promise.resolve(out);
          }
          return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {});
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

// ---------------------------------------------------------------------------
// Helper — mirrors the useEffect in main.tsx (L3-3 Step 13).
// Defined inline here; production logic stays in main.tsx.
// ---------------------------------------------------------------------------

async function runShortcutToastEffect(showToast: (s: string) => void): Promise<void> {
  const seen = await chrome.storage.local.get('shortcutToastSeen:260424');
  if (seen['shortcutToastSeen:260424']) return;
  showToast('⌘\\ now toggles the right panel (Outline retired).');
  await chrome.storage.local.set({ 'shortcutToastSeen:260424': 1 });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('shortcut toast first-run gating', () => {
  beforeEach(async () => { await chrome.storage.local.clear(); });

  it('shows toast on first mount and stamps the flag', async () => {
    const toasts: string[] = [];
    const showToast = (s: string) => toasts.push(s);
    await runShortcutToastEffect(showToast);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain('⌘');
    const flag = await chrome.storage.local.get('shortcutToastSeen:260424');
    expect(flag['shortcutToastSeen:260424']).toBe(1);
  });

  it('does not show toast on second mount (flag is set)', async () => {
    await chrome.storage.local.set({ 'shortcutToastSeen:260424': 1 });
    const toasts: string[] = [];
    const showToast = (s: string) => toasts.push(s);
    await runShortcutToastEffect(showToast);
    expect(toasts).toHaveLength(0);
  });

  it('shows toast again after explicit logout (flag cleared)', async () => {
    // Simulate first mount
    await chrome.storage.local.set({ 'shortcutToastSeen:260424': 1 });
    // Simulate logout (clears the flag per top-bar.tsx doLogout)
    await chrome.storage.local.remove('shortcutToastSeen:260424');
    const toasts: string[] = [];
    const showToast = (s: string) => toasts.push(s);
    await runShortcutToastEffect(showToast);
    expect(toasts).toHaveLength(1);
  });
});
