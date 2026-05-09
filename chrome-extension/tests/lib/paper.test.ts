import { describe, it, expect } from 'vitest';
import { findIntroParagraphs, resolveOutlineTarget, extractRolePrefix } from '../../reader/lib/paper';
import { formatRelative, getVisibleParagraphs } from '../../reader/lib/paper';
import type { OutlineItem, Paragraph, Paper } from '../../reader/types';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    urlHash: 'h1',
    title: 't',
    authors: [],
    abstract: '',
    outline: [],
    paragraphs: [],
    memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] },
    ...overrides,
  };
}

describe('findIntroParagraphs', () => {
  it('returns paragraphs whose sectionId matches an Introduction outline item', () => {
    const outline: OutlineItem[] = [
      { id: 'o0', label: '1 Introduction', level: 0 },
      { id: 'o1', label: '2 Method', level: 0 },
    ];
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Introduction', text: 'intro a' },
      { id: 'sec0-p1', sectionId: 'o0', section: '1 Introduction', text: 'intro b' },
      { id: 'sec1-p0', sectionId: 'o1', section: '2 Method', text: 'method' },
    ];
    const paper = makePaper({ outline, paragraphs });
    expect(findIntroParagraphs(paper).map(p => p.id)).toEqual(['sec0-p0', 'sec0-p1']);
  });

  it('is case-insensitive on Introduction detection', () => {
    const outline: OutlineItem[] = [{ id: 'o0', label: 'INTRODUCTION', level: 0 }];
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: 'INTRODUCTION', text: 'x' },
    ];
    expect(findIntroParagraphs(makePaper({ outline, paragraphs }))).toHaveLength(1);
  });

  it('falls back to level-0 sectionIndex prefix when Introduction has no direct paragraphs', () => {
    // 1 Introduction (level-0, no direct paragraphs)
    //   1.1 Motivation (level-1, has paragraphs)
    const outline: OutlineItem[] = [
      { id: 'o0', label: '1 Introduction', level: 0 },
      { id: 'o1', label: '1.1 Motivation', level: 1 },
      { id: 'o2', label: '2 Method', level: 0 },
    ];
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o1', section: '1.1 Motivation', text: 'motiv a' },
      { id: 'sec0-p1', sectionId: 'o1', section: '1.1 Motivation', text: 'motiv b' },
      { id: 'sec1-p0', sectionId: 'o2', section: '2 Method', text: 'm' },
    ];
    expect(findIntroParagraphs(makePaper({ outline, paragraphs })).map(p => p.id))
      .toEqual(['sec0-p0', 'sec0-p1']);
  });

  it('returns all paragraphs when no Introduction outline item exists', () => {
    const outline: OutlineItem[] = [{ id: 'o0', label: 'Preface', level: 0 }];
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: 'Preface', text: 'a' },
    ];
    expect(findIntroParagraphs(makePaper({ outline, paragraphs }))).toEqual(paragraphs);
  });
});

describe('resolveOutlineTarget', () => {
  const outline: OutlineItem[] = [
    { id: 'o0', label: '1 Introduction', level: 0 },
    { id: 'o1', label: '2 Method', level: 0 },
    { id: 'o2', label: '2.1 Chunk', level: 1 },
  ];

  it('returns the first paragraph with matching sectionId', () => {
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Introduction', text: 'x' },
      { id: 'sec1-p0', sectionId: 'o2', section: '2.1 Chunk', text: 'y' },
    ];
    const target = resolveOutlineTarget(outline[0], makePaper({ outline, paragraphs }));
    expect(target?.id).toBe('sec0-p0');
  });

  it('falls back to sectionIndex prefix for level-0 with only nested paragraphs', () => {
    const paragraphs: Paragraph[] = [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Introduction', text: 'x' },
      { id: 'sec1-p0', sectionId: 'o2', section: '2.1 Chunk', text: 'y' },  // belongs to level-0 "2 Method"
    ];
    // Looking up "2 Method" (level 0, no direct paragraph) should return the sec1-* paragraph
    const target = resolveOutlineTarget(outline[1], makePaper({ outline, paragraphs }));
    expect(target?.id).toBe('sec1-p0');
  });

  it('returns undefined for level-1 item with no matching paragraph', () => {
    const paragraphs: Paragraph[] = [];
    const target = resolveOutlineTarget(outline[2], makePaper({ outline, paragraphs }));
    expect(target).toBeUndefined();
  });
});

