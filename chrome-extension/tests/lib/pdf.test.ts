import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePdf } from '../../reader/lib/pdf';

describe('parsePdf', () => {
  let buf: ArrayBuffer;
  beforeAll(() => {
    const f = readFileSync(join(__dirname, '../fixtures/sample.pdf'));
    buf = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
  });

  it('extracts numPages', async () => {
    const { parsed } = await parsePdf(buf);
    expect(parsed.numPages).toBeGreaterThan(0);
  });

  it('emits at least one paragraph', async () => {
    const { parsed } = await parsePdf(buf);
    expect(parsed.paragraphs.length).toBeGreaterThan(0);
    expect(parsed.paragraphs[0].text.length).toBeGreaterThan(0);
  });

  it('uses the PDF bookmarks tree for outline labels when present', async () => {
    // sample.pdf ships with one bookmark ("Dummy PDF file") pointing at
    // page 1. resolveDocOutline should surface that label instead of
    // falling through to the "Page N" stub.
    const { parsed } = await parsePdf(buf);
    expect(parsed.outline.length).toBeGreaterThan(0);
    expect(parsed.outline[0]).toMatchObject({ level: 0, page: 1 });
    expect(parsed.outline[0].label).not.toMatch(/^Page \d+$/);
    expect(parsed.outline[0].label.length).toBeGreaterThan(0);
  });

  it('assigns paragraphs to their source page via sectionId', async () => {
    const { parsed } = await parsePdf(buf);
    const outlineIds = new Set(parsed.outline.map(o => o.id));
    for (const p of parsed.paragraphs) {
      expect(outlineIds.has(p.sectionId)).toBe(true);
    }
  });
});

describe('parsePdf runtime handles', () => {
  let buf: ArrayBuffer;
  beforeAll(() => {
    const f = readFileSync(join(__dirname, '../fixtures/sample.pdf'));
    buf = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
  });

  it('returns pdfDoc with same numPages as the parsed result', async () => {
    const result = await parsePdf(buf);
    expect(result.doc).toBeDefined();
    expect(result.doc.numPages).toBe(result.parsed.numPages);
  });

  it('returns pageItemRanges length equal to numPages', async () => {
    const result = await parsePdf(buf);
    expect(result.pageItemRanges).toHaveLength(result.parsed.numPages);
  });

  it('pageItemRanges cover the same total paragraph count as parsed.paragraphs', async () => {
    const result = await parsePdf(buf);
    const totalRanges = result.pageItemRanges.reduce((sum, page) => sum + page.length, 0);
    expect(totalRanges).toBe(result.parsed.paragraphs.length);
  });

  it('pageItemRanges[i] ranges are ordered and non-overlapping', async () => {
    const result = await parsePdf(buf);
    for (const pageRanges of result.pageItemRanges) {
      for (let i = 1; i < pageRanges.length; i++) {
        expect(pageRanges[i].startIdx).toBeGreaterThanOrEqual(pageRanges[i - 1].endIdx);
      }
    }
  });
});
