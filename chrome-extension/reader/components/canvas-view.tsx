import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls,
  type Node, type Edge,
  applyNodeChanges, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { I } from './icons';
import type { Paper, MarginResult, ChatMessage, Citation, CanvasNode, CanvasLayout } from '../types';
import { buildCanvasGraph } from '../lib/canvas-graph';
import { applyDagreLayout, CANVAS_NODE_SIZE } from '../lib/canvas-layout';
import { getCanvasLayout, setCanvasLayout } from '../lib/storage';
import { paperKey } from '../lib/ids';
import { paperCanvasAgentNodesKey } from '../lib/storage-schema';

/* ---------- Agent-injected nodes (Phase 11 Plan 05 writeCanvas) ---------- */

type AgentNodeKind = 'paper' | 'section' | 'note' | 'linked' | 'chat';
interface AgentInjectedNodeRecord {
  nodeId: string;
  nodeType: AgentNodeKind;
  nodeTitle: string;
  nodeBody?: string;
  parentNodeId?: string;
  createdAt: number;
}
interface AgentNodeFlow {
  id: string;
  type: AgentNodeKind;
  data: { title: string; body?: string };
  width?: number;
  height?: number;
}

/* ---------- Shared Head element for all node kinds ---------- */

type HeadProps = {
  icon: keyof typeof I;
  label: string;
  accent?: string;
};

function Head({ icon, label, accent }: HeadProps) {
  const Ico = I[icon];
  return (
    <div
      className="pf-canvas-node-head"
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 12px',
        borderBottom: '0.5px solid var(--rule)',
        background: 'var(--paper-soft)',
        userSelect: 'none',
        cursor: 'grab',
      }}
    >
      <Ico size={12} stroke={1.5} style={{ color: accent ?? 'var(--ink-faded)' }} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: accent ?? 'var(--ink-faded)',
        fontWeight: 600,
      }}>{label}</span>
    </div>
  );
}

const baseNodeStyle: React.CSSProperties = {
  width: '100%', height: '100%',
  background: 'var(--paper)',
  border: '0.5px solid var(--rule)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-1)',
  overflow: 'hidden',
  display: 'flex', flexDirection: 'column',
};

/* ---------- 5 node components ---------- */

export function PaperNode({ data }: { data: { title: string; authors: string[]; venue: string } }) {
  return (
    <div style={baseNodeStyle}>
      <Head icon="Book" label="Paper" />
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600,
          lineHeight: 1.3, color: 'var(--ink)',
        }}>{data.title}</div>
        <div style={{
          fontSize: 10, color: 'var(--ink-faded)',
          fontStyle: 'italic', marginTop: 6,
        }}>{data.authors.slice(0, 3).join(', ')}{data.authors.length > 3 ? ' et al.' : ''}</div>
        {data.venue && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--ink-ghost)', marginTop: 4,
          }}>{data.venue}</div>
        )}
      </div>
    </div>
  );
}

export function SectionNode({ data }: { data: { label: string; level: number; page?: number } }) {
  return (
    <div style={{
      ...baseNodeStyle,
      padding: '10px 14px', justifyContent: 'center',
    }}>
      <div style={{
        fontFamily: 'var(--font-serif)', fontSize: 13,
        fontWeight: data.level === 0 ? 600 : 400,
        color: 'var(--ink)',
      }}>{data.label}</div>
      {data.page != null && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--ink-faded)', marginTop: 2,
        }}>p. {data.page}</div>
      )}
    </div>
  );
}

const NOTE_TONE: Record<string, string> = {
  explain:   'var(--sky)',
  summarize: 'var(--walnut)',
  translate: 'var(--forest)',
  why:       'var(--walnut)',
};

export function NoteNode({ data }: { data: { kind: string; source?: string; body: string } }) {
  const accent = NOTE_TONE[data.kind] ?? 'var(--ink-faded)';
  const labelMap: Record<string, string> = {
    explain: 'Explain', summarize: 'Summarize', translate: 'Translate',
    why: 'Why this matters',
  };
  return (
    <div style={baseNodeStyle}>
      <Head icon={data.kind === 'why' ? 'Sparkle' : 'Quote'} label={labelMap[data.kind] ?? data.kind} accent={accent} />
      <div style={{
        flex: 1, overflow: 'auto', padding: '10px 14px',
        fontFamily: 'var(--font-serif)', fontSize: 12, lineHeight: 1.55,
        color: 'var(--ink)',
      }}>
        {data.source && (
          <blockquote style={{
            margin: '0 0 8px', padding: '2px 8px',
            borderLeft: '2px solid var(--walnut-soft)',
            fontStyle: 'italic', fontSize: 11, color: 'var(--ink-faded)',
          }}>"{data.source}"</blockquote>
        )}
        <div>{data.body}</div>
      </div>
    </div>
  );
}

