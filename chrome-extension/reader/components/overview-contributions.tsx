import { useMemo } from 'react';
import { MarkdownBody, buildCitationMap } from './markdown';
import { extractCitations, paragraphIndexFromLoc } from '../lib/ai';
import type { Paper } from '../types';
import type { OverviewState } from '../lib/overview';
import { t } from '../lib/i18n';

interface Props { state: OverviewState; model: string; paper: Paper; onRetry?: () => void; }
export function OverviewContributions({ state, model, paper, onRetry }: Props) {
  const showRegenerate = onRetry && (state.kind === 'ready' || state.kind === 'streaming');
  const body = state.kind === 'streaming' ? state.partial : state.kind === 'ready' ? state.body : '';
  // Build citationMap once per (body, paper) so [pN] / [abs] tokens become
  // clickable sups (jumpToCitation) instead of inert chip-styled spans.
  // Streaming partials are safe — extractCitations ignores incomplete tokens.
  const citationMap = useMemo(
    () => buildCitationMap(extractCitations(body, paper), paragraphIndexFromLoc),
    [body, paper],
  );
  return (
    <section>
      <Header model={model} onRegenerate={showRegenerate ? onRetry : undefined} regenerating={state.kind === 'streaming'} />
      {state.kind === 'idle' && <Skeleton lines={3} />}
      {state.kind === 'unconfigured' && <UnconfiguredHint />}
      {state.kind === 'streaming' && (
        <div className="ink-streaming">
          <MarkdownBody body={state.partial} citationMap={citationMap} />
        </div>
      )}
      {state.kind === 'ready' && (
        <MarkdownBody body={state.body} citationMap={citationMap} />
      )}
      {state.kind === 'error' && (
        <div role="alert" style={{ background: 'var(--foxglove-soft)', color: 'var(--foxglove)', padding: 8, borderRadius: 4 }}>
          {t('error.aiFailed') || 'Generation failed'}
          {onRetry && <button onClick={onRetry} style={{ marginLeft: 8 }}>{t('action.retry') || 'Retry'}</button>}
        </div>
      )}
    </section>
  );
}
function Header({ model, onRegenerate, regenerating }: { model: string; onRegenerate?: () => void; regenerating?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
      <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 500 }}>
        {t('overview.contributions.title') || '核心贡献'}
      </h3>
      <span style={{ fontSize: 11, color: 'var(--ink-faded)' }}>AI · {model}</span>
      <span style={{ flex: 1 }} />
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          title={t('action.regenerate') || '重新生成'}
          style={{
            fontFamily: 'var(--font-sans)', fontSize: 11,
            padding: '2px 6px', borderRadius: 4,
            border: '0.5px solid var(--rule-soft)',
            background: 'transparent',
            color: regenerating ? 'var(--ink-ghost)' : 'var(--ink-faded)',
            cursor: regenerating ? 'default' : 'pointer',
            opacity: regenerating ? 0.6 : 1,
          }}
        >↻</button>
      )}
    </div>
  );
}
function UnconfiguredHint() {
  const openOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      void chrome.runtime.openOptionsPage();
    }
  };
  return (
    <div style={{ fontSize: 13, color: 'var(--ink-faded)', lineHeight: 1.5 }}>
      {t('overview.unconfigured.title') || 'Configure AI to enable summary'}
      {' '}
      <button
        onClick={openOptions}
        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--sky)', cursor: 'pointer', textDecoration: 'underline' }}
      >
        {t('overview.unconfigured.cta') || 'Open Options'}
      </button>
    </div>
  );
}
function Skeleton({ lines }: { lines: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ height: 14, background: 'var(--rule-soft)', borderRadius: 2, width: `${60 + Math.random() * 30}%`, opacity: 0.6, animation: 'pulse 1.6s infinite' }} />
      ))}
    </div>
  );
}
