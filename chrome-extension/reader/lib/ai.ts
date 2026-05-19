import type { Paper, PaperMemory, AiActionKind, AiConfig, ChatMessage as StoredChatMessage, Citation, SummarySection } from '../types';
import { getLocale } from './i18n';
import { isCodexBaseURL } from './byok-presets';

/**
 * Build the "Paper" markdown block injected into every AI call (§3.7.1).
 * Paragraphs are labeled [p1]..[pN] (1-based) with their section prefix so
 * the model can emit tight citations.
 *
 * Abstract block is skipped when empty; the citation hint line is kept so
 * the model knows the [abs] token exists even if it has nothing to cite.
 */
export function buildPaperContext(paper: Paper): string {
  const parts: string[] = [];
  parts.push(`# ${paper.title}\n`);
  const byline = `By ${paper.authors.join(', ')}.${paper.venue ? ` Published in ${paper.venue}.` : ''}`;
  parts.push(byline + '\n');

  if (paper.abstract) {
    parts.push(`## Abstract\n${paper.abstract}\n`);
  }

  parts.push(
    '## Paragraphs (cite with paragraph ids like [p1]; cite the abstract as [abs]):'
  );
  paper.paragraphs.forEach((p, idx) => {
    parts.push(`[p${idx + 1}] §${p.section} · ${p.text}`);
  });

  return parts.join('\n');
}

/**
 * Emit the "Reader's memory on this paper" block (§3.7.2) if any field is
 * non-empty after whitespace-trim. `nextActions` is filtered to undone items;
 * if no field remains, returns ''.
 */
export function buildMemoryInjection(m: PaperMemory): string {
  const lines: string[] = [];
  if (m.whyItMatters && m.whyItMatters.trim()) lines.push(`- Why it matters: ${m.whyItMatters.trim()}`);
  if (m.role && m.role.trim())                 lines.push(`- Role in research: ${m.role.trim()}`);
  if (m.judgment && m.judgment.trim())         lines.push(`- Personal judgment: ${m.judgment.trim()}`);

  if (m.linked.length > 0) {
    lines.push('- Linked work:');
    for (const l of m.linked) {
      lines.push(`  - ${l.title} (${l.role}): ${l.why}`);
    }
  }

  const todo = m.nextActions.filter((a) => !a.done);
  if (todo.length > 0) {
    lines.push('- Outstanding actions:');
    for (const a of todo) lines.push(`  - [ ] ${a.text}`);
  }

  if (lines.length === 0) return '';
  return `# Reader's memory on this paper\n${lines.join('\n')}`;
}

/**
 * Output-language choices exposed in the options page. `instruction` is
 * appended to every prompt so the model responds in the user's chosen
 * language. `translateTarget` is what the `translate` selection action
 * uses as its target — `auto` keeps the legacy Chinese default.
 */
export interface OutputLanguage {
  code: string;
  label: string;
  instruction: string;
  translateTarget: string;
}

export const OUTPUT_LANGUAGES: OutputLanguage[] = [
  // D5 + D17: 'auto' resolves to the current UI locale at langCfg() call time.
  // The instruction below is a placeholder — `langCfg('auto')` always falls
  // through to the matched UI-locale entry below; this string is never actually
  // sent to the model. Kept in the array so the picker can render an entry for
  // it; the picker overrides the label dynamically (`Auto · {ui native}`).
  { code: 'auto',  label: 'Auto (match UI)',
    instruction: '— resolved at request time, see langCfg —',
    translateTarget: '中文 (Simplified Chinese)' },
  // D17: 'detect' explicitly preserves the legacy model-heuristic behavior for
  // users who want responses to match the typed-question language regardless of
  // their UI locale. Independent of getLocale().
  { code: 'detect', label: 'Detect from question',
    instruction: "Respond in the reader's language if they asked in one; otherwise default to English.",
    translateTarget: '中文 (Simplified Chinese)' },
  { code: 'en',    label: 'English',
    instruction: 'Respond in English.',
    translateTarget: 'English' },
  { code: 'zh-CN', label: '简体中文',
    instruction: 'Respond in Simplified Chinese (简体中文).',
    translateTarget: '中文 (Simplified Chinese)' },
  { code: 'zh-TW', label: '繁體中文',
    instruction: 'Respond in Traditional Chinese (繁體中文).',
    translateTarget: '繁體中文 (Traditional Chinese)' },
  { code: 'ja',    label: '日本語',
    instruction: 'Respond in Japanese (日本語).',
    translateTarget: '日本語 (Japanese)' },
  { code: 'ko',    label: '한국어',
    instruction: 'Respond in Korean (한국어).',
    translateTarget: '한국어 (Korean)' },
  { code: 'fr',    label: 'Français',
    instruction: 'Respond in French (Français).',
    translateTarget: 'Français (French)' },
  { code: 'de',    label: 'Deutsch',
    instruction: 'Respond in German (Deutsch).',
    translateTarget: 'Deutsch (German)' },
  { code: 'es',    label: 'Español',
    instruction: 'Respond in Spanish (Español).',
    translateTarget: 'Español (Spanish)' },
  { code: 'ru',    label: 'Русский',
    instruction: 'Respond in Russian (Русский).',
    translateTarget: 'Русский (Russian)' },
];

