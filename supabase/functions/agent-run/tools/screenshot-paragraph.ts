// supabase/functions/agent-run/tools/screenshot-paragraph.ts
//
// CLIENT tool — NO execute. The Chrome extension's agent-client.ts (Plan 06)
// computes the result via chrome.tabs.captureVisibleTab and POSTs back via
// addToolResult flow.
//
// Pitfall (AI-SPEC §3 Pitfall 2 / vercel/ai #7683): the client must NOT set
// `sendAutomaticallyWhen: true` — manual decision to re-POST is required.

import { tool } from 'ai'
import { z } from 'zod'

export const screenshotParagraphTool = tool({
  description:
    'Capture a screenshot of paragraph N in the user\'s currently open paper. Returns a data URL (base64 PNG). ' +
    'WHEN NOT TO USE: do not call for plain text content (use readPaperSection — same paragraph, no image overhead); ' +
    'do not call for whole-page screenshots (this captures a single paragraph by data-pid); ' +
    'do not call before the user has scrolled to the paragraph — readPaperSection works regardless of scroll position; ' +
    'do not call repeatedly on the same paragraphId (the image is deterministic). ' +
    'GOOD INPUTS: a known data-pid like "sec0-p2" or "sec3-p1" (find via readPaperSection or paper outline). ' +
    'For the abstract paragraph, use the special id "abs" (the abstract is rendered separately, NOT as sec0-p0). ' +
    'BAD INPUTS: paragraph numbers like "1" / "2" (those are not data-pid values). ' +
    'Argument: paragraphId (string).',
  inputSchema: z.object({
    paragraphId: z
      .string()
      .min(1)
      .describe(
        'The data-pid attribute value of the target paragraph on the reader page DOM. ' +
        'Find via the outline or by reading the paper structure first.',
      ),
  }),
  // NO execute — client tool. SDK emits tool-call frame; Chrome ext implements;
  // addToolResult feeds the result back into the next request.
})
