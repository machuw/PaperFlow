#!/usr/bin/env node
/**
 * Measures left/right gutters around the paper reading card at a given
 * zoom level. Confirms that the paper stays centered in its scroll
 * container regardless of zoom.
 */
import { chromium } from '/Users/mayuanchao/.nvm/versions/node/v22.14.0/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const extDir = resolve(repoRoot, 'chrome-extension/dist');
const arg = process.argv[2] ?? '2604.05015';
const zoomLevel = parseFloat(process.argv[3] ?? '1.3');
const src = arg.startsWith('http') ? arg : `https://arxiv.org/pdf/${arg}`;
const arxivId = arg.replace(/.*\//, '').replace(/v\d+.*/, '');

mkdirSync(resolve(repoRoot, '.playwright-cli'), { recursive: true });

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--no-first-run',
  ],
  viewport: { width: 1440, height: 900 },
});

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10_000 });
const extId = new URL(sw.url()).host;
// The reader parses the hash with the raw URL (matches DNR regexSubstitution
// behaviour). Don't percent-encode — verify-reader.mjs does the same.
const readerUrl = `chrome-extension://${extId}/reader/index.html#src=${src}`;

const page = ctx.pages()[0] ?? await ctx.newPage();
// Seed the zoom tweak before the reader boots so we measure the right layout.
await page.addInitScript((z) => {
  const raw = localStorage.getItem('pf-tweaks');
  const t = raw ? JSON.parse(raw) : {};
  localStorage.setItem('pf-tweaks', JSON.stringify({ ...t, zoom: z }));
}, zoomLevel);
await page.goto(readerUrl);
await page.waitForSelector('.pf-pdf-page, h1, [role="status"]', { timeout: 30_000 });
await page.waitForTimeout(2500);

// Measure gutters: compare the scroll container's client rect and the
// paper card's client rect to see the left/right offsets.
const measurement = await page.evaluate(() => {
  const scroll = document.querySelector('[data-reader-scroll]');
  if (!scroll) return { error: 'no scroll container' };
  const scrollRect = scroll.getBoundingClientRect();
  // Pick the PDF canvas card for PDF mode, or the paper card div for HTML.
  const pdfPage = document.querySelector('.pf-pdf-page');
  const target = pdfPage || document.querySelector('[data-reader-scroll] > div > div');
  if (!target) return { error: 'no paper card target' };
  const targetRect = target.getBoundingClientRect();
  return {
    scrollLeft: Math.round(scrollRect.left),
    scrollRight: Math.round(scrollRect.right),
    scrollWidth: Math.round(scrollRect.width),
    cardLeft: Math.round(targetRect.left),
    cardRight: Math.round(targetRect.right),
    cardWidth: Math.round(targetRect.width),
    gutterLeft: Math.round(targetRect.left - scrollRect.left),
    gutterRight: Math.round(scrollRect.right - targetRect.right),
  };
});

console.log(`Zoom: ${zoomLevel}×  |  Paper: ${arxivId}`);
console.log(JSON.stringify(measurement, null, 2));
if (measurement.gutterLeft != null && measurement.gutterRight != null) {
  const diff = Math.abs(measurement.gutterLeft - measurement.gutterRight);
  console.log(`Gutter |Δ| = ${diff}px ${diff <= 4 ? '✓ balanced' : '✗ skewed'}`);
}

const shot = resolve(repoRoot, '.playwright-cli', `zoom-${arxivId}-${Math.round(zoomLevel * 100)}.png`);
await page.screenshot({ path: shot, fullPage: false });
console.log(`Screenshot: ${shot}`);

await ctx.close();