describe('extractRolePrefix', () => {
  it('returns standard value when prefix matches before " — "', () => {
    expect(extractRolePrefix('Background — a candidate alternative to RAG')).toBe('Background');
    expect(extractRolePrefix('Counter-evidence — §4 disagrees')).toBe('Counter-evidence');
  });

  it('returns standard value when string is exactly the standard', () => {
    expect(extractRolePrefix('Central')).toBe('Central');
    expect(extractRolePrefix('Ancestor')).toBe('Ancestor');
  });

  it('returns empty string when prefix is not a standard value', () => {
    expect(extractRolePrefix('background — lowercase fails')).toBe('');
    expect(extractRolePrefix('Counter — missing "-evidence"')).toBe('');
    expect(extractRolePrefix('Random text')).toBe('');
  });

  it('returns empty string for empty or whitespace input', () => {
    expect(extractRolePrefix('')).toBe('');
    expect(extractRolePrefix('   ')).toBe('');
  });
});

describe('formatRelative', () => {
  // Fixed "now" so tests are deterministic.
  const NOW = 1_700_000_000_000; // 2023-11-14 ish

  it('returns "just now" within 60 s', () => {
    expect(formatRelative(NOW - 30_000, NOW)).toBe('just now');
    expect(formatRelative(NOW, NOW)).toBe('just now');
  });

  it('returns "{n} min ago" for minutes', () => {
    expect(formatRelative(NOW - 2 * 60_000, NOW)).toBe('2 min ago');
    expect(formatRelative(NOW - 59 * 60_000, NOW)).toBe('59 min ago');
  });

  it('returns "{n} hr ago" for hours', () => {
    expect(formatRelative(NOW - 3 * 3_600_000, NOW)).toBe('3 hr ago');
    expect(formatRelative(NOW - 23 * 3_600_000, NOW)).toBe('23 hr ago');
  });

  it('returns "yesterday" for 24..47 h', () => {
    expect(formatRelative(NOW - 25 * 3_600_000, NOW)).toBe('yesterday');
  });

  it('returns "{n} days ago" for 2-7 days', () => {
    expect(formatRelative(NOW - 2 * 86_400_000, NOW)).toBe('2 days ago');
    expect(formatRelative(NOW - 6 * 86_400_000, NOW)).toBe('6 days ago');
  });

  it('returns "{n} week(s) ago" for 7-29 days', () => {
    expect(formatRelative(NOW - 7 * 86_400_000, NOW)).toBe('1 week ago');
    expect(formatRelative(NOW - 14 * 86_400_000, NOW)).toBe('2 weeks ago');
  });

  it('returns "{n} month(s) ago" past ~30 days', () => {
    expect(formatRelative(NOW - 40 * 86_400_000, NOW)).toBe('1 month ago');
    expect(formatRelative(NOW - 90 * 86_400_000, NOW)).toBe('3 months ago');
  });

  it('returns an empty string when epochMs is 0', () => {
    expect(formatRelative(0, NOW)).toBe('');
  });
});

describe('getVisibleParagraphs', () => {
  it('returns [data-pid] elements whose rect intersects container rect', () => {
    const container = document.createElement('div');
    // Stub container rect: top=0, bottom=200.
    container.getBoundingClientRect = () => ({
      top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200, x: 0, y: 0, toJSON() { return {}; },
    });

    function makePara(top: number, height: number, pid: string): HTMLElement {
      const el = document.createElement('p');
      el.setAttribute('data-pid', pid);
      el.getBoundingClientRect = () => ({
        top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON() { return {}; },
      });
      container.appendChild(el);
      return el;
    }
    makePara(-50, 100, 'sec0-p0');   // fully above but bottom=50 > container.top=0 → intersects
    makePara(60, 100, 'sec0-p1');    // fully in viewport
    makePara(180, 100, 'sec0-p2');   // top=180 < container.bottom=200 → intersects
    makePara(300, 100, 'sec0-p3');   // fully below viewport → excluded

    const visible = getVisibleParagraphs(container);
    expect(visible.map((el) => el.getAttribute('data-pid'))).toEqual(['sec0-p0', 'sec0-p1', 'sec0-p2']);
  });

  it('returns an empty array when no [data-pid] elements exist', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({
      top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200, x: 0, y: 0, toJSON() { return {}; },
    });
    expect(getVisibleParagraphs(container)).toEqual([]);
  });
});
