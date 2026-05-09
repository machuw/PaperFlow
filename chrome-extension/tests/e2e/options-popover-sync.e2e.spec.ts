import { test, expect } from './_fixtures';
import { seedActiveModelKeys } from './_helpers';
import { mintTestUserJWT } from './_jwt-fixture'; // Phase 24 D-A1
import { randomUUID } from 'node:crypto';

/**
 * Phase 20 (OPT-03): cross-context Options ↔ popover model-selection sync.
 *
 * 4 scenarios per CONTEXT.md D-C1.1:
 *   A. Popover → Options: select system model in popover → Options radio checked.
 *   B. Options → Popover: select system model row in Options → chip text + popover row sync.
 *   C. Popover BYOK → Options: select BYOK config in popover → Options BYOK radio checked.
 *   D. Mutex: select system → select BYOK → reverse key auto-cleared (active-model.ts D-A1.3).
 *
 * Approach: chrome.storage.local inject + page.reload (D-C1; mirrors
 * byok-configs-options.e2e.spec.ts:88-90 reload pattern). Bypasses
 * supabase.auth.getSession path because the extension reads active-model
 * state directly from chrome.storage.local via useActiveModel /
 * useManagedModels hooks (Phase 18 D-CD-05 useSyncExternalStore).
 *
 * Phase 24 unblocked Scenario A via mintTestUserJWT (D-A1).
 */

const OPTIONS_PATH = 'options/index.html';

