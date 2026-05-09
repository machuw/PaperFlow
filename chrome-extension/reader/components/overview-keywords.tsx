import { useState } from 'react';
import type { OverviewState } from '../lib/overview';
import type { Paper } from '../types';
import { t } from '../lib/i18n';
import { callAI, buildMessages, rafBatchedAppender } from '../lib/ai';
import { getKeywordExplain, setKeywordExplain } from '../lib/storage';
import { paperKey } from '../lib/ids';

const MAX_KEYWORDS = 4;

type ExplainState =
  | { kind: 'idle' }
  | { kind: 'streaming'; partial: string }
  | { kind: 'ready'; body: string }
  | { kind: 'error'; message: string };

interface Props {
  state: OverviewState;
  model: string;
  paper: Paper;
  locale: string;
  onRetry?: () => void;
}

export function OverviewKeywords({ state, model, paper, locale, onRetry }: Props) {
  const list = (state.kind === 'ready' ? parseKeywords(state.body)
              : state.kind === 'streaming' ? parseKeywords(state.partial) : [])
              .slice(0, MAX_KEYWORDS);

  const [selected, setSelected] = useState<string | null>(null);
  const [explainMap, setExplainMap] = useState<Record<string, ExplainState>>({});
  const explainState = selected ? (explainMap[selected] ?? { kind: 'idle' }) : null;

  async function ensureExplain(kw: string): Promise<void> {
    const cached = await getKeywordExplain(paperKey(paper), kw, model, locale);
    if (cached) {
      setExplainMap((m) => ({ ...m, [kw]: { kind: 'ready', body: cached } }));
      return;
    }
    setExplainMap((m) => ({ ...m, [kw]: { kind: 'streaming', partial: '' } }));
    const messages = buildMessages('keywordExplain', paper, kw, locale);
    const batch = rafBatchedAppender((acc) => {
      setExplainMap((m) => ({ ...m, [kw]: { kind: 'streaming', partial: acc } }));
    });
    let final = '';
    try {
      await callAI(messages, 'keywordExplain', (chunk) => { batch.append(chunk); final += chunk; });
      batch.flush();
      setExplainMap((m) => ({ ...m, [kw]: { kind: 'ready', body: final } }));
      await setKeywordExplain(paperKey(paper), kw, model, locale, final);
    } catch (e: any) {
      setExplainMap((m) => ({ ...m, [kw]: { kind: 'error', message: e?.message ?? 'failed' } }));
    }
  }

  function onClickChip(kw: string) {
    if (selected === kw) { setSelected(null); return; }
    setSelected(kw);
    if (!explainMap[kw] || explainMap[kw].kind === 'error') void ensureExplain(kw);
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 500 }}>
          {t('overview.keywords.title') || '关键词'}
        </h3>
        <span style={{ fontSize: 11, color: 'var(--ink-faded)' }}>AI · {model}</span>
        <span style={{ flex: 1 }} />
        {onRetry && (state.kind === 'ready' || state.kind === 'streaming') && (
          <button
            onClick={() => { setSelected(null); setExplainMap({}); onRetry(); }}
            disabled={state.kind === 'streaming'}
            title={t('action.regenerate') || '重新生成'}
            style={{
              fontFamily: 'var(--font-sans)', fontSize: 11,
              padding: '2px 6px', borderRadius: 4,
              border: '0.5px solid var(--rule-soft)',
              background: 'transparent',
              color: state.kind === 'streaming' ? 'var(--ink-ghost)' : 'var(--ink-faded)',
              cursor: state.kind === 'streaming' ? 'default' : 'pointer',
              opacity: state.kind === 'streaming' ? 0.6 : 1,
            }}
          >↻</button>
        )}
      </div>
      {state.kind === 'idle' && <ChipSkeleton n={MAX_KEYWORDS} />}
      {state.kind === 'unconfigured' && <UnconfiguredHint />}
      {(state.kind === 'streaming' || state.kind === 'ready') && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {list.map((kw) => {
              const isActive = selected === kw;
              return (
                <button
                  key={kw}
                  onClick={() => onClickChip(kw)}
                  aria-pressed={isActive}
                  style={{
                    padding: '4px 10px', fontSize: 12,
                    fontFamily: 'var(--font-serif)',
                    border: isActive ? '0.5px solid var(--ink)' : '0.5px solid var(--rule-soft)',
                    borderRadius: 0,
                    color: isActive ? 'var(--ink)' : 'var(--ink-faded)',
                    background: isActive ? 'var(--paper-soft)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >{kw}</button>
              );
            })}
          </div>
          {selected && explainState && (
            <ExplainRow kw={selected} state={explainState} onRetry={() => void ensureExplain(selected)} />
          )}
        </>
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

function ExplainRow({ state, onRetry }: { kw: string; state: ExplainState; onRetry: () => void }) {
  const text = state.kind === 'ready' ? state.body
             : state.kind === 'streaming' ? state.partial
             : '';
  const showDots = (state.kind === 'idle') || (state.kind === 'streaming' && !text);
  return (
    <div style={{
      marginTop: 8, padding: '6px 10px',
      borderLeft: '2px solid var(--rule-soft)',
      fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.5,
      color: 'var(--ink)',
    }}>
      {showDots && <span style={{ color: 'var(--ink-faded)' }}>···</span>}
      {!showDots && state.kind !== 'error' && text}
      {state.kind === 'error' && (
        <span style={{ color: 'var(--foxglove)' }}>
          {t('error.aiFailed') || 'Failed'}{' '}
          <button onClick={onRetry}>{t('action.retry') || 'Retry'}</button>
        </span>
      )}
    </div>
  );
}

function parseKeywords(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
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
function ChipSkeleton({ n }: { n: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ width: 60 + Math.random() * 50, height: 22, background: 'var(--rule-soft)', borderRadius: 0 }} />
      ))}
    </div>
  );
}
