import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePdf } from '../../reader/lib/pdf';

describe('parsePdf runtime contract (for PdfPage render)', () => {
  let buf: ArrayBuffer;
  beforeAll(() => {
    const f = readFileSync(join(__dirname, '../fixtures/sample.pdf'));
    buf = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
  });

  it('each paragraph maps to an outline entry with a page field', async () => {
    const { parsed } = await parsePdf(buf);
    const outlineById = new Map(parsed.outline.map((o) => [o.id, o]));
    for (const p of parsed.paragraphs) {
      const outline = outlineById.get(p.sectionId);
      expect(outline).toBeDefined();
      expect(outline!.page).toBeGreaterThan(0);
    }
  });

  it('per-page paragraph grouping matches pageItemRanges layout', async () => {
    const { parsed, pageItemRanges } = await parsePdf(buf);
    const outlineById = new Map(parsed.outline.map((o) => [o.id, o]));
    const countByPage = new Map<number, number>();
    for (const p of parsed.paragraphs) {
      const page = outlineById.get(p.sectionId)!.page!;
      countByPage.set(page, (countByPage.get(page) ?? 0) + 1);
    }
    for (let i = 0; i < pageItemRanges.length; i++) {
      const page = i + 1;
      expect(countByPage.get(page) ?? 0).toBe(pageItemRanges[i].length);
    }
  });
});
