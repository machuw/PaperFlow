import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// AI SDK 5 v5 LTS pin guard (CONTEXT.md INFRA-AGENT-01 / AI-SPEC §3 Pitfall 5).
// Auto-bump to v6 would silently break the Phase 10 agent-run invariants
// (rewritten Agent abstraction, possibly altered tool authoring contract).
//
// This test is the LAST line of defense — the GitHub workflow runs this same
// check via a `node -e` sentinel so the gate survives even if this file is removed.

describe('AI SDK 5 version pin', () => {
  const pkgPath = resolve(__dirname, '..', 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

  it('pins ai to exact 5.x.x — no caret, no tilde', () => {
    const aiVersion = pkg.dependencies.ai
    expect(aiVersion).toBeDefined()
    expect(aiVersion).toMatch(/^5\.\d+\.\d+$/)
    expect(aiVersion.startsWith('^')).toBe(false)
    expect(aiVersion.startsWith('~')).toBe(false)
  })

  it('pins @ai-sdk/openai-compatible to exact 1.x.x (V2-spec compatible with ai@5)', () => {
    // 2.x bumped to LanguageModelV3 spec which ai@5 doesn't accept (raises
    // AI_UnsupportedModelVersionError at runtime). 1.0.36 uses
    // @ai-sdk/provider@2.0.1 + @ai-sdk/provider-utils@3.0.23 — exact match
    // for ai@5.0.179's bundled provider deps. Bump to 2.x is gated on
    // upgrading ai to 6.x (Phase 12+).
    const v = pkg.dependencies['@ai-sdk/openai-compatible']
    expect(v).toBeDefined()
    expect(v).toMatch(/^1\.\d+\.\d+$/)
    expect(v.startsWith('^')).toBe(false)
    expect(v.startsWith('~')).toBe(false)
  })

  it('pins zod to exact 3.x.x', () => {
    const v = pkg.dependencies.zod
    expect(v).toBeDefined()
    expect(v).toMatch(/^3\.\d+\.\d+$/)
  })

  it('imports streamText symbol from ai module', async () => {
    // Just imports — does not call the model. Validates module resolution.
    const ai = await import('ai')
    expect(typeof ai.streamText).toBe('function')
    expect(typeof ai.stepCountIs).toBe('function')
    expect(typeof ai.tool).toBe('function')
  })

  it('imports createOpenAICompatible from @ai-sdk/openai-compatible', async () => {
    const mod = await import('@ai-sdk/openai-compatible')
    expect(typeof mod.createOpenAICompatible).toBe('function')
  })
})
