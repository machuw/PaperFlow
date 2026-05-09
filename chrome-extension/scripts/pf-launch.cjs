// Launch persistent Chromium with PaperFlow extension loaded.
// Used by playwright-cli `attach --cdp` to connect afterwards.
const { chromium } = require('playwright');
const path = require('path');

const EXT = '/Users/mayuanchao/Workspace/PaperFlow-Design/chrome-extension/dist';
const PROFILE = process.env.PROFILE || '/tmp/pf-playwright-profile';

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--remote-debugging-port=9333',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  // Wait for the SW to register.
  await new Promise(r => setTimeout(r, 2000));
  const sws = ctx.serviceWorkers();
  console.log('Service workers:', sws.map(sw => sw.url()));
  console.log('CDP endpoint: http://localhost:9333');
  console.log('Profile:', PROFILE);
  // Keep alive
  await new Promise(() => {});
})();
