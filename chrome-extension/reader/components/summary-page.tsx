import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Paper } from '../types';
import { MarkdownBody, buildCitationMap } from './markdown';
import { TypingDots } from './typing-dots';
import { callAI, ProxyError, buildVariantSummaryMessages, extractCitations, paragraphIndexFromLoc } from '../lib/ai';
import {
  getConfig,
  getVariantSummary,
  setVariantSummary,
  clearVariantSummary,
} from '../lib/storage';
import { getItem } from '../lib/storage-schema';
import { paperKey } from '../lib/ids';
import { t, useT } from '../lib/i18n';
import { surfaceCodexError } from '../lib/toast-helpers';

/**
 * Full-page article-style Markdown summary rendered in the Summary variant.
 *
 * Stream lifecycle is MODULE-level (not component-level): once a stream
 * starts, it runs to completion regardless of mount/unmount. The component
 * subscribes on mount + unsubscribes on unmount. Tab-switching away and
 * back shows the in-progress body instead of restarting.
 *
 * Uses `callAI` so BYOK and managed-AI (signed-in, no key) users both work.
 * Cache key uses `model || 'proxy'` so managed users also hit the cache on
 * revisits (see main.tsx:449/497 for the same symmetry on Abstract tab).
 */

// ─── Module-level stream registry ────────────────────────────────────────

interface StreamState {
  body: string;
  status: 'streaming' | 'ready' | 'error';
  errorMessage?: string;
  listeners: Set<(s: StreamState) => void>;
  // Bumped on regenerate. Old callbacks check this and bail if superseded
  // so the old stream's trailing cache-write doesn't clobber the new one.
  requestId: number;
}

const streams = new Map<string, StreamState>();

function streamKey(urlHash: string, model: string, lang: string | undefined): string {
  return `${urlHash}::${model}::${lang ?? ''}`;
}

function notify(state: StreamState): void {
  // Snapshot listeners in case one of them unsubscribes during iteration.
  for (const l of [...state.listeners]) l(state);
}

function startStream(
  key: string,
  paper: Paper,
  model: string,
  outputLanguage: string | undefined,
): StreamState {
  const state: StreamState = {
    body: '',
    status: 'streaming',
    listeners: new Set(),
    requestId: Date.now() + Math.random(),
  };
  streams.set(key, state);
  const myRequestId = state.requestId;

  const msgs = buildVariantSummaryMessages(paper, outputLanguage);
  const pk = paperKey(paper);

  // [diag-260427] startStream lifecycle for bug 2026-04-27 — drop after fix
  console.info(`[summary] startStream key=${key.slice(-40)} model=${model} lang=${outputLanguage ?? '(none)'}`);
  void (async () => {
    try {
      await callAI(msgs, 'summary', (chunk) => {
        const cur = streams.get(key);
        if (!cur || cur.requestId !== myRequestId) return;  // superseded
        cur.body += chunk;
        notify(cur);
      });
      const cur = streams.get(key);
      if (!cur || cur.requestId !== myRequestId) return;
      cur.status = 'ready';
      notify(cur);
      // [diag-260427]
      console.info(`[summary] stream ready bodyLen=${cur.body.length}`);
      await setVariantSummary(pk, model, cur.body, outputLanguage);
    } catch (err) {
      const cur = streams.get(key);
      if (!cur || cur.requestId !== myRequestId) return;
      // Slice 3 #12: codex-typed errors fire a toast; clear the stream so the
      // page doesn't render a redundant error banner with the raw status code.
      if (surfaceCodexError(err)) {
        streams.delete(key);
        return;
      }
      cur.status = 'error';
      if (err instanceof ProxyError) {
        if (err.code === 'QUOTA_EXCEEDED') {
          const trigger = (err.payload as { limit?: number })?.limit === 20
            ? 'trial' : 'monthly';
          window.dispatchEvent(new CustomEvent('open-upgrade-prompt', { detail: { trigger } }));
        }
        cur.errorMessage = t(`summary.error.${err.code}`) || err.code;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        cur.errorMessage = msg.slice(0, 200);
      }
      // [diag-260427]
      console.error(`[summary] stream error code=${cur.errorMessage}`, err);
      notify(cur);
    }
  })();

  return state;
}

function subscribeStream(key: string, listener: (s: StreamState) => void): () => void {
  const s = streams.get(key);
  if (s) {
    s.listeners.add(listener);
    listener(s);  // prime with current snapshot
  }
  return () => {
    const cur = streams.get(key);
    cur?.listeners.delete(listener);
  };
}

/**
 * Clear the module-level stream registry. Test-only: the `streams` Map is
 * intentionally module-scoped so streams survive component unmount — but
 * that state bleeds across vitest test cases. Call this in `beforeEach` to
 * isolate tests from one another.
 */
export function __resetSummaryStreams__(): void {
  streams.clear();
}

// ─── Component ───────────────────────────────────────────────────────────

type State =
  | { kind: 'loading' }
  | { kind: 'streaming'; body: string }
  | { kind: 'ready'; body: string }
  | { kind: 'error'; message: string };

interface Props { paper: Paper; }

