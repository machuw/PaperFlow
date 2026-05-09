import { test, expect } from './_fixtures';
import { seedConfigs } from './_helpers';

/**
 * Phase 13 (UI-01 + UI-02): top-bar BYOK chip + popover + AccountMenu rename.
 *
 * Pre-conditions:
 *   - Extension built from chrome-extension/dist (Playwright fixtures load it).
 *   - The reader page lives at chrome-extension://<id>/reader/index.html?e2e=fake-paper.
 *
 * Coverage map (≥13 cases — base T1-T10 plus C-6 T13/T14/T15):
 *   T1  Chip renders in TopBar between QuotaChip and AccountMenu
 *   T2  0-active chip shows "+ Set up BYOK" CTA + dashed border (data-state="empty")
 *   T3  0-active chip click jumps to Options page (does NOT open popover)
 *   T4  With saved active config, chip shows `Name · Model` text
 *   T5  Click chip → popover opens; row click → setActive + popover closes; chip text updates
 *   T6  Esc closes popover
 *   T7  Click outside popover closes it
 *   T8  AccountMenu trigger uses User-silhouette icon (NOT the gear)
 *   T9  AccountMenu (signed-out) does NOT contain "BYOK settings" text
 *   T10 AccountMenu trigger title reflects renamed account.header
 *   T11 i18n locale switch — chip + popover render in target locale (zh-CN)
 *   T12 Popover edit-button click does NOT swap active (C-2 stopPropagation)
 *
 *   T13 (C-6 a) unreachable banner end-to-end (seed unhealthy cache + open
 *       popover + assert banner with name + doc-link target)
 *   T14 (C-6 b) logged-in BYOK menu deletion (fake sb-*-auth-token via
 *       addInitScript + open AccountMenu + assert no `account.byok.settings`
 *       text in rendered DOM)
 *   T15 (C-6 c) mount-time Options probe + chip flips healthy <5s (stub
 *       localhost `/v1/models` server + open Options + assert green chip)
 */

import { createServer, type Server } from 'node:http';

const READER_PATH = 'reader/index.html?e2e=fake-paper';

