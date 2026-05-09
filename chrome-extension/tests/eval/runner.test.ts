// chrome-extension/tests/eval/runner.test.ts
//
// Phase 14 EVAL-02 / EVAL-03 — vitest unit tests for the eval runner core.
//
// Coverage:
//   - jaccardScore (5 cases)
//   - argsContainsScore C-5 ArgMatch (6 cases incl. anti-regression)
//   - parseSSEFrames (3 cases incl. comment-frame skip)
//   - JUDGE_PROMPT_TEMPLATE placeholders + SCORE regex
//   - judgeFinalAnswer happy + bad-output (mocked fetch)
//   - withRetry C-3 (4 cases — appended in Task 3)
//   - isMainModule C-4 (2 cases — appended in Task 3)
//
// NO live HTTP. NO chrome.* references. NO supabase imports.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { jaccardScore, argsContainsScore } from './metric'
import { parseSSEFrames } from './sse'
import { JUDGE_PROMPT_TEMPLATE, judgeFinalAnswer } from './judge'
import { withRetry, isMainModule } from './runner'

// ───────────────── helpers ─────────────────

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(s))
      controller.close()
    },
  })
}

async function collectFrames(s: string) {
  const out: unknown[] = []
  for await (const f of parseSSEFrames(streamFromString(s))) out.push(f)
  return out
}

// ───────────────── jaccardScore ─────────────────

describe('jaccardScore', () => {
  it('equal sets → 1', () => {
    expect(jaccardScore(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1)
  })
  it('disjoint sets → 0', () => {
    expect(jaccardScore(['a', 'b'], ['c', 'd'])).toBe(0)
  })
  it('subset → correct fraction', () => {
    // expected={a,b}, observed={a,b,c} → intersect=2, union=3 → 2/3
    expect(jaccardScore(['a', 'b'], ['a', 'b', 'c'])).toBeCloseTo(2 / 3, 5)
  })
  it('empty-empty → 1 (perfect agreement)', () => {
    expect(jaccardScore([], [])).toBe(1)
  })
  it('empty-vs-non-empty → 0', () => {
    expect(jaccardScore([], ['a'])).toBe(0)
    expect(jaccardScore(['a'], [])).toBe(0)
  })
})

// ───────────────── argsContainsScore (C-5 ArgMatch) ─────────────────

describe('argsContainsScore (C-5 ArgMatch)', () => {
  it('exact match success', () => {
    const score = argsContainsScore(
      [{ tool: 'readPaperSection', argsContains: { paragraphId: { kind: 'exact', value: 'sec1-p3' } } }],
      [{ toolName: 'readPaperSection', args: { paragraphId: 'sec1-p3' } }],
    )
    expect(score).toBe(1)
  })
  it('exact match failure (anti-regression: substring "sec" does NOT pass exact "sec1-p3")', () => {
    const score = argsContainsScore(
      [{ tool: 'readPaperSection', argsContains: { paragraphId: { kind: 'exact', value: 'sec1-p3' } } }],
      [{ toolName: 'readPaperSection', args: { paragraphId: 'sec' } }],
    )
    // C-5 critical: exact gold 'sec1-p3' rejects observed 'sec' (the
    // pre-C-5 substring policy would have falsely passed).
    expect(score).toBe(0)
  })
  it('substring match success', () => {
    const score = argsContainsScore(
      [{ tool: 'searchArxiv', argsContains: { query: { kind: 'substring', value: 'BERT' } } }],
      [{ toolName: 'searchArxiv', args: { query: 'BERT pre-training language model' } }],
    )
    expect(score).toBe(1)
  })
  it('substring case-insensitive', () => {
    const score = argsContainsScore(
      [{ tool: 'searchArxiv', argsContains: { query: { kind: 'substring', value: 'bert' } } }],
      [{ toolName: 'searchArxiv', args: { query: 'BERT' } }],
    )
    expect(score).toBe(1)
  })
  it('missing arg key fails', () => {
    const score = argsContainsScore(
      [{ tool: 'readPaperSection', argsContains: { paragraphId: { kind: 'exact', value: 'sec1-p3' } } }],
      [{ toolName: 'readPaperSection', args: { otherKey: 'sec1-p3' } }],
    )
    expect(score).toBe(0)
  })
  it('mixed exact + substring per entry — both must match', () => {
    const score = argsContainsScore(
      [
        {
          tool: 'writeCanvas',
          argsContains: {
            nodeType: { kind: 'exact', value: 'paper' },
            nodeTitle: { kind: 'substring', value: 'attention' },
          },
        },
      ],
      [{ toolName: 'writeCanvas', args: { nodeType: 'paper', nodeTitle: 'Self-Attention Mechanism' } }],
    )
    expect(score).toBe(1)
  })
})

// ───────────────── parseSSEFrames ─────────────────

describe('parseSSEFrames', () => {
  it('single LF-LF frame parsed', async () => {
    const frames = await collectFrames('data: {"type":"text-delta","delta":"hi"}\n\n')
    expect(frames).toEqual([{ type: 'text-delta', delta: 'hi' }])
  })
  it('CRLF-CRLF frame parsed', async () => {
    const frames = await collectFrames('data: {"type":"finish","totalTokens":42}\r\n\r\n')
    expect(frames).toEqual([{ type: 'finish', totalTokens: 42 }])
  })
  it('comment frame (keepalive) is skipped — yields no frame', async () => {
    const frames = await collectFrames(':keepalive\n\ndata: {"type":"text-delta","delta":"x"}\n\n')
    // The comment frame is skipped silently; only the real frame remains.
    expect(frames).toEqual([{ type: 'text-delta', delta: 'x' }])
  })
})

// ───────────────── JUDGE_PROMPT_TEMPLATE ─────────────────

describe('JUDGE_PROMPT_TEMPLATE', () => {
  it('contains all 3 placeholders', () => {
    expect(JUDGE_PROMPT_TEMPLATE).toContain('{{RUBRIC}}')
    expect(JUDGE_PROMPT_TEMPLATE).toContain('{{KEYWORDS}}')
    expect(JUDGE_PROMPT_TEMPLATE).toContain('{{ANSWER}}')
  })
  it('SCORE regex extracts an integer 1-5 from sample output', () => {
    const sample =
      'Step 1: keywords self-attention, transformer present.\n' +
      'Step 2: The answer cites the abstract correctly and explains attention.\n' +
      'SCORE: 4'
    const m = sample.match(/SCORE:\s*([1-5])/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(4)
  })
})

// ───────────────── judgeFinalAnswer ─────────────────

describe('judgeFinalAnswer', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = global.fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('happy path: parses SCORE: 4 and returns reasoning', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  'Step 1: all keywords present.\n' +
                  'Step 2: cites abstract; satisfies rubric.\n' +
                  'SCORE: 4',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const verdict = await judgeFinalAnswer({
      answer: 'self-attention is a mechanism that lets each position attend to all positions',
      rubric: '5: defines self-attention precisely. 1: hallucinates.',
      keywords: ['self-attention', 'transformer'],
      openaiKey: 'test-key',
    })
    expect(verdict.score).toBe(4)
    expect(verdict.reasoning).toContain('all keywords present')
  })

  it('bad output: throws judge-bad-output when no SCORE line present', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'no score here, just rambling' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    await expect(
      judgeFinalAnswer({
        answer: 'a',
        rubric: 'r',
        keywords: ['k'],
        openaiKey: 'test-key',
      }),
    ).rejects.toThrow(/judge-bad-output/)
  })
})

