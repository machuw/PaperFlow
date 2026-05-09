// supabase/functions/agent-run/tools/search-arxiv.ts
//
// SERVER tool with `execute`. Phase 11 deltas vs Phase 10 ship:
//   1. ToolResult discriminated union returns (D-B1) — success/transientError/logicalError
//   2. Tightened WHEN-NOT-TO-USE description (selection note §8 lever #2)
//
// Engineering principles (selection note §6.1, §6.2):
//   - NEVER throw inside execute() — return structured error so model self-corrects
//   - Forward abortSignal into fetch() so client-disconnect cuts mid-flight
//   - Distinguish transient (don't push to model) from logical (push to model)

import { tool } from 'ai'
import { z } from 'zod'
import { success, transientError, logicalError } from '../../_shared/tool-result.ts'

export const searchArxivTool = tool({
  description:
    'Search arXiv for academic papers matching a query. Returns up to 10 metadata hits as raw arXiv API XML. ' +
    'WHEN NOT TO USE: do not call for general web facts (use a web-search tool); ' +
    'do not call for citation graphs / cited-by lookups (use fetchSemanticScholar); ' +
    'do not call to look up a paper you already know the arXiv ID of (use fetchSemanticScholar with paperId). ' +
    'BAD QUERIES: "transformers" (too broad — millions of hits); "ML" (acronym, low recall). ' +
    'GOOD QUERIES: "vision transformers ImageNet 2024"; "RLHF reward model alignment 2023". ' +
    'Argument: query (string).',
  inputSchema: z.object({
    query: z
      .string()
      .min(1, 'query must not be empty')
      .max(200, 'query must be ≤200 chars (arxiv full-text indexer noise above this)')
      .describe(
        'Search query — be specific. Bad: "transformers". Good: "vision transformers ImageNet 2024".',
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe('Number of hits to return; default 5; cap 10 to keep tool-result tokens bounded.'),
  }),
  execute: async ({ query, maxResults }, { abortSignal }) => {
    try {
      const url =
        `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}` +
        `&max_results=${maxResults}`
      const r = await fetch(url, { signal: abortSignal })
      if (r.status === 429) {
        return transientError('arxiv-rate-limited', `${r.status}`)
      }
      if (r.status >= 400 && r.status < 500) {
        return logicalError('arxiv-bad-query', `${r.status} — narrow the query or try a different one`)
      }
      if (!r.ok) {
        return transientError('arxiv-server-error', `${r.status}`)
      }
      const items = await r.text()
      return success({ items })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return transientError('aborted')
      return transientError('network-error', (e as Error).message)
    }
  },
})