export function LinkedNode({ data }: { data: { title: string; why: string; role: string } }) {
  return (
    <div style={baseNodeStyle}>
      <Head icon="Link" label="Linked context" />
      <div style={{ flex: 1, padding: '10px 14px' }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 12, fontWeight: 600,
          color: 'var(--ink)', marginBottom: 4,
        }}>→ {data.title}</div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--ink-faded)', marginBottom: 6,
        }}>{data.role}</div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 11,
          color: 'var(--ink-soft)', lineHeight: 1.5,
        }}>{data.why}</div>
      </div>
    </div>
  );
}

export function ChatNode({ data }: { data: { question: string; answer: string; citations: Citation[] } }) {
  const firstCite = data.citations[0];
  return (
    <div style={baseNodeStyle}>
      <Head icon="Chat" label="Chat" accent="var(--sky)" />
      <div style={{
        flex: 1, overflow: 'auto', padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{
          alignSelf: 'flex-end', maxWidth: '80%',
          padding: '6px 10px',
          background: 'var(--paper-deep)',
          borderRadius: '8px 8px 2px 8px',
          fontSize: 11,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}>{data.question}</div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 11.5,
          lineHeight: 1.55, color: 'var(--ink)',
        }}>{data.answer}</div>
        {firstCite && (
          <div style={{
            padding: '6px 8px',
            background: 'var(--paper-soft)',
            border: '0.5px solid var(--rule)',
            borderRadius: 4,
            fontSize: 10,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--walnut)', fontWeight: 600,
            }}>{firstCite.n} · {firstCite.loc}</div>
            <div style={{
              fontFamily: 'var(--font-serif)', fontStyle: 'italic',
              color: 'var(--ink-faded)',
            }}>"{firstCite.quote}"</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- nodeTypes map: wires our components to react-flow ---------- */

const nodeTypes = {
  paper: PaperNode,
  section: SectionNode,
  note: NoteNode,
  linked: LinkedNode,
  chat: ChatNode,
} as const;

/* ---------- CanvasView — top-level react-flow shell ---------- */

interface Props {
  paper: Paper;
  notes: MarginResult[];
  chat: ChatMessage[];
  threeLineSummary: string | null;
  onBack: () => void;
}

/**
 * Merge initial dagre-laid positions with any user-saved overrides.
 * Unknown saved node ids are ignored (graph shape changed since save).
 */
function applySavedLayout(
  nodes: CanvasNode[],
  saved: CanvasLayout | null,
): CanvasNode[] {
  if (!saved) return nodes;
  const byId = new Map(saved.nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    const override = byId.get(n.id);
    if (!override) return n;
    return { ...n, position: { x: override.x, y: override.y } };
  });
}

/** Convert our CanvasNode → react-flow Node. */
function toFlowNodes(nodes: CanvasNode[]): Node[] {
  return nodes.map((n) => {
    const size = CANVAS_NODE_SIZE[n.kind];
    return {
      id: n.id,
      type: n.kind,
      position: n.position ?? { x: 0, y: 0 },
      data: n.data,
      width: size?.width,
      height: size?.height,
    };
  });
}

export function CanvasView({ paper, notes, chat, threeLineSummary, onBack }: Props) {
  const pk = paperKey(paper);

  // Build graph (pure) once per (paper, notes, chat, threeLineSummary) identity.
  const { graphNodes, graphEdges } = useMemo(() => {
    const { nodes, edges } = buildCanvasGraph(paper, notes, chat, threeLineSummary);
    return { graphNodes: nodes, graphEdges: edges };
  }, [paper, notes, chat, threeLineSummary]);

  const [nodes, setNodes] = useState<Node[]>([]);
  // Phase 11 Plan 05: agent-injected nodes (via writeCanvas tool). Maintained
  // separately from dagre-laid nodes so the [pk, graphNodes, graphEdges]
  // useEffect doesn't wipe them on graph change.
  const [agentNodes, setAgentNodes] = useState<AgentNodeFlow[]>([]);
  const edges = useMemo<Edge[]>(
    () => graphEdges.map((e) => ({
      id: e.id, source: e.source, target: e.target,
    })),
    [graphEdges],
  );

  // Hydrate agentNodes from chrome.storage.local on mount and pk-change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const key = paperCanvasAgentNodesKey(pk);
        const stored = await chrome.storage.local.get([key]);
        const list = (stored?.[key] as AgentInjectedNodeRecord[] | undefined) ?? [];
        if (cancelled) return;
        setAgentNodes(list.map((n) => {
          const size = CANVAS_NODE_SIZE[n.nodeType];
          return {
            id: n.nodeId,
            type: n.nodeType,
            data: { title: n.nodeTitle, body: n.nodeBody ?? '' },
            width: size?.width,
            height: size?.height,
          };
        }));
      } catch { /* no-op */ }
    })();
    return () => { cancelled = true; };
  }, [pk]);

  // Listen for live writeCanvas dispatches (Phase 11 Plan 05 integration).
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as AgentInjectedNodeRecord;
      const size = CANVAS_NODE_SIZE[detail.nodeType];
      setAgentNodes((prev) => [
        ...prev,
        {
          id: detail.nodeId,
          type: detail.nodeType,
          data: { title: detail.nodeTitle, body: detail.nodeBody ?? '' },
          width: size?.width,
          height: size?.height,
        },
      ]);
    };
    window.addEventListener('canvas:add-node', handler);
    return () => window.removeEventListener('canvas:add-node', handler);
  }, []);

  // Hydrate positions on mount / graph change: saved layout overrides dagre.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getCanvasLayout(pk);
      if (cancelled) return;
      const laid = applyDagreLayout(graphNodes, graphEdges);
      const merged = applySavedLayout(laid, saved);
      const baseNodes = toFlowNodes(merged);
      // Append agent-injected nodes (Phase 11 writeCanvas integration). They
      // sit at {0,0} initially; user can drag, and drag-stop persists via the
      // existing onNodesChange handler.
      const combined: Node[] = [
        ...baseNodes,
        ...agentNodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: { x: 0, y: 0 },
          data: n.data,
          width: n.width,
          height: n.height,
        })),
      ];
      setNodes(combined);
    })();
    return () => { cancelled = true; };
  }, [pk, graphNodes, graphEdges, agentNodes]);

  // Persist positions after drag (100 ms debounce).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback((current: Node[]) => {
    const targetKey = pk;   // capture at invocation time
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const layout: CanvasLayout = {
        nodes: current.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
      };
      setCanvasLayout(targetKey, layout).catch(() => { /* quota handled globally */ });
    }, 100);
  }, [pk]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => {
      const next = applyNodeChanges(changes, prev);
      // Only save on drag-stop (change.type === 'position' && !dragging).
      const dragStopped = changes.some(
        (c) => c.type === 'position' && c.dragging === false,
      );
      if (dragStopped) persist(next);
      return next;
    });
  }, [persist]);

  // Cleanup pending save on unmount OR paper-key change so a late-fired
  // setCanvasLayout doesn't race a paper-swap in storage.
  useEffect(() => {
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [pk]);

  const cardCount = graphNodes.length;
  const linkCount = graphEdges.length;

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      background: 'var(--paper-deep)',
    }}>
      {/* Left toolbar: Back + counts */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        display: 'flex', gap: 6, alignItems: 'center',
        padding: '6px 10px',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 20,
        boxShadow: 'var(--shadow-1)',
      }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11, color: 'var(--ink-soft)',
        }}>
          <span style={{ fontSize: 12, lineHeight: 1 }}>←</span> Back to reader
        </button>
        <div style={{ width: 0.5, height: 12, background: 'var(--rule)' }} />
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--ink-faded)',
        }}>{cardCount} cards · {linkCount} links</div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.6}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={0.6} color="var(--ink-ghost)" />
        <Controls
          position="top-right"
          showInteractive={false}
          showFitView={false}
          style={{
            background: 'var(--paper-soft)',
            border: '0.5px solid var(--rule)',
            borderRadius: 20,
          }}
        />
      </ReactFlow>
    </div>
  );
}
