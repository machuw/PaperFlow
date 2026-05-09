/**
 * Quick 260506-8ov telemetry e2e — verify the dist gate emits
 * `[pf-chat-telemetry]` end-to-end.
 *
 * Strategy: load dist as unpacked extension, set storage flag, open options
 * page (no auth required, no paper needed), dynamically import the same
 * `byok-health-check` chunk that ships with the reader page, then invoke
 * `callAI({ kind: 'chat', telemetry })`. The proxy path will throw (no
 * Supabase session in this throwaway profile), but the telemetry hook fires
 * in `finally` regardless of outcome — `status: 'error'` proves the path.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const PROFILE = path.join(__dirname, '.tmp-profile-telemetry-e2e');

function findBundleFilename(name) {
  const files = fs.readdirSync(path.join(DIST, 'assets'));
  const match = files.find((f) => f.startsWith(name + '-') && f.endsWith('.js'));
  if (!match) throw new Error('chunk not found: ' + name);
  return match;
}

(async () => {
  if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });

  const byokChunk = findBundleFilename('byok-health-check');
  console.log('byok chunk:', byokChunk);

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,                       // MV3 SW does not register in headless mode
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-sandbox',
      '--headless=new',                    // newer headless mode supports extensions
      '--no-first-run',
    ],
  });

  // Open a blank page first to wake the runtime; then wait for SW.
  const warmup = await ctx.newPage();
  await warmup.goto('about:blank');

  let sw = ctx.serviceWorkers()[0];
  if (!sw) {
    try { sw = await ctx.waitForEvent('serviceworker', { timeout: 8000 }); }
    catch { /* SW may not register before extension page is opened */ }
  }
  if (!sw) {
    // Fallback — derive ext id from extension manifest reachable through chrome://extensions.
    // We can also poll service workers periodically.
    for (let i = 0; i < 10 && !sw; i++) {
      await new Promise((r) => setTimeout(r, 500));
      sw = ctx.serviceWorkers()[0];
    }
  }
  if (!sw) {
    await ctx.close();
    throw new Error('service worker did not register (extension load failed?)');
  }
  await warmup.close();
  const extId = new URL(sw.url()).host;
  console.log('extension id:', extId);

  const page = await ctx.newPage();
  const consoleLines = [];
  page.on('console', (msg) => {
    const t = msg.text();
    consoleLines.push({ type: msg.type(), text: t });
    if (t.includes('pf-chat-telemetry') || t.includes('[ai] callAI')) {
      console.log('  >>', msg.type(), t.slice(0, 220));
    }
  });
  page.on('pageerror', (err) => console.log('  !! pageerror:', err.message.slice(0, 200)));

  await page.goto(`chrome-extension://${extId}/options/index.html`, { waitUntil: 'domcontentloaded' });

  // Set the opt-in flag.
  await page.evaluate(() => chrome.storage.local.set({ 'debug:chatTelemetry': true }));
  const stored = await page.evaluate(() => chrome.storage.local.get('debug:chatTelemetry'));
  console.log('storage set →', stored);

  // Dynamically import the byok-health-check chunk that contains callAI.
  // Vite minifies the export names, so we identify callAI by its source signature
  // (the function body contains `[ai] callAI kind=` literally) rather than by name.
  const chunkURL = `chrome-extension://${extId}/assets/${byokChunk}`;
  const result = await page.evaluate(async (url) => {
    try {
      const mod = await import(url);
      const keys = Object.keys(mod);
      let callAIKey = null;
      for (const k of keys) {
        const v = mod[k];
        if (typeof v === 'function' && /\[ai\] callAI kind=/.test(v.toString())) {
          callAIKey = k;
          break;
        }
      }
      return { exportCount: keys.length, callAIKey };
    } catch (err) {
      return { error: String(err) };
    }
  }, chunkURL);
  console.log('module probe →', result);

  if (result.callAIKey) {
    console.log(`--- invoking callAI (export key '${result.callAIKey}') ---`);
    const invokeResult = await page.evaluate(async ({ url, key }) => {
      const mod = await import(url);
      const callAI = mod[key];
      const messages = [
        { role: 'system', content: 'You are a helpful assistant grounded in the paper. [p1]' },
        { role: 'user', content: '请总结一下这篇论文的核心贡献。' },
      ];
      try {
        await callAI(messages, 'chat', () => {}, {
          telemetry: { paperId: 'test-paper-id', sessionId: 'test-session-id' },
        });
        return { threw: false };
      } catch (err) {
        return {
          threw: true,
          code: err && err.code ? err.code : null,
          msg: String(err && err.message ? err.message : err).slice(0, 200),
        };
      }
    }, { url: chunkURL, key: result.callAIKey });
    console.log('callAI result →', invokeResult);
  } else {
    console.log('callAI not directly exported — falling back: byok-health-check is internal helper.');
    console.log('Trying reader chunk instead…');
    const readerChunk = findBundleFilename('reader');
    const readerURL = `chrome-extension://${extId}/assets/${readerChunk}`;
    const readerResult = await page.evaluate(async (url) => {
      try {
        const mod = await import(url);
        return { exports: Object.keys(mod).slice(0, 30) };
      } catch (err) { return { error: String(err) }; }
    }, readerURL);
    console.log('reader chunk →', readerResult);
  }

  // Drain final logs.
  await new Promise((r) => setTimeout(r, 1500));

  const telemetryLines = consoleLines.filter((l) => l.text.includes('pf-chat-telemetry'));
  console.log('\n=== RESULT ===');
  console.log('console lines captured:', consoleLines.length);
  console.log('[pf-chat-telemetry] lines:', telemetryLines.length);
  for (const l of telemetryLines) console.log('  ', l.type, l.text.slice(0, 400));

  await ctx.close();
  process.exit(telemetryLines.length > 0 ? 0 : 2);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(3);
});
