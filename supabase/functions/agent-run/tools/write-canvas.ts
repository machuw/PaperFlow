// supabase/functions/agent-run/tools/write-canvas.ts
//
// CLIENT tool — NO execute. The Chrome extension's agent-tools/write-canvas.ts
// dispatches CustomEvent('canvas:add-node') + persists to chrome.storage.local
// 'paper:{pk}:canvas:agentNodes' so canvas-view.tsx can add the node whether
// mounted or not (PATTERNS.md §12).

import { tool } from 'ai'
import { z } from 'zod'

export const writeCanvasTool = tool({
  description:
    'Append a single node to the user\'s canvas (auto-laid-out via dagre on next render). ' +
    'Use to surface a search result, an interesting paragraph, or a chat conclusion as a persistent node. ' +
    'WHEN NOT TO USE: do not call to read canvas state (canvas state is observed via the paper context in subsequent messages); ' +
    'do not call to add multiple nodes at once (call once per node — they auto-layout); ' +
    'do not call for transient annotations (use a chat reply for ephemeral remarks); ' +
    'do not call to delete or rename nodes (this is append-only; v1.5+ adds full mutation). ' +
    'GOOD CALLS: nodeType="paper" + nodeTitle="ViT-22B (Dehghani 2024)" to add an arXiv result; ' +
    'nodeType="note" + nodeTitle="Key insight" + nodeBody="Self-attention scales..." to capture a thought. ' +
    'BAD CALLS: nodeType="dummy" (not in enum); empty nodeTitle. ' +
    'Arguments: nodeType (string), nodeTitle (string).',
  inputSchema: z.object({
    nodeType: z.enum(['paper', 'section', 'note', 'linked', 'chat']).describe(
      'Visual category. paper=arxiv result; section=paper section; note=user/agent note; linked=cross-paper link; chat=chat-derived insight.',
    ),
    nodeTitle: z.string().min(1).max(200).describe('Short title shown on the node card (≤200 chars).'),
    nodeBody: z.string().max(2000).optional().describe('Optional body text (≤2000 chars).'),
    parentNodeId: z.string().optional().describe('Optional parent node id; if present, an edge is drawn from parent → new node (deferred to v1.5).'),
  }),
  // NO execute — client tool resolved via addToolResult round-trip.
})
