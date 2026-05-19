import { test, expect } from './_fixtures';

/**
 * Slice 1 #8 — Codex BYOK preset login UX, end-to-end.
 *
 * Exercises the full login → logged-in → logout flow in the Options page
 * with auth.openai.com endpoints intercepted via Playwright route mocks.
 * No real OpenAI traffic.
 *
 * Mock sequence (mirrors the production device flow):
 *   1. POST /api/accounts/deviceauth/usercode → returns user_code + device_auth_id
 *   2. POST /api/accounts/deviceauth/token → first call 403 (waiting),
 *      second call 200 (authorized) with authorization_code + code_verifier
 *   3. POST /oauth/token (grant_type=authorization_code) → 200 with
 *      access_token + refresh_token + id_token (payload contains email)
 *   4. UI flips to "Logged in as <email>" — codex_auth_user storage write
 *      triggers the panel's chrome.storage.onChanged listener
 *   5. Logout button → codex_auth_tokens + codex_auth_user cleared → UI
 *      flips back to the Log In button
 */

function fakeIdToken(email: string): string {
  const b64url = (s: string) =>
    Buffer.from(s).toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${b64url('{}')}.${b64url(JSON.stringify({ email }))}.sig`;
}

test.describe('Codex BYOK preset · login UX', () => {
  test('full device-flow login → logged-in display → logout', async ({ context, extensionId }) => {
    const page = await context.newPage();

    // Install OAuth mocks BEFORE navigation so the Options page's initial
    // mount + the eventual login click both hit fakes.
    let pollCount = 0;
    await context.route('**/auth.openai.com/api/accounts/deviceauth/usercode', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          device_auth_id: 'e2e-device-id',
          user_code: 'E2E-CODE',
          interval: '1',
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        }),
      });
    });
    await context.route('**/auth.openai.com/api/accounts/deviceauth/token', (route) => {
      pollCount += 1;
      if (pollCount === 1) {
        void route.fulfill({ status: 403, body: 'pending' });
      } else {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            authorization_code: 'e2e-auth-code',
            code_verifier: 'e2e-verifier',
          }),
        });
      }
    });
    await context.route('**/auth.openai.com/oauth/token', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'e2e-access',
          refresh_token: 'e2e-refresh',
          id_token: fakeIdToken('e2e@example.com'),
          expires_in: 864_000,
          token_type: 'bearer',
        }),
      });
    });
    // chrome.tabs.create opens auth.openai.com/codex/device in a new tab.
    // The test doesn't drive that tab — we just need the request to not hang.
    await context.route('**/chatgpt.com/codex/device', (route) => {
      void route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' });
    });
    await context.route('**/auth.openai.com/codex/device', (route) => {
      void route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' });
    });

    await page.goto(`chrome-extension://${extensionId}/options/index.html`);
    await expect(page.locator('#root')).toBeVisible();

    // Open the new-config form (button label varies per locale).
    const newConfigBtn = page
      .getByRole('button')
      .filter({ hasText: /New config|新建|新規|새|nouvelle|новая|nueva|neue/i });
    await newConfigBtn.click();

    // Switch the preset select to openai-codex (the only stable selector
    // since the label varies per locale).
    const presetSelect = page
      .locator('select')
      .filter({ has: page.locator('option[value="openai-codex"]') })
      .first();
    await presetSelect.selectOption('openai-codex');

    // Codex panel renders the login button.
    const loginBtn = page.getByRole('button', {
      name: /Log in with ChatGPT|ChatGPT.*[登入|로그인|ログイン]|connecter avec ChatGPT|anmelden|войти/i,
    });
    await expect(loginBtn).toBeVisible();
    await loginBtn.click();

    // Pending state: user_code is rendered prominently.
    await expect(page.getByText('E2E-CODE')).toBeVisible({ timeout: 5_000 });

    // After ~1s the second poll fires, returns 200, token exchange happens,
    // codex_auth_user is written, and the panel listener flips us to
    // "Logged in as e2e@example.com" (label translated per locale, but
    // the email substring is stable).
    await expect(page.getByText(/e2e@example\.com/)).toBeVisible({ timeout: 10_000 });

    // Logout button → back to initial state.
    const logoutBtn = page.getByRole('button', {
      name: /Log out|退出|登出|로그아웃|ログアウト|déconnecter|abmelden|cerrar sesión|выйти/i,
    });
    await logoutBtn.click();
    await expect(loginBtn).toBeVisible({ timeout: 5_000 });
  });
});
