import dagre from 'dagre';
import type { CanvasNode, CanvasEdge } from '../types';

/**
 * Per-kind width/height hints — used by both dagre layout (in this file)
 * and react-flow Node sizing (in canvas-view.tsx). Keep them in sync here.
 */
export const CANVAS_NODE_SIZE: Record<string, { width: number; height: number }> = {
  paper:   { width: 360, height: 420 },
  section: { width: 220, height: 60 },
  note:    { width: 280, height: 150 },
  linked:  { width: 260, height: 120 },
  chat:    { width: 320, height: 260 },
};

/**
 * Apply a dagre auto-layout to the given node/edge graph. Returns a new
 * node array with `position: { x, y }` filled. Direction is left-to-right
 * (LR) so source nodes (notes, sections) appear to the left of the paper.
 *
 * Input is not mutated.
 */
export function applyDagreLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): CanvasNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: 28,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const size = CANVAS_NODE_SIZE[n.kind] ?? { width: 200, height: 100 };
    g.setNode(n.id, size);
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const laid = g.node(n.id);
    const size = CANVAS_NODE_SIZE[n.kind] ?? { width: 200, height: 100 };
    return {
      ...n,
      position: {
        x: laid.x - size.width / 2,
        y: laid.y - size.height / 2,
      },
    };
  });
}
