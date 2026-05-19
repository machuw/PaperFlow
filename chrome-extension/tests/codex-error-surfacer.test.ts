// chrome-extension/tests/codex-error-surfacer.test.ts
//
// Slice 3 #12 — surfaceCodexError helper tests.
// Asserts that codex-typed errors get translated into pf-show-toast events
// with an "Open Options" action; non-codex errors pass through untouched.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodexReloginRequiredError } from '../reader/lib/codex-auth';
import { CodexApiSurfaceChangedError, CodexNetworkError } from '../reader/lib/codex-stream';

const openOptionsMock = vi.fn();

beforeEach(() => {
  // Intentionally NOT calling vi.resetModules() — module identity matters
  // because surfaceCodexError uses `instanceof CodexApiSurfaceChangedError`.
  // Resetting modules would split the class into two identities (helper's
  // copy vs test's copy) and break the check.
  openOptionsMock.mockReset();
  (globalThis as any).chrome = {
    runtime: { openOptionsPage: openOptionsMock },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('surfaceCodexError', () => {
  it('Slice 3 #12: CodexReloginRequiredError → dispatches toast with re-login copy and an action that opens Options', async () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('pf-show-toast', handler);

    const { surfaceCodexError } = await import('../reader/lib/toast-helpers');
    const handled = surfaceCodexError(new CodexReloginRequiredError());

    expect(handled).toBe(true);
    expect(events).toHaveLength(1);
    const detail = events[0].detail as { message: string; action?: { label: string; handler: () => void } };
    expect(detail.message).toMatch(/session|re-?log|过期|重新登录/i);
    expect(detail.action?.label).toBeTruthy();

    detail.action?.handler();
    expect(openOptionsMock).toHaveBeenCalledTimes(1);

    window.removeEventListener('pf-show-toast', handler);
  });

  it('Slice 3 #12: CodexApiSurfaceChangedError → dispatches toast with API-change copy + opens-Options action', async () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('pf-show-toast', handler);

    const { surfaceCodexError } = await import('../reader/lib/toast-helpers');
    const handled = surfaceCodexError(new CodexApiSurfaceChangedError(403, 'forbidden'));

    expect(handled).toBe(true);
    expect(events).toHaveLength(1);
    const detail = events[0].detail as { message: string; action?: { label: string; handler: () => void } };
    expect(detail.message).toMatch(/api|provider|byok|更换|提供商/i);
    expect(detail.action?.label).toBeTruthy();

    detail.action?.handler();
    expect(openOptionsMock).toHaveBeenCalledTimes(1);

    window.removeEventListener('pf-show-toast', handler);
  });

  it('PR #15 fix: CodexNetworkError → dispatches toast with network-error copy (no Options action)', async () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('pf-show-toast', handler);

    const { surfaceCodexError } = await import('../reader/lib/toast-helpers');
    const handled = surfaceCodexError(new CodexNetworkError(new TypeError('Failed to fetch')));

    expect(handled).toBe(true);
    expect(events).toHaveLength(1);
    const detail = events[0].detail as { message: string; action?: { label: string; handler: () => void } };
    expect(detail.message).toMatch(/network|connect|连接|网络/i);
    // No Options-opening action — re-login won't help, switching BYOK won't
    // help; the user just needs to wait for network to come back.
    expect(detail.action).toBeUndefined();

    window.removeEventListener('pf-show-toast', handler);
  });

  it('Slice 3 #12: non-codex errors → returns false, no toast dispatched (caller handles normally)', async () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('pf-show-toast', handler);

    const { surfaceCodexError } = await import('../reader/lib/toast-helpers');
    const handled = surfaceCodexError(new Error('something else broke'));

    expect(handled).toBe(false);
    expect(events).toHaveLength(0);
    expect(openOptionsMock).not.toHaveBeenCalled();

    window.removeEventListener('pf-show-toast', handler);
  });
});
