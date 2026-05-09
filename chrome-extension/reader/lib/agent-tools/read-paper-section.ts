// chrome-extension/reader/lib/agent-tools/read-paper-section.ts
//
// Phase 11 Plan 05: DOM textContent extraction by data-pid.
// Returns ToolResult<{paragraphId, text}> per cross-boundary contract (D-B1).

import { z } from 'zod'
import type { ToolResult } from '../../../../supabase/functions/_shared/types'

const InputSchema = z.object({
  paragraphId: z.string().min(1),
})

export type ReadPaperSectionResult = ToolResult<{ paragraphId: string; text: string }>

export async function readPaperSection(args: unknown): Promise<ReadPaperSectionResult> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) {
    return { ok: false, kind: 'logical', reason: 'bad-input', detail: parsed.error.message }
  }
  const { paragraphId } = parsed.data
  if (typeof document === 'undefined') {
    return { ok: false, kind: 'transient', reason: 'paper-not-mounted', detail: 'document undefined (SW context?)' }
  }
  const el = document.querySelector<HTMLElement>(`[data-pid="${CSS.escape(paragraphId)}"]`)
  if (!el) {
    return { ok: false, kind: 'logical', reason: 'paragraph-not-found', detail: `data-pid="${paragraphId}"` }
  }
  const text = (el.textContent ?? '').trim()
  if (!text) {
    return { ok: false, kind: 'logical', reason: 'paragraph-empty', detail: `data-pid="${paragraphId}" has no textContent` }
  }
  return { ok: true, data: { paragraphId, text } }
}