/**
 * Resolve a stored output-language code to the OutputLanguage entry whose
 * `instruction` will be appended to the system prompt.
 *
 * - 'detect' (D17) → returns the 'detect' entry, model-heuristic preserved.
 * - 'auto' / undefined (D5) → returns the current UI locale's entry. Read at
 *   call time so mid-stream `setLocale()` does not affect in-flight requests
 *   (D15) but DOES affect the next request.
 * - explicit code → matched entry, independent of UI locale.
 * - unknown code → falls back to 'en'.
 */
function langCfg(code: string | undefined): OutputLanguage {
  if (code === 'detect') {
    return OUTPUT_LANGUAGES.find((l) => l.code === 'detect')!;
  }
  if (!code || code === 'auto') {
    const ui = getLocale();
    return OUTPUT_LANGUAGES.find((l) => l.code === ui)
      ?? OUTPUT_LANGUAGES.find((l) => l.code === 'en')!;
  }
  return OUTPUT_LANGUAGES.find((l) => l.code === code)
    ?? OUTPUT_LANGUAGES.find((l) => l.code === 'en')!;
}

export function langInstruction(code: string | undefined): string {
  return langCfg(code).instruction;
}

const PROMPT_BODIES = {
  explain:   "The reader selected a passage. Explain what it's actually claiming, in 2–4 sentences, at the level of a colleague thinking out loud. Avoid restating; go to the underlying claim.",
  summarize: "Compress the selected passage to 1–2 sentences that preserve its core claim.",
} as const;

function promptFor(kind: AiActionKind, lang: string | undefined): string {
  const cfg = langCfg(lang);
  if (kind === 'translate') {
    return `Translate the selected passage to ${cfg.translateTarget}. Preserve technical terms in their original form when they're canonical (e.g. 'attention', 'residual').`;
  }
  if (kind === 'overviewContributions') {
    return "List the paper's 3 to 5 core contributions as a strict bulleted list. Each bullet ≤ 1 sentence. No prefatory text. No headings.\n" + cfg.instruction;
  }
  if (kind === 'overviewKeywords') {
    return "List up to 4 keywords that uniquely identify THIS paper — terms a reader would search to find this exact work, not generic field words. One per line, no bullets, no definitions, no quotes.\n" +
           "Reject generic terms (e.g. 'machine learning', 'deep learning', 'video understanding'). Prefer the paper's named contributions, methods, or datasets.\n" + cfg.instruction;
  }
  if (kind === 'keywordExplain') {
    return "Explain the given keyword in the context of THIS paper only. ≤2 sentences, ≤40 words. Do not repeat the keyword itself in the answer. No bullets, no headings.\n" + cfg.instruction;
  }
  return PROMPT_BODIES[kind as 'explain' | 'summarize'] + '\n' + cfg.instruction;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Assemble the message list for a given selection action (§3.7.3).
 * Shape: [system { PROMPT + paper context + memory? }, user { selected text }].
 */
export function buildMessages(
  kind: AiActionKind,
  paper: Paper,
  selectedText: string,
  outputLanguage?: string,
): ChatMessage[] {
  const paperCtx = buildPaperContext(paper);
  const mem = buildMemoryInjection(paper.memory);
  const systemParts = [promptFor(kind, outputLanguage), '', paperCtx];
  if (mem) systemParts.push('', mem);
  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: selectedText },
  ];
}

function chatBasePrompt(lang: string | undefined): string {
  // D16: chat history may contain assistant messages from a prior locale (e.g.
  // user switched UI language mid-conversation). Lock the language explicitly
  // so the model is not anchored by past-turn language. Only chat needs this —
  // buildMessages / buildSummaryMessages have no history concatenation.
  const cfg = langCfg(lang);
  return "You are a research assistant grounded in the paper below. Answer strictly from the paragraphs; cite them inline using `[pN]` where N is the paragraph index shown in the context. If the paper doesn't cover the question, say so directly.\n" +
    cfg.instruction + "\n" +
    `Past assistant turns may be in a different language; from this turn forward, respond strictly in ${cfg.translateTarget}.`;
}

