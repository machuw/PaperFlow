import type { OutlineItem, Paper, Paragraph } from '../types';

/**
 * Find the paragraphs belonging to the Introduction section (§8.1).
 * Matches the first level-0 outline item whose label contains "introduction"
 * (case-insensitive). If that item has no direct paragraphs (e.g. only
 * subsections), falls back to all paragraphs under the same level-0 range
 * via the sec{level0Index}-* id prefix (§3.2).
 */
export function findIntroParagraphs(paper: Paper): Paragraph[] {
  const introItem = paper.outline.find(
    (o) => o.level === 0 && o.label.toLowerCase().includes('introduction')
  );
  if (!introItem) return paper.paragraphs;

  const direct = paper.paragraphs.filter((p) => p.sectionId === introItem.id);
  if (direct.length > 0) return direct;

  const level0Index = paper.outline
    .filter((o) => o.level === 0)
    .findIndex((o) => o.id === introItem.id);
  return paper.paragraphs.filter((p) => p.id.startsWith(`sec${level0Index}-`));
}

/**
 * Resolve an OutlineItem to the paragraph the UI should scroll to (§8.4).
 * Tries direct sectionId match first; for level-0 items with only nested
 * paragraphs, falls back to the first paragraph whose id begins with
 * `sec{level0Index}-`. Returns undefined when no paragraph can be located.
 */
export function resolveOutlineTarget(
  item: OutlineItem,
  paper: Paper
): Paragraph | undefined {
  const direct = paper.paragraphs.find((p) => p.sectionId === item.id);
  if (direct) return direct;

  if (item.level === 0) {
    const level0Index = paper.outline
      .filter((o) => o.level === 0)
      .findIndex((o) => o.id === item.id);
    return paper.paragraphs.find((p) => p.id.startsWith(`sec${level0Index}-`));
  }
  return undefined;
}

const ROLE_STANDARDS = [
  'Background',
  'Method reference',
  'Counter-evidence',
  'Tangential',
  'Central',
  'Ancestor',
] as const;

/**
 * Extract a standard Role prefix from `PaperMemory.role` free text (§3.6).
 * Memory tab stores "Standard — free text"; Library/Overview need the
 * standard prefix alone. Returns '' when the prefix is not one of the 6
 * standard values.
 */
export function extractRolePrefix(s: string): string {
  if (!s || !s.trim()) return '';
  const head = s.split(' — ', 1)[0].trim();
  return (ROLE_STANDARDS as readonly string[]).includes(head) ? head : '';
}

/**
 * Relative-time formatter for Library (§3.4). Returns natural-language deltas
 * like "just now", "3 min ago", "yesterday", "2 weeks ago", "1 month ago".
 * Epoch ms of 0 means "never opened" — returns '' so the caller can skip.
 *
 * The `now` arg is injectable for deterministic testing; production callers
 * can omit it to get `Date.now()`.
 */
export function formatRelative(epochMs: number, now: number = Date.now()): string {
  if (!epochMs) return '';
  const d = Math.max(0, now - epochMs);
  if (d < 60_000) return 'just now';
  const m = Math.floor(d / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(d / 3_600_000);
  if (h < 24) return `${h} hr ago`;
  const days = Math.floor(d / 86_400_000);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/**
 * Returns all `[data-pid]` paragraph elements inside `container` whose
 * bounding rect intersects the container's visible region (§9.1 CmdK
 * "Translate current page" scope).
 */
export function getVisibleParagraphs(container: HTMLElement): HTMLElement[] {
  const cRect = container.getBoundingClientRect();
  const all = Array.from(container.querySelectorAll<HTMLElement>('[data-pid]'));
  return all.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > cRect.top && r.top < cRect.bottom;
  });
}
