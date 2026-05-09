// chrome-extension/reader/lib/agent-tools/screenshot-paragraph.ts
//
// Phase 11 Plan 05: real DOM screenshot via chrome.tabs.captureVisibleTab.
// Returns ToolResult<{dataUrl}> per cross-boundary type contract (D-B1).
//
// CHROME PERMISSION NOTE: this requires "tabs" or "activeTab" in manifest.json
// (Plan 05 adds "activeTab"). If missing, the call rejects — caller catches
// and returns transientError so the model can self-correct.

import { z } from 'zod'
import type { ToolResult } from '../../../../supabase/functions/_shared/types'

const InputSchema = z.object({
  paragraphId: z.string().min(1, 'paragraphId must not be empty'),
})

export type ScreenshotParagraphResult = ToolResult<{ dataUrl: string }>

export async function screenshotParagraph(
  args: unknown,
): Promise<ScreenshotParagraphResult> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) {
    return { ok: false, kind: 'logical', reason: 'bad-input', detail: parsed.error.message }
  }

  const { paragraphId } = parsed.data
  const target = typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>(`[data-pid="${CSS.escape(paragraphId)}"]`)
    : null
  if (!target) {
    return { ok: false, kind: 'logical', reason: 'paragraph-not-found', detail: `data-pid="${paragraphId}"` }
  }

  // chrome.tabs.captureVisibleTab requires "activeTab" (or "tabs") permission.
  // We capture the full visible tab and trust the model+UI to show the
  // surrounding context (cropping to bounding rect is a v1.5+ refinement).
  try {
    target.scrollIntoView({ block: 'center', behavior: 'auto' })
    // Allow 1 frame for paint before capture.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)))

    const dataUrl: string = await new Promise((resolve, reject) => {
      try {
        chrome.tabs.captureVisibleTab(
          { format: 'png' },
          (data) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message ?? 'captureVisibleTab failed'))
            } else if (!data) {
              reject(new Error('captureVisibleTab returned empty'))
            } else {
              resolve(data)
            }
          },
        )
      } catch (e) {
        reject(e)
      }
    })

    return { ok: true, data: { dataUrl } }
  } catch (e) {
    return { ok: false, kind: 'transient', reason: 'capture-failed', detail: (e as Error).message }
  }
}