/**
 * Build the message list for a Chat turn. Shape:
 *   [system { CHAT_BASE_PROMPT + paper + memory? }, ...history (role+text), user { input }]
 * History citations are UI-only and intentionally stripped.
 */
export function buildChatMessages(
  paper: Paper,
  history: StoredChatMessage[],
  userText: string,
  outputLanguage?: string,
): ChatMessage[] {
  const paperCtx = buildPaperContext(paper);
  const mem = buildMemoryInjection(paper.memory);
  const systemParts = [chatBasePrompt(outputLanguage), '', paperCtx];
  if (mem) systemParts.push('', mem);

  const out: ChatMessage[] = [
    { role: 'system', content: systemParts.join('\n') },
  ];
  for (const m of history) {
    out.push({ role: m.role, content: m.text });
  }
  out.push({ role: 'user', content: userText });
  return out;
}

export interface CallOptions {
  signal?: AbortSignal;
}

/**
 * OpenAI-compatible streaming chat completion. Yields assistant content deltas
 * as they arrive. Throws on non-2xx. Caller is responsible for aggregating
 * chunks and handling `AbortError` / other fetch failures.
 *
 * Endpoint shape follows §3.3: `{baseURL}/chat/completions` with bearer token.
 * `baseURL` is expected to already be normalized (trailing slash stripped at
 * save time in `options/main.tsx` before calling `pushByokPrefs`).
 */
export function callChatCompletion(
  cfg: AiConfig,
  messages: ChatMessage[],
  opts: CallOptions = {},
  telemetry?: ChatTelemetryHookInput,  // Quick 260506-8ov: chat-only callers pass this
): AsyncIterable<string> {
  const url = `${cfg.baseURL}/chat/completions`;
  // Quick 260506-8ov: capture t0 IMMEDIATELY before fetch so total_stream_ms
  // spans fetch + SSE; ttft_ms is set on the first non-empty delta yielded.
  const t0 = performance.now();
  let ttft_ms: number | null = null;
  let output_chars = 0;
  let status: 'ok' | 'error' | 'aborted' = 'ok';
  let errMsg: string | undefined;

  // Start the fetch eagerly so callers can attach/abort the signal before the
  // first iteration. Returning a generator from an async function would defer
  // fetch until the first `.next()`, which breaks the "abort before iterate"
  // contract used in tests and the UI.
  const resPromise = fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
    }),
    signal: opts.signal,
  });
  // Suppress unhandled-rejection noise if the caller never starts iterating;
  // the awaited reference inside the generator still surfaces the real error.
  resPromise.catch(() => {});

  async function* iterate(): AsyncGenerator<string> {
    const res = await resPromise;

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`AI request failed: ${res.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`);
    }
    if (!res.body) throw new Error('AI response body is empty');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse complete SSE events from the buffer. Each event is terminated
        // by a blank line — accept both LF-LF and CRLF-CRLF variants because
        // some proxies re-encode line endings.
        const findFrame = () => {
          const lf = buffer.indexOf('\n\n');
          const crlf = buffer.indexOf('\r\n\r\n');
          if (lf === -1) return { pos: crlf, len: 4 };
          if (crlf === -1) return { pos: lf, len: 2 };
          return crlf < lf ? { pos: crlf, len: 4 } : { pos: lf, len: 2 };
        };

        let frameInfo = findFrame();
        while (frameInfo.pos !== -1) {
          const frame = buffer.slice(0, frameInfo.pos);
          buffer = buffer.slice(frameInfo.pos + frameInfo.len);

          // Frame lines: typically a single `data: {...}` or `data: [DONE]`.
          const dataLine = frame.split(/\r?\n/).find((l) => l.startsWith('data: '));
          if (dataLine) {
            const payload = dataLine.slice(6).trim();
            if (payload === '[DONE]') return;
            try {
              const json = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                // Quick 260506-8ov: TTFT captured on FIRST non-empty delta.
                if (ttft_ms === null) ttft_ms = performance.now() - t0;
                output_chars += delta.length;
                yield delta;
              }
            } catch {
              // Malformed frame — skip silently. Streams sometimes emit partial frames
              // on reconnect; the outer loop will pick up the next complete one.
            }
          }
          frameInfo = findFrame();
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Quick 260506-8ov: when telemetry hook present, wrap iterate() so we can
  // observe stream end / abort / error and emit one record afterward. When
  // telemetry is undefined (selection actions, summary), behavior is bit-identical
  // to the prior code path — the original iterate() iterable is returned.
  if (!telemetry) return iterate();

  async function* withTelemetry(): AsyncGenerator<string> {
    try {
      for await (const c of iterate()) yield c;
    } catch (err) {
      if (err && (err as { name?: string }).name === 'AbortError') {
        status = 'aborted';
      } else {
        status = 'error';
        if (!errMsg) {
          errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 200);
        }
      }
      throw err;
    } finally {
      const stats = composeMessageStats(messages);
      const rec: ChatTelemetryRecord = {
        ts: new Date().toISOString(),
        paperId: telemetry!.paperId,
        sessionId: telemetry!.sessionId,
        query: stats.query,
        messages_count: stats.messages_count,
        system_chars: stats.system_chars,
        history_chars: stats.history_chars,
        user_chars: stats.user_chars,
        total_chars: stats.total_chars,
        est_input_tokens: stats.est_input_tokens,
        model: cfg.model,
        route: telemetry!.route,
        ttft_ms,
        total_stream_ms: performance.now() - t0,
        output_chars,
        status,
        error: errMsg,
      };
      telemetry!.onComplete?.(rec);
      void logChatTelemetry(rec);
    }
  }
  return withTelemetry();
}