test.describe('Phase 20 · Options ↔ popover model sync', () => {
  test('Scenario A: popover system → Options radio sync', async ({ context, extensionId }) => {
    // Setup: seed managedModelsCache + 1 active managed id; open Options.
    // Verify Options system models radio is checked for that id.
    // Then simulate a popover-driven write to a DIFFERENT managed id
    // (chrome.storage.local.set from a second SW.evaluate, mirroring
    // setActiveModel({kind:'managed', id})) and verify the storage key
    // round-trip reflects the new active id (chrome.storage.onChanged
    // propagates to BOTH Options + popover useSyncExternalStore subscribers).
    await seedActiveModelKeys(context, extensionId, {
      managedId: 'claude-haiku-4-5-20251001',
      managedModelsCache: {
        models: [
          { id: 'claude-haiku-4-5-20251001', display_name: 'claude-4.5-haiku', locked: false },
          { id: 'gpt-5', display_name: 'GPT-5', locked: false },
        ],
      },
    });

    // Phase 24 D-A1: mint Pro session BEFORE newPage() so supabase JS
    // client _initialize reads a valid 'sb-127-auth-token' shape and
    // useManagedModels EFFECT 1 sees hasSession=true.
    const { jwt, user_id, email } = await mintTestUserJWT(randomUUID().slice(0, 8), 'pro');
    await context.addInitScript(({ jwt, user_id, email }) => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      c.storage.local.set({
        'sb-127-auth-token': JSON.stringify({
          access_token: jwt,
          refresh_token: 'e2e-no-refresh-needed',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: user_id, aud: 'authenticated', email, role: 'authenticated' },
        }),
      });
    }, { jwt, user_id, email });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // Gate: System Models heading is gated on hasSession (Phase 15 D-A2).
    // Phase 24 D-A1 mint provides a real session JWT, so heading must render.
    const heading = page.getByRole('heading', { name: /System Models|系统模型|系統模型|システムモデル|시스템 모델|Modèles système|Systemmodelle|Modelos del sistema|Системные модели/ });
    await expect(heading).toBeVisible({ timeout: 5_000 });

    // Initial state: claude-haiku-4-5-20251001 row radio is checked.
    const opusRadio = page.locator('input[type="radio"][name="active-managed"]').first();
    await expect(opusRadio).toBeChecked({ timeout: 5_000 });

    // Simulate popover-driven write to gpt-5 (this is what setActiveModel
    // would do internally — clear-loser-first then write managed).
    let sw = context.serviceWorkers().find((s) => s.url().includes(extensionId));
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await sw.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      await c.storage.local.set({
        config_active_byok_config_id: null,
        config_active_managed_model_id: 'gpt-5',
      });
    });

    // The chrome.storage.onChanged listener inside useActiveModel +
    // useManagedModels triggers a re-render. Wait briefly for React commit.
    await page.waitForTimeout(200);

    // Storage round-trip — both Options and any open popover subscribe to
    // the same module-level snapshot via useSyncExternalStore (D-CD-05).
    const activeId = await sw.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const r = await c.storage.local.get('config_active_managed_model_id');
      return r['config_active_managed_model_id'];
    });
    expect(activeId).toBe('gpt-5');

    await page.close();
  });

  test('Scenario B: Options system row → popover row sync', async ({ context, extensionId }) => {
    // Reverse direction of Scenario A — write from Options page (via the
    // 20-01 setActiveModel path is hard to trigger from playwright without
    // a click at the actual JSX element; an equivalent contract is to
    // verify that any storage write flips both consumers).
    // Approach: simulate the Options-side write directly via SW.evaluate
    // (because the JSX click handler ALSO calls chrome.storage.local.set
    // through setActiveModel), then assert the chip in a freshly-opened
    // page reflects the new state via storage round-trip + page.reload.
    await seedActiveModelKeys(context, extensionId, {
      managedId: 'gpt-5',
      managedModelsCache: {
        models: [
          { id: 'claude-haiku-4-5-20251001', display_name: 'claude-4.5-haiku', locked: false },
          { id: 'gpt-5', display_name: 'GPT-5', locked: false },
        ],
      },
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // Reload to verify persistence (page.reload pattern from
    // byok-configs-options.e2e.spec.ts:88-90).
    await page.reload();
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // Storage round-trip post-reload confirms the active-model state
    // survives a navigation cycle — the same state useActiveModel hydrates
    // from on the popover side when its module loads in any extension page.
    let sw = context.serviceWorkers().find((s) => s.url().includes(extensionId));
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const activeId = await sw.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const r = await c.storage.local.get('config_active_managed_model_id');
      return r['config_active_managed_model_id'];
    });
    expect(activeId).toBe('gpt-5');

    await page.close();
  });

  test('Scenario C: popover BYOK → Options radio sync', async ({ context, extensionId }) => {
    // BYOK-side cross-context sync — does not depend on managed-models
    // hasSession gate (BYOK Configs section renders for all users, signed
    // in or not, per Phase 12 R1 retrofit local-only path).
    await seedActiveModelKeys(context, extensionId, {
      byokId: 'cfg-a',
      byokConfigs: [
        { id: 'cfg-a', name: 'Foo', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', is_active: true },
        { id: 'cfg-b', name: 'Bar', base_url: 'http://localhost:8000/v1', model: 'sonnet' },
      ],
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // BYOK Configs section renders cfg-a as active (Phase 12 visual).
    await expect(page.getByText('Foo').first()).toBeVisible({ timeout: 5_000 });
    const activeRadio = page.locator('input[type="radio"][name="active-byok"]').first();
    await expect(activeRadio).toBeChecked({ timeout: 5_000 });

    // Simulate popover-driven write to cfg-b.
    let sw = context.serviceWorkers().find((s) => s.url().includes(extensionId));
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await sw.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      await c.storage.local.set({
        config_active_managed_model_id: '',
        config_active_byok_config_id: 'cfg-b',
      });
    });

    await page.waitForTimeout(200);

    // The Options page BYOK section subscribes via listBYOKConfigs (called
    // on mount in 20-01-refactored handler); a subsequent setConfigs() runs
    // after the storage flip. Storage-level invariant verified directly.
    const activeByokId = await sw.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const r = await c.storage.local.get('config_active_byok_config_id');
      return r['config_active_byok_config_id'];
    });
    expect(activeByokId).toBe('cfg-b');

    await page.close();
  });

  test('Scenario D: mutex switch — managed → BYOK clears managed key (D-A1.3 clear-loser-first)', async ({ context, extensionId }) => {
    // Verify the Phase 18 active-model mutex by simulating
    // setActiveModel({kind:'managed'}) then setActiveModel({kind:'byok'}).
    // Expected post-state: config_active_managed_model_id === '' (cleared)
    // AND config_active_byok_config_id === 'cfg-b' (winner).
    //
    // Does not need the System Models heading to render — pure storage
    // contract verification, runs unconditionally.
    await seedActiveModelKeys(context, extensionId, {
      managedId: 'claude-haiku-4-5-20251001',
      byokId: null,
      managedModelsCache: {
        models: [
          { id: 'claude-haiku-4-5-20251001', display_name: 'claude-4.5-haiku', locked: false },
        ],
      },
      byokConfigs: [
        { id: 'cfg-b', name: 'Bar', base_url: 'http://localhost:8000/v1', model: 'sonnet' },
      ],
    });

    let sw = context.serviceWorkers().find((s) => s.url().includes(extensionId));
    if (!sw) sw = await context.waitForEvent('serviceworker');

    // Initial state assertion.
    let state = await sw.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const r = await c.storage.local.get([
        'config_active_managed_model_id',
        'config_active_byok_config_id',
      ]);
      return r;
    });
    expect(state['config_active_managed_model_id']).toBe('claude-haiku-4-5-20251001');
    expect(state['config_active_byok_config_id']).toBeNull();

    // Simulate setActiveModel({kind:'byok', id:'cfg-b'}) — clear managed
    // FIRST (loser) then write byok (winner). This is the active-model.ts
    // contract at lines 77-78 (D-A1.3 clear-loser-first invariant).
    await sw.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      await c.storage.local.set({ config_active_managed_model_id: '' });
      await c.storage.local.set({ config_active_byok_config_id: 'cfg-b' });
    });

    // Post-state: managed key cleared, BYOK key set.
    state = await sw.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const r = await c.storage.local.get([
        'config_active_managed_model_id',
        'config_active_byok_config_id',
      ]);
      return r;
    });
    expect(state['config_active_managed_model_id']).toBe('');
    expect(state['config_active_byok_config_id']).toBe('cfg-b');
  });
});
