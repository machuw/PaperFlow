import { describe, it, expect } from 'vitest';
import { buildCanvasGraph } from '../../reader/lib/canvas-graph';
import type { Paper, MarginResult, ChatMessage } from '../../reader/types';
import { emptyMemory } from '../../reader/types';

function fakePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    urlHash: 'h1',
    title: 'A Paper',
    authors: ['Alice', 'Bob'],
    abstract: 'An abstract.',
    outline: [
      { id: 'o0', label: '1 Intro', level: 0 },
      { id: 'o1', label: '2 Method', level: 0 },
    ],
    paragraphs: [
      { id: 'sec0-p0', sectionId: 'o0', section: '1 Intro', text: 'intro text' },
      { id: 'sec1-p0', sectionId: 'o1', section: '2 Method', text: 'method text' },
    ],
    memory: {
      whyItMatters: 'because',
      role: 'Central',
      judgment: '',
      linked: [{ title: 'Prior Work', why: 'earlier result', role: 'Prior' }],
      nextActions: [],
    },
    ...overrides,
  };
}

describe('buildCanvasGraph', () => {
  it('emits one paper node as the graph root', () => {
    const { nodes } = buildCanvasGraph(fakePaper(), [], [], null);
    const paperNodes = nodes.filter((n) => n.kind === 'paper');
    expect(paperNodes).toHaveLength(1);
    expect(paperNodes[0].id).toBe('paper');
    expect(paperNodes[0].data.title).toBe('A Paper');
  });

  it('emits one section node per outline entry with a section→paper edge', () => {
    const { nodes, edges } = buildCanvasGraph(fakePaper(), [], [], null);
    const secs = nodes.filter((n) => n.kind === 'section');
    expect(secs.map((n) => n.id)).toEqual(['section:o0', 'section:o1']);
    for (const sec of secs) {
      const edge = edges.find((e) => e.source === sec.id && e.target === 'paper');
      expect(edge).toBeDefined();
    }
  });

  it('emits one note node per MarginResult, edged to its paragraph section', () => {
    const note: MarginResult = {
      id: 'r-1', kind: 'explain', source: 'foo',
      body: 'explanation', paragraphId: 'sec0-p0', createdAt: 0,
    };
    const { nodes, edges } = buildCanvasGraph(fakePaper(), [note], [], null);
    const noteNode = nodes.find((n) => n.kind === 'note' && n.id === 'note:r-1');
    expect(noteNode).toBeDefined();
    expect(edges.find((e) => e.source === 'note:r-1' && e.target === 'section:o0')).toBeDefined();
  });

  it('emits a note node for memory.whyItMatters when non-empty', () => {
    const { nodes } = buildCanvasGraph(fakePaper(), [], [], null);
    const why = nodes.find((n) => n.id === 'note:why');
    expect(why).toBeDefined();
    expect(why!.data.body).toBe('because');
  });

  it('skips whyItMatters node when memory.whyItMatters is blank', () => {
    const paper = fakePaper({ memory: { ...emptyMemory(), whyItMatters: '   ' } });
    const { nodes } = buildCanvasGraph(paper, [], [], null);
    expect(nodes.find((n) => n.id === 'note:why')).toBeUndefined();
  });

  it('emits one linked node per memory.linked entry, edged to paper', () => {
    const { nodes, edges } = buildCanvasGraph(fakePaper(), [], [], null);
    const linked = nodes.filter((n) => n.kind === 'linked');
    expect(linked).toHaveLength(1);
    expect(linked[0].data.title).toBe('Prior Work');
    expect(edges.find((e) => e.source === linked[0].id && e.target === 'paper')).toBeDefined();
  });

  it('emits a chat node with the most recent assistant message when chat has content', () => {
    const chat: ChatMessage[] = [
      { id: 'u-1', role: 'user', text: 'Where does it fail?', createdAt: 0 },
      {
        id: 'a-1', role: 'assistant',
        text: 'On repetition-sensitive tasks [p5].',
        citations: [{ n: 1, kind: 'paragraph', quote: 'fails here', loc: '§2 Method · ¶ p5' }],
        createdAt: 1,
      },
    ];
    const { nodes } = buildCanvasGraph(fakePaper(), [], chat, null);
    const chatNode = nodes.find((n) => n.kind === 'chat');
    expect(chatNode).toBeDefined();
    expect(chatNode!.data.question).toBe('Where does it fail?');
    expect(chatNode!.data.answer).toBe('On repetition-sensitive tasks [p5].');
    expect((chatNode!.data.citations as unknown[]).length).toBe(1);
  });

  it('emits no chat node when chat history is empty', () => {
    const { nodes } = buildCanvasGraph(fakePaper(), [], [], null);
    expect(nodes.find((n) => n.kind === 'chat')).toBeUndefined();
  });

  it('emits a summary note when threeLineSummary is non-empty', () => {
    const { nodes, edges } = buildCanvasGraph(
      fakePaper(), [], [], 'Line 1.\nLine 2.\nLine 3.',
    );
    const summary = nodes.find((n) => n.id === 'note:summary');
    expect(summary).toBeDefined();
    expect(summary!.data.body).toBe('Line 1.\nLine 2.\nLine 3.');
    expect(summary!.data.kind).toBe('summarize');
    expect(edges.find((e) => e.source === 'note:summary' && e.target === 'paper')).toBeDefined();
  });

  it('skips summary node when threeLineSummary is null, empty, or whitespace-only', () => {
    for (const val of [null, '', '   ', '\n\n']) {
      const { nodes } = buildCanvasGraph(fakePaper(), [], [], val);
      expect(nodes.find((n) => n.id === 'note:summary')).toBeUndefined();
    }
  });
});
