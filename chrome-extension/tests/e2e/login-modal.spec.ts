import { test, expect } from './_fixtures';

/**
 * v1.1 todo `2026-04-28-email-login-two-step-ux-with-separate-otp-view` —
 * smoke-coverage for the two-step LoginModal landed in commit 63ac97f.
 *
 * Scope: verifies the email step renders the right elements (Google +
 * divider + email + send button + BYOK escape) and that ESC closes the
 * modal. The email→otp transition requires a live Supabase signInWithOtp
 * round-trip and is left to manual / integration coverage — too much
 * mock surface for an e2e smoke.
 */
test.describe('LoginModal · two-step email flow (email step)', () => {
  test('opens via signed-out account CTA with all email-step elements visible', async ({
    readerPage,
  }) => {
    await readerPage.locator('#root').waitFor({ state: 'visible' });

    // Open the AccountMenu (top-bar User icon trigger — Phase 13 D-A2 rename).
    // Title attribute is locale-bound; match the en label.
    // Phase 13 D-A2 renamed AccountMenu header from "Account" to "Settings".
    const accountTrigger = readerPage.locator('[title="Settings"]').first();
    await accountTrigger.click();

    // The signed-out CTA opens LoginModal.
    await readerPage.getByRole('button', { name: /Sign in/i }).first().click();

    // Email-step elements: Google button, divider "or", email input, send button.
    await expect(readerPage.getByRole('button', { name: 'Sign in with Google' }))
      .toBeVisible();
    await expect(readerPage.getByText('or', { exact: true })).toBeVisible();
    await expect(readerPage.getByPlaceholder('Your email')).toBeVisible();
    await expect(readerPage.getByRole('button', { name: 'Send OTP' })).toBeVisible();

    // BYOK escape link present in the email step (it's hidden on the OTP step).
    await expect(readerPage.getByText('Already have an API key?')).toBeVisible();
    await expect(readerPage.getByRole('button', { name: /Skip · use BYOK/ }))
      .toBeVisible();

    // OTP-step elements should NOT be visible until after a successful send.
    await expect(readerPage.getByText('Enter verification code')).toBeHidden();
    await expect(readerPage.getByText(/^← Back$/)).toBeHidden();
  });

  test('Escape closes the modal', async ({ readerPage }) => {
    await readerPage.locator('#root').waitFor({ state: 'visible' });

    // Phase 13 D-A2 renamed AccountMenu header from "Account" to "Settings".
    const accountTrigger = readerPage.locator('[title="Settings"]').first();
    await accountTrigger.click();
    await readerPage.getByRole('button', { name: /Sign in/i }).first().click();
    await expect(readerPage.getByRole('button', { name: 'Sign in with Google' }))
      .toBeVisible();

    await readerPage.keyboard.press('Escape');
    await expect(readerPage.getByRole('button', { name: 'Sign in with Google' }))
      .toBeHidden();
  });
});
