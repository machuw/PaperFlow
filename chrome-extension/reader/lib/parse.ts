import type { OutlineItem, Paragraph } from '../types';

export interface RawParagraph {
  outlineItemId: string;
  text: string;
  html?: string;
}

/**
 * Assign Paragraph.id using sec{level0Index}-p{pInLevel0} format (spec §3.2).
 * pInLevel0 is continuous across subsections within the same level-0 section.
 */
export function buildParagraphs(raw: RawParagraph[], outline: OutlineItem[]): Paragraph[] {
  const level0Items = outline.filter(o => o.level === 0);
  const level0IndexById = new Map<string, number>();
  const level0AncestorOf = new Map<string, string>();

  // Build ancestor map: for each outline item, find its level-0 ancestor id.
  // Algorithm: walk outline in document order, track the current level-0 item.
  let currentLevel0: string | null = null;
  for (const item of outline) {
    if (item.level === 0) {
      currentLevel0 = item.id;
      level0IndexById.set(item.id, level0Items.findIndex(o => o.id === item.id));
    }
    if (currentLevel0) level0AncestorOf.set(item.id, currentLevel0);
  }

  const outlineById = new Map(outline.map(o => [o.id, o]));
  const pCounter = new Map<string, number>();  // level0 id → next p index

  return raw.map((r): Paragraph => {
    const outlineItem = outlineById.get(r.outlineItemId);
    if (!outlineItem) throw new Error(`unknown outline item: ${r.outlineItemId}`);

    const level0Id = level0AncestorOf.get(r.outlineItemId);
    if (!level0Id) throw new Error(`no level-0 ancestor for ${r.outlineItemId}`);

    const sectionIdx = level0IndexById.get(level0Id)!;
    const pIdx = pCounter.get(level0Id) ?? 0;
    pCounter.set(level0Id, pIdx + 1);

    const base: Paragraph = {
      id: `sec${sectionIdx}-p${pIdx}`,
      sectionId: outlineItem.id,      // deepest
      section: outlineItem.label,
      text: r.text,
    };
    return r.html ? { ...base, html: r.html } : base;
  });
}
