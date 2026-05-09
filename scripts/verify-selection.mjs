#!/usr/bin/env node
/**
 * Simulates a text selection drag across the PDF page 1 abstract and
 * reports (a) what `window.getSelection().toString()` returns and
 * (b) a span-by-span breakdown of which spans were caught. Run after
 * `npm run build` to validate text-layer selection fixes.
 */
import { chromium } from '/Users/mayuanchao/.nvm/versions/node/v22.14.0/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const extDir = resolve(repoRoot, 'chrome-extension/dist');
const arg = process.argv[2] ?? '2604.05015';
const src = arg.startsWith('http') ? arg : `https://arxiv.org/pdf/${arg}`;
const arxivId = arg.replace(/.*\//, '').replace(/v\d+.*/, '');

mkdirSync(resolve(repoRoot, '.playwright-cli'), { recursive: true });

const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'pf-sel-')), {
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
const readerUrl = `chrome-extension://${extId}/reader/index.html#src=${src}`;

const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(readerUrl);
await page.waitForSelector('.pf-pdf-page, h1, [role="status"]', { timeout: 30_000 });
await page.waitForTimeout(3000);

// Wait for page 1 text layer to have spans.
await page.waitForFunction(() => {
  const tl = document.querySelector('.pf-pdf-page[data-page="1"] .pf-pdf-text-layer');
  return tl && tl.querySelectorAll('span').length > 10;
}, null, { timeout: 15_000 });

// Scroll to top so page 1 is visible.
await page.evaluate(() => {
  const s = document.querySelector('[data-reader-scroll]');
  if (s) s.scrollTop = 0;
});
await page.waitForTimeout(800);

// Pick the middle of the abstract — multiple lines tall.
const region = await page.evaluate(() => {
  const tl = document.querySelector('.pf-pdf-page[data-page="1"] .pf-pdf-text-layer');
  if (!tl) return null;
  // Collect spans, sort by y then x to approximate reading order.
  const spans = Array.from(tl.querySelectorAll('span'))
    .filter((s) => s.textContent && s.textContent.trim().length > 0)
    .map((s) => ({ el: s, r: s.getBoundingClientRect() }))
    .filter((x) => x.r.width > 0 && x.r.height > 0)
    .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
  if (spans.length < 20) return null;
  // Target: drag from ~20% into the abstract to ~60% through it.
  const start = spans[Math.floor(spans.length * 0.25)].r;
  const end = spans[Math.floor(spans.length * 0.55)].r;
  return {
    startX: start.left + 4, startY: start.top + start.height / 2,
    endX: end.right - 4, endY: end.top + end.height / 2,
    totalSpans: spans.length,
  };
});
if (!region) {
  console.error('No usable region found.');
  await ctx.close();
  process.exit(1);
}

console.log(`Abstract spans available: ${region.totalSpans}`);
console.log(`Drag: (${Math.round(region.startX)}, ${Math.round(region.startY)}) → (${Math.round(region.endX)}, ${Math.round(region.endY)})`);

// Drag-select using real pointer events so our pointerdown handler fires.
await page.mouse.move(region.startX, region.startY);
await page.mouse.down();
// Move through intermediate points for a more natural drag.
const steps = 25;
for (let i = 1; i <= steps; i++) {
  const t = i / steps;
  await page.mouse.move(
    region.startX + (region.endX - region.startX) * t,
    region.startY + (region.endY - region.startY) * t,
    { steps: 2 },
  );
}
await page.mouse.up();
await page.waitForTimeout(400);

const sel = await page.evaluate(() => {
  const s = window.getSelection();
  const text = s?.toString() ?? '';
  // Count caught spans: those whose rects intersect the selection range bbox.
  const tl = document.querySelector('.pf-pdf-page[data-page="1"] .pf-pdf-text-layer');
  const total = tl ? tl.querySelectorAll('span').length : 0;
  if (!s || s.rangeCount === 0) return { text, totalSpans: total, caught: 0 };
  const r = s.getRangeAt(0);
  const rects = Array.from(r.getClientRects());
  const caught = rects.length;
  return { text, totalSpans: total, caught, rectHeight: rects[0]?.height };
});

console.log('\n── Selection result ──');
console.log(`Text (${sel.text.length} chars):\n${sel.text.slice(0, 500)}${sel.text.length > 500 ? '…' : ''}`);
console.log(`\nRange client rects (selection "lines"): ${sel.caught}`);

const shot = resolve(repoRoot, '.playwright-cli', `selection-${arxivId}.png`);
// Clip to the selected region for a high-detail view.
const clip = await page.evaluate(() => {
  const s = window.getSelection();
  if (!s || s.rangeCount === 0) return null;
  const r = s.getRangeAt(0);
  const bb = r.getBoundingClientRect();
  return { x: Math.max(0, bb.x - 30), y: Math.max(0, bb.y - 30),
           width: bb.width + 60, height: bb.height + 60 };
});
if (clip) {
  await page.screenshot({ path: shot, clip });
} else {
  await page.screenshot({ path: shot, fullPage: false });
}
console.log(`\nScreenshot: ${shot}`);

// Also dump first 10 span rects for the selected region to inspect.
const spanInfo = await page.evaluate(() => {
  const tl = document.querySelector('.pf-pdf-page[data-page="1"] .pf-pdf-text-layer');
  if (!tl) return [];
  return Array.from(tl.querySelectorAll('span')).slice(0, 25).map((s, i) => ({
    i,
    text: (s.textContent || '').slice(0, 40),
    rect: { l: Math.round(s.getBoundingClientRect().left),
            t: Math.round(s.getBoundingClientRect().top),
            w: Math.round(s.getBoundingClientRect().width),
            h: Math.round(s.getBoundingClientRect().height) },
    transform: s.style.transform,
    children: s.children.length,
  }));
});
console.log('\nFirst 25 spans:');
for (const s of spanInfo) {
  console.log(`  [${s.i}] "${s.text}" @ (${s.rect.l},${s.rect.t}) ${s.rect.w}×${s.rect.h} ${s.transform} ${s.children ? `children:${s.children}` : ''}`);
}

await ctx.close();
