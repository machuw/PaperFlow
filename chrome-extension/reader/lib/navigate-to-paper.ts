// Phase 27 — Library card click → reader navigation planner.
//
// Pure helper: takes a library row + the currently-open paperKey, returns a
// tagged action the caller dispatches. Keeps the dispatch (chrome.tabs.create
// / showToast / onClose) out of this module so it stays trivially testable.
//
// CRITICAL — URL encoding: both #src= and #paperKey= fragments embed values
// RAW (no percent-encoding). inject.ts and sw.ts pass raw URLs by convention,
// and readSrc() / readPaperKey() in main.tsx use .slice() without
// decodeURIComponent. Re-encoding would round-trip back to fetch() as a
// relative path → ERR_FILE_NOT_FOUND. (Verified via playwright network log
// 2026-05-07; see Phase 27 SPEC §A3.)
//
// 5-branch fallback chain (priority order):
//   1. rowKey === currentPaperKey       → close-only (don't open dup tab)
//   2. row.src present                  → #src=<raw URL>
//   3. row.id is arxiv-shaped           → #src=https://arxiv.org/abs/{id}
//   4. paperKey :parsed cache loadable  → #paperKey=<key>
//   5. else                             → toast

import type { LibraryRow } from '../types';
import { reconstructUrlForArxivRow } from './ids';
import { loadPaperFromCache } from './load-paper-from-cache';

export type NavigateAction =
  | { kind: 'close-only' }
  | { kind: 'open-tab'; url: string }
  | { kind: 'toast'; messageKey: string };

export interface PlanNavigateInput {
  row: LibraryRow;
  rowKey: string;
  currentPaperKey: string;
}

const READER_PATH = 'reader/index.html';

function openTab(fragment: string): NavigateAction {
  return {
    kind: 'open-tab',
    url: chrome.runtime.getURL(READER_PATH) + fragment,
  };
}

export async function planNavigateToPaper(input: PlanNavigateInput): Promise<NavigateAction> {
  if (input.rowKey === input.currentPaperKey) {
    return { kind: 'close-only' };
  }

  // Priority 2: original URL captured at last open.
  if (input.row.src) {
    return openTab('#src=' + input.row.src);
  }

  // Priority 3: rebuild a canonical /abs/ URL from an arxiv-shaped id.
  // /abs/ over /pdf/ on purpose — matches a fresh visit's HTML-first
  // preference (richer selection, faster first paint).
  const reconstructed = reconstructUrlForArxivRow(input.row);
  if (reconstructed) {
    return openTab('#src=' + reconstructed);
  }

  // Priority 4: previously-parsed cache exists → render from storage.
  // Returns null for cache miss AND for PDF cache (PDF fallback deferred to
  // v1.6 — pdfjs needs live bytes that the cache doesn't carry).
  const fromCache = await loadPaperFromCache(input.rowKey);
  if (fromCache) {
    return openTab('#paperKey=' + input.rowKey);
  }

  return { kind: 'toast', messageKey: 'library.jump.needsOriginalUrl' };
}
