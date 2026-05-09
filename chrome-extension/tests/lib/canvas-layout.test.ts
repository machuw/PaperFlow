import { describe, it, expect } from 'vitest';
import { applyDagreLayout } from '../../reader/lib/canvas-layout';
import type { CanvasNode, CanvasEdge } from '../../reader/types';

describe('applyDagreLayout', () => {
  it('assigns a position to every input node', () => {
    const nodes: CanvasNode[] = [
      { id: 'paper', kind: 'paper', data: {} },
      { id: 'section:o0', kind: 'section', data: {} },
      { id: 'note:n0', kind: 'note', data: {} },
    ];
    const edges: CanvasEdge[] = [
      { id: 'e1', source: 'section:o0', target: 'paper' },
      { id: 'e2', source: 'note:n0', target: 'section:o0' },
    ];
    const out = applyDagreLayout(nodes, edges);
    expect(out).toHaveLength(3);
    for (const n of out) {
      expect(n.position).toBeDefined();
      expect(typeof n.position!.x).toBe('number');
      expect(typeof n.position!.y).toBe('number');
    }
  });

  it('produces distinct x coordinates for nodes at different depths (LR layout)', () => {
    const nodes: CanvasNode[] = [
      { id: 'paper', kind: 'paper', data: {} },
      { id: 'section:o0', kind: 'section', data: {} },
      { id: 'note:n0', kind: 'note', data: {} },
    ];
    const edges: CanvasEdge[] = [
      { id: 'e1', source: 'section:o0', target: 'paper' },
      { id: 'e2', source: 'note:n0', target: 'section:o0' },
    ];
    const out = applyDagreLayout(nodes, edges);
    const paper = out.find((n) => n.id === 'paper')!;
    const section = out.find((n) => n.id === 'section:o0')!;
    const note = out.find((n) => n.id === 'note:n0')!;
    expect(note.position!.x).toBeLessThan(section.position!.x);
    expect(section.position!.x).toBeLessThan(paper.position!.x);
  });

  it('handles an orphan node (no edges) by giving it a valid position', () => {
    const nodes: CanvasNode[] = [
      { id: 'paper', kind: 'paper', data: {} },
      { id: 'chat', kind: 'chat', data: {} },
    ];
    const out = applyDagreLayout(nodes, []);
    const chat = out.find((n) => n.id === 'chat')!;
    expect(chat.position).toBeDefined();
    expect(Number.isFinite(chat.position!.x)).toBe(true);
    expect(Number.isFinite(chat.position!.y)).toBe(true);
  });

  it('returns a new array; does not mutate input', () => {
    const nodes: CanvasNode[] = [{ id: 'paper', kind: 'paper', data: {} }];
    const out = applyDagreLayout(nodes, []);
    expect(out).not.toBe(nodes);
    expect(nodes[0].position).toBeUndefined();
  });
});