export function SummaryPage({ paper }: Props) {
  useT();  // re-render on locale change so error prefix follows current language
  const [state, setState] = useState<State>({ kind: 'loading' });
  const unsubRef = useRef<(() => void) | null>(null);
  // Resolved model + language cached for the Regenerate handler. Written
  // once getConfig resolves; read-only afterwards for this component mount.
  const ctxRef = useRef<{ model: string; lang: string | undefined } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const applyStream = (s: StreamState) => {
      if (cancelled) return;
      if (s.status === 'streaming') setState({ kind: 'streaming', body: s.body });
      else if (s.status === 'ready') setState({ kind: 'ready', body: s.body });
      else setState({ kind: 'error', message: s.errorMessage ?? 'unknown' });
    };

    void (async () => {
      // getConfig() composes from split keys and returns null when a user has
      // neither apiKey nor baseURL/model prefs (managed-AI-only users). Fall
      // back to reading outputLanguage directly from its own split slot so
      // language preference still takes effect in that case.
      const cfg = await getConfig();
      const outputLanguage = cfg?.outputLanguage
        ?? (await getItem('config_outputLanguage')) ?? undefined;
      const effectiveModel = cfg?.model || 'proxy';
      const pk = paperKey(paper);
      const key = streamKey(paper.urlHash, effectiveModel, outputLanguage);

      ctxRef.current = { model: effectiveModel, lang: outputLanguage };

      // 1. In-flight stream wins over stale cache (regenerate-in-progress
      //    must not be overwritten by older cached body).
      if (streams.has(key)) {
        unsubRef.current = subscribeStream(key, applyStream);
        return;
      }

      // 2. Persistent cache next.
      const cached = await getVariantSummary(pk, effectiveModel, outputLanguage);
      if (cancelled) return;
      if (cached) { setState({ kind: 'ready', body: cached }); return; }

      // 3. Start fresh stream.
      startStream(key, paper, effectiveModel, outputLanguage);
      unsubRef.current = subscribeStream(key, applyStream);
    })();

    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [paper.urlHash]);

  async function onRegenerate() {
    if (!ctxRef.current) return;  // still loading initial config — ignore
    const { model, lang } = ctxRef.current;
    const pk = paperKey(paper);
    const key = streamKey(paper.urlHash, model, lang);
    // Drop persistent cache so a subsequent mount during the in-flight rerun
    // doesn't flash the old body.
    await clearVariantSummary(pk, model, lang);
    // startStream bumps requestId, old stream's callbacks become no-ops.
    unsubRef.current?.();
    startStream(key, paper, model, lang);
    unsubRef.current = subscribeStream(key, (s) => {
      if (s.status === 'streaming') setState({ kind: 'streaming', body: s.body });
      else if (s.status === 'ready') setState({ kind: 'ready', body: s.body });
      else setState({ kind: 'error', message: s.errorMessage ?? 'unknown' });
    });
  }

  // pf-figure://{n} resolver: pre-process the body so MarkdownBody (which
  // renders a React tree — no <img> emission) gets an inline fallback.
  // Replace the Markdown image line with an italic caption paragraph.
  // If Paper.figures ever gains a real URL, swap this for a real <img>.
  const resolveFigures = (body: string): string => {
    if (!paper.figures?.length) return body;
    return body.replace(/!\[Figure (\d+)\]\(pf-figure:\/\/(\d+)\)/g, (_m, _n, idx) => {
      const i = Number(idx) - 1;
      const fig = paper.figures?.[i];
      if (!fig) return '';
      return `\n*${fig.label}.* ${fig.caption}\n`;
    });
  };

  const canRegenerate = state.kind === 'ready' || state.kind === 'error';

  // Body is only meaningful for streaming/ready; '' for the others. Memoized
  // so [pN] / [abs] tokens render as clickable sups instead of inert chips.
  // Streaming partials are safe — extractCitations ignores incomplete tokens.
  // Hook MUST run before any early return (Rules of Hooks).
  const body =
    state.kind === 'streaming' || state.kind === 'ready'
      ? resolveFigures(state.body)
      : '';
  const citationMap = useMemo(
    () => buildCitationMap(extractCitations(body, paper), paragraphIndexFromLoc),
    [body, paper],
  );

  if (state.kind === 'loading') {
    return <div style={bodyWrapStyle}><TypingDots /></div>;
  }
  if (state.kind === 'error') {
    return (
      <div style={bodyWrapStyle}>
        <div style={{ color: 'var(--foxglove)', marginBottom: 12 }}>{t('summary.error.prefix')} {state.message}</div>
        <RegenerateButton disabled={!canRegenerate} onClick={onRegenerate} />
      </div>
    );
  }
  // streaming | ready — body already resolved above for the citation hook.
  // Empty body in streaming state = waiting for first chunk; in ready state = silent failure.
  // Without this, the card would render only a floating Regenerate button (bug 2026-04-27 symptom 1).
  const isEmpty = body.length === 0;
  return (
    <div style={bodyWrapStyle}>
      {isEmpty ? (
        state.kind === 'streaming'
          ? <TypingDots />
          : <div style={{ color: 'var(--ink-faded)' }}>Empty response. Try regenerating.</div>
      ) : (
        <MarkdownBody body={body} citationMap={citationMap} />
      )}
      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <RegenerateButton disabled={!canRegenerate} onClick={onRegenerate} />
      </div>
    </div>
  );
}

function RegenerateButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Wait for the current generation to finish' : 'Re-generate summary'}
      style={{
        padding: '6px 12px',
        background: 'transparent',
        border: '0.5px solid var(--rule)',
        borderRadius: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.05em',
        color: disabled ? 'var(--ink-faded)' : 'var(--ink-soft)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      ↻ Regenerate
    </button>
  );
}

const bodyWrapStyle: CSSProperties = {
  maxWidth: 720, margin: '0 auto', padding: '20px 24px 60px',
};
