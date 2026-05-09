import { getOverviewMeta, setOverviewMeta } from './storage';
import type { OverviewMeta } from '../types';

const ENDPOINT = 'https://api.semanticscholar.org/graph/v1/paper/arXiv:';
const FIELDS = 'venue,citationCount,fieldsOfStudy,openAccessPdf';
let queue: Promise<unknown> = Promise.resolve();

function jitterTtlMs(): number {
  const days = 5 + Math.random() * 4;
  return days * 86400000;
}

export async function fetchOverviewMeta(paperKey: string, arxivId: string | null): Promise<OverviewMeta | null> {
  if (!arxivId) return null;
  const cached = await getOverviewMeta(paperKey);
  const now = Date.now();
  if (cached) {
    if (cached.failed && cached.failedAt && now - cached.failedAt < 86400000) return null;
    if (!cached.failed && cached.expiresAt > now) return cached;
  }
  return queue = queue.then(async () => {
    try {
      const res = await fetch(`${ENDPOINT}${encodeURIComponent(arxivId)}?fields=${FIELDS}`);
      if (!res.ok) {
        const m: OverviewMeta = { fetchedAt: now, expiresAt: now + jitterTtlMs(), failed: true, failedAt: now };
        await setOverviewMeta(paperKey, m);
        return null;
      }
      const j = await res.json();
      const m: OverviewMeta = {
        venue: j.venue ?? undefined,
        citations: j.citationCount ?? undefined,
        codeUrl: j.openAccessPdf?.url ?? undefined,
        field: Array.isArray(j.fieldsOfStudy) ? j.fieldsOfStudy.join(' / ') : undefined,
        fetchedAt: now,
        expiresAt: now + jitterTtlMs(),
      };
      await setOverviewMeta(paperKey, m);
      return m;
    } catch {
      const m: OverviewMeta = { fetchedAt: now, expiresAt: now + jitterTtlMs(), failed: true, failedAt: now };
      await setOverviewMeta(paperKey, m);
      return null;
    }
  }) as Promise<OverviewMeta | null>;
}

export function _resetForTest(): void { queue = Promise.resolve(); }
