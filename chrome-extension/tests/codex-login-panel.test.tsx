// chrome-extension/tests/codex-login-panel.test.tsx
//
// Slice 4 #23 — CodexLoginPanel pending-state copy button.
// Focused unit coverage for the new Copy control: render placement,
// clipboard invocation, label flip + revert, error label, timer cleanup.
//
// jsdom + @testing-library/react. codex-auth is mocked so the panel can
// be driven into the "login in progress" state deterministically without
// hitting any real OAuth endpoints.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { setLocale } from '../reader/lib/i18n';

// Hold-open loginPoll: returns a Promise we never resolve so the panel
// stays in pending state long enough for the test to interact.
const loginStartMock = vi.fn();
const loginPollMock = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
const logoutMock = vi.fn();

vi.mock('../reader/lib/codex-auth', () => ({
  loginStart: (...a: unknown[]) => (loginStartMock as any)(...a),
  loginPoll: (...a: unknown[]) => (loginPollMock as any)(...a),
  logout: (...a: unknown[]) => (logoutMock as any)(...a),
  CodexReloginRequiredError: class extends Error {},
}));

vi.mock('../reader/lib/storage-schema', () => ({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  loginStartMock.mockReset();
  loginPollMock.mockClear();
  // PR #27 review fix: i18n-codex-byok-completeness.test.ts loops through all
  // 9 locales and may leave the module-global currentLocale at 'ru'. Pin to
  // 'en' so this file's assertions against "Copy" / "Cancel" stay stable
  // regardless of vitest's `isolate` mode.
  await setLocale('en');
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { create: vi.fn().mockResolvedValue({ id: 1 }) },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // PR #27 review fix: tear down the clipboard mock so later tests don't
  // inherit a stale writeText spy (or its rejection state).
  delete (navigator as any).clipboard;
});

// Drive the panel from the unauthenticated screen into the "login in
// progress" state with a known userCode. Returns when the pending state
// is fully rendered.
async function enterPendingState(userCode = 'WXYZ-1234'): Promise<void> {
  loginStartMock.mockResolvedValueOnce({
    deviceAuthId: 'dev-1',
    userCode,
    intervalMs:  5_000,
    expiresAtMs: Date.now() + 10 * 60_000,
  });
  const { CodexLoginPanel } = await import('../options/codex-login-panel');
  render(<CodexLoginPanel />);
  // Click "Log in with ChatGPT"
  const loginBtn = await screen.findByText(/Log in with ChatGPT/i);
  await act(async () => { fireEvent.click(loginBtn); });
  await waitFor(() => screen.getByText(userCode));
}

// Install a controllable clipboard mock — jsdom does not implement
// navigator.clipboard. Returns the mock so tests can flip resolve/reject.
function installClipboardMock() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

describe('CodexLoginPanel — Slice 4 #23 copy button', () => {
  it('cycle 1: pending state renders Copy button to the left of Cancel in the same row', async () => {
    await enterPendingState();
    const copyBtn = screen.getByRole('button', { name: 'Copy' });
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    expect(copyBtn).toBeInstanceOf(HTMLElement);
    expect(cancelBtn).toBeInstanceOf(HTMLElement);
    // Both buttons share an immediate parent (the horizontal action row).
    expect(copyBtn.parentElement).toBe(cancelBtn.parentElement);
    // Copy is positioned BEFORE Cancel in DOM order — flex layout renders it
    // to the left without needing explicit order styling.
    const buttons = Array.from(copyBtn.parentElement!.querySelectorAll('button')) as HTMLElement[];
    expect(buttons.indexOf(copyBtn as HTMLElement)).toBeLessThan(buttons.indexOf(cancelBtn as HTMLElement));
  });

  it('cycle 2: click writes user_code to clipboard and flips label to "Copied!"', async () => {
    const writeText = installClipboardMock();
    await enterPendingState('USER-CODE-42');

    // Role-based query uses the stable aria-label ("Copy") so the button is
    // always discoverable. The visible label is asserted via getByText since
    // it diverges from the accessible name while the confirmation is shown.
    const copyBtn = screen.getByRole('button', { name: 'Copy' });
    await act(async () => { fireEvent.click(copyBtn); });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('USER-CODE-42');
    await screen.findByText('Copied!');
  });

  it('cycle 3: "Copied!" visible label reverts after 2 seconds', async () => {
    installClipboardMock();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await enterPendingState();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    await screen.findByText('Copied!');

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByText('Copied!')).toBeNull();
    expect(screen.getByText('Copy')).toBeInstanceOf(HTMLElement);
  });

  it('cycle 4: clipboard rejection shows "Copy failed" and reverts after 2s', async () => {
    const writeText = installClipboardMock();
    writeText.mockRejectedValueOnce(new Error('not allowed'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await enterPendingState();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    await screen.findByText('Copy failed');

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByText('Copy failed')).toBeNull();
    expect(screen.getByText('Copy')).toBeInstanceOf(HTMLElement);
  });

  it('cycle 5: unmount calls clearTimeout with the revert timer id', async () => {
    // PR #27 review fix: the previous version grepped for the React "setState
    // on an unmounted component" warning, which React 18.3 no longer emits —
    // making the assertion vacuous (would pass even with the useEffect
    // cleanup deleted). This version pins the timer id allocated by the
    // revert setTimeout and asserts clearTimeout received that exact id on
    // unmount. Directly probes the cleanup, not its observable side effect.
    installClipboardMock();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    loginStartMock.mockResolvedValueOnce({
      deviceAuthId: 'd', userCode: 'X-Y', intervalMs: 5_000,
      expiresAtMs: Date.now() + 10 * 60_000,
    });
    const { CodexLoginPanel } = await import('../options/codex-login-panel');
    const { unmount } = render(<CodexLoginPanel />);
    await act(async () => { fireEvent.click(await screen.findByText(/Log in with ChatGPT/i)); });
    await waitFor(() => screen.getByText('X-Y'));

    // Click Copy → starts the 2s revert timer.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    await screen.findByText('Copied!');

    // Identify the specific timer the CopyButton scheduled (delay === 2000).
    const revertCall = setTimeoutSpy.mock.calls.findIndex((c) => c[1] === 2000);
    expect(revertCall).toBeGreaterThanOrEqual(0);
    const revertId = setTimeoutSpy.mock.results[revertCall].value;

    unmount();

    // The component's useEffect cleanup must have called clearTimeout(revertId).
    // (Other clearTimeout calls fired by React / RTL during unmount are fine —
    // we only assert OUR id is among them.)
    const clearedIds = clearTimeoutSpy.mock.calls.map((c) => c[0]);
    expect(clearedIds).toContain(revertId);

    // Restore the global timer spies so subsequent tests get the unwrapped
    // setTimeout/clearTimeout that @testing-library's waitFor needs.
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('PR #27 review fix: aria-label stays "Copy" while visible label flips', async () => {
    // The accessible name must NOT flip to "Copied!" — screen readers
    // re-scanning the button after click should still hear the affordance,
    // not the transient confirmation.
    installClipboardMock();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await enterPendingState();

    const copyBtn = screen.getByRole('button', { name: 'Copy' });
    expect(copyBtn.getAttribute('aria-label')).toBe('Copy');
    expect(copyBtn.getAttribute('aria-live')).toBe('polite');

    await act(async () => { fireEvent.click(copyBtn); });
    await screen.findByText('Copied!');
    // Same DOM node, label unchanged, visible text differs.
    expect(copyBtn.getAttribute('aria-label')).toBe('Copy');
    expect(copyBtn.textContent).toBe('Copied!');
    // Still discoverable by accessible name.
    expect(screen.getByRole('button', { name: 'Copy' })).toBe(copyBtn);
  });

});
