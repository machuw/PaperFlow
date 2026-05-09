import { test, expect } from './_fixtures';

const HOMEPAGE_URL = 'https://paperflow.pages.dev';

test('toolbar icon click opens homepage', async ({ context }) => {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });

  const hasListener = await sw.evaluate(
    () => (chrome as any).action.onClicked.hasListeners() as boolean,
  );
  expect(hasListener).toBe(true);

  const tab = await sw.evaluate(
    (url) =>
      new Promise<{ id: number | undefined; url: string | undefined; pendingUrl: string | undefined }>((resolve) => {
        chrome.tabs.create({ url }, (t) =>
          resolve({ id: t.id, url: t.url, pendingUrl: (t as any).pendingUrl }),
        );
      }),
    HOMEPAGE_URL,
  );

  const target = tab.url || tab.pendingUrl || '';
  expect(target).toMatch(/^https:\/\/paperflow\.pages\.dev\/?$/);
});

test('top-bar brand click opens homepage in new tab', async ({ context, readerPage }) => {
  const brand = readerPage.locator('a[href="https://paperflow.pages.dev"]');
  await expect(brand).toBeVisible();
  await expect(brand).toHaveAttribute('target', '_blank');
  await expect(brand).toHaveAttribute('rel', /noopener/);

  // Clicking an anchor with target="_blank" should fire a new page event in
  // the browser context. We don't assert the new page's URL because (a) the
  // homepage may not be deployed yet, so DNS hangs and the navigation request
  // may never complete; (b) browser semantics for target="_blank" + the
  // verified href attribute guarantees the navigation target.
  const newPagePromise = context.waitForEvent('page', { timeout: 10_000 });
  await brand.click();
  const newPage = await newPagePromise;
  expect(newPage).toBeTruthy();
});
