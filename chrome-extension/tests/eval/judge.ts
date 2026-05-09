// chrome-extension/tests/eval/judge.ts
//
// Phase 14 EVAL-02 #3 — LLM-as-judge for the `final answer` metric.
// Uses GPT-4o (NOT mini per D-B3) for stable single-line scoring.
//
// judgeFinalAnswer({answer, rubric, keywords, openaiKey}) →
//   POSTs JUDGE_PROMPT_TEMPLATE (with placeholders interpolated) to
//   https://api.openai.com/v1/chat/completions, parses "SCORE: <1-5>"
//   from the assistant content, returns {score, reasoning}.
//
// Throws `judge-bad-output` if the response lacks a parseable SCORE line.

export const JUDGE_PROMPT_TEMPLATE = `You are evaluating an AI agent's final answer to a research-paper user query.

GRADING RUBRIC (assign a single integer score 1-5):
{{RUBRIC}}

REQUIRED KEYWORDS (final answer should contain at least 2 of these substrings, case-insensitive — full credit only if it contains all of them in a coherent context):
{{KEYWORDS}}

THE AGENT'S FINAL ANSWER:
"""
{{ANSWER}}
"""

Step 1: List which required keywords appear and which are missing (1 sentence).
Step 2: Reason about how well the answer satisfies the rubric (2-3 sentences).
Step 3: Output a single line in the exact format: "SCORE: <integer 1-5>"

Begin your response with Step 1.`

export type JudgeVerdict = { score: 1 | 2 | 3 | 4 | 5; reasoning: string }

/**
 * POST to OpenAI Chat Completions with model=gpt-4o (D-B3) and parse the
 * SCORE line from the response. Mocked fetch in unit tests; live in runner.
 */
export async function judgeFinalAnswer(args: {
  answer: string
  rubric: string
  keywords: string[]
  openaiKey: string
  /**
   * Override the OpenAI base URL (default `https://api.openai.com/v1`).
   * Required when the user's PF_EVAL_OPENAI_KEY is for an OpenAI-compatible
   * proxy (e.g. newapi.magicneko.com) and `api.openai.com` would 401. The
   * runner forwards `PF_EVAL_OPENAI_BASE_URL` here.
   */
  baseURL?: string
  /**
   * Override the judge model (default `gpt-4o`). Required when the user's
   * proxy has no `gpt-4o` channel — set `PF_EVAL_JUDGE_MODEL=gpt-4o-mini`
   * (or any other supported chat model) and the runner forwards it here.
   */
  model?: string
}): Promise<JudgeVerdict> {
  const prompt = JUDGE_PROMPT_TEMPLATE.replace('{{RUBRIC}}', args.rubric)
    .replace('{{KEYWORDS}}', args.keywords.join(', '))
    .replace('{{ANSWER}}', args.answer)

  const baseURL = (args.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.openaiKey}`,
    },
    body: JSON.stringify({
      model: args.model ?? 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 600,
    }),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`judge-http-error: ${res.status} ${txt.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content ?? ''
  const m = content.match(/SCORE:\s*([1-5])/)
  if (!m) {
    throw new Error(`judge-bad-output: ${content.slice(0, 200)}`)
  }
  const score = Number(m[1]) as 1 | 2 | 3 | 4 | 5
  const reasoning = content
    .replace(/SCORE:.*$/m, '')
    .trim()
    .slice(0, 600)
  return { score, reasoning }
}
