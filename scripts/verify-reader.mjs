#!/usr/bin/env node
// Automated smoke test for PaperFlow reader — loads the built extension into
// Chromium, navigates to a paper, waits for render, and reports on what's
// actually in the DOM (figures, imgs, blocks, failed image loads, console
// errors). Skips the need to rebuild + reload manually in chrome://extensions.
//
// Usage:
//   node scripts/verify-reader.mjs [arxivId | full-url]
//   node scripts/verify-reader.mjs 2604.05015               → /pdf/ (PDF canvas)
//   node scripts/verify-reader.mjs https://arxiv.org/abs/2604.05015  → HTML
//   node scripts/verify-reader.mjs https://arxiv.org/html/2604.05015 → HTML
//
// Env:
//   PF_HEADLESS=1  run headless (default: headed so you can watch)
//   PF_KEEP=1      keep browser open after report (default: closes in 2s)

import { chromium } from '/Users/mayuanchao/.nvm/versions/node/v22.14.0/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = resolve(repoRoot, 'chrome-extension/dist');
const arg = process.argv[2] || '2604.05015';
// Accept either a raw arxiv id (default to /pdf/ which triggers PDF canvas
// mode) or a full URL so you can exercise either rendering path.
const paperUrl = /^https?:\/\//.test(arg) ? arg : `https://arxiv.org/pdf/${arg}`;
const arxivId = (arg.match(/(\d{4}\.\d{4,5})/) || [])[1] || arg;

if (!existsSync(resolve(extDir, 'manifest.json'))) {
  console.error(`✗ No built extension at ${extDir}`);
  console.error(`  Run: cd chrome-extension && npm run build`);
  process.exit(1);
}

// Read extension id strategy: Chrome assigns a random id to unpacked extensions,
// but we can read the manifest's "key" field or just discover the id via the
// chrome.runtime URL emitted by one of the extension pages.
const manifest = JSON.parse(readFileSync(resolve(extDir, 'manifest.json'), 'utf-8'));
console.log(`→ Loading extension "${manifest.name}" v${manifest.version} from ${extDir}`);
console.log(`→ Paper: ${paperUrl}`);

const userDataDir = mkdtempSync(resolve(tmpdir(), 'pf-verify-'));
const headless = process.env.PF_HEADLESS === '1';

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
  ],
});

// Discover the extension id by waiting for the service worker to register.
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10_000 });
const extId = sw.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];
if (!extId) {
  console.error('✗ Could not discover extension id from service worker URL:', sw.url());
  await ctx.close();
  process.exit(1);
}
console.log(`→ Extension id: ${extId}`);

const page = ctx.pages()[0] || (await ctx.newPage());
// Reader expects a RAW url in the hash (matches the DNR regexSubstitution
// behavior which doesn't url-encode the matched group).
const readerUrl = `chrome-extension://${extId}/reader/index.html#src=${paperUrl}`;

// Capture console errors + failed image requests.
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

const imgResults = []; // {url, status, ok}
page.on('response', (res) => {
  const req = res.request();
  if (req.resourceType() === 'image') {
    imgResults.push({ url: res.url(), status: res.status(), ok: res.ok() });
  }
});

console.log(`→ Opening ${readerUrl}`);
await page.goto(readerUrl);

// Wait for content (HTML title, PDF canvas page, or error toast).
// PDF mode no longer renders a duplicate HTML <h1> header, so we also
// accept `.pf-pdf-page` as a success signal.
try {
  await page.waitForSelector('h1, .pf-pdf-page, [role="status"]', { timeout: 30_000 });
} catch (err) {
  const errShot = resolve(repoRoot, '.playwright-cli', `verify-${arxivId}-timeout.png`);
  await page.screenshot({ path: errShot, fullPage: true });
  const bodyHtml = await page.evaluate(() => document.body.innerHTML.slice(0, 500));
  console.error(`✗ Timeout waiting for content. Body so far:\n${bodyHtml}`);
  console.error(`Screenshot: ${errShot}`);
  if (consoleErrors.length > 0) {
    console.error('Console errors so far:');
    for (const e of consoleErrors) console.error('  ' + e.slice(0, 300));
  }
  await ctx.close();
  process.exit(1);
}