/**
 * Build the location string for a paragraph citation (§3.7.4).
 * PDF mode → 'p. {page} · §{section} · ¶ p{N}'.
 * HTML mode (no page) → '§{section} · ¶ p{N}'.
 * N is 1-based (matches buildPaperContext [pN] labels).
 */
export function formatLoc(paper: Paper, n: number): string {
  const p = paper.paragraphs[n - 1];
  if (!p) return `¶ p${n}`;
  const outlineItem = paper.outline.find((o) => o.id === p.sectionId);
  const parts: string[] = [];
  if (outlineItem?.page != null) parts.push(`p. ${outlineItem.page}`);
  parts.push(`§${p.section}`);
  parts.push(`¶ p${n}`);
  return parts.join(' · ');
}

// Inverse of formatLoc: recover the 1-based paragraph index by parsing the
// '¶ pN' suffix. Abstract citations have no paragraph index (-1).
export function paragraphIndexFromLoc(c: Citation): number {
  if (c.kind === 'abstract') return -1;
  const m = c.loc.match(/¶ p(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

const TRUNC = 140;

/**
 * Scan a completed assistant message for [pN] and [abs] tokens (§3.7.4).
 * Returns Citation[] in first-appearance order, deduped by (kind, n).
 * Out-of-range paragraph indexes and [abs] with no abstract are dropped.
 */
export function extractCitations(text: string, paper: Paper): Citation[] {
  const re = /\[(p\d+|abs)\]/g;
  const seen = new Set<string>();
  const out: Citation[] = [];
  let n = 1;

  for (const match of text.matchAll(re)) {
    const tok = match[1];
    if (seen.has(tok)) continue;

    if (tok === 'abs') {
      if (!paper.abstract) continue;
      seen.add(tok);
      out.push({
        n: n++,
        kind: 'abstract',
        quote: paper.abstract.slice(0, TRUNC),
        loc: 'Abstract',
      });
      continue;
    }

    const paraN = parseInt(tok.slice(1), 10);
    const para = paper.paragraphs[paraN - 1];
    if (!para) continue; // out-of-range

    seen.add(tok);
    out.push({
      n: n++,
      kind: 'paragraph',
      quote: para.text.slice(0, TRUNC),
      loc: formatLoc(paper, paraN),
    });
  }

  return out;
}

const SUMMARY_PROMPT_BODIES: Record<SummarySection, string> = {
  threeLine:
    "You are reading a research paper. Write exactly 3 sentences — one per line, no bullets, no blank lines between them.\n" +
    "Each sentence must start with a short bold label (2–4 words) that names what the sentence is about, followed by a colon and the sentence itself.\n" +
    "Format: `**{label}**: {sentence}`\n" +
    "Cover, in order: (1) the paper's main idea, (2) its core mechanism, (3) its key limitation. Choose labels that fit THIS paper (e.g. 'Core claim', 'Benchmark design', 'Scoring mechanism', 'Hierarchical bottleneck') — don't use the generic words 'Main idea / Core mechanism / Key limitation'.",
  keyTerms:
    "Extract 3–5 key terms from the paper. For each, write a one-sentence definition in the paper's own framing. Format: `{term} :: {definition}`, one per line.",
  detailed:
    "Write a structured summary of the paper for a researcher already familiar with the field. Produce exactly these 5 paragraphs, in this order, each starting with its bolded label on its own line followed by a blank line and then the paragraph body. Separate paragraphs with a blank line.\n" +
    "\n" +
    "1. **Key contributions** — 2–4 sentences naming the paper's novel contributions.\n" +
    "2. **Methodology** — 3–5 sentences on the approach: data, model, pipeline, or framework design.\n" +
    "3. **Core formulation** — 2–4 sentences on the central equation, algorithm, or scoring function. Use inline backticks for symbols (e.g. `N/4`, `L_total`), and keep math short; skip this paragraph only if the paper genuinely has no formal mechanism.\n" +
    "4. **Experimental results** — 2–4 sentences with the most informative numbers (best/worst model, headline gap, one diagnostic finding).\n" +
    "5. **Limitations** — 2–3 sentences on honest limitations the paper itself discusses (or that are obvious from its setup). Don't fabricate.\n" +
    "\n" +
    "Use plain prose inside each paragraph. Inline markdown (**bold**, *italic*, `code`) is allowed but don't over-format. Keep citation markers like [p5] inline as the paper-context injects them.",
};

export function buildSummaryMessages(
  section: SummarySection,
  paper: Paper,
  outputLanguage?: string,
): ChatMessage[] {
  const paperCtx = buildPaperContext(paper);
  const mem = buildMemoryInjection(paper.memory);
  const prompt = SUMMARY_PROMPT_BODIES[section] + '\n' + langInstruction(outputLanguage);
  const systemParts = [prompt, '', paperCtx];
  if (mem) systemParts.push('', mem);
  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: 'Produce the summary as instructed.' },
  ];
}

/**
 * Build messages for the Summary VARIANT (full-page article-style Markdown).
 * Different shape from buildSummaryMessages (which targets the 3 tab sections).
 * Target: 500–800 words. Markdown only. Reference figures as
 * `![Figure N](pf-figure://N)` drawing from the paper's own figures list —
 * the extension resolves the scheme client-side.
 */
export function buildVariantSummaryMessages(
  paper: Paper,
  outputLanguage?: string,
): ChatMessage[] {
  const paperCtx = buildPaperContext(paper);
  const mem = buildMemoryInjection(paper.memory);
  const figureHint = (paper.figures && paper.figures.length > 0)
    ? `Available figures: ${paper.figures.map((f, i) => `Figure ${i + 1} (${f.label}: ${f.caption.slice(0, 80)})`).join('; ')}. Reference at least two using Markdown image syntax: \`![Figure N](pf-figure://N)\` on its own line between paragraphs.`
    : 'No figures available; produce prose only.';
  const prompt = [
    "Write an article-style Markdown summary of the paper below for a reader who wants a full understanding without reading the original.",
    "Target length: 500–800 words.",
    "Structure: one `# Title` line (the paper's title), then 3–5 `## Section` blocks covering motivation, method, results, and limitations. Use normal paragraphs (no bullet-dumps unless the paper itself enumerates). Inline markdown (**bold**, *italic*, `code`) is allowed sparingly.",
    figureHint,
    "Keep citation markers like [p5] inline as the paper context injects them.",
    langInstruction(outputLanguage),
  ].join('\n');
  const systemParts = [prompt, '', paperCtx];
  if (mem) systemParts.push('', mem);
  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: 'Produce the Summary variant article now.' },
  ];
}

