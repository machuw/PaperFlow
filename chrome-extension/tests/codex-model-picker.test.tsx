// chrome-extension/tests/codex-model-picker.test.tsx
//
// Slice 2 #24 — CodexModelPicker: <Field> + native <select> that reflects
// the codex_available_models storage key. Renders nothing if the user is
// not logged in (no list in storage) or the list is empty, so the picker
// can be unconditionally placed in the layout for the openai-codex preset.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { setLocale } from '../reader/lib/i18n';

// In-memory chrome.storage.local shim with a single onChanged listener so
// tests can simulate cross-context storage updates (e.g. a refresh-driven
// fetch updating codex_available_models).
const storage: Record<string, unknown> = {};
const listeners = new Set<(changes: any, area: string) => void>();

function makeChromeShim() {
  return {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[] | null) => {
          if (key === null || key === undefined) return { ...storage };
          if (Array.isArray(key)) {
            const out: Record<string, unknown> = {};
            for (const k of key) if (k in storage) out[k] = storage[k];
            return out;
          }
          return key in storage ? { [key]: storage[key] } : {};
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: storage[k], newValue: v };
            storage[k] = v;
          }
          for (const l of listeners) l(changes, 'local');
        }),
        remove: vi.fn(async (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k];
          const changes: Record<string, { oldValue?: unknown }> = {};
          for (const key of keys) {
            changes[key] = { oldValue: storage[key] };
            delete storage[key];
          }
          for (const l of listeners) l(changes, 'local');
        }),
      },
      onChanged: {
        addListener: vi.fn((l: (c: any, a: string) => void) => { listeners.add(l); }),
        removeListener: vi.fn((l: (c: any, a: string) => void) => { listeners.delete(l); }),
      },
    },
  };
}

beforeEach(async () => {
  for (const k of Object.keys(storage)) delete storage[k];
  listeners.clear();
  (globalThis as any).chrome = makeChromeShim();
  await setLocale('en');
});

afterEach(() => {
  cleanup();
});

