import { test, expect } from './_fixtures';
import { mintTestUserJWT } from './_jwt-fixture'; // Phase 24 D-A1
import { randomUUID } from 'node:crypto';        // Phase 24 — unique e2e user ids per test

/**
 * Phase 15 Plan 15-04 Task 3 — System Models Options page e2e regression suite.
 *
 * Three scenarios mirroring `byok-configs-options.e2e.spec.ts:18-80`:
 *   1. Anonymous user → System Models section is HIDDEN (D-A2 / D-D2)
 *   2. Pro user → row visible + selectable; click radio writes
 *      `config_active_managed_model_id = 'claude-haiku-4-5-20251001'` to chrome.storage.local
 *   3. Free user → row visible + locked; 'Pro only' badge + 'Upgrade to Pro'
 *      button visible; click Upgrade calls supabase.functions.invoke
 *      ('create-checkout-session', { body: { tier: 'pro' } })
 *
 * Auth seed: Phase 24 mintTestUserJWT (real service-role-signed Supabase
 * session JWT) + context.addInitScript writing `sb-127-auth-token` storage
 * key (D-A1).
 *
 * NOTE: Run with `npx playwright test tests/e2e/managed-models-options.e2e.spec.ts`.
 * The vitest config explicitly excludes `tests/e2e/**` so this file is only
 * picked up by Playwright. The `checkpoint:human-verify` portion of Task 3
 * (manual UI smoke + Stripe Checkout test-mode click + reader toast smoke)
 * is deferred to user action post-merge — see Plan 15-04 SUMMARY.md.
 */

const OPTIONS_PATH = 'options/index.html';

// Supabase Edge Function URL — VITE_SUPABASE_URL is inlined at build time.
// In .env.local for dev/e2e it points to the local stack 127.0.0.1:54321
// (see CLAUDE.md "Local dev stack"). The extension's bundled supabase
// client invokes `${VITE_SUPABASE_URL}/functions/v1/<name>`.
const SUPABASE_URL = 'http://127.0.0.1:54321';
const MANAGED_MODELS_FN_URL = `${SUPABASE_URL}/functions/v1/managed-models`;
const CHECKOUT_FN_URL = `${SUPABASE_URL}/functions/v1/create-checkout-session`;

