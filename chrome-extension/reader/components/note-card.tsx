import { useMemo, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import type { Note, Paper } from '../types';
import { MarkdownBody, buildCitationMap } from './markdown';
import { extractCitations, paragraphIndexFromLoc } from '../lib/ai';
import { I } from './icons';
import { t } from '../lib/i18n';

const KIND_COLOR: Record<Note['kind'], string> = {
  explain:   'var(--walnut)',
  highlight: 'var(--walnut-soft)',
  note:      'var(--forest)',
  translate: 'var(--sky)',
};

interface Props {
  note: Note;
  paper: Paper;
  locale: string;
  model: string;
  isStreaming?: boolean;
  hasError?: boolean;
  onJumpSource?: () => void;
  onJumpChat?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  flash?: boolean;
}

export function NoteCard({ note, paper, isStreaming, hasError, onJumpSource, onJumpChat, onDelete, onRetry, flash }: Props) {
  const body = note.kind === 'note' ? note.userText : note.aiAnswer;
  // Only AI-generated bodies (explain / translate / aiAnswer) carry [pN] tokens;
  // user-authored notes don't, so skip the map there to avoid pointless work.
  const isAiBody = note.kind !== 'note';
  const citationMap = useMemo(
    () => isAiBody && body
      ? buildCitationMap(extractCitations(body, paper), paragraphIndexFromLoc)
      : undefined,
    [isAiBody, body, paper],
  );
  const showBody = note.kind !== 'highlight' && (!!body || isStreaming || hasError);
  const page = note.loc?.page;
  const showJumpChat = onJumpChat && !!note.chatSessionId;
  const accent = KIND_COLOR[note.kind];
  const kindLabel = t(`note.kinds.${note.kind}`) || note.kind;

  const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();
  const handleKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onJumpSource?.();
    }
  };

  return (
    <article
      tabIndex={onJumpSource ? 0 : undefined}
      aria-label={`${note.kind} note`}
      title={onJumpSource ? 'Click to jump to source' : undefined}
      onClick={onJumpSource}
      onKeyDown={onJumpSource ? handleKey : undefined}
      style={{ ...cardStyle, cursor: onJumpSource ? 'pointer' : undefined, animation: flash ? 'flash-walnut 600ms' : undefined }}
    >
      <header style={headerStyle}>
        <span style={chipStyle(accent)}>{kindLabel}</span>
        {page != null && <span style={pageStyle}>· p.{page}</span>}
        <span style={{ flex: 1 }} />
        {onDelete && (
          <button
            onClick={(e) => { stop(e); onDelete(); }}
            onKeyDown={stop}
            className="icon-btn"
            aria-label="Delete"
            style={iconBtn}
          >
            <I.Close size={12} />
          </button>
        )}
      </header>

      <blockquote style={quoteStyle}>"{note.quote}"</blockquote>

      {showBody && (
        <div style={bodyWrapStyle} onClick={stop}>
          {hasError ? (
            <div role="alert" style={errorStyle}>
              {t('error.aiFailed') || 'AI reply failed'}{' '}
              <button onClick={(e) => { stop(e); onRetry?.(); }}>{t('action.retry') || 'Retry'}</button>
            </div>
          ) : (
            <div className={isStreaming ? 'ink-streaming' : ''}>
              <MarkdownBody body={body!} citationMap={citationMap} />
            </div>
          )}
        </div>
      )}

      {showJumpChat && (
        <button
          onClick={(e) => { stop(e); onJumpChat!(); }}
          onKeyDown={stop}
          style={chatLinkStyle}
        >
          → {t('action.viewSession') || 'View session'}
        </button>
      )}
    </article>
  );
}

const cardStyle: CSSProperties = {
  background: 'var(--paper)',
  border: '0.5px solid var(--rule-soft)',
  borderRadius: 6,
  padding: '10px 12px',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const chipStyle = (accent: string): CSSProperties => ({
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 999,
  background: `color-mix(in oklch, ${accent} 18%, transparent)`,
  color: 'var(--ink)',
  letterSpacing: '0.02em',
});

const pageStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-faded)',
  letterSpacing: '0.02em',
};

const quoteStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif)',
  fontSize: 14,
  lineHeight: 1.5,
  color: 'var(--ink)',
  display: '-webkit-box',
  WebkitLineClamp: 4,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const bodyWrapStyle: CSSProperties = {
  borderTop: '0.5px solid var(--rule-soft)',
  paddingTop: 6,
  fontFamily: 'var(--font-serif)',
  fontSize: 14,
  color: 'var(--ink)',
  cursor: 'auto',
};

const errorStyle: CSSProperties = {
  background: 'var(--foxglove-soft)',
  color: 'var(--foxglove)',
  padding: 8,
  borderRadius: 4,
};

const iconBtn: CSSProperties = {
  width: 22, height: 22, padding: 5,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0,
};

const chatLinkStyle: CSSProperties = {
  alignSelf: 'flex-start',
  fontSize: 11,
  fontFamily: 'var(--font-sans)',
  color: 'var(--ink-faded)',
  background: 'transparent',
  border: 'none',
  padding: '2px 0',
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};