describe('CodexModelPicker — Slice 2 #24', () => {
  it('cycle 1: renders nothing when codex_available_models is absent from storage', async () => {
    const { CodexModelPicker } = await import('../options/codex-model-picker');
    const { container } = render(
      <CodexModelPicker value="" onChange={() => {}} />,
    );
    // Wait for any async hydration to settle, then assert the picker
    // produced no markup at all (Field shell + select stay absent).
    await waitFor(() => {
      expect(container.querySelector('select')).toBeNull();
      expect(container.textContent ?? '').toBe('');
    });
  });

  it('cycle 2: renders a labeled MODEL select with options from codex_available_models', async () => {
    storage['codex_available_models'] = ['gpt-5.2', 'gpt-6-preview'];
    const { CodexModelPicker } = await import('../options/codex-model-picker');
    render(<CodexModelPicker value="gpt-5.2" onChange={() => {}} />);

    // MODEL Field label resolves via the shared i18n key 'options.byok-
    // configs.field.model.label' (reused; no new i18n introduced).
    await screen.findByText('Model');
    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toEqual(['gpt-5.2', 'gpt-6-preview']);
    expect(select.value).toBe('gpt-5.2');
  });

  it('cycle 3: changing the select invokes onChange with the new model id', async () => {
    storage['codex_available_models'] = ['gpt-5.2', 'gpt-6-preview'];
    const onChange = vi.fn();
    const { CodexModelPicker } = await import('../options/codex-model-picker');
    render(<CodexModelPicker value="gpt-5.2" onChange={onChange} />);

    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    await act(async () => { fireEvent.change(select, { target: { value: 'gpt-6-preview' } }); });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('gpt-6-preview');
  });

  it('cycle 4: storage.onChanged for codex_available_models updates options live (no remount)', async () => {
    storage['codex_available_models'] = ['gpt-5.2'];
    const { CodexModelPicker } = await import('../options/codex-model-picker');
    render(<CodexModelPicker value="gpt-5.2" onChange={() => {}} />);
    await screen.findByText('Model');

    // Simulate a token-refresh-driven discovery dropping a new list into
    // storage from outside the Options view (background script context).
    await act(async () => {
      await chrome.storage.local.set({
        codex_available_models: ['gpt-5.2', 'gpt-6-preview', 'gpt-7'],
      });
    });

    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toEqual(['gpt-5.2', 'gpt-6-preview', 'gpt-7']);
  });

  it('PR #29 review fix MED-B: stale editing.model not in options — onChange auto-corrects to models[0]', async () => {
    // Window between login and Slice 3 #25 reconcile firing: the picker
    // can render with a `value` that isn't in the storage list. Native
    // <select> displays the first option visually but the controlled
    // `value` prop still holds the stale id — Save would persist an
    // invisible mismatch. The picker auto-corrects in one onChange so
    // what the user sees == what gets saved.
    storage['codex_available_models'] = ['gpt-5.2', 'gpt-6-preview'];
    const onChange = vi.fn();
    const { CodexModelPicker } = await import('../options/codex-model-picker');
    render(<CodexModelPicker value="gpt-removed" onChange={onChange} />);
    await screen.findByRole('combobox');

    expect(onChange).toHaveBeenCalledWith('gpt-5.2');
    // Single self-heal — must not fire repeatedly.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('PR #29 review fix MED-B: value already in list — no spurious onChange', async () => {
    storage['codex_available_models'] = ['gpt-5.2', 'gpt-6-preview'];
    const onChange = vi.fn();
    const { CodexModelPicker } = await import('../options/codex-model-picker');
    render(<CodexModelPicker value="gpt-5.2" onChange={onChange} />);
    await screen.findByRole('combobox');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('PR #29 re-review CRITICAL: unstable onChange does NOT re-trigger self-heal across parent re-renders', async () => {
    // main.tsx passes `onChange={(m) => setEditing({ ...editing, model: m })}` —
    // a fresh function on every render. If the picker's effect includes
    // onChange in its deps, every parent re-render bumps the dep identity
    // and re-runs the self-heal.
    //
    // To actually pin the regression we must hold `value` STALE while the
    // parent re-renders (otherwise the inner `!models.includes(value)`
    // guard masks the difference between the old and new impl — that's the
    // very fragility the reviewer flagged). The parent below intentionally
    // does NOT propagate `onChange` into `value`, so each tick re-renders
    // with the same stale value but a new onChange identity. On the new
    // impl (ref pattern, deps = [models, value]) the effect runs ONCE.
    // On the old impl (deps include onChange) each tick re-fires the
    // effect because the dep changed.
    storage['codex_available_models'] = ['gpt-5.2', 'gpt-6-preview'];
    const calls: string[] = [];
    const { CodexModelPicker } = await import('../options/codex-model-picker');
    const { useState } = await import('react');

    function Parent() {
      const [, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((n) => n + 1)} data-testid="tick">tick</button>
          <CodexModelPicker
            value="gpt-removed"
            onChange={(m) => { calls.push(m); }}
          />
        </>
      );
    }
    render(<Parent />);
    await screen.findByRole('combobox');

    // Bump the parent so the onChange identity flips while value stays stale.
    await act(async () => { fireEvent.click(screen.getByTestId('tick')); });
    await act(async () => { fireEvent.click(screen.getByTestId('tick')); });

    // Old impl with `onChange` in deps would have fired 3 times (mount + 2 ticks).
    expect(calls).toEqual(['gpt-5.2']);
  });

  it('PR #29 re-review IMPORTANT: empty value is auto-seeded with models[0]', async () => {
    // A brand-new BYOK config can open with editing.model === '' if the user
    // edits the row before the preset default applies. Empty must seed too —
    // otherwise Save persists '' and the AI call relies on codex-stream's
    // CODEX_DEFAULT_MODEL fallback to keep working (correct but invisible).
    storage['codex_available_models'] = ['gpt-5.2', 'gpt-6-preview'];
    const onChange = vi.fn();
    const { CodexModelPicker } = await import('../options/codex-model-picker');
    render(<CodexModelPicker value="" onChange={onChange} />);
    await screen.findByRole('combobox');

    expect(onChange).toHaveBeenCalledWith('gpt-5.2');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('PR #29 review fix MED-A: hydrate-vs-onChanged race — listener wins over a late getItem resolution', async () => {
    // Scenario: a background refreshAvailableModels lands a fresh list into
    // storage right after Options mounts but BEFORE the picker's initial
    // getItem resolves. A naive implementation has getItem's `.then`
    // overwrite the fresh value with the stale one. We pin the fresh value.
    storage['codex_available_models'] = ['stale-1'];

    // Replace chrome.storage.local.get with a deferred Promise so we can
    // resolve it after the onChanged tick.
    let resolveGet!: (v: any) => void;
    const getPromise = new Promise<any>((r) => { resolveGet = r; });
    (globalThis as any).chrome.storage.local.get = vi.fn().mockReturnValue(getPromise);

    const { CodexModelPicker } = await import('../options/codex-model-picker');
    render(<CodexModelPicker value="stale-1" onChange={() => {}} />);

    // Fire the onChanged tick BEFORE getItem resolves — simulates a fast
    // background discovery write that races the initial hydrate.
    await act(async () => {
      for (const l of listeners) {
        l({ codex_available_models: { oldValue: ['stale-1'], newValue: ['fresh-1', 'fresh-2'] } }, 'local');
      }
    });

    // Now resolve the late getItem with the STALE value (what it would have
    // observed if it had been awaited before the listener fired).
    await act(async () => {
      resolveGet({ codex_available_models: ['stale-1'] });
      await Promise.resolve();
    });

    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    // The fresh list from the listener must win — the late getItem must NOT
    // clobber it back to the stale one.
    expect(opts).toEqual(['fresh-1', 'fresh-2']);
  });

  it('cycle 5: chrome.storage listener is removed on unmount', async () => {
    storage['codex_available_models'] = ['gpt-5.2'];
    const { CodexModelPicker } = await import('../options/codex-model-picker');
    const { unmount } = render(<CodexModelPicker value="gpt-5.2" onChange={() => {}} />);
    await screen.findByRole('combobox');

    const addCalls = (chrome.storage.onChanged.addListener as any).mock.calls.length;
    const removeCallsBefore = (chrome.storage.onChanged.removeListener as any).mock.calls.length;
    expect(addCalls).toBeGreaterThan(0);

    unmount();

    const removeCallsAfter = (chrome.storage.onChanged.removeListener as any).mock.calls.length;
    expect(removeCallsAfter - removeCallsBefore).toBe(1);
    // And the listener Set in the shim should be empty again.
    expect(listeners.size).toBe(0);
  });
});
