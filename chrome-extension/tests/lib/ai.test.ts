import { describe, it, expect, vi } from 'vitest';
import { buildPaperContext, callChatCompletion } from '../../reader/lib/ai';
import type { Paper, AiConfig } from '../../reader/types';
import { buildMemoryInjection, buildMessages, langInstruction, OUTPUT_LANGUAGES } from '../../reader/lib/ai';
import type { PaperMemory } from '../../reader/types';
import { buildChatMessages } from '../../reader/lib/ai';
import type { ChatMessage } from '../../reader/types';

function samplePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: '2402.18413',
    urlHash: 'abc123def456',
    title: 'Contextual Residuals',
    authors: ['Khan, Y.', 'Voigt, R.'],
    abstract: 'We propose a lightweight residual memory.',
    venue: 'arXiv:2402.18413  [cs.LG]  14 Feb 2026',
    outline: [
      { id: 'o0', label: '1 Introduction', level: 0 },
      { id: 'o1', label: '2 Method', level: 0 },
    ],
    paragraphs: [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Introduction', text: 'Intro first.' },
      { id: 'sec0-p1', sectionId: 'o0', section: '1 Introduction', text: 'Intro second.' },
      { id: 'sec1-p0', sectionId: 'o1', section: '2 Method', text: 'Method goes here.' },
    ],
    memory: { whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [] },
    ...overrides,
  };
}

describe('buildPaperContext', () => {
  it('emits title, byline, venue, abstract, and paragraphs in order', () => {
    const ctx = buildPaperContext(samplePaper());
    expect(ctx).toContain('# Contextual Residuals');
    expect(ctx).toContain('By Khan, Y., Voigt, R.');
    expect(ctx).toContain('Published in arXiv:2402.18413  [cs.LG]  14 Feb 2026');
    expect(ctx).toContain('## Abstract\nWe propose a lightweight residual memory.');
    expect(ctx).toContain('[p1] §1 Introduction · Intro first.');
    expect(ctx).toContain('[p2] §1 Introduction · Intro second.');
    expect(ctx).toContain('[p3] §2 Method · Method goes here.');
  });

  it('omits "Published in" when venue is empty', () => {
    const ctx = buildPaperContext(samplePaper({ venue: undefined }));
    expect(ctx).not.toContain('Published in');
    expect(ctx).toContain('By Khan, Y., Voigt, R.');
  });

  it('omits the Abstract block when abstract is empty but keeps [abs] hint', () => {
    const ctx = buildPaperContext(samplePaper({ abstract: '' }));
    expect(ctx).not.toContain('## Abstract');
    expect(ctx).toContain('cite the abstract as [abs]');
  });

  it('numbers paragraphs starting at [p1] (1-based)', () => {
    const ctx = buildPaperContext(samplePaper());
    expect(ctx).not.toContain('[p0]');
    expect(ctx).toContain('[p1]');
    expect(ctx).toContain('[p3]');
    expect(ctx).not.toContain('[p4]');
  });
});

const emptyMem: PaperMemory = {
  whyItMatters: '', role: '', judgment: '', linked: [], nextActions: [],
};

describe('buildMemoryInjection', () => {
  it('returns empty string when all fields are empty', () => {
    expect(buildMemoryInjection(emptyMem)).toBe('');
  });

  it('includes whyItMatters when non-empty', () => {
    const out = buildMemoryInjection({ ...emptyMem, whyItMatters: 'matters to me' });
    expect(out).toContain('# Reader\'s memory on this paper');
    expect(out).toContain('- Why it matters: matters to me');
  });

  it('omits whyItMatters line when only whitespace', () => {
    const out = buildMemoryInjection({ ...emptyMem, role: 'Central', whyItMatters: '   ' });
    expect(out).not.toContain('Why it matters');
    expect(out).toContain('- Role in research: Central');
  });

  it('includes linked block only when array non-empty', () => {
    const mem: PaperMemory = {
      ...emptyMem,
      linked: [{ title: 'Landmark Attention', why: 'predecessor', role: 'Ancestor' }],
    };
    const out = buildMemoryInjection(mem);
    expect(out).toContain('- Linked work:');
    expect(out).toContain('  - Landmark Attention (Ancestor): predecessor');
  });

  it('filters done actions from nextActions', () => {
    const mem: PaperMemory = {
      ...emptyMem,
      nextActions: [
        { text: 'Re-read §4', done: false },
        { text: 'Cite in draft', done: true },
        { text: 'Run ablation', done: false },
      ],
    };
    const out = buildMemoryInjection(mem);
    expect(out).toContain('- [ ] Re-read §4');
    expect(out).toContain('- [ ] Run ablation');
    expect(out).not.toContain('Cite in draft');
  });

  it('omits Outstanding actions block when all actions are done', () => {
    const mem: PaperMemory = {
      ...emptyMem,
      nextActions: [{ text: 'done', done: true }],
    };
    expect(buildMemoryInjection(mem)).toBe('');
  });
});

