import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// v1.2.x A2 — static-grep guard for the always-on agent system prompt.
//
// Phase 14 q-01 live eval surfaced a behavior bug: the agent emitted ONE
// failing tool call and then terminated without producing a user-facing
// answer. Root cause was that supabase/functions/agent-run/index.ts never
// passed a system prompt to runAgent, so the model had no recovery / final-
// answer guidance.
//
// This test pins the post-fix contract: index.ts MUST contain a default
// system-prompt constant and MUST forward it (or a caller override) into
// runAgent's `systemPrompt` slot. Static grep is the right level of test —
// dynamic verification would require live LLM calls, which is what the eval
// runner already does.

const REPO_ROOT = resolve(__dirname, '..', '..')
const INDEX_PATH = resolve(REPO_ROOT, 'supabase/functions/agent-run/index.ts')

describe('agent-run system prompt', () => {
  const src = readFileSync(INDEX_PATH, 'utf-8')

  it('declares a DEFAULT_AGENT_SYSTEM_PROMPT constant', () => {
    expect(src).toMatch(/const\s+DEFAULT_AGENT_SYSTEM_PROMPT\s*=/)
  })

  it("prompt mentions tool-failure recovery (the q-01 root cause)", () => {
    expect(src).toMatch(/tool[- ]failure\s+recovery/i)
  })

  it('prompt mentions final-answer obligation (no silent termination)', () => {
    expect(src).toMatch(/final[- ]answer\s+obligation/i)
  })

  it('forwards the prompt (or caller override) into runAgent.systemPrompt', () => {
    expect(src).toMatch(
      /systemPrompt:\s*body\.system\s*\?\?\s*DEFAULT_AGENT_SYSTEM_PROMPT/,
    )
  })

  it('AgentRunBody type accepts an optional `system` override', () => {
    expect(src).toMatch(/system\?:\s*string/)
  })
})
