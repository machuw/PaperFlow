// supabase/functions/agent-run/tools/fetch-semantic-scholar.ts
//
// SERVER tool with `execute`. Looks up paper metadata via Semantic Scholar's
// public Graph API (no API key required). 1 req/s public rate limit per
// https://api.semanticscholar.org/api-docs/ — wrap fetch in withRetry with
// ≥1100ms backoff to be safe.
//
// ToS: User-Agent header with attribution required.
//
// Engineering principles (selection note §6.1, §6.2):
//   - NEVER throw inside execute() — return structured error
//   - Forward abortSignal into fetch()
//   - Distinguish transient (429/5xx/network) from logical (404/bad request)

import { tool } from 'ai'
import { z } from 'zod'
import {
  success,
  transientError,
  logicalError,
  withRetry,
} from '../../_shared/tool-result.ts'

type S2Author = { authorId?: string; name?: string }
type S2Paper = {
  paperId?: string
  title?: string
  abstract?: string | null
  authors?: S2Author[]
  citationCount?: number
  year?: number
  venue?: string
}

export const fetchSemanticScholarTool = tool({
  description:
    'Look up paper metadata (title, abstract, authors, citation count, year, venue) on Semantic Scholar by paperId. ' +
    'Accepts arXiv ID (e.g. "arxiv:2401.01234"), DOI (e.g. "10.1145/abc"), or Semantic Scholar 40-char ID. ' +
    'WHEN NOT TO USE: do not call for keyword search across the literature (use searchArxiv); ' +
    'do not call for general web search (use a web-search tool); ' +
    'use ONLY for cited-by / citation-graph queries on a known paperId, or for enriching an arXiv hit with ' +
    'citation count + abstract that searchArxiv does not return. ' +
    'BAD INPUTS: "transformers" (this is a query, not a paperId); empty string. ' +
    'GOOD INPUTS: "arxiv:2401.01234"; "10.1145/3658644.3690370"; "649def34f8be52c8b66281af98ae884c09aef38b". ' +
    'Argument: paperId (string).',
  inputSchema: z.object({
    paperId: z
      .string()
      .min(1, 'paperId must not be empty')
      .max(100, 'paperId must be ≤100 chars')
      .describe(
        'arXiv ID like "arxiv:2401.01234", DOI like "10.xxx/abc", or 40-char Semantic Scholar ID. NOT a search query.',
      ),
  }),
  execute: async ({ paperId }, { abortSignal }) => {
    const fields = 'title,abstract,authors,citationCount,year,venue'
    const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}?fields=${fields}`
    const headers: Record<string, string> = {
      'User-Agent': 'PaperFlow/1.0 (mailto:contact@paperflow.local)',
      'Accept': 'application/json',
    }

    try {
      // 1 req/s public rate limit — backoff 1100ms to be safe.
      const r = await withRetry(
        () => fetch(url, { headers, signal: abortSignal }),
        { maxAttempts: 2, backoffMs: 1100 },
      )

      if (r.status === 429) return transientError('s2-rate-limited', '429')
      if (r.status === 404) {
        return logicalError('paper-not-found', `paperId=${paperId} not in Semantic Scholar`)
      }
      if (r.status >= 400 && r.status < 500) return logicalError('s2-bad-request', `${r.status}`)
      if (!r.ok) return transientError('s2-server-error', `${r.status}`)

      const raw = await r.json() as S2Paper
      // Cap response size for context-window economy (PATTERNS.md §4 risk note).
      const data = {
        paperId: raw.paperId ?? paperId,
        title: raw.title ?? '',
        abstract: typeof raw.abstract === 'string' && raw.abstract.length > 500
          ? raw.abstract.slice(0, 500) + '…'
          : (raw.abstract ?? ''),
        authors: (raw.authors ?? []).slice(0, 5).map((a) => a.name).filter(Boolean) as string[],
        citationCount: typeof raw.citationCount === 'number' ? raw.citationCount : 0,
        year: raw.year ?? null,
        venue: raw.venue ?? '',
      }
      return success(data)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return transientError('aborted')
      return transientError('network-error', (e as Error).message)
    }
  },
})
