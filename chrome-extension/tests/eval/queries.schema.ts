// chrome-extension/tests/eval/queries.schema.ts
//
// Plan 14-02: Single-source-of-truth TypeScript contract for the v1.2 agent
// eval set. queries.json conforms to GoldQuery[]; the runner (Plan 14-03)
// and reporter (Plan 14-04) both import these types so any drift between
// the JSON dataset and downstream consumers fails the build.
//
// Cross-AI Review iter 2 (C-5): the previous draft typed
// `argsContains: Record<string, string>` — that shape allowed weak gold
// values like `{ paragraphId: "sec" }` which the agent could trivially
// satisfy by passing literally any string starting with "sec". This file
// introduces the `ArgMatch` discriminated union: ID-shaped fields
// (paragraphId / paperId) take `kind: 'exact'`; free-text fields
// (searchArxiv.query / writeCanvas.nodeTitle) take `kind: 'substring'`.

/** Three eval scenarios per D-A2 + ROADMAP SC #1. */
export type Scenario = 'find-evidence' | 'paint-canvas' | 'organize-library'

/** Difficulty bucket per <specifics> 难度梯度 — drives metric spread. */
export type Difficulty = 'easy' | 'mid' | 'hard'

/** The 5 v1.2 tools. Frozen — must match the 5 tool files in supabase/functions/agent-run/tools/. */
export type ToolName =
  | 'searchArxiv'
  | 'fetchSemanticScholar'
  | 'screenshotParagraph'
  | 'readPaperSection'
  | 'writeCanvas'

/**
 * C-5 (cross-AI review iter 2) — ArgMatch discriminated union.
 *
 * Distinguishes two scoring policies:
 *
 * - kind: 'exact' — string equality (case-sensitive). Used for ID-shaped values
 *   that have a single correct form: paragraphId (e.g. "sec1-p3"), paperId
 *   (e.g. "p-attention-2017"), arxivId (e.g. "1706.03762"). Agent passing
 *   garbage like "anything" against `paragraphId: {kind:'exact', value:'sec1-p3'}`
 *   is a clear miss; substring would have falsely passed because "anything"
 *   trivially contains "" if the gold were the loose `{paragraphId: 'sec'}`.
 *
 * - kind: 'substring' — case-insensitive substring match. Used for keyword/
 *   query/title fragments where multiple plausible values exist (e.g.
 *   searchArxiv.query="BERT" matching the actual call's query="BERT
 *   pre-training language" is correct).
 *
 * The runner's argsContainsScore (Plan 14-03 metric.ts) branches on .kind to
 * apply the correct comparison.
 */
export type ArgMatch =
  | { kind: 'exact'; value: string }
  | { kind: 'substring'; value: string }

/** D-A3 detailed gold-answer schema. */
export type GoldQuery = {
  /** Stable internal id, format: "q-<NN>-<short-slug>" e.g. "q-01-attention-citations" */
  queryId: string

  /** paperId from papers.json (referential — runner verifies the link exists) */
  paperId: string

  /** Scenario bucket (D-A2 quota: 7/7/6 across these three) */
  scenario: Scenario

  /** Difficulty (drives GPT-4o-mini vs Sonnet 4.5 spread per ROADMAP SC #3) */
  difficulty: Difficulty

  /**
   * The user-facing query text — what the agent sees in messages[].content.
   * Should reference the paper context implicitly (e.g. "this paper" / "the open paper")
   * so the agent must use readPaperSection or other tools to ground.
   */
  query: string

  /**
   * Set of tools the agent SHOULD invoke at least once (order-agnostic — Jaccard
   * scoring per D-B3). Subset of ToolName, may include 1-5 entries.
   */
  expectedTools: ToolName[]

  /**
   * Per-tool argument expectations. Each entry asserts that AT LEAST ONE call
   * to `tool` had argument values matching argsContains under the per-arg
   * ArgMatch policy (D-B3 + C-5 review iter 2).
   *
   * argsContains shape: object whose keys are arg names per the tool's zod schema.
   * Values are ArgMatch records selecting the comparison policy:
   *
   *   {paragraphId: {kind: 'exact', value: 'sec1-p3'}}      // single correct ID
   *   {paperId:     {kind: 'exact', value: 'p-attention-2017'}}
   *   {query:       {kind: 'substring', value: 'BERT'}}     // keyword fragment
   *
   * Per-tool defaults (C-5 — see <arg_match_policy> block in 14-02-PLAN.md):
   *   searchArxiv.query                 → substring
   *   searchArxiv.maxResults            → exact
   *   fetchSemanticScholar.paperId      → exact (must equal an arxivId or known paperId)
   *   screenshotParagraph.paragraphId   → exact (must equal a real paragraphId from the paper)
   *   readPaperSection.paragraphId      → exact (same)
   *   writeCanvas.nodeType              → exact (enum)
   *   writeCanvas.nodeTitle             → substring (free-text)
   *   writeCanvas.nodeBody              → substring
   *   writeCanvas.parentNodeId          → exact (when present)
   *
   * Empty {} = "tool was called, no specific arg constraint" (avoid; prefer at
   * least one ArgMatch entry per tool per D-A3 detail-level mandate).
   */
  expectedToolArgs: Array<{
    tool: ToolName
    argsContains: Record<string, ArgMatch>
  }>

  /**
   * 1-5 score rubric description (free text, ≥40 chars). Injected into
   * GPT-4o-as-judge prompt (Plan 14-03 judge.ts). Must specify what makes 5 vs 3 vs 1.
   */
  finalAnswerRubric: string

  /**
   * Substrings the final answer SHOULD contain (case-insensitive). Acts as
   * a fallback metric if LLM-as-judge is unavailable (D-A3). 3-7 keywords.
   */
  finalAnswerKeywords: string[]
}

/** queries.json is GoldQuery[]; exactly 20 entries. */
export type QueriesJson = GoldQuery[]
