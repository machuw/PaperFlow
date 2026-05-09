// chrome-extension/reader/components/trace-stack.tsx
//
// Phase 11 Plan 07: reasoning trace cards per UI-SPEC §1-§16.
// Inline styles for visuals; scoped CSS file (../styles/trace-card.css) for
// a11y utilities, reduce-motion, and JSON-pre wrapping.
//
// Two exports: <TraceStack /> (default) + <TraceCard /> (named, for
// unit testing / storybook if added later).
//
// Contract: zero new tokens.css edits; zero new icons.tsx edits.

import { I } from './icons'
import type { TraceEntry } from '../lib/use-agent-run'
import '../styles/trace-card.css'

/* ────────────── Tool → visual mapping (UI-SPEC §6) ────────────── */

type IconName = 'Search' | 'Link' | 'Highlight' | 'Book' | 'Edit' | 'Sparkle'

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function fmtNum(n: number): string {
  if (n > 999) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const TOOL_VISUAL: Record<string, {
  icon: IconName
  summary: (e: TraceEntry) => string
}> = {
  searchArxiv: {
    icon: 'Search',
    summary: (e) => {
      const q = (e.input as { query?: string } | undefined)?.query ?? ''
      if (e.state === 'done') {
        const items = (e.output as { data?: { items?: string } } | undefined)?.data?.items
        // arXiv returns XML; we surface <entry> count as a rough hit count.
        const hits = typeof items === 'string'
          ? (items.match(/<entry>/g)?.length ?? 0)
          : 0
        return `arXiv「${truncate(q, 32)}」→ ${fmtNum(hits)} 条结果` // I18N(P13)
      }
      return `搜索 arXiv：「${truncate(q, 32)}」` // I18N(P13)
    },
  },
  fetchSemanticScholar: {
    icon: 'Link',
    summary: (e) => {
      const id = (e.input as { paperId?: string } | undefined)?.paperId ?? ''
      if (e.state === 'done') {
        const o = (e.output as { data?: { title?: string; citationCount?: number } } | undefined)?.data
        const title = truncate(o?.title ?? id, 60)
        return `S2 ${truncate(id, 32)} → ${title}（${fmtNum(o?.citationCount ?? 0)} 引用）` // I18N(P13)
      }
      return `查 Semantic Scholar：${truncate(id, 32)}` // I18N(P13)
    },
  },
  screenshotParagraph: {
    icon: 'Highlight',
    summary: (e) => {
      const pid = (e.input as { paragraphId?: string } | undefined)?.paragraphId ?? ''
      if (e.state === 'done') return `截图段落 ${truncate(pid, 24)} ✓` // I18N(P13)
      return `截图段落 ${truncate(pid, 24)}` // I18N(P13)
    },
  },
  readPaperSection: {
    icon: 'Book',
    summary: (e) => {
      const pid = (e.input as { paragraphId?: string } | undefined)?.paragraphId ?? ''
      if (e.state === 'done') {
        const text = (e.output as { data?: { text?: string } } | undefined)?.data?.text ?? ''
        return `读 ${truncate(pid, 18)}：「${truncate(text, 30)}」` // I18N(P13)
      }
      return `读取段落 ${truncate(pid, 24)}` // I18N(P13)
    },
  },
  writeCanvas: {
    icon: 'Edit',
    summary: (e) => {
      const i = e.input as { nodeType?: string; nodeTitle?: string } | undefined
      const type = i?.nodeType ?? ''
      const title = i?.nodeTitle ?? ''
      if (e.state === 'done') return `+ canvas ${type}「${truncate(title, 32)}」` // I18N(P13)
      return `写入 canvas：${type}` // I18N(P13)
    },
  },
}

const FALLBACK = {
  icon: 'Sparkle' as IconName,
  summary: (e: TraceEntry) =>
    `调用 ${e.toolName}：${truncate(JSON.stringify(e.input ?? {}), 40)}`, // I18N(P13)
}

/* ────────────── State → color mapping (UI-SPEC §4) ────────────── */

function stateColor(entry: TraceEntry): string {
  if (entry.state === 'pending') return 'var(--ink-ghost)'
  if (entry.state === 'running') return 'var(--walnut)'
  if (entry.state === 'done') return 'var(--forest)'
  // error: amber for transient, foxglove for logical
  return entry.errorKind === 'transient' ? 'var(--amber)' : 'var(--foxglove)'
}

function stateBackground(entry: TraceEntry): string {
  if (entry.state === 'error' && entry.errorKind === 'transient') return 'var(--amber-soft)'
  if (entry.state === 'error' && entry.errorKind === 'logical') return 'var(--foxglove-soft)'
  return 'var(--paper-soft)'
}

/* ────────────── Spinner (pulse-ink reuse, UI-SPEC §7) ────────────── */

function Spinner({ color }: { color: string }) {
  return (
    <>
      <span
        className="pf-trace-spinner"
        aria-hidden="true"
        style={{
          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
          background: color,
          animation: 'pulse-ink 1.1s ease-in-out infinite',
        }}
      />
      <span className="pf-trace-spinner-fallback" aria-hidden="true">…</span>
    </>
  )
}

/* ────────────── TraceCard (named export) ────────────── */

export interface TraceCardProps {
  entry: TraceEntry
  expanded: boolean
  outputExpanded: boolean
  onToggle: () => void
  onToggleOutput: () => void
}

export function TraceCard({ entry, expanded, outputExpanded, onToggle, onToggleOutput }: TraceCardProps) {
  const visual = TOOL_VISUAL[entry.toolName] ?? FALLBACK
  const color = stateColor(entry)
  const bg = stateBackground(entry)
  const Ico = I[visual.icon as keyof typeof I]
  const summary = visual.summary(entry)

  return (
    <div className="pf-trace-card" style={{ animation: 'fade-up 140ms ease-out' }}>
      <button
        type="button"
        className="pf-trace-card-button"
        aria-expanded={expanded}
        aria-busy={entry.state === 'running' ? true : undefined}
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px',
          background: bg,
          border: '0.5px solid var(--rule-soft)',
          borderLeft: `2px solid ${color}`,
          borderRadius: 6,
        }}
      >
        <Ico size={14} style={{ color, flexShrink: 0 }} />
        <span style={{
          flex: 1, minWidth: 0, textAlign: 'left',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--t-sm)',
          fontWeight: 500, lineHeight: 1.4, color: 'var(--ink)',
        }}>{summary}</span>
        {entry.state === 'running' && <Spinner color={color} />}
        <span className="pf-sr-only">
          {entry.state === 'running' && `正在调用 ${entry.toolName}` /* I18N(P13) */}
          {entry.state === 'done' && '完成' /* I18N(P13) */}
          {entry.state === 'error' && entry.errorKind === 'transient' && `暂时失败 — ${entry.errorReason ?? ''}` /* I18N(P13) */}
          {entry.state === 'error' && entry.errorKind === 'logical' && `${entry.toolName} 报告：${entry.errorReason ?? ''}` /* I18N(P13) */}
        </span>
        <I.ChevronDown
          size={11}
          style={{
            color: 'var(--ink-ghost)',
            transform: expanded ? 'rotate(180deg)' : undefined,
            transition: 'transform 150ms ease-out',
            flexShrink: 0,
          }}
        />
      </button>

      {expanded && (
        <div
          role={entry.state === 'error' ? 'alert' : undefined}
          style={{
            background: bg,
            border: '0.5px solid var(--rule-soft)',
            borderTop: 'none',
            borderRadius: '0 0 6px 6px',
            padding: '8px 10px',
          }}
        >
          {/* Error reason text (UI-SPEC §5.2 error states) */}
          {entry.state === 'error' && entry.errorReason && (
            <div style={{
              fontFamily: 'var(--font-serif)', fontStyle: 'italic',
              fontSize: 'var(--t-sm)', lineHeight: 1.5,
              color: 'var(--ink-soft)', paddingBottom: 4,
            }}>
              {entry.errorReason}
            </div>
          )}
          {entry.state === 'error' && entry.errorKind === 'logical' && (
            <div style={{
              fontFamily: 'var(--font-serif)', fontStyle: 'italic',
              fontSize: 'var(--t-xs)', lineHeight: 1.4,
              color: 'var(--ink-faded)', paddingBottom: 6,
            }}>
              （模型已收到错误信息，将自我纠错）{/* I18N(P13) */}
            </div>
          )}

          {/* INPUT label + JSON */}
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xxs)',
            fontWeight: 600, letterSpacing: '0.08em',
            color: 'var(--ink-faded)', marginBottom: 4,
          }}>INPUT</div>
          <pre className="pf-trace-json-pre">{JSON.stringify(entry.input ?? null, null, 2)}</pre>

          {/* OUTPUT label + Show more button + JSON */}
          {entry.output !== undefined && (
            <>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                marginBottom: 4,
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xxs)',
                  fontWeight: 600, letterSpacing: '0.08em',
                  color: 'var(--ink-faded)',
                }}>OUTPUT</div>
                <button
                  type="button"
                  onClick={(ev) => { ev.stopPropagation(); onToggleOutput() }}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    fontFamily: 'var(--font-sans)', fontSize: 'var(--t-xs)',
                    fontWeight: 500, color: 'var(--walnut)',
                    textDecoration: 'underline', textUnderlineOffset: '2px',
                    cursor: 'pointer',
                  }}
                >
                  {outputExpanded ? '收起' : '展开全部'}{/* I18N(P13) */}
                </button>
              </div>
              {/* W-04 / UI-SPEC §6: inline 80px thumbnail for screenshotParagraph */}
              {entry.toolName === 'screenshotParagraph' && (entry.output as { data?: { dataUrl?: string } } | undefined)?.data?.dataUrl && (
                <img
                  src={(entry.output as { data: { dataUrl: string } }).data.dataUrl}
                  alt="paragraph screenshot"
                  style={{ maxHeight: 80, marginBottom: 8, display: 'block', borderRadius: 4 }}
                />
              )}
              <pre
                className={`pf-trace-json-pre ${outputExpanded ? 'pf-trace-output-expanded' : 'pf-trace-output-truncated'}`}
              >{JSON.stringify(entry.output ?? null, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ────────────── TraceStack (default export) ────────────── */

export interface TraceStackProps {
  events: TraceEntry[]
  expanded?: Set<string>
  outputExpanded?: Set<string>
  onToggle?: (toolCallId: string, expanded: boolean) => void
  onShowMore?: (toolCallId: string) => void
  ariaLabel?: string
}

export default function TraceStack({
  events, expanded, outputExpanded, onToggle, onShowMore,
  ariaLabel = '推理过程', // I18N(P13)
}: TraceStackProps) {
  if (!events || events.length === 0) return null
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        marginBottom: 8,
      }}
    >
      {events.map((entry) => {
        const isExpanded = expanded?.has(entry.toolCallId) ?? false
        const isOutputExpanded = outputExpanded?.has(entry.toolCallId) ?? false
        return (
          <TraceCard
            key={entry.toolCallId}
            entry={entry}
            expanded={isExpanded}
            outputExpanded={isOutputExpanded}
            onToggle={() => onToggle?.(entry.toolCallId, !isExpanded)}
            onToggleOutput={() => onShowMore?.(entry.toolCallId)}
          />
        )
      })}
    </div>
  )
}