describe('OUTPUT_LANGUAGES + langInstruction', () => {
  it('includes auto, detect, and explicit language codes', () => {
    const codes = OUTPUT_LANGUAGES.map((l) => l.code);
    expect(codes).toContain('auto');
    expect(codes).toContain('detect');  // D17
    expect(codes).toContain('en');
    expect(codes).toContain('zh-CN');
  });

  // D5: 'auto' / undefined → resolves to UI locale at call time. Test env has
  // navigator.language='en-US' (jsdom default), so detectInitialLocale → 'en'.
  it('resolves undefined to the current UI locale instruction (D5)', () => {
    expect(langInstruction(undefined)).toMatch(/Respond in English/);
  });

  it('resolves "auto" to the current UI locale instruction (D5)', () => {
    expect(langInstruction('auto')).toMatch(/Respond in English/);
  });

  // CRITICAL regression (IRON RULE): 'auto' must NOT fall back to the legacy
  // model-heuristic. If a future change re-introduces "Respond in the reader's
  // language…" for the 'auto' code, this test fails loudly.
  it("CRITICAL: 'auto' does NOT use the legacy model-heuristic", () => {
    expect(langInstruction('auto')).not.toMatch(/reader's language/);
    expect(langInstruction(undefined)).not.toMatch(/reader's language/);
  });

  // D17: explicit 'detect' preserves the model-heuristic for users who want the
  // old behavior. This is the only path that should produce that string.
  it("D17: 'detect' uses the model-heuristic instruction", () => {
    expect(langInstruction('detect')).toMatch(/reader's language/);
  });

  it('returns the language-specific instruction for a known code', () => {
    expect(langInstruction('zh-CN')).toMatch(/Simplified Chinese/);
    expect(langInstruction('ja')).toMatch(/Japanese/);
  });

  it('falls back to English when the code is unknown', () => {
    expect(langInstruction('klingon')).toBe(langInstruction('en'));
  });
});

describe('buildMessages', () => {
  it('produces system + user messages for Explain with paper context + selection', () => {
    const paper = samplePaper({ memory: emptyMem });
    const msgs = buildMessages('explain', paper, 'Attention is already excellent at short-range recall');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/selected .*passage/i);
    expect(msgs[0].content).toContain('# Contextual Residuals');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('Attention is already excellent');
  });

  // D5: with no explicit outputLanguage, the system prompt now uses the UI
  // locale's instruction (test env defaults to en).
  it('appends the UI-locale instruction by default for non-translate actions (D5)', () => {
    const paper = samplePaper({ memory: emptyMem });
    expect(buildMessages('explain', paper, 'x')[0].content).toMatch(/Respond in English/);
    expect(buildMessages('summarize', paper, 'x')[0].content).toMatch(/Respond in English/);
  });

  it('uses the configured output language when provided', () => {
    const paper = samplePaper({ memory: emptyMem });
    const msgs = buildMessages('explain', paper, 'x', 'ja');
    expect(msgs[0].content).toMatch(/Japanese/);
    expect(msgs[0].content).not.toMatch(/reader's language/);
  });

  // D5: 'translate' action's auto target now follows the UI locale's
  // translateTarget (en → "English"), not the old hard-coded Chinese default.
  it('translate action follows UI locale (auto) and explicit overrides (D5)', () => {
    const paper = samplePaper({ memory: emptyMem });
    // Test env UI locale is 'en' → translateTarget = "English"
    expect(buildMessages('translate', paper, 'x')[0].content).toMatch(/English/);
    expect(buildMessages('translate', paper, 'x', 'en')[0].content).toMatch(/English/);
    expect(buildMessages('translate', paper, 'x', 'ja')[0].content).toMatch(/Japanese/);
    expect(buildMessages('translate', paper, 'x', 'zh-CN')[0].content).toMatch(/中文/);
  });

  it('injects memory block into system prompt when memory non-empty', () => {
    const paper = samplePaper({
      memory: { ...emptyMem, whyItMatters: 'matters' },
    });
    const msgs = buildMessages('summarize', paper, 'x');
    expect(msgs[0].content).toContain('Why it matters: matters');
  });

  it('does not include memory block when all memory fields empty', () => {
    const paper = samplePaper({ memory: emptyMem });
    const msgs = buildMessages('translate', paper, 'x');
    expect(msgs[0].content).not.toContain('Reader\'s memory on this paper');
  });
});

const cfg: AiConfig = {
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4.1-mini',
};

function sseBody(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
}

describe('callChatCompletion', () => {
  it('yields decoded content deltas from SSE frames', async () => {
    global.fetch = vi.fn(async () =>
      new Response(sseBody([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]), { status: 200 })
    ) as any;

    const chunks: string[] = [];
    for await (const c of callChatCompletion(cfg, [{ role: 'user', content: 'hi' }])) {
      chunks.push(c);
    }
    expect(chunks.join('')).toBe('Hello world');
  });

  it('handles chunked SSE frames split across reads', async () => {
    global.fetch = vi.fn(async () =>
      new Response(sseBody([
        'data: {"choices":[{"delta":{"content":"A"',
        '}}]}\n\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\n',
        'data: [DONE]\n\n',
      ]), { status: 200 })
    ) as any;

    const chunks: string[] = [];
    for await (const c of callChatCompletion(cfg, [{ role: 'user', content: 'hi' }])) {
      chunks.push(c);
    }
    expect(chunks.join('')).toBe('AB');
  });

  it('skips data frames without delta.content', async () => {
    global.fetch = vi.fn(async () =>
      new Response(sseBody([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ]), { status: 200 })
    ) as any;

    const chunks: string[] = [];
    for await (const c of callChatCompletion(cfg, [{ role: 'user', content: 'hi' }])) {
      chunks.push(c);
    }
    expect(chunks.join('')).toBe('ok');
  });

  it('throws when HTTP status is non-2xx', async () => {
    global.fetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as any;
    const iter = callChatCompletion(cfg, [{ role: 'user', content: 'hi' }]);
    await expect(async () => { for await (const _ of iter) {} })
      .rejects.toThrow(/429/);
  });

  it('sends POST to {baseURL}/chat/completions with bearer + JSON body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(sseBody(['data: [DONE]\n\n']), { status: 200 })
    );
    global.fetch = fetchMock as any;

    const iter = callChatCompletion(cfg, [{ role: 'user', content: 'hi' }]);
    for await (const _ of iter) {}

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit & { headers: Record<string, string>; body: string }][])[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4.1-mini');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('aborts the fetch when signal fires and iteration throws', async () => {
    let abortFired = false;
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', () => { abortFired = true; });
      // Simulate a fetch that respects the abort signal.
      if (init.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      // Never-ending body wired to the signal — real fetch ties the body
      // stream to the abort signal, so reader.read() rejects on abort.
      const neverBody = new ReadableStream<Uint8Array>({
        start(controller) {
          const onAbort = () => controller.error(new DOMException('Aborted', 'AbortError'));
          if (init.signal?.aborted) { onAbort(); return; }
          init.signal?.addEventListener('abort', onAbort);
        },
      });
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        // Resolve eagerly with never-ending body if not aborted in the turn.
        resolve(new Response(neverBody, { status: 200 }));
      });
    }) as any;

    const ac = new AbortController();
    const iter = callChatCompletion(cfg, [{ role: 'user', content: 'hi' }], { signal: ac.signal });
    // Abort before anyone iterates.
    ac.abort();

    let caught: unknown = null;
    try {
      for await (const _ of iter) { /* drain */ }
    } catch (err) {
      caught = err;
    }
    expect(abortFired).toBe(true);
    expect(caught).toBeTruthy();
    expect(String(caught)).toMatch(/Abort/i);
  });

  it('tolerates \\r\\n\\r\\n frame separators', async () => {
    global.fetch = vi.fn(async () =>
      new Response(sseBody([
        'data: {"choices":[{"delta":{"content":"CR"}}]}\r\n\r\n',
        'data: {"choices":[{"delta":{"content":"LF"}}]}\r\n\r\n',
        'data: [DONE]\r\n\r\n',
      ]), { status: 200 })
    ) as any;

    const chunks: string[] = [];
    for await (const c of callChatCompletion(cfg, [{ role: 'user', content: 'hi' }])) {
      chunks.push(c);
    }
    expect(chunks.join('')).toBe('CRLF');
  });
});

