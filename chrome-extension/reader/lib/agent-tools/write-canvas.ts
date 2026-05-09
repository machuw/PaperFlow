// chrome-extension/reader/lib/agent-tools/write-canvas.ts
//
// Phase 11 Plan 05: append a node to the user's canvas.
// - Dispatches CustomEvent('canvas:add-node') for live UI update (canvas-view listens)
// - Persists to chrome.storage.local 'paper:{pk}:canvas:agentNodes' so canvas-view
//   can hydrate the node on next mount (PATTERNS.md §12 risk note)
//
// Returns ToolResult<{nodeId}> — the new node's id (mintable up-front).

import { z } from 'zod'
import type { ToolResult } from '../../../../supabase/functions/_shared/types'
import { paperCanvasAgentNodesKey } from '../storage-schema'

const InputSchema = z.object({
  nodeType: z.enum(['paper', 'section', 'note', 'linked', 'chat']),
  nodeTitle: z.string().min(1).max(200),
  nodeBody: z.string().max(2000).optional(),
  parentNodeId: z.string().optional(),
})

export type WriteCanvasResult = ToolResult<{ nodeId: string }>

export interface AgentInjectedNode {
  nodeId: string
  nodeType: 'paper' | 'section' | 'note' | 'linked' | 'chat'
  nodeTitle: string
  nodeBody?: string
  parentNodeId?: string
  createdAt: number
}

function activePaperKey(): string | null {
  try {
    if (typeof window !== 'undefined') {
      // Reader (main.tsx) sets this on paper-effect entry; canvas-view also reads it.
      const pk = (window as Window & { __pfActivePaperPk?: string }).__pfActivePaperPk
      if (typeof pk === 'string' && pk.length > 0) return pk
    }
  } catch { /* no-op */ }
  return null
}

export async function writeCanvas(args: unknown): Promise<WriteCanvasResult> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) {
    return { ok: false, kind: 'logical', reason: 'bad-input', detail: parsed.error.message }
  }
  const nodeId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const node: AgentInjectedNode = {
    nodeId,
    ...parsed.data,
    createdAt: Date.now(),
  }

  // Dispatch event for live UI update (non-fatal if window unavailable).
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('canvas:add-node', { detail: node }))
    }
  } catch { /* non-fatal */ }

  // Persist for durability across reload / variant switch.
  const pk = activePaperKey()
  if (pk) {
    try {
      const key = paperCanvasAgentNodesKey(pk)
      const existing = await chrome.storage.local.get([key])
      const list = (existing?.[key] as AgentInjectedNode[] | undefined) ?? []
      list.push(node)
      await chrome.storage.local.set({ [key]: list })
    } catch {
      // Persist failed but event went out; treat as success — caller already
      // sees the node in-UI and can re-emit later if needed.
      return { ok: true, data: { nodeId } }
    }
  }

  return { ok: true, data: { nodeId } }
}
