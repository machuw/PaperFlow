// supabase/functions/agent-run/tools/read-paper-section.ts
//
// CLIENT tool — NO execute. The Chrome extension's agent-tools/read-paper-section.ts
// reads document.querySelector('[data-pid=...]').textContent and returns text
// via addToolResult round-trip (Phase 10 D-01).

import { tool } from 'ai'
import { z } from 'zod'

export const readPaperSectionTool = tool({
  description:
    'Read the plain-text content of paragraph N in the user\'s currently open paper. ' +
    'Returns the paragraph text (no formatting). ' +
    'WHEN NOT TO USE: do not call for visual / image content (use screenshotParagraph for figures, equations as visuals); ' +
    'do not call to look up arbitrary unknown paragraphIds — first read the paper outline / structure to know which paragraphs exist; ' +
    'do not call to fetch entire sections (this returns ONE paragraph); ' +
    'do not call for content from a different paper (this only reads the currently open paper). ' +
    'GOOD INPUTS: "sec0-p2", "sec3-p1", "sec5-p4". ' +
    'For the abstract paragraph, use the special id "abs" (the abstract is rendered separately, NOT as sec0-p0). ' +
    'BAD INPUTS: section names like "Introduction"; paragraph indices like 1; non-data-pid strings. ' +
    'Argument: paragraphId (string).',
  inputSchema: z.object({
    paragraphId: z
      .string()
      .min(1)
      .describe(
        'The data-pid attribute value of the target paragraph on the reader page DOM. ' +
        'Find via the paper outline or readPaperSection on a known earlier paragraph first.',
      ),
  }),
  // NO execute — client tool resolved via addToolResult round-trip.
})