// ───────────────── withRetry (C-3 — runner.ts) ─────────────────

describe('withRetry (C-3)', () => {
  it('first attempt succeeds → no retry', async () => {
    const fn = vi.fn(async () => 'ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('2nd attempt succeeds (after 1 transient failure)', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n++
      if (n === 1) throw new Error('boom')
      return 'ok'
    })
    const result = await withRetry(fn, { baseBackoffMs: 1, maxAttempts: 3 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('all 3 attempts fail → original error rethrown', async () => {
    const fn = vi.fn(async () => {
      throw new Error('persistent')
    })
    await expect(withRetry(fn, { baseBackoffMs: 1, maxAttempts: 3 })).rejects.toThrow('persistent')
    expect(fn).toHaveBeenCalledTimes(3)
  })
  it('rate-limited error path uses longer backoff', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n++
      if (n === 1) throw new Error('rate-limited')
      return 'ok'
    })
    const before = Date.now()
    const result = await withRetry(fn, {
      baseBackoffMs: 1,
      rateLimitBackoffMs: 50,
      maxAttempts: 3,
      isRateLimited: (e) => e instanceof Error && /rate-limited/.test(e.message),
    })
    const elapsed = Date.now() - before
    expect(result).toBe('ok')
    // Rate-limit path took ≥45ms (rateLimitBackoffMs=50, allow tolerance);
    // base path would have taken ~1ms.
    expect(elapsed).toBeGreaterThanOrEqual(45)
  })
})

// ───────────────── isMainModule (C-4 — runner.ts) ─────────────────

describe('isMainModule (C-4)', () => {
  it('returns false for a file URL that does not match argv[1]', () => {
    // process.argv[1] in vitest context is the test runner, NOT runner.ts;
    // a fabricated import.meta.url for a nonexistent runner.ts must return false.
    expect(isMainModule('file:///nonexistent/runner.ts')).toBe(false)
  })
  it('does not throw on malformed metaUrl', () => {
    expect(() => isMainModule('not-a-valid-url')).not.toThrow()
  })
})