describe('buildChatMessages', () => {
  it('instructs the model to cite [pN] inline and decline when out of scope', () => {
    const paper = samplePaper({ memory: emptyMem });
    const sys = buildChatMessages(paper, [], 'q')[0].content;
    expect(sys).toMatch(/\[pN\]/);
    expect(sys).toMatch(/cite/i);
    expect(sys).toMatch(/doesn't cover|paper doesn't/i);
  });

  it('appends the language instruction for the configured output language', () => {
    const paper = samplePaper({ memory: emptyMem });
    // D5: undefined / 'auto' resolves to UI locale (test env: en).
    expect(buildChatMessages(paper, [], 'q')[0].content).toMatch(/Respond in English/);
    expect(buildChatMessages(paper, [], 'q', 'zh-CN')[0].content).toMatch(/Simplified Chinese/);
  });

  // D16: chatBasePrompt locks the language explicitly so chat history in a
  // prior locale cannot anchor the model to an old response language.
  it('D16: chatBasePrompt includes the language-lock line', () => {
    const paper = samplePaper({ memory: emptyMem });
    const sys = buildChatMessages(paper, [], 'q', 'fr')[0].content;
    expect(sys).toMatch(/Respond in French/);
    expect(sys).toMatch(/Past assistant turns may be in a different language/);
    expect(sys).toMatch(/respond strictly in Français \(French\)/);
  });

  it('produces system + prior history + new user message', () => {
    const paper = samplePaper({ memory: emptyMem });
    const history: ChatMessage[] = [
      { id: 'u-1', role: 'user', text: 'q1', createdAt: 1 },
      { id: 'a-1', role: 'assistant', text: 'a1', createdAt: 2 },
    ];
    const msgs = buildChatMessages(paper, history, 'what is the core idea?');

    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/cite them inline/);
    expect(msgs[0].content).toContain('# Contextual Residuals');

    expect(msgs.slice(1, -1).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs.slice(1, -1).map((m) => m.content)).toEqual(['q1', 'a1']);

    expect(msgs[msgs.length - 1].role).toBe('user');
    expect(msgs[msgs.length - 1].content).toBe('what is the core idea?');
  });

  it('injects memory block when memory has content', () => {
    const paper = samplePaper({
      memory: { ...emptyMem, whyItMatters: 'matters' },
    });
    const msgs = buildChatMessages(paper, [], 'q');
    expect(msgs[0].content).toContain('Why it matters: matters');
  });

  it('drops citation metadata from history (only role + text sent to model)', () => {
    const paper = samplePaper({ memory: emptyMem });
    const history: ChatMessage[] = [
      {
        id: 'a-1', role: 'assistant', text: 'earlier reply',
        citations: [{ n: 1, kind: 'paragraph', quote: 'q', loc: 'l' }],
        createdAt: 1,
      },
    ];
    const msgs = buildChatMessages(paper, history, 'q');
    // The history-reconstruction step must not send citations (which are UI-only).
    // @ts-expect-error — we're asserting the shape we send is plain {role,content}
    expect(msgs[1].citations).toBeUndefined();
  });
});

