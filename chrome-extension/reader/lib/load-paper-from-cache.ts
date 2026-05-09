// Phase 27 — rebuild a LoadedPaper-shaped object from `paper:{key}:parsed`
// + `paper:{key}:memory` without re-fetching or starting pdfjs. Used by
// main.tsx as the third-priority entry path (after #src= URL load) when
// the user opens a paper from the library by paperKey only.
//
// Returns null when:
//   - The :parsed cache is missing.
//   - The :parsed cache is a PDF cache (outline entries all carry `page`).
//     PDF rendering needs a live pdfDoc, which we cannot resume from cache;
//     PDF cache fallback is deferred to v1.6 (SPEC §9 Q3).
//
// `paperKey` is the SAME string used everywhere else (Paper.id ?? urlHash).
// We treat it as urlHash for the rebuilt Paper, and additionally set
// Paper.id when the key looks arxiv-shaped (YYMM.NNNNN). Without setting
// id, downstream code that branches on `paper.id` (e.g. arxiv-only API
// fetches in overview-paper-info) would degrade silently to PDF-only mode.

import { getCachedParsed, getMemory } from './storage';
import { emptyMemory } from '../types';
import type { Paper, PdfRuntime } from '../types';

export interface LoadedFromCache {
  paper: Paper;
  pdfRuntime: PdfRuntime | null;
}

export async function loadPaperFromCache(paperKey: string): Promise<LoadedFromCache | null> {
  const cached = await getCachedParsed(paperKey);
  if (!cached) return null;

  // PDF cache detection — same heuristic as main.tsx loadPaper(): every
  // outline entry carries a numeric `page` field iff parsePdf produced it.
  const isPdfCache =
    cached.outline.length > 0 && cached.outline.every((o) => typeof o.page === 'number');
  if (isPdfCache) return null;

  const mem = (await getMemory(paperKey)) ?? emptyMemory();
  const isArxivShape = /^\d{4}\.\d{4,5}$/.test(paperKey);

  const paper: Paper = {
    id: isArxivShape ? paperKey : undefined,
    urlHash: paperKey,
    title: cached.title,
    authors: cached.authors,
    abstract: cached.abstract,
    venue: cached.venue,
    outline: cached.outline,
    paragraphs: cached.paragraphs,
    memory: mem,
  };

  return { paper, pdfRuntime: null };
}
