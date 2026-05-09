import type {
  Paper, MarginResult, ChatMessage,
  CanvasNode, CanvasEdge,
} from '../types';

/**
 * Build a Canvas graph from the current Paper state + margin notes + chat history.
 *
 * Nodes emitted:
 *   - 'paper' — always; the root.
 *   - 'section:<outlineId>' — one per outline entry.
 *   - 'note:<marginResultId>' — one per margin note.
 *   - 'note:why' — from memory.whyItMatters (if non-empty after trim).
 *   - 'note:summary' — from threeLineSummary (if non-empty after trim).
 *   - 'linked:<index>' — one per memory.linked entry.
 *   - 'chat' — shows most recent user/assistant exchange (if any assistant message exists).
 *
 * Edges:
 *   - section → paper
 *   - note → section (anchored via paragraph's sectionId; falls through to paper if unknown)
 *   - linked → paper
 *   - chat → (no edge — free-floating per spec §8.3)
 */
export function buildCanvasGraph(
  paper: Paper,
  notes: MarginResult[],
  chat: ChatMessage[],
  threeLineSummary: string | null,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  nodes.push({
    id: 'paper',
    kind: 'paper',
    data: {
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue ?? '',
    },
  });

  for (const o of paper.outline) {
    const id = `section:${o.id}`;
    nodes.push({
      id,
      kind: 'section',
      data: { label: o.label, level: o.level, page: o.page },
    });
    edges.push({ id: `e:${id}->paper`, source: id, target: 'paper' });
  }

  const sectionByParagraph = new Map(paper.paragraphs.map((p) => [p.id, p.sectionId]));

  for (const note of notes) {
    const id = `note:${note.id}`;
    nodes.push({
      id,
      kind: 'note',
      data: {
        kind: note.kind,
        source: note.source,
        body: note.body,
      },
    });
    const sectionId = sectionByParagraph.get(note.paragraphId);
    const target = sectionId ? `section:${sectionId}` : 'paper';
    edges.push({ id: `e:${id}->${target}`, source: id, target });
  }

  const why = paper.memory.whyItMatters.trim();
  if (why) {
    nodes.push({
      id: 'note:why',
      kind: 'note',
      data: { kind: 'why', body: why },
    });
    edges.push({ id: 'e:note:why->paper', source: 'note:why', target: 'paper' });
  }

  const summary = threeLineSummary?.trim() ?? '';
  if (summary) {
    nodes.push({
      id: 'note:summary',
      kind: 'note',
      data: { kind: 'summarize', body: summary },
    });
    edges.push({ id: 'e:note:summary->paper', source: 'note:summary', target: 'paper' });
  }

  paper.memory.linked.forEach((l, i) => {
    const id = `linked:${i}`;
    nodes.push({
      id,
      kind: 'linked',
      data: { title: l.title, why: l.why, role: l.role },
    });
    edges.push({ id: `e:${id}->paper`, source: id, target: 'paper' });
  });

  const lastAssistant = [...chat].reverse().find(
    (m) => m.role === 'assistant' && m.text.trim().length > 0,
  );
  if (lastAssistant) {
    const assistantIdx = chat.findIndex((m) => m.id === lastAssistant.id);
    const priorUser = [...chat.slice(0, assistantIdx)].reverse().find((m) => m.role === 'user');
    nodes.push({
      id: 'chat',
      kind: 'chat',
      data: {
        question: priorUser?.text ?? '',
        answer: lastAssistant.text,
        citations: lastAssistant.citations ?? [],
      },
    });
  }

  return { nodes, edges };
}