test.describe('Phase 15 · System Models Options page', () => {
  test('Scenario 1: anonymous user — System Models section is hidden', async ({ context, extensionId }) => {
    // Do NOT seed a session. The hasSession effect resolves to false; the
    // entire `## System Models` block is gated out (D-A2 / D-D2).
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // The heading text comes from t('options.managed-models.heading') — match
    // any locale spelling (en + 8 translations from Plan 15-04 Task 1).
    const headingPattern = /System Models|系统模型|系統模型|システムモデル|시스템 모델|Modèles système|Systemmodelle|Modelos del sistema|Системные модели/;
    const headingCount = await page.getByRole('heading', { name: headingPattern }).count();
    expect(headingCount).toBe(0);

    // Likewise no `Pro only` badge anywhere on the page.
    const badgeCount = await page.getByText(/Pro only|仅 Pro|僅 Pro|Pro 専用|Pro 전용|Pro uniquement|Nur Pro|Solo Pro|Только Pro/).count();
    expect(badgeCount).toBe(0);

    await page.close();
  });

  // Scenarios 2 + 3 unblocked Phase 24 via mintTestUserJWT (D-A1).

  test('Scenario 2: Pro user — row visible + selectable, click writes active id', async ({ context, extensionId }) => {
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

    // Mock GET /managed-models to return one Pro-unlocked model.
    await page.route(MANAGED_MODELS_FN_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          models: [{
            id: 'claude-haiku-4-5-20251001',
            display_name: 'claude-4.5-haiku',
            min_tier: 'pro',
            locked: false,
            provider: 'newapi',
            upstream_model: 'claude-haiku-4-5-20251001',
          }],
        }),
      });
    });

    await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // Heading visible (default en locale).
    await expect(page.getByRole('heading', { name: /System Models|系统模型|系統模型/ })).toBeVisible({ timeout: 5_000 });

    // Row content visible (display_name + id).
    await expect(page.getByText('claude-4.5-haiku').first()).toBeVisible();
    await expect(page.getByText('claude-haiku-4-5-20251001').first()).toBeVisible();

    // Radio is enabled (NOT disabled) since locked=false.
    const radio = page.locator('input[type="radio"][name="active-managed"]');
    await expect(radio).toBeVisible();
    await expect(radio).toBeEnabled();

    // Click radio → setItem writes to chrome.storage.local.
    await radio.click();

    // Read storage from the page context — chrome.storage.local persists across
    // ticks, so the write should be visible immediately after the click.
    const storedActiveId = await page.evaluate(async () => {
      const r = await chrome.storage.local.get('config_active_managed_model_id');
      return r['config_active_managed_model_id'];
    });
    expect(storedActiveId).toBe('claude-haiku-4-5-20251001');

    await page.close();
  });

  test('Scenario 3: Free user — locked row + Upgrade CTA invokes checkout', async ({ context, extensionId }) => {
    const { jwt, user_id, email } = await mintTestUserJWT(randomUUID().slice(0, 8), 'free');
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

    // Track checkout invocation via route interception. The supabase JS
    // client posts to the function URL with a JSON body — captured here.
    let checkoutInvokedWith: { tier?: string } | null = null;
    let openedCheckoutUrl: string | null = null;

    await page.route(MANAGED_MODELS_FN_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          models: [{
            id: 'claude-haiku-4-5-20251001',
            display_name: 'claude-4.5-haiku',
            min_tier: 'pro',
            locked: true,
            provider: 'newapi',
            upstream_model: 'claude-haiku-4-5-20251001',
          }],
        }),
      });
    });

    await page.route(CHECKOUT_FN_URL, async (route) => {
      const body = route.request().postDataJSON() as { tier?: string } | null;
      checkoutInvokedWith = body ?? {};
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://checkout.stripe.com/test_session_e2e_15_04' }),
      });
    });

    // Capture chrome.tabs.create — supabase invoke success path opens a new tab.
    await page.exposeFunction('__captureUrl', (url: string) => {
      openedCheckoutUrl = url;
    });
    await page.addInitScript(() => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const orig = c.tabs?.create?.bind(c.tabs);
      (c.tabs as unknown as { create: typeof orig }).create = ((opts: { url?: string }) => {
        if (opts?.url) (globalThis as unknown as { __captureUrl: (u: string) => void }).__captureUrl(opts.url);
        return orig ? orig(opts as never) : (Promise.resolve({} as never));
      }) as typeof orig;
    });

    await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // 'Pro only' badge visible.
    await expect(page.getByText(/Pro only|仅 Pro|僅 Pro|Pro 専用|Pro 전용|Pro uniquement|Nur Pro|Solo Pro|Только Pro/).first()).toBeVisible({ timeout: 5_000 });

    // Radio is disabled.
    const radio = page.locator('input[type="radio"][name="active-managed"]');
    await expect(radio).toBeDisabled();

    // 'Upgrade to Pro' button visible.
    const upgradeBtn = page.getByRole('button', { name: /Upgrade to Pro|升级到 Pro|升級到 Pro|Pro にアップグレード|Pro로 업그레이드|Passer à Pro|Auf Pro upgraden|Actualizar a Pro|Перейти на Pro/ });
    await expect(upgradeBtn).toBeVisible();

    // Click Upgrade → supabase.functions.invoke('create-checkout-session') →
    // chrome.tabs.create({ url: data.url }).
    await upgradeBtn.click();

    // Allow the route + tabs.create monkey-patch to settle.
    await page.waitForTimeout(500);

    expect(checkoutInvokedWith).not.toBeNull();
    expect((checkoutInvokedWith as unknown as { tier?: string })?.tier).toBe('pro');
    expect(openedCheckoutUrl).toBe('https://checkout.stripe.com/test_session_e2e_15_04');

    await page.close();
  });
});