// --- D2: BYOK vs managed-AI router ---
import { supabase } from './supabase';
import { getConfig } from './storage';
import { getItem } from './storage-schema';
import {
  logChatTelemetry,
  composeMessageStats,
  type ChatTelemetryHookInput,
  type ChatTelemetryRecord,
} from './telemetry';
// Phase 23: ProxyErrorCode imported from cross-boundary SoT
// (沿用 agent-client.ts:33 idiom — 3 层 ../，无 .ts 扩展)
import type { ProxyErrorCode } from '../../../supabase/functions/_shared/types';

/**
 * Typed error thrown by `callAI` when the managed proxy returns a non-200
 * status or when BYOK is misconfigured. `code` is now a discriminated union
 * (Phase 21 — was untyped string) so `handleProxyError` switch is TS exhaustive.
 */
export class ProxyError extends Error {
  constructor(public code: ProxyErrorCode, public payload: any) {
    super(code);
  }
}

/**
 * Exhaustiveness guard for `ProxyErrorCode` switch defaults. If a new code
 * is added to the union without a corresponding case in `handleProxyError`,
 * TS reports a type error at compile time. Public so consumers (main.tsx
 * switch default) can import.
 */
export function assertNever(x: never, context = 'unhandled ProxyErrorCode'): never {
  throw new Error(`${context}: ${String(x)}`);
}

