import { describe, it, expect } from 'vitest';
import { buildParagraphs } from '../../reader/lib/parse';
import type { OutlineItem } from '../../reader/types';

const outline: OutlineItem[] = [
  { id: 'o0', label: 'Abstract', level: 0 },
  { id: 'o1', label: '1 Introduction', level: 0 },
  { id: 'o2', label: '2 Related', level: 0 },
  { id: 'o3', label: '2.1 RAG', level: 1 },
  { id: 'o4', label: '2.2 Long-context', level: 1 },
  { id: 'o5', label: '3 Method', level: 0 },
];

describe('buildParagraphs', () => {
  it('assigns sec{level0Idx}-p{n} ids and populates sectionId/section', () => {
    const raw = [
      { outlineItemId: 'o0', text: 'abs p0' },
      { outlineItemId: 'o1', text: 'intro p0' },
      { outlineItemId: 'o1', text: 'intro p1' },
      { outlineItemId: 'o3', text: '2.1 p0' },
      { outlineItemId: 'o3', text: '2.1 p1' },
      { outlineItemId: 'o4', text: '2.2 p0' },
      { outlineItemId: 'o5', text: 'method p0' },
    ];

    const result = buildParagraphs(raw, outline);

    expect(result.map(p => p.id)).toEqual([
      'sec0-p0',       // Abstract
      'sec1-p0', 'sec1-p1',  // 1 Intro
      'sec2-p0', 'sec2-p1', 'sec2-p2',  // 2 Related (includes 2.1 + 2.2 cumulative)
      'sec3-p0',       // 3 Method
    ]);

    expect(result[3].sectionId).toBe('o3');          // 2.1 RAG (deepest)
    expect(result[3].section).toBe('2.1 RAG');
    expect(result[5].sectionId).toBe('o4');          // 2.2 Long-context
    expect(result[5].section).toBe('2.2 Long-context');
    expect(result[1].sectionId).toBe('o1');          // 1 Intro (level-0, direct)
  });

  it('handles empty paragraphs array', () => {
    expect(buildParagraphs([], outline)).toEqual([]);
  });

  it('throws on paragraph referencing unknown outline item', () => {
    const raw = [{ outlineItemId: 'ghost', text: 'x' }];
    expect(() => buildParagraphs(raw, outline)).toThrow(/unknown outline/i);
  });
});

describe('buildParagraphs html passthrough', () => {
  const outline: OutlineItem[] = [
    { id: 'o0', label: '1 Intro', level: 0 },
  ];

  it('passes the optional html field through when provided', () => {
    const raw = [
      { outlineItemId: 'o0', text: 'plain text', html: '<p class="ltx_p">plain text</p>' },
    ];
    const out = buildParagraphs(raw, outline);
    expect(out[0].html).toBe('<p class="ltx_p">plain text</p>');
    expect(out[0].text).toBe('plain text');
  });

  it('leaves html undefined when absent from raw', () => {
    const raw = [{ outlineItemId: 'o0', text: 'plain' }];
    const out = buildParagraphs(raw, outline);
    expect(out[0].html).toBeUndefined();
  });
});
