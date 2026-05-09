#!/usr/bin/env node
/**
 * Three-probe diagnostic for PDF text selection.
 *
 *  (1) Is the selection TEXT missing the right-side portions of each
 *      visual line? i.e. does `sel.toString()` contain the unselected-
 *      looking text from the screenshot?
 *  (2) Do the text-layer spans cover the full visible width of each
 *      line? We read every span on page 1 and report the leftmost and
 *      rightmost span edge per Y-band, compared against the page
 *      viewport width.
 *  (3) Is there exactly one .pf-pdf-text-layer per .pf-pdf-page?
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
mkdirSync(resolve(repoRoot, '.playwright-cli'), { recursive: true });

const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'pf-d-')), {
  headless: false,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run'],
  viewport: { width: 1440, height: 900 },
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10_000 });
const extId = new URL(sw.url()).host;
const page = ctx.pages()[0] ?? await ctx.newPage();
// Seed zoom before load so we test at 130% like the user.
await page.addInitScript(() => {
  const raw = localStorage.getItem('pf-tweaks');
  const t = raw ? JSON.parse(raw) : {};
  localStorage.setItem('pf-tweaks', JSON.stringify({ ...t, zoom: 1.3 }));
});
await page.goto(`chrome-extension://${extId}/reader/index.html#src=${src}`);
await page.waitForSelector('.pf-pdf-page', { timeout: 30_000 });
await page.waitForTimeout(3000);

// Probe 3: how many text layers per page?
const probe3 = await page.evaluate(() => {
  const pages = Array.from(document.querySelectorAll('.pf-pdf-page'));
  return pages.map((p, i) => ({
    page: i + 1,
    textLayers: p.querySelectorAll('.pf-pdf-text-layer').length,
    canvases: p.querySelectorAll('canvas').length,
  })).slice(0, 3);
});
console.log('── Probe 3: text layers per page ──');
console.table(probe3);

// Probe Z: localStorage pf-tweaks + scaled canvas element
const probeZ = await page.evaluate(() => {
  const raw = localStorage.getItem('pf-tweaks');
  const canvas = document.querySelector('.pf-pdf-page[data-page="1"] canvas');
  const cRect = canvas ? canvas.getBoundingClientRect() : null;
  return {
    tweaks: raw ? JSON.parse(raw) : null,
    canvasClientWidth: cRect ? Math.round(cRect.width) : null,
    canvasStyleWidth: canvas ? canvas.style.width : null,
  };
});
console.log('\n── Probe Z: zoom state ──');
console.log(JSON.stringify(probeZ, null, 2));

// Probe 0: first abstract span full-text length and bounding box
const probe0 = await page.evaluate(() => {
  const tl = document.querySelector('.pf-pdf-page[data-page="1"] .pf-pdf-text-layer');
  const spans = Array.from(tl?.querySelectorAll('span') ?? []);
  const firstAbs = spans.find((s) => (s.textContent || '').startsWith('With the rapid'));
  if (!firstAbs) return null;
  const r = firstAbs.getBoundingClientRect();
  const pgEl = document.querySelector('.pf-pdf-page[data-page="1"]');
  const pg = pgEl ? pgEl.getBoundingClientRect() : { left: 0, top: 0 };
  const text = firstAbs.textContent || '';
  return {
    text,
    textLength: text.length,
    childNodes: firstAbs.childNodes.length,
    firstChildType: firstAbs.firstChild ? firstAbs.firstChild.nodeName : null,
    firstChildLength: firstAbs.firstChild instanceof Text ? firstAbs.firstChild.length : null,
    boundingBox: {
      l: Math.round(r.left - pg.left),
      r: Math.round(r.right - pg.left),
      w: Math.round(r.width),
    },
    transform: firstAbs.style.transform,
  };
});
console.log('\n── Probe 0: first abstract span ──');
console.log(JSON.stringify(probe0, null, 2));

// Probe 2: span coverage per visible line on page 1.
const probe2 = await page.evaluate(() => {
  const pg = document.querySelector('.pf-pdf-page[data-page="1"]');
  if (!pg) return { err: 'no page 1' };
  const pgRect = pg.getBoundingClientRect();
  const tl = pg.querySelector('.pf-pdf-text-layer');
  if (!tl) return { err: 'no text layer' };
  const spans = Array.from(tl.querySelectorAll('span'))
    .filter((s) => (s.textContent || '').trim().length > 0 || (s.textContent || '').length >= 1)
    .map((s) => {
      const r = s.getBoundingClientRect();
      return {
        text: (s.textContent || '').slice(0, 60),
        left: Math.round(r.left - pgRect.left),
        right: Math.round(r.right - pgRect.left),
        top: Math.round(r.top - pgRect.top),
        width: Math.round(r.width),
      };
    });
  // Group spans by rounded Y (line band).
  const byLine = new Map();
  for (const s of spans) {
    const key = Math.round(s.top / 3) * 3; // 3px bands
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(s);
  }
  const lines = Array.from(byLine.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([y, items]) => {
      items.sort((a, b) => a.left - b.left);
      return {
        y,
        spans: items.length,
        left: items[0].left,
        right: items[items.length - 1].right,
        text: items.map((x) => x.text).join(' | ').slice(0, 160),
      };
    });
  return { pageWidth: Math.round(pgRect.width), lines };
});
console.log('\n── Probe 2: span coverage per line (page 1) ──');
console.log(`page width (client px): ${probe2.pageWidth}`);
console.log('y     | spans | left | right |  text');
for (const l of probe2.lines.slice(0, 25)) {
  const line = `${String(l.y).padStart(4)}  |   ${String(l.spans).padStart(2)}  |  ${String(l.left).padStart(3)} |  ${String(l.right).padStart(4)} |  ${l.text}`;
  console.log(line);
}

// Probe 1: user's actual scenario — drag ends at "benchma" on line 1
// (roughly 80% into the first abstract span, still within its bounds).
const drag = await page.evaluate(() => {
  const tl = document.querySelector('.pf-pdf-page[data-page="1"] .pf-pdf-text-layer');
  if (!tl) return null;
  const spans = Array.from(tl.querySelectorAll('span'));
  const firstAbs = spans.find((s) => (s.textContent || '').startsWith('With the rapid'));
  if (!firstAbs) return null;
  const a = firstAbs.getBoundingClientRect();
  const text = firstAbs.textContent || '';
  const benchmaOffset = text.indexOf('benchma');
  // Assume text fills span linearly → convert char offset to x position.
  // Multi-line drag (zoom regression check)
  const groupSpan = spans.find((s) => (s.textContent || '').startsWith('group-based'));
  if (groupSpan) {
    const b = groupSpan.getBoundingClientRect();
    return {
      sx: a.left + 2, sy: a.top + a.height / 2,
      ex: b.left + b.width * 0.5, ey: b.top + b.height / 2,
    };
  }
  const targetX = a.left + a.width * 0.7;
  return {
    sx: a.left + 2,
    sy: a.top + a.height / 2,
    ex: targetX,
    ey: a.top + a.height / 2,
  };
});
if (drag) {
  await page.mouse.move(drag.sx, drag.sy);
  await page.mouse.down();
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(drag.sx + (drag.ex - drag.sx) * t, drag.sy + (drag.ey - drag.sy) * t, { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(400);

  const sel = await page.evaluate(() => {
    const s = window.getSelection();
    if (!s || s.rangeCount === 0) return { text: '', rectCount: 0, rects: [] };
    const r = s.getRangeAt(0);
    const pageEl = document.querySelector('.pf-pdf-page[data-page="1"]');
    const pgRect = pageEl ? pageEl.getBoundingClientRect() : { left: 0, top: 0 };
    const rects = Array.from(r.getClientRects()).map((rect) => ({
      l: Math.round(rect.left - pgRect.left),
      r: Math.round(rect.right - pgRect.left),
      t: Math.round(rect.top - pgRect.top),
      w: Math.round(rect.width),
    })).slice(0, 20);
    // Inspect the Range endpoints in detail.
    const describeNode = (n) => {
      if (!n) return null;
      return {
        nodeName: n.nodeName,
        textSample: n.nodeType === 3 ? (n.nodeValue || '').slice(0, 40) : null,
        childNodes: n.nodeType === 1 ? n.childNodes.length : null,
        parentTag: n.parentElement ? n.parentElement.tagName : null,
        parentSample: n.parentElement ? (n.parentElement.textContent || '').slice(0, 40) : null,
      };
    };
    return {
      text: s.toString(),
      rectCount: r.getClientRects().length,
      rects,
      startContainer: describeNode(r.startContainer),
      startOffset: r.startOffset,
      endContainer: describeNode(r.endContainer),
      endOffset: r.endOffset,
    };
  });
  console.log('\n── Probe 1: selection text after rectangular-ish drag ──');
  console.log(`chars: ${sel.text.length}, rects: ${sel.rectCount}`);
  // Check specifically for words expected to be "missing" per the screenshot.
  const needles = ['rks are becoming', 'ted leaderboard', 'ap, we introduce', 'aluate the ro-', 'evaluate model', 'increases', 'sual information'];
  console.log('\nneedles present in selection text?');
  for (const n of needles) {
    console.log(`  ${sel.text.includes(n) ? '✓' : '✗'}  "${n}"`);
  }
  console.log('\nselection (first 800 chars):');
  console.log(sel.text.slice(0, 800));

  console.log('\nrange endpoints:');
  console.log(`  start: ${JSON.stringify(sel.startContainer)} offset=${sel.startOffset}`);
  console.log(`  end:   ${JSON.stringify(sel.endContainer)} offset=${sel.endOffset}`);

  console.log('\nrange client rects (first 20, page-relative):');
  console.log(' idx |  t  |   l -   r |  w');
  (sel.rects || []).forEach((r, i) => {
    console.log(` ${String(i).padStart(3)} | ${String(r.t).padStart(3)} | ${String(r.l).padStart(3)} - ${String(r.r).padStart(3)} | ${String(r.w).padStart(3)}`);
  });

  const shot = resolve(repoRoot, '.playwright-cli', 'diag-selection.png');
  // Clip to the selected region for a high-detail view
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
}

await ctx.close();
