// chrome-extension/reader/lib/use-agent-run.ts
//
// Phase 11 Plan 06: React hook reducing RunAgentEvent → TraceEntry[].
// Per UI-SPEC §8.3. Used by chat-view.tsx (Plan 07) to drive <TraceStack>.
//
// The reducer rules (UI-SPEC §8.3):
//   - tool-call (first time toolCallId seen): create entry state='running', fill input
//   - tool-call (toolCallId already seen): update input (defensive; should be rare)
//   - tool-result: update entry to state='done', fill output, set endedAt
//   - tool-error: update entry to state='error', fill errorKind/errorReason, set endedAt
//   - step-start / step-finish / finish: stream-level; no card-level change
//
// Multi-trigger compat (UI-SPEC §8.3 last bullet): the dev-menu calls runAgent
// WITHOUT passing onEvent — its frames are still consumed but useAgentRun is
// not subscribed. Both routes share the same agent-client.ts internals.

import { useCallback, useMemo, useRef, useState } from 'react'
import type { RunAgentEvent } from './agent-client'
import { runAgent } from './agent-client'

export interface TraceEntry {
  toolCallId: string
  toolName: string
  state: 'pending' | 'running' | 'done' | 'error'
  errorKind?: 'transient' | 'logical'
  errorReason?: string
  input?: unknown
  output?: unknown
  startedAt: number
  endedAt?: number
}

export interface UseAgentRunResult {
  run: (params: { messages: Array<unknown>; assistantMsgId: string; abortSignal?: AbortSignal }) => Promise<void>
  abort: () => void
  traces: Map<string, TraceEntry[]>
  tracesByMsgId: Record<string, TraceEntry[]>
  expanded: Set<string>
  outputExpanded: Set<string>
  toggleExpanded: (toolCallId: string) => void
  toggleOutputExpanded: (toolCallId: string) => void
  running: boolean
  // Phase 12 Plan 05 (MED-6 cross-AI review): config-error variant surfaces
  // pre-tool-call problems (e.g. no active BYOK config) as a banner / setup
  // prompt — NOT a trace card. The host component renders this slot above
  // the trace stack.
  configError: { kind: 'no-active-config' | 'invalid-config'; reason: string; detail?: string } | null
  clearConfigError: () => void
}

export function useAgentRun(): UseAgentRunResult {
  const [traces, setTraces] = useState<Map<string, TraceEntry[]>>(() => new Map())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [outputExpanded, setOutputExpanded] = useState<Set<string>>(() => new Set())
  const [running, setRunning] = useState(false)
  // Phase 12 Plan 05 (MED-6 cross-AI review): config-error banner state slot.
  // Stored separately from trace cards because the event occurs before any
  // tool call — the host component renders this as a top-of-panel notice.
  const [configError, setConfigError] = useState<
    { kind: 'no-active-config' | 'invalid-config'; reason: string; detail?: string } | null
  >(null)

  const abortRef = useRef<AbortController | null>(null)
  const currentMsgIdRef = useRef<string | null>(null)

  // Convert Map → plain object for easy useMemo dep tracking in consumers.
  const tracesByMsgId = useMemo(() => {
    const obj: Record<string, TraceEntry[]> = {}
    for (const [k, v] of traces) obj[k] = v
    return obj
  }, [traces])

  const onEvent = useCallback((e: RunAgentEvent) => {
    // Phase 12 Plan 05 (MED-6 cross-AI review): config-error is a pre-tool-call
    // event — store in a separate banner slot, do NOT push into trace cards.
    if (e.type === 'config-error') {
      setConfigError({ kind: e.kind, reason: e.reason, detail: e.detail })
      return
    }
    const msgId = currentMsgIdRef.current
    if (!msgId) return
    setTraces((prev) => {
      const list = (prev.get(msgId) ?? []).slice()
      const findIdx = (id: string) => list.findIndex((x) => x.toolCallId === id)

      if (e.type === 'tool-call') {
        const idx = findIdx(e.toolCallId)
        const entry: TraceEntry = {
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          state: 'running',
          input: e.input,
          startedAt: idx >= 0 ? list[idx].startedAt : Date.now(),
        }
        if (idx >= 0) list[idx] = entry
        else list.push(entry)
      } else if (e.type === 'tool-result') {
        const idx = findIdx(e.toolCallId)
        if (idx >= 0) {
          list[idx] = { ...list[idx], state: 'done', output: e.output, endedAt: Date.now() }
        }
      } else if (e.type === 'tool-error') {
        const idx = findIdx(e.toolCallId)
        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            state: 'error',
            errorKind: e.kind,
            errorReason: e.reason,
            endedAt: Date.now(),
          }
        } else {
          // Defensive: error without prior tool-call (rare; emit a synthetic entry).
          list.push({
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            state: 'error',
            errorKind: e.kind,
            errorReason: e.reason,
            startedAt: Date.now(),
            endedAt: Date.now(),
          })
        }
      }
      // step-start / step-finish / finish: no card-level mutation per UI-SPEC §8.3 reducer rules

      const next = new Map(prev)
      next.set(msgId, list)
      return next
    })
  }, [])

  const run = useCallback(
    async (params: { messages: Array<unknown>; assistantMsgId: string; abortSignal?: AbortSignal }) => {
      currentMsgIdRef.current = params.assistantMsgId
      // Phase 12 Plan 05 (MED-6): clear any prior config-error banner; the
      // current run will surface a fresh one if the config is still missing.
      setConfigError(null)
      const ctl = new AbortController()
      abortRef.current = ctl
      const externalSignal = params.abortSignal
      if (externalSignal) {
        if (externalSignal.aborted) ctl.abort()
        else externalSignal.addEventListener('abort', () => ctl.abort(), { once: true })
      }
      setRunning(true)
      try {
        await runAgent({
          messages: params.messages as Array<{ role: string; content: unknown; toolCallId?: string }>,
          abortSignal: ctl.signal,
          onEvent,
        })
      } finally {
        setRunning(false)
      }
    },
    [onEvent],
  )

  const clearConfigError = useCallback(() => setConfigError(null), [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    // UI-SPEC §12 row "Stream aborts mid-tool-call": mark all running entries
    // as error/transient/'已取消'.
    const msgId = currentMsgIdRef.current
    if (!msgId) return
    setTraces((prev) => {
      const list = (prev.get(msgId) ?? []).slice()
      for (let i = 0; i < list.length; i++) {
        if (list[i].state === 'running') {
          list[i] = {
            ...list[i],
            state: 'error',
            errorKind: 'transient',
            errorReason: '已取消',
            endedAt: Date.now(),
          }
        }
      }
      const next = new Map(prev)
      next.set(msgId, list)
      return next
    })
  }, [])

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const toggleOutputExpanded = useCallback((id: string) => {
    setOutputExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  return {
    run,
    abort,
    traces,
    tracesByMsgId,
    expanded,
    outputExpanded,
    toggleExpanded,
    toggleOutputExpanded,
    running,
    configError,
    clearConfigError,
  }
}
