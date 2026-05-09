#!/usr/bin/env node
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

mkdirSync(resolve(repoRoot, '.playwright-cli'), { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'pf-s-')), {
  headless: false,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run'],
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10_000 });
const extId = new URL(sw.url()).host;
const readerUrl = `chrome-extension://${extId}/reader/index.html#src=${src}`;
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(readerUrl);
await page.waitForSelector('.pf-pdf-page', { timeout: 30_000 });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const tl = document.querySelector('.pf-pdf-page[data-page="1"] .pf-pdf-text-layer');
  if (!tl) return { err: 'no text layer' };
  const spans = Array.from(tl.querySelectorAll('span'));
  const sample = spans.slice(0, 12).map((s) => ({
    text: (s.textContent || '').slice(0, 30),
    transform: s.style.transform,
    left: s.style.left,
    top: s.style.top,
    width: s.style.width,
    hasChildren: s.children.length,
    childTagName: s.firstElementChild?.tagName ?? null,
  }));
  const all = spans.length;
  // Count spans with children (wrappers) vs. leaf text spans
  const wrappers = spans.filter((s) => s.children.length > 0 && !s.textContent?.trim()).length;
  const leaves = spans.filter((s) => (s.textContent || '').trim().length > 0).length;
  // Count spans with transform: scaleX
  const scaleSpans = spans.filter((s) => /scale\(|scaleX\(/.test(s.style.transform)).length;
  return { all, wrappers, leaves, scaleSpans, sample };
});
console.log(JSON.stringify(info, null, 2));
await ctx.close();