test.describe('Phase 13 · BYOK chip + popover (UI-01)', () => {
  test('T1: chip renders in TopBar between QuotaChip and AccountMenu', async ({ context, extensionId }) => {
    await seedConfigs(context, extensionId, [
      { id: 'cfg-1', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', isActive: true, apiKey: 'sk-test' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    const chip = page.locator('.byok-chip');
    await expect(chip).toBeVisible({ timeout: 5_000 });

    // DOM ordering: QuotaChip → BYOKChip → AccountMenu (top-bar.tsx:141-147)
    // Use compareDocumentPosition for layout-independent ordering. Bit 4 means
    // "this comes before other"; bit 2 means "other comes before this".
    const ordering = await page.evaluate(() => {
      const chipAnchor = document.querySelector('.byok-chip-anchor');
      const accountAnchor = document.querySelector('.account-menu-anchor');
      if (!chipAnchor || !accountAnchor) return null;
      // bit 4 (DOCUMENT_POSITION_FOLLOWING) means accountAnchor follows chipAnchor
      const pos = chipAnchor.compareDocumentPosition(accountAnchor);
      return { chipFirst: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    expect(ordering?.chipFirst).toBeTruthy();

    await page.close();
  });

  test('T2: 0-active chip shows + Set up BYOK and data-state=empty', async ({ context, extensionId }) => {
    await seedConfigs(context, extensionId, []);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    const chip = page.locator('.byok-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-state', 'empty');
    // Default-locale en — "Set up BYOK" matches; tolerate locale variants
    await expect(chip).toContainText(/Set up BYOK|配置 BYOK|設定 BYOK|BYOK を設定|BYOK 설정|Configurer BYOK|BYOK einrichten|Configurar BYOK|Настроить BYOK/i);

    await page.close();
  });

  test('T3: 0-active chip click does NOT open popover (jumps to Options page)', async ({ context, extensionId }) => {
    await seedConfigs(context, extensionId, []);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    const popoverBefore = await page.locator('.byok-popover-panel').count();
    expect(popoverBefore).toBe(0);

    // Listen for the new tab/page targeting the options URL
    const newPagePromise = context.waitForEvent('page', { timeout: 3_000 }).catch(() => null);
    await page.locator('.byok-chip').click();

    // Popover MUST NOT open in 0-active state — chip onClick branches early
    // to chrome.runtime.openOptionsPage() (byok-chip.tsx:147)
    await page.waitForTimeout(300);
    expect(await page.locator('.byok-popover-panel').count()).toBe(0);

    // Cleanup any opened options page
    const opened = await newPagePromise;
    if (opened) await opened.close().catch(() => {});

    await page.close();
  });

  test('T4: chip with active config shows config name only (model in popover)', async ({ context, extensionId }) => {
    await seedConfigs(context, extensionId, [
      { id: 'cfg-1', name: 'My OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', isActive: true, apiKey: 'sk-test' },
      { id: 'cfg-2', name: 'My Local', baseUrl: 'http://localhost:8000/v1', model: 'claude-sonnet-4-5', isActive: false, apiKey: 'placeholder' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // Chip label = config name only per redesign (model shows in popover row).
    const chip = page.locator('.byok-chip');
    await expect(chip).toContainText('My OpenAI');
    await expect(chip).not.toContainText('gpt-4o');
    await expect(chip).toHaveAttribute('data-state', 'default');

    await page.close();
  });

  test('T5: row click switches active and closes popover', async ({ context, extensionId }) => {
    await seedConfigs(context, extensionId, [
      { id: 'cfg-1', name: 'My OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', isActive: true, apiKey: 'sk-test' },
      { id: 'cfg-2', name: 'My Local', baseUrl: 'https://e2e-mock.invalid/v1', model: 'claude-sonnet-4-5', isActive: false, apiKey: 'placeholder' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // Open popover
    await page.locator('.byok-chip').click();
    await expect(page.locator('.byok-popover-panel')).toBeVisible();

    // Pick the inactive row
    const rows = page.locator('.byok-popover-row');
    await expect(rows).toHaveCount(2);
    await rows.filter({ hasText: 'My Local' }).first().click();

    // Popover closes
    await expect(page.locator('.byok-popover-panel')).toBeHidden({ timeout: 2_000 });

    // Chip updates to new active (name-only label per current design)
    await expect(page.locator('.byok-chip')).toContainText('My Local');

    await page.close();
  });

  test('T6: Esc closes popover', async ({ context, extensionId }) => {
    await seedConfigs(context, extensionId, [
      { id: 'cfg-1', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', isActive: true, apiKey: 'sk-test' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    await page.locator('.byok-chip').click();
    await expect(page.locator('.byok-popover-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.byok-popover-panel')).toBeHidden({ timeout: 1_000 });

    await page.close();
  });

  test('T7: outside-click closes popover', async ({ context, extensionId }) => {
    await seedConfigs(context, extensionId, [
      { id: 'cfg-1', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', isActive: true, apiKey: 'sk-test' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    await page.locator('.byok-chip').click();
    await expect(page.locator('.byok-popover-panel')).toBeVisible();
    // Click somewhere clearly outside (paper body area, well away from chip + popover)
    await page.mouse.click(100, 600);
    await expect(page.locator('.byok-popover-panel')).toBeHidden({ timeout: 1_000 });

    await page.close();
  });

  test('T11: i18n locale switch — popover renders zh-CN strings', async ({ context, extensionId }) => {
    await seedConfigs(context, extensionId, [
      { id: 'cfg-1', name: '本地模型', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', isActive: true, apiKey: 'sk-test' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // Switch UI language via i18n.ts's storage key 'config_uiLanguage'.
    // useT() listens to chrome.storage.onChanged; flipping the key re-renders
    // all consumers including BYOKChip. Reload also forces a clean re-init.
    await page.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      await c.storage.local.set({ config_uiLanguage: 'zh-CN' });
    });
    await page.reload();
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    await page.locator('.byok-chip').click();
    const heading = page.locator('.byok-popover-heading');
    await expect(heading).toBeVisible();
    // zh-CN: 'topbar.byok-popover.heading' = '模型'
    await expect(heading).toHaveText('模型');
    // CTA buttons in zh-CN: '+ 新建配置' and '管理全部 →'
    await expect(page.locator('.byok-popover-cta-new')).toContainText(/新建配置/);
    await expect(page.locator('.byok-popover-cta-manage')).toContainText(/管理全部/);

    await page.close();
  });

  test('T12: edit-icon click does NOT swap active (C-2 stopPropagation)', async ({ context, extensionId }) => {
    await seedConfigs(context, extensionId, [
      { id: 'cfg-1', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', isActive: true, apiKey: 'sk-test' },
      { id: 'cfg-2', name: 'Local', baseUrl: 'https://e2e-mock.invalid/v1', model: 'claude-sonnet-4-5', isActive: false, apiKey: 'placeholder' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    await page.locator('.byok-chip').click();
    await expect(page.locator('.byok-popover-panel')).toBeVisible();

    // Click edit on the inactive row — must NOT swap-active.
    const inactiveRow = page.locator('.byok-popover-row').filter({ hasText: 'Local' }).first();
    const editBtn = inactiveRow.locator('.byok-popover-row-edit');
    // Capture any popped-out Options tab (edit also calls openOptionsPage)
    const newPagePromise = context.waitForEvent('page', { timeout: 3_000 }).catch(() => null);
    await editBtn.click();
    const opened = await newPagePromise;
    if (opened) await opened.close().catch(() => {});

    // Chip text MUST still reflect the original active config (OpenAI · gpt-4o)
    // — the click did NOT propagate to the row's onSelectRow handler.
    await expect(page.locator('.byok-chip')).toContainText('OpenAI');
    await expect(page.locator('.byok-chip')).toContainText('gpt-4o');

    await page.close();
  });
});

test.describe('Phase 13 · AccountMenu rename + icon swap (UI-02)', () => {
  test('T8: AccountMenu trigger uses User silhouette icon (NOT gear)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    const trigger = page.locator('.account-menu-anchor button').first();
    await expect(trigger).toBeVisible();

    // Icon path data — User: 'M3 14c0-2.5 ...'  vs Gear: 'M8 1.5v2 ...'
    // (icons.tsx:35 vs icons.tsx:68). Single-path SVG distinguishes via the
    // `d` attribute prefix.
    const pathD = await trigger.locator('svg path').first().getAttribute('d');
    expect(pathD).toContain('M3 14');         // User silhouette signature
    expect(pathD).not.toContain('M8 1.5v2');  // gear signature absent

    await page.close();
  });

  test('T9: BYOK settings link absent from AccountMenu (signed-out path)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // Open AccountMenu (signed-out — primary CTA + BYOK status row, no actions list)
    await page.locator('.account-menu-anchor button').first().click();
    await expect(page.locator('.account-menu-panel')).toBeVisible({ timeout: 3_000 });
    const panelText = await page.locator('.account-menu-panel').textContent();
    // The translated value of 'account.byok.settings' MUST NOT appear in the
    // rendered menu — JSX consumer was deleted in Plan 13-03 D-C3.
    expect(panelText).not.toMatch(/BYOK\s+(settings|设置|設定|설정|Paramètres|Einst|Ajustes|Настройки)/i);

    await page.close();
  });

  test('T10: AccountMenu trigger title reflects renamed account.header', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    const trigger = page.locator('.account-menu-anchor button').first();
    const title = await trigger.getAttribute('title');
    // Plan 13-01 rewrote account.header from 'Account' → 'Settings' / '设置' / etc.
    // Default e2e locale is 'auto' (browser-detected); accept any of the 9 locale values.
    expect(title).toMatch(/Settings|设置|設定|설정|Paramètres|Einstellungen|Ajustes|Настройки/);
    expect(title).not.toBe('Account');

    await page.close();
  });
});

// ─────────────────────────────────────────────────────────────────────
// C-6 acceptance tests added 2026-05-01 iter-2 (--reviews mode)
// T13: unreachable banner end-to-end (C-6 a)
// T14: logged-in BYOK menu deletion (C-6 b)
// T15: mount-time Options probe + chip flip (C-6 c)
// ─────────────────────────────────────────────────────────────────────

test.describe('Phase 13 · C-6 (cross-AI review consensus) acceptance', () => {
  test('T13: unreachable banner shows in popover with doc-link target', async ({ context, extensionId }) => {
    // Seed an active localhost config.  The chip's mount-time probe will
    // fire against http://localhost:9 (RFC discard port — never listens),
    // which writes byokHealthCache[cfg-local] = { healthy:false } and the
    // popover renders the amber banner.
    //
    // We also pre-seed the byokHealthCache directly so the assertion does
    // not race the mount probe (~1-2s budget).
    await seedConfigs(context, extensionId, [
      { id: 'cfg-local', name: 'My Wrapper', baseUrl: 'http://localhost:9/v1', model: 'sonnet', isActive: true, apiKey: 'placeholder' },
    ]);
    const sw = context.serviceWorkers().find((s) => s.url().includes(extensionId)) ?? await context.waitForEvent('serviceworker');
    await sw.evaluate(async (args) => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      await c.storage.local.set({
        byokHealthCache: {
          [args.id]: { ts: Date.now(), healthy: false, reason: 'ECONNREFUSED' },
        },
      });
    }, { id: 'cfg-local' });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    await page.locator('.byok-chip').click();
    const banner = page.locator('.byok-popover-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    // Banner contains the config name (interpolation works)
    await expect(banner).toContainText(/My Wrapper/);
    // Banner has a doc-link button (translatable text — match any of 9 locales)
    const docLink = banner.locator('.byok-popover-banner-link');
    await expect(docLink).toBeVisible();
    await expect(docLink).toContainText(/View setup guide|查看启动文档|查看啟動文件|セットアップ手順|설치 가이드|guide d'installation|Setup-Anleitung|guía de configuración|руководство/i);

    // Click target — verify chrome.tabs.create is called with the bundled
    // wrapper-setup doc URL. The .md file triggers a download in Chrome
    // (Chrome does NOT render markdown as HTML), so the new tab closes
    // immediately without a navigation event firing — observing the URL on
    // the popped page is unreliable. Instead, monkey-patch chrome.tabs.create
    // BEFORE the click so it stashes the URL on window.__capturedDocUrl.
    await page.evaluate(() => {
      const w = window as unknown as { __capturedDocUrl?: string };
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const original = c.tabs.create;
      (c.tabs as unknown as { create: typeof original }).create =
        ((props: chrome.tabs.CreateProperties, cb?: (tab: chrome.tabs.Tab) => void) => {
          w.__capturedDocUrl = props.url ?? '';
          // Forward to original. chrome.tabs.create types require cb but at
          // runtime it's optional; cast to suppress TS2554 and TS2345.
          return original.call(c.tabs, props, cb as (tab: chrome.tabs.Tab) => void);
        }) as typeof original;
    });
    await docLink.click();
    // Poll for the captured URL (the click → onBannerLinkClick → chrome.tabs.create
    // chain is synchronous on the page, so 1s is plenty).
    const capturedUrl = await page.waitForFunction(
      () => (window as unknown as { __capturedDocUrl?: string }).__capturedDocUrl ?? null,
      null,
      { timeout: 5_000 },
    ).then((h) => h.jsonValue() as Promise<string>);
    // Doc URL is chrome-extension://<id>/docs/2026-04-29-claude-code-via-litellm.md
    expect(capturedUrl).toMatch(/^chrome-extension:\/\/[a-z]+\/docs\/2026-04-29-claude-code-via-litellm\.md(?:[?#].*)?$/);

    await page.close();
  });

  test('T14: logged-in AccountMenu does NOT contain BYOK settings link', async ({ context, extensionId }) => {
    // Seed an authenticated session via init script (per agent-dev-demo.e2e.spec.ts:85-123 precedent).
    // The supabase storage key is sb-<URL_HASH>-auth-token; intercept any
    // get for a key containing 'auth-token' and return a fake session.
    await context.addInitScript(() => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const originalGet = c.storage.local.get.bind(c.storage.local);
      (c.storage.local as unknown as { get: typeof originalGet }).get =
        ((keys: unknown, cb?: unknown) => {
          const key = typeof keys === 'string' ? keys : null;
          if (key && key.includes('auth-token')) {
            const fakeSession = JSON.stringify({
              access_token: 'fake-jwt-for-e2e',
              token_type: 'bearer',
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              refresh_token: 'fake-refresh',
              user: {
                id: '00000000-0000-0000-0000-000000000099',
                aud: 'authenticated',
                email: 'phase13@e2e.test',
              },
            });
            const result = { [key]: fakeSession };
            if (typeof cb === 'function') {
              (cb as (v: unknown) => void)(result);
              return undefined as unknown as Promise<unknown>;
            }
            return Promise.resolve(result);
          }
          return originalGet(keys as never, cb as never);
        }) as typeof originalGet;
    });

    await seedConfigs(context, extensionId, [
      { id: 'cfg-1', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', isActive: true, apiKey: 'sk-test' },
    ]);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${READER_PATH}`);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });

    // Open AccountMenu
    await page.locator('.account-menu-anchor button').first().click();
    await expect(page.locator('.account-menu-panel')).toBeVisible({ timeout: 3_000 });

    // The 'BYOK settings' menu item must NOT appear in the rendered DOM
    // post-Plan-13-03 (the JSX consumer was deleted; the i18n key remains
    // but is no longer referenced). Strict negative assertion across all
    // 9 locales.
    const panelText = await page.locator('.account-menu-panel').textContent();
    expect(panelText).not.toMatch(/BYOK\s+(settings|设置|設定|설정|Paramètres|Einst|Ajustes|Настройки)/i);

    // Stronger: assert against rendered HTML innerHTML
    const html = await page.locator('.account-menu-panel').innerHTML();
    expect(html).not.toMatch(/BYOK\s+(settings|设置|設定|설정)/i);

    await page.close();
  });

  test('T15: mount-time Options probe flips chip to healthy within 5s', async ({ context, extensionId }) => {
    // Spawn a stub localhost server returning /v1/models 200 with a model list.
    // Mirrors byok-health-chip.e2e.spec.ts pattern (Phase 12 12-08).
    let stubReq = 0;
    const server: Server = createServer((req, res) => {
      stubReq += 1;
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(8999, '127.0.0.1', resolve));

    try {
      await seedConfigs(context, extensionId, [
        { id: 'cfg-local-stub', name: 'Stub Wrapper', baseUrl: 'http://localhost:8999/v1', model: 'sonnet', isActive: true, apiKey: 'placeholder' },
      ]);

      // Open the Options page (mount-time probe is the surface under test).
      const optionsPage = await context.newPage();
      await optionsPage.goto(`chrome-extension://${extensionId}/options/index.html`);

      // Plan 13-04 D-B3 #1 mount probe + Plan 13-02 Task 3 persistByokHealth +
      // Plan 13-04 C-5 listener cooperate: mount fires probe → probe resolves
      // → setHealthByConfigId updates → row re-renders. The healthy chip text
      // matches the en or zh-CN i18n value (Plan 13-04 D-E lift).
      const healthyText = optionsPage.getByText(/Healthy \(\d+ models?\)|已检测到（\d+ 个模型）/);
      await expect(healthyText).toBeVisible({ timeout: 5_000 });
      // Stub server received at least 1 request from the mount probe.
      expect(stubReq).toBeGreaterThanOrEqual(1);

      await optionsPage.close();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });
});
