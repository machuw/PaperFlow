const ARXIV_ID_RE = /(\d{4}\.\d{4,5})(v\d+)?/;

export function normalizeArxivId(url: string): string | null {
  if (!url.includes('arxiv.org/')) return null;
  const m = url.match(ARXIV_ID_RE);
  return m ? m[1] : null;
}

/**
 * User-intent detection for arXiv URLs. A click on `/pdf/{id}` means the
 * user wants the canonical PDF (as published), not the ar5iv HTML (which
 * can diverge in content, formatting, or figure placement because ar5iv is
 * LaTeXML-generated from the source).
 *
 * `/abs/`, `/html/`, or bare-id sources return false — those callers
 * prefer HTML-first (faster, richer selection/highlight).
 */
export function prefersPdfForArxiv(url: string): boolean {
  return /\barxiv\.org\/pdf\//.test(url);
}

export async function urlHash(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 12);
}

export function paperKey(paper: { id?: string; urlHash: string }): string {
  return paper.id ?? paper.urlHash;
}

/**
 * Phase 27 — rebuild a fetch-able arXiv URL from a library row whose `src`
 * was lost (legacy entry pre-dating the src column).
 *
 * Returns `https://arxiv.org/abs/<id>` for new-style ids; null otherwise.
 *
 * /abs/ over /pdf/ on purpose: matches a fresh visit's preferred path
 * (HTML-first → richer selection, faster first paint, can still re-route to
 * pdfjs via prefersPdfForArxiv when the user explicitly opens /pdf/).
 *
 * Old-style ids (cs/0512345 etc.) are not supported — the loader doesn't
 * handle them either, so failing closed lets the caller fall through to the
 * paperKey cache route (or toast).
 */
export function reconstructUrlForArxivRow(row: { id?: string }): string | null {
  if (!row.id) return null;
  // ARXIV_ID_RE matches new-style YYMM.NNNN(N)(vN)? anywhere in the string.
  // Anchor it for id-only input so 'h-abcdef123456' (urlHash shape) doesn't
  // false-match a digit substring.
  const m = row.id.match(/^(\d{4}\.\d{4,5})(v\d+)?$/);
  return m ? `https://arxiv.org/abs/${m[1]}` : null;
}

/**
 * Rewrite a source URL so the response body is the raw PDF.
 *
 * Hugging Face: `huggingface.co/{owner}/{repo}/blob/{rev}/{path}` is the
 * HTML preview page, not the file — fetching it and handing the bytes to
 * pdfjs yields "Invalid PDF structure". The raw LFS blob lives at the
 * parallel `/resolve/{rev}/{path}` route. `hf.co` is the short mirror with
 * identical routing.
 *
 * Pass-through for everything else, and idempotent on already-rewritten
 * URLs. Callers keep the original URL for hashing/filename so cache and
 * library keys stay stable across the rewrite.
 */
export function normalizePdfFetchUrl(url: string): string {
  return url.replace(
    /^(https?:\/\/(?:huggingface\.co|hf\.co)\/[^/]+\/[^/]+)\/blob\//,
    '$1/resolve/',
  );
}