// Give lazy-load + async renders a moment to settle.
await page.waitForTimeout(1500);

// Query DOM: what's actually rendered?
const stats = await page.evaluate(() => {
  const ltxBlocks = Array.from(document.querySelectorAll('.ltx-block'));
  const pdfPages = Array.from(document.querySelectorAll('.pf-pdf-page'));
  const mode = pdfPages.length > 0 ? 'pdf' : 'html';
  const imgs = Array.from(document.querySelectorAll('img'));
  return {
    mode,
    figures: document.querySelectorAll('figure').length,
    imgs: imgs.length,
    imgSrcs: imgs.slice(0, 5).map((i) => i.getAttribute('src')),
    ltxBlocks: ltxBlocks.length,
    tables: document.querySelectorAll('table').length,
    equations: document.querySelectorAll('.ltx_equation').length,
    pdfPages: pdfPages.length,
    canvases: document.querySelectorAll('.pf-pdf-canvas').length,
    title: document.querySelector('h1')?.textContent?.slice(0, 80),
    venue: document.querySelector('[style*="var(--font-mono)"]')?.textContent?.slice(0, 80),
  };
});

// Scroll to bottom to trigger any lazy renders, wait, re-check.
await page.evaluate(() => {
  const scroll = document.querySelector('[data-reader-scroll]');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
});
// Wait for imgs to finish decoding (up to 15s), not just for network 200s.
try {
  await page.waitForFunction(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    if (imgs.length === 0) return true;
    return imgs.every((i) => i.complete);
  }, null, { timeout: 15_000 });
} catch { /* some imgs still decoding — report anyway */ }

const statsAfterScroll = await page.evaluate(() => {
  const imgs = Array.from(document.querySelectorAll('img'));
  return {
    imgs: imgs.length,
    imgsLoaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    imgsFailed: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    imgsPending: imgs.filter((i) => !i.complete).length,
  };
});

// Scroll back to top so the screenshot captures the paper opening
// (page 1) — otherwise we've just scrolled to bottom to trigger
// lazy-load and the shot would show the tail of the document.
await page.evaluate(() => {
  const scroll = document.querySelector('[data-reader-scroll]');
  if (scroll) scroll.scrollTop = 0;
});
await page.waitForTimeout(800);

const screenshotPath = resolve(repoRoot, '.playwright-cli', `verify-${arxivId}.png`);
await page.screenshot({ path: screenshotPath, fullPage: false });

// Layout-overlap check: only for paragraph/block siblings (not nested
// descendants). Flags genuine overlap like the ar5iv-transform bug where
// a table was offset outside its wrapper, shifting siblings up.
const overlapIssues = await page.evaluate(() => {
  const scroll = document.querySelector('[data-reader-scroll]');
  if (!scroll) return [];
  // Only top-level [data-pid] blocks — the paragraphs / rich-blocks that
  // should flow vertically. Skips nested <p>/<span> descendants that might
  // report "overlap" with their own container.
  const blocks = Array.from(scroll.querySelectorAll('[data-pid]'))
    .filter((el) => !el.parentElement?.closest('[data-pid]'));
  const issues = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    const a = blocks[i].getBoundingClientRect();
    const b = blocks[i + 1].getBoundingClientRect();
    if (a.height === 0 || b.height === 0) continue;
    // Flag when next block's TOP is meaningfully (> 5px) above current's BOTTOM.
    if (b.top < a.bottom - 5) {
      issues.push({
        i,
        curr: (blocks[i].textContent || '').slice(0, 60).trim(),
        next: (blocks[i + 1].textContent || '').slice(0, 60).trim(),
        overlap: Math.round(a.bottom - b.top),
      });
    }
  }
  return issues.slice(0, 5);
});
if (overlapIssues.length > 0) {
  console.log('\n⚠ Layout overlaps detected:');
  for (const o of overlapIssues) {
    console.log(`  block[${o.i}] overlaps next by ${o.overlap.toFixed(1)}px`);
    console.log(`    curr: "${o.curr}…"`);
    console.log(`    next: "${o.next}…"`);
  }
} else {
  console.log('\n✓ No content overlap — blocks flow cleanly in vertical order.');
}