import { extractCitations, formatLoc } from '../../reader/lib/ai';

describe('formatLoc', () => {
  it('emits "p. N · §section · ¶ pN" for PDF mode', () => {
    const paper = samplePaper({
      outline: [{ id: 'o0', label: '1 Intro', level: 0, page: 3 }],
      paragraphs: [
        { id: 'sec0-p0', sectionId: 'o0', section: '1 Intro', text: 'x' },
      ],
    });
    expect(formatLoc(paper, 1)).toBe('p. 3 · §1 Intro · ¶ p1');
  });

  it('omits page segment for HTML mode', () => {
    const paper = samplePaper({
      outline: [{ id: 'o0', label: '1 Intro', level: 0 }],
      paragraphs: [
        { id: 'sec0-p0', sectionId: 'o0', section: '1 Intro', text: 'x' },
      ],
    });
    expect(formatLoc(paper, 1)).toBe('§1 Intro · ¶ p1');
  });
});

describe('extractCitations', () => {
  it('extracts [pN] and [abs] tokens by first-occurrence order', () => {
    const paper = samplePaper(); // has 3 paragraphs (indexes 1..3)
    const text = 'See [p2] and also [abs]. Again [p1] first mention.';
    const cites = extractCitations(text, paper);
    expect(cites.map((c) => ({ n: c.n, kind: c.kind }))).toEqual([
      { n: 1, kind: 'paragraph' }, // [p2] first
      { n: 2, kind: 'abstract' },
      { n: 3, kind: 'paragraph' }, // [p1]
    ]);
  });

  it('dedupes repeated tokens by the first-occurrence n', () => {
    const paper = samplePaper();
    const text = 'First [p2] then [p2] again and [p1].';
    const cites = extractCitations(text, paper);
    expect(cites.map((c) => c.n)).toEqual([1, 2]);
  });

  it('populates quote truncated to 140 chars + loc from formatLoc', () => {
    const paper = samplePaper({
      abstract: 'A'.repeat(200),
      outline: [{ id: 'o0', label: '1 Intro', level: 0, page: 1 }],
      paragraphs: [
        { id: 'sec0-p0', sectionId: 'o0', section: '1 Intro', text: 'B'.repeat(200) },
      ],
    });
    const cites = extractCitations('[p1] and [abs]', paper);
    expect(cites[0]).toMatchObject({ kind: 'paragraph', quote: 'B'.repeat(140), loc: 'p. 1 · §1 Intro · ¶ p1' });
    expect(cites[1]).toMatchObject({ kind: 'abstract', loc: 'Abstract', quote: 'A'.repeat(140) });
  });

  it('ignores out-of-range [pN] (dangling citations)', () => {
    const paper = samplePaper(); // 3 paragraphs
    expect(extractCitations('See [p99].', paper)).toEqual([]);
  });

  it('ignores [abs] when paper.abstract is empty', () => {
    const paper = samplePaper({ abstract: '' });
    expect(extractCitations('[abs]', paper)).toEqual([]);
  });
});