async function streamBYOK(
  messages: ChatMessage[],
  _kind: string,
  onChunk: (c: string) => void,
  opts?: { signal?: AbortSignal; telemetry?: ChatTelemetryHookInput },
) {
  // Wrap the existing AsyncIterable callChatCompletion into a callback API.
  // Phase 13: read via getConfig() which prefers the active multi-config row
  // (Phase 12+13 顶栏 chip / Options 写新 keys) and falls back to v1.1 split.
  const cfg = await getConfig();
  if (!cfg || !cfg.apiKey || !cfg.baseURL || !cfg.model) {
    throw new ProxyError('byok-misconfigured', {});
  }
  // [diag-260427]
  let chunkCount = 0;
  try {
    // Quick 260506-8ov: forward telemetry hook so callChatCompletion emits
    // one record at end-of-stream / abort / error.
    for await (const chunk of callChatCompletion(cfg, messages, { signal: opts?.signal }, opts?.telemetry)) {
      onChunk(chunk);
      chunkCount++;
    }
    console.info(`[ai] byok done kind=${_kind} chunks=${chunkCount}`);
  } catch (err) {
    console.warn(`[ai] byok error kind=${_kind} chunks=${chunkCount}`, err);
    throw err;
  }
}

function anyAbortSignal(signals: AbortSignal[]): AbortSignal {
  if ('any' in AbortSignal && typeof (AbortSignal as any).any === 'function') {
    return (AbortSignal as any).any(signals);
  }
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) { ctrl.abort(); return ctrl.signal; }
    s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