// Also screenshot the table area (S5 experiments) so we can visually confirm.
try {
  const tableFig = await page.$('figure.ltx_table');
  if (tableFig) {
    await tableFig.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const tableShot = resolve(repoRoot, '.playwright-cli', `verify-${arxivId}-table.png`);
    await page.screenshot({ path: tableShot, fullPage: false });
    console.log(`📷 Table screenshot: ${tableShot}`);
  }
} catch { /* no tables in this paper */ }

// Report
console.log('\n══════ Render Report ══════');
console.log(`Mode:               ${stats.mode.toUpperCase()}${stats.mode === 'pdf' ? ' (canvas + text-layer)' : ' (ar5iv ltx-blocks)'}`);
console.log(`Title:              ${stats.title}`);
console.log(`Venue:              ${stats.venue}`);
if (stats.mode === 'pdf') {
  console.log(`.pf-pdf-page:       ${stats.pdfPages}`);
  console.log(`.pf-pdf-canvas:     ${stats.canvases}`);
} else {
  console.log(`<figure> elements:  ${stats.figures}`);
  console.log(`.ltx-block:         ${stats.ltxBlocks}`);
  console.log(`<img> elements:     ${stats.imgs}  (initial)`);
  console.log(`<img> after scroll: ${statsAfterScroll.imgs}`);
  console.log(`  loaded:           ${statsAfterScroll.imgsLoaded}`);
  console.log(`  failed (404 etc): ${statsAfterScroll.imgsFailed}`);
  console.log(`  pending:          ${statsAfterScroll.imgsPending}`);
  console.log(`<table> elements:   ${stats.tables}`);
  console.log(`.ltx_equation:      ${stats.equations}`);
}

if (stats.imgSrcs.length > 0) {
  console.log('\nFirst 5 img src attributes:');
  for (const s of stats.imgSrcs) console.log(`  ${s}`);
}

if (imgResults.length > 0) {
  console.log('\nImage network requests:');
  for (const r of imgResults.slice(0, 10)) {
    const marker = r.ok ? '✓' : '✗';
    console.log(`  ${marker} ${r.status}  ${r.url.slice(0, 100)}`);
  }
  const fails = imgResults.filter((r) => !r.ok);
  if (fails.length > 0) {
    console.log(`\n⚠ ${fails.length} image request(s) failed — likely the figure-rendering bug.`);
  }
}

if (consoleErrors.length > 0) {
  console.log('\nConsole errors:');
  for (const e of consoleErrors.slice(0, 5)) console.log(`  ${e.slice(0, 200)}`);
}

console.log(`\n📷 Screenshot: ${screenshotPath}`);

// Verdict
let verdict;
if (stats.mode === 'pdf') {
  verdict = stats.pdfPages > 0 && stats.canvases > 0
    ? `✓ PDF mode — ${stats.pdfPages} page skeleton(s), ${stats.canvases} canvas(es) rendered`
    : '✗ PDF mode selected but no .pf-pdf-page / canvas mounted';
} else {
  verdict = statsAfterScroll.imgsLoaded > 0
    ? `✓ HTML mode — ${statsAfterScroll.imgsLoaded} image(s) rendered successfully`
    : statsAfterScroll.imgsFailed > 0
      ? `✗ HTML mode — ${statsAfterScroll.imgsFailed} image(s) FAILED to load`
      : stats.imgs === 0
        ? '⚠ HTML mode with 0 <img> — parser may be stripping them'
        : '⚠ HTML mode — images in DOM but none loaded yet';
}
console.log(`\nVerdict: ${verdict}`);

if (process.env.PF_KEEP === '1') {
  console.log('\n(PF_KEEP=1 — browser staying open, Ctrl-C to exit)');
  await new Promise(() => {});
} else {
  await page.waitForTimeout(500);
  await ctx.close();
}