import { buildSummaryMessages } from '../../reader/lib/ai';

describe('buildSummaryMessages', () => {
  it('produces system+user messages with the chosen section prompt + paper context', () => {
    const paper = samplePaper({ memory: emptyMem });
    const msgs = buildSummaryMessages('threeLine', paper);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/3 sentences/i);
    expect(msgs[0].content).toContain('# Contextual Residuals');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toBeTruthy();
  });

  it('appends a language instruction to every section (D5)', () => {
    const paper = samplePaper({ memory: emptyMem });
    for (const section of ['threeLine', 'keyTerms', 'detailed'] as const) {
      // D5: default is now UI locale (test env: en).
      expect(buildSummaryMessages(section, paper)[0].content).toMatch(/Respond in English/);
    }
  });

  it('respects the configured output language', () => {
    const paper = samplePaper({ memory: emptyMem });
    const msgs = buildSummaryMessages('detailed', paper, 'fr');
    expect(msgs[0].content).toMatch(/French/);
    expect(msgs[0].content).not.toMatch(/reader's language/);
  });

  it('injects memory when non-empty', () => {
    const paper = samplePaper({ memory: { ...emptyMem, judgment: 'risky' } });
    const msgs = buildSummaryMessages('detailed', paper);
    expect(msgs[0].content).toContain('Personal judgment: risky');
  });
});