async function streamThroughProxy(
  messages: ChatMessage[],
  kind: string,
  onChunk: (c: string) => void,
  opts?: { signal?: AbortSignal; model?: string; telemetry?: ChatTelemetryHookInput },  // Phase 15 D-E3: optional model id; Quick 260506-8ov: optional telemetry
) {
  // Quick 260506-8ov: trackers for the inline SSE parser below. Mirror the
  // shape used in callChatCompletion (the parser is intentionally duplicated
  // here per spec — do NOT refactor into shared helper).
  const t0 = performance.now();
  let ttft_ms: number | null = null;
  let output_chars = 0;
  let status: 'ok' | 'error' | 'aborted' = 'ok';
  let errMsg: string | undefined;

  const emitTelemetry = () => {
    if (!opts?.telemetry) return;
    const stats = composeMessageStats(messages);
    const rec: ChatTelemetryRecord = {
      ts: new Date().toISOString(),
      paperId: opts.telemetry.paperId,
      sessionId: opts.telemetry.sessionId,
      query: stats.query,
      messages_count: stats.messages_count,
      system_chars: stats.system_chars,
      history_chars: stats.history_chars,
      user_chars: stats.user_chars,
      total_chars: stats.total_chars,
      est_input_tokens: stats.est_input_tokens,
      model: opts?.model ?? '(managed-default)',
      route: opts.telemetry.route,
      ttft_ms,
      total_stream_ms: performance.now() - t0,
      output_chars,
      status,
      error: errMsg,
    };
    opts.telemetry.onComplete?.(rec);
    void logChatTelemetry(rec);
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      // [diag-260427] make this state explicit so user knows to re-sign-in
      console.warn(`[ai] proxy: no session — user must sign in (kind=${kind})`);
      throw new ProxyError('UNAUTHENTICATED', {});
    }
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-proxy`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      // Phase 15 D-E3: include `model` only when a managed selection is active.
      // Backward-compatible — fallback path (no managed selection) omits the
      // field entirely so the server uses its default OPENAI_MODEL env.
      body: JSON.stringify({
        kind,
        messages,
        stream: true,
        ...(opts?.model ? { model: opts.model } : {}),
      }),
      signal: opts?.signal,
    });
    // [diag-260427] proxy response status — pivotal for bug 2026-04-27 repro
    console.info(`[ai] proxy resp kind=${kind} status=${resp.status}`);
    switch (resp.status) {
      case 200: {
        // /ai-proxy pipes OpenAI's response body through unchanged — same OpenAI
        // SSE format (`data: {...}\n\n`, terminated by `data: [DONE]`). Parse
        // frames and emit only `choices[0].delta.content` deltas to onChunk.
        // Mirrors the parser in callChatCompletion above; kept inline to avoid
        // refactoring that function's AsyncIterable contract.
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // [diag-260427] count emitted deltas — empty-stream ready is the bug 1 hypothesis
        let chunkCount = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const findFrame = () => {
              const lf = buffer.indexOf('\n\n');
              const crlf = buffer.indexOf('\r\n\r\n');
              if (lf === -1) return { pos: crlf, len: 4 };
              if (crlf === -1) return { pos: lf, len: 2 };
              return crlf < lf ? { pos: crlf, len: 4 } : { pos: lf, len: 2 };
            };
            let frameInfo = findFrame();
            while (frameInfo.pos !== -1) {
              const frame = buffer.slice(0, frameInfo.pos);
              buffer = buffer.slice(frameInfo.pos + frameInfo.len);
              const dataLine = frame.split(/\r?\n/).find((l) => l.startsWith('data: '));
              if (dataLine) {
                const payload = dataLine.slice(6).trim();
                if (payload === '[DONE]') {
                  // [diag-260427]
                  console.info(`[ai] proxy DONE kind=${kind} chunks=${chunkCount}`);
                  return;
                }
                try {
                  const json = JSON.parse(payload) as {
                    choices?: Array<{ delta?: { content?: string } }>;
                  };
                  const delta = json.choices?.[0]?.delta?.content;
                  if (delta) {
                    // Quick 260506-8ov: TTFT on first non-empty delta + accumulate output_chars.
                    if (ttft_ms === null) ttft_ms = performance.now() - t0;
                    output_chars += delta.length;
                    onChunk(delta);
                    chunkCount++;
                  }
                } catch { /* malformed frame — skip silently */ }
              }
              frameInfo = findFrame();
            }
          }
          // [diag-260427] stream ended without [DONE] — proxy disconnect or empty body
          console.info(`[ai] proxy stream-end kind=${kind} chunks=${chunkCount} (no DONE)`);
        } finally {
          reader.releaseLock();
        }
        return;
      }
      case 402: throw new ProxyError('QUOTA_EXCEEDED', await resp.json());
      case 403: throw new ProxyError('TIER_NO_MANAGED_AI', await resp.json());
      case 429: throw new ProxyError('RATE_LIMITED', {});
      case 401:
        // 401 used to auto-clearStaleSession() here, which destructively signed
        // the user out and cascaded the failure to every subsequent AI call
        // (chat/explain/translate/keyword). Now we just throw UNAUTHENTICATED
        // for THIS call; the user explicitly re-signs-in if their session is
        // truly stale. See bug 2026-04-27.
        console.warn(`[ai] proxy 401 kind=${kind} (no auto-signout)`);
        throw new ProxyError('UNAUTHENTICATED', {});
      case 500: throw new ProxyError('SERVER_ERROR', {});
      default:  throw new ProxyError('UNKNOWN', {});
    }
  } catch (err) {
    // Quick 260506-8ov: classify error for telemetry status. ProxyError carries
    // its `code` as the message slice; AbortError → aborted; other → error.
    if (err && (err as { name?: string }).name === 'AbortError') {
      status = 'aborted';
    } else {
      status = 'error';
      if (err instanceof ProxyError) {
        errMsg = err.code;
      } else if (err instanceof Error) {
        errMsg = err.message.slice(0, 200);
      } else {
        errMsg = String(err).slice(0, 200);
      }
    }
    throw err;
  } finally {
    emitTelemetry();
  }
}

/**
 * Route an AI request through BYOK (if the user has set `config_apikey`) or
 * the managed Supabase proxy (for signed-in no-key users). Callers aggregate
 * chunks via `onChunk`. Throws ProxyError on proxy-path failures; BYOK errors
 * bubble up from `callChatCompletion` as plain Errors (existing contract).
 *
 * `opts.signal` is propagated to the underlying fetch so callers can cancel
 * mid-stream via AbortController (§17.A.3).
 */
// Inactivity timeout: if no chunk arrives for this many ms, abort and throw
// ProxyError TIMEOUT code. Resets on every chunk so long generations are fine
// as long as the stream is making progress. Matches user expectation: a
// stalled/hung request surfaces visibly within this window instead of
// looking dead. 30s accommodates time-to-first-chunk for managed Claude
// Opus through newapi → Anthropic when the prompt embeds full paper
// context (5–15s TTFT typical, up to 20s worst case).
const INACTIVITY_TIMEOUT_MS = 30_000;

export async function callAI(
  messages: ChatMessage[],
  kind: string,
  onChunk: (c: string) => void,
  opts?: {
    signal?: AbortSignal;
    // Quick 260506-8ov: per-chat-request telemetry hook. Caller-supplied
    // paperId/sessionId; route is filled in below based on which branch fires.
    // ONLY consumed when kind === 'chat' — selection actions / summary /
    // overview ignore this field, preserving the chat-only invariant by
    // construction at the router layer.
    telemetry?: { paperId: string | null; sessionId: string | null };
  },
): Promise<void> {
  // Phase 15 D-E2: 3-priority routing.
  //   (1) managed: config_active_managed_model_id non-empty → streamThroughProxy(model)
  //   (2) BYOK:    cfg.apiKey present → streamBYOK
  //   (3) fallback proxy: no managed + no BYOK → streamThroughProxy() (no model field)
  // Architecturally separate per D-A2: BYOK is local-only credentials; managed
  // is server-billed. The model id MUST come from getItem (not inlined) so
  // tier downgrades or migration writes take effect on the next callAI.
  const managedId = (await getItem('config_active_managed_model_id')) ?? '';
  const cfg = await getConfig();
  // Slice 2 #9: detect the openai-codex BYOK preset by its sentinel baseURL.
  // Routed BEFORE the apiKey check because the codex preset has no
  // user-supplied apiKey (credentials are OAuth-managed by codex-auth).
  const isCodex = isCodexBaseURL(cfg?.baseURL);
  const route = managedId ? 'managed' : isCodex ? 'codex' : (cfg?.apiKey ? 'byok' : 'proxy');
  console.info(`[ai] callAI kind=${kind} route=${route}`);

  // Quick 260506-8ov: build telemetry hook only for chat turns. Proxy fallback
  // (no managed + no BYOK) routes through the managed proxy → route='managed'.
  const telemetryHook: ChatTelemetryHookInput | undefined =
    kind === 'chat' && opts?.telemetry
      ? {
          paperId: opts.telemetry.paperId,
          sessionId: opts.telemetry.sessionId,
          route: managedId ? 'managed' : (cfg?.apiKey ? 'byok' : 'managed'),
        }
      : undefined;

  const timeoutCtrl = new AbortController();
  let timedOut = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const resetWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      timedOut = true;
      console.warn(`[ai] inactivity timeout (${INACTIVITY_TIMEOUT_MS}ms) kind=${kind}`);
      timeoutCtrl.abort();
    }, INACTIVITY_TIMEOUT_MS);
  };
  resetWatchdog();
  const wrappedOnChunk = (c: string) => { resetWatchdog(); onChunk(c); };
  const combinedSignal = opts?.signal
    ? anyAbortSignal([opts.signal, timeoutCtrl.signal])
    : timeoutCtrl.signal;

  try {
    if (managedId) {
      // Priority 1 — managed: pass model id to ai-proxy. Server validates
      // against MANAGED_MODELS whitelist + tier; 403 surfaces as ProxyError
      // TIER_NO_MANAGED_AI with the tier-locked reason in payload preserved.
      return await streamThroughProxy(messages, kind, wrappedOnChunk, {
        signal: combinedSignal,
        model: managedId,
        telemetry: telemetryHook,
      });
    }
    if (isCodex) {
      // Slice 2 #9 — Codex preset: route through codex-stream (sentinel
      // baseURL='chatgpt://codex'). Auth tokens come from codex-auth, NOT
      // from cfg.apiKey. Skipped above the apiKey check so an empty apiKey
      // does not fall through to the managed-proxy fallback.
      const { streamCodexResponses } = await import('./codex-stream');
      // #22 / ADR-0002: pass cfg.model through so the user-picked Codex
      // model id reaches OpenAI; streamCodexResponses falls back to
      // CODEX_DEFAULT_MODEL when cfg.model is missing.
      return await streamCodexResponses(messages, combinedSignal, wrappedOnChunk, cfg?.model);
    }
    if (cfg?.apiKey) {
      // Priority 2 — BYOK: local-only credentials. T-15-03-T8: managed branch
      // never reaches here, so apiKey never flows into a model-bearing proxy
      // call. Verified by negative grep on cfg.apiKey within the managedId block.
      return await streamBYOK(messages, kind, wrappedOnChunk, {
        signal: combinedSignal,
        telemetry: telemetryHook,
      });
    }
    // Priority 3 — fallback proxy without model field (v1.1 behavior).
    return await streamThroughProxy(messages, kind, wrappedOnChunk, {
      signal: combinedSignal,
      telemetry: telemetryHook,
    });
  } catch (err) {
    if (timedOut) throw new ProxyError('TIMEOUT', {});
    throw err;
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
}

/**
 * rAF-batched streaming-chunk appender (spec §17.C.4).
 * Each call returns a fresh closure with isolated state — no module-level
 * accumulator. Batches incoming chunks into a single `setText` call per
 * animation frame, capping rerenders at ~60/sec regardless of chunk rate.
 *
 * Usage:
 *   const { append, flush } = rafBatchedAppender(setText);
 *   for await (const chunk of stream) append(chunk);
 *   flush(); // drain any final pending chunk synchronously
 */
export function rafBatchedAppender(
  setText: (full: string) => void,
): { append: (chunk: string) => void; flush: () => void } {
  let pending = '';
  let scheduled = false;
  let acc = '';
  function flush() {
    scheduled = false;
    if (!pending) return;
    acc += pending; pending = '';
    setText(acc);
  }
  return {
    append(chunk: string) {
      pending += chunk;
      if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
    },
    flush() { flush(); },
  };
}
