import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Paper, ChatMessage, Note, NoteKind } from '../types';
import { I } from './icons';
import { MarkdownBody, buildCitationMap } from './markdown';
import { paragraphIndexFromLoc } from '../lib/ai';
import { t, useT } from '../lib/i18n';
import { TypingDots } from './typing-dots';
import { useAgentRun } from '../lib/use-agent-run';
import TraceStack from './trace-stack';

interface Props {
  paper: Paper;
  messages: ChatMessage[];
  streamingId: string | null;
  actionStreamingIds?: ReadonlySet<string>;
  askPrefill: string | null;
  onSend: (text: string, pinnedSelection: string | null) => void;
  onAbort: () => void;
  onDismissPrefill: () => void;
  onJumpNote?: (actionId: string, kind: NoteKind) => void;
  notes?: Note[];
  /** Slot rendered between the messages scroll area and the composer.
   *  ChatPanel passes the session-tabs row + history drawer here so the
   *  tabs sit just above the input box (was previously at the panel top). */
  tabsBar?: ReactNode;
}

const SECTION_BLACKLIST = ['abstract', 'references', 'acknowledgements', 'appendix', 'bibliography'];

function firstContentSection(paper: Paper): string | null {
  for (const o of paper.outline) {
    if (o.level !== 0) continue;
    if (!o.label) continue;
    const lower = o.label.toLowerCase();
    if (SECTION_BLACKLIST.some((b) => lower.includes(b))) continue;
    return o.label;
  }
  return null;
}

function suggestionSet(paper: Paper): string[] {
  const sec = firstContentSection(paper);
  const mechanism = sec
    ? t('chat.suggest.mechanism.section', { section: sec })
    : t('chat.suggest.mechanism.generic');
  return [
    mechanism,
    t('chat.suggest.priorWork'),
    t('chat.suggest.fail'),
  ];
}

export function ChatView({ paper, messages, streamingId, actionStreamingIds, askPrefill, onSend, onAbort, onDismissPrefill, onJumpNote, notes, tabsBar }: Props) {
  // Re-render the suggestion bank + welcome line when the user changes locale
  // mid-session. useT() subscribes us to the locale store; the returned `t`
  // identity is stable, so suggestionSet's useMemo dep can stay [paper, locale].
  const locale = useT();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => suggestionSet(paper), [paper, locale]);
  const showWelcome = messages.length === 0;

  // Phase 11 SC #4: agent run hook drives reasoning trace cards.
  const agentRun = useAgentRun();
  const { tracesByMsgId, expanded, outputExpanded, toggleExpanded, toggleOutputExpanded } = agentRun;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingId]);

  const send = (textOverride?: string) => {
    const q = (textOverride ?? input).trim();
    if (!q) return;
    onSend(q, askPrefill);
    // Phase 11 SC #4 demo wiring: spin up the agent runtime alongside the
    // legacy onSend path. Trace cards render on the latest assistant message id;
    // if no assistant message yet, the next render bucket adopts the id once
    // the parent reducer assigns one.
    const lastAssistantId = [...messages].reverse().find((m) => m.id.startsWith('a-'))?.id
      ?? `a-pending-${Date.now()}`;
    void agentRun.run({
      messages: [{ role: 'user', content: q }],
      assistantMsgId: lastAssistantId,
    });
    setInput('');
  };

  return (
    // Outer column owns its own padding for messages + composer so the
    // tabsBar slot can render full-width (with its own borderTop separator)
    // without an awkward 12px inset. Composer sits at the bottom; tabsBar
    // floats above it, separating the input from the messages above.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflow: 'auto',
          padding: '12px 12px 0',
          display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        {showWelcome && (
          <WelcomeCard suggestions={suggestions} onPick={(s) => send(s)} />
        )}
        {messages.map((m) => (
          <ChatMsg
            key={m.id}
            msg={m}
            streaming={streamingId === m.id || (actionStreamingIds?.has(m.id) ?? false)}
            onJumpNote={onJumpNote}
            notes={notes}
            traces={tracesByMsgId[m.id] ?? []}
            expanded={expanded}
            outputExpanded={outputExpanded}
            onToggleExpanded={toggleExpanded}
            onToggleOutputExpanded={toggleOutputExpanded}
          />
        ))}
      </div>

      {tabsBar}

      <div style={{ padding: '8px 12px 12px' }}>
        {/* While AI is streaming, swap the composer for a single stop circle.
            Click → abort the in-flight request. Partial text already streamed
            is preserved (onChatSend's catch finalizes whatever accumulated). */}
        {streamingId === null ? (
          <Composer
            input={input}
            setInput={setInput}
            disabled={false}
            askPrefill={askPrefill}
            onDismissPrefill={onDismissPrefill}
            onSend={() => send()}
          />
        ) : (
          <StopCircle onClick={onAbort} />
        )}
      </div>
    </div>
  );
}

function WelcomeCard({ suggestions, onPick }: { suggestions: string[]; onPick: (s: string) => void }) {
  return (
    <div style={{ animation: 'fade-up 180ms' }}>
      <div style={{
        fontFamily: 'var(--font-serif)', fontSize: 13.5, lineHeight: 1.65,
        color: 'var(--ink)',
      }}>
        {t('chat.welcome.intro')}
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            style={{
              textAlign: 'left',
              padding: '6px 10px',
              background: 'var(--paper-soft)',
              border: '0.5px solid var(--rule)',
              borderRadius: 6,
              fontFamily: 'var(--font-serif)', fontSize: 12, fontStyle: 'italic',
              color: 'var(--ink-soft)',
            }}
          >→ {s}</button>
        ))}
      </div>
    </div>
  );
}

function ChatMsg({
  msg, streaming, onJumpNote, notes, traces = [],
  expanded, outputExpanded, onToggleExpanded, onToggleOutputExpanded,
}: {
  msg: ChatMessage; streaming: boolean;
  onJumpNote?: (actionId: string, kind: NoteKind) => void;
  notes?: Note[];
  traces?: import('../lib/use-agent-run').TraceEntry[];
  expanded?: Set<string>;
  outputExpanded?: Set<string>;
  onToggleExpanded?: (id: string) => void;
  onToggleOutputExpanded?: (id: string) => void;
}) {
  if (msg.kind === 'actionCard' && msg.action) {
    return <ActionCard msg={msg} onJumpNote={onJumpNote} notes={notes} />;
  }
  if (msg.role === 'user') {
    return (
      <div style={{
        alignSelf: 'flex-end', maxWidth: '85%',
        padding: '8px 12px',
        background: 'var(--paper-deep)',
        border: '0.5px solid var(--rule)',
        borderRadius: '10px 10px 2px 10px',
        fontSize: 13, lineHeight: 1.5,
        fontFamily: 'var(--font-sans)', color: 'var(--ink)',
        animation: 'fade-up 140ms',
        whiteSpace: 'pre-wrap',
      }}>{msg.text}</div>
    );
  }

  const citationMap = buildCitationMap(msg.citations, paragraphIndexFromLoc);
  // Pre-stream window: assistant message is mounted (so the user sees the
  // request was accepted) but no chunk has arrived. Show typing dots so the
  // panel doesn't look stuck while we wait for the first byte over the wire.
  const thinking = streaming && !msg.text.trim();
  return (
    <div
      className={streaming ? 'ink-streaming' : ''}
      style={{ animation: 'fade-up 180ms' }}
    >
      {/* Phase 11 SC #4: trace cards render BEFORE typing-dots / markdown body.
          Suppress TypingDots when traces are visible (UI-SPEC §9.2). */}
      {traces.length > 0 && (
        <TraceStack
          events={traces}
          expanded={expanded}
          outputExpanded={outputExpanded}
          onToggle={(id) => onToggleExpanded?.(id)}
          onShowMore={(id) => onToggleOutputExpanded?.(id)}
        />
      )}
      {thinking && traces.length === 0 ? (
        <TypingDots />
      ) : (
        <MarkdownBody body={msg.text} citationMap={citationMap} />
      )}
      {/* Citation cards intentionally removed — the inline [pN] superscripts
          rendered by MarkdownBody are now clickable and scroll the reader to
          the source paragraph (see markdown.tsx jumpToCitation). The stacked
          quote cards previously rendered here pushed real content off-screen. */}
    </div>
  );
}

function ActionCard({ msg, onJumpNote, notes }: { msg: ChatMessage; onJumpNote?: (actionId: string, kind: NoteKind) => void; notes?: Note[] }) {
  const a = msg.action!;
  const accent = a.kind === 'explain' ? 'var(--walnut)' : 'var(--sky)';
  const badgeLabel = a.kind === 'explain' ? 'EXPLAIN' : 'TRANSLATE';
  const locStr = a.loc?.page ? `· p.${a.loc.page}` : '';
  const noteExists = notes?.some((n) => n.id === a.actionId) ?? false;
  const showJump = onJumpNote != null && noteExists;
  return (
    <div style={{ borderLeft: `2px solid ${accent}`, paddingLeft: 8, animation: 'fade-up 140ms' }}>
      <div style={{ background: 'var(--paper-soft)', border: '1px solid var(--rule-soft)', borderRadius: 6, padding: '8px 10px', position: 'relative' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.03em', textTransform: 'uppercase', color: accent, fontWeight: 600, marginBottom: 4 }}>{badgeLabel} {locStr}</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 13, color: 'var(--ink-soft)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>"{a.quote}"</div>
        {showJump && (
          <button
            aria-label="Jump to note"
            onClick={() => onJumpNote(a.actionId, a.kind)}
            style={{
              display: 'flex', alignItems: 'center', gap: 2,
              marginTop: 6, marginLeft: 'auto',
              background: 'none', border: 'none', padding: 0,
              fontSize: 11, fontFamily: 'var(--font-sans)',
              color: accent, cursor: 'pointer',
              animation: 'fade-up 150ms',
            }}
          >
            <I.ArrowRight size={11} />
            <span style={{ textDecoration: 'underline' }}>Note</span>
          </button>
        )}
      </div>
    </div>
  );
}

// CitationCardView removed — clickable inline [pN] superscripts replace it.
// paragraphIndexFromLoc moved to lib/ai.ts (inverse of formatLoc).

interface ComposerProps {
  input: string;
  setInput: (v: string) => void;
  disabled: boolean;
  askPrefill: string | null;
  onDismissPrefill: () => void;
  onSend: () => void;
}

function Composer({ input, setInput, disabled, askPrefill, onDismissPrefill, onSend }: ComposerProps) {
  return (
    <div style={{
      border: '0.5px solid var(--rule)',
      borderRadius: 10,
      background: 'var(--paper-soft)',
      padding: '8px 10px 6px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {askPrefill && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6,
          padding: '6px 8px',
          background: 'var(--paper-deep)',
          border: '0.5px solid var(--walnut-soft)',
          borderRadius: 6,
          fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          fontSize: 11, color: 'var(--ink-faded)',
          lineHeight: 1.4,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontStyle: 'normal',
            fontSize: 9, letterSpacing: '0.08em',
            color: 'var(--walnut)', fontWeight: 600, flexShrink: 0, marginTop: 1,
          }}>ABOUT</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            "{askPrefill.length > 120 ? askPrefill.slice(0, 120) + '…' : askPrefill}"
          </span>
          <button
            onClick={onDismissPrefill}
            className="icon-btn"
            style={{ width: 18, height: 18, flexShrink: 0 }}
            title="Drop pinned selection"
          ><I.Close size={9} /></button>
        </div>
      )}
      <textarea
        className="pf-chat-composer"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
        }}
        placeholder={askPrefill ? t('chat.composer.placeholder.pinned') : t('chat.composer.placeholder')}
        rows={2}
        disabled={disabled}
        style={{
          width: '100%', border: 'none', outline: 'none',
          background: 'none', resize: 'none',
          fontFamily: 'var(--font-sans)', fontSize: 13,
          color: 'var(--ink)', lineHeight: 1.5,
          opacity: disabled ? 0.5 : 1,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <SendCircle
          onClick={onSend}
          disabled={disabled || (!input.trim() && !askPrefill)}
        />
      </div>
    </div>
  );
}

/**
 * Round send button — light circle with an up-arrow. Mutes (lower opacity,
 * cursor:default) when there's nothing to send so the affordance stays
 * visible without inviting a no-op click.
 */
function SendCircle({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Send"
      aria-label="Send"
      style={{
        width: 28, height: 28, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--ink)', color: 'var(--paper)',
        border: 'none', padding: 0,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'opacity 120ms, transform 120ms',
      }}
    >
      <I.ArrowUp size={14} stroke={2} />
    </button>
  );
}

/**
 * Standalone round stop button — replaces the entire composer while a chat
 * stream is in flight. Click → abort. Partial text already streamed is kept
 * (the onChatSend catch path finalizes whatever accumulated up to abort).
 */
function StopCircle({ onClick }: { onClick: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 8px' }}>
      <button
        onClick={onClick}
        title="Stop generating"
        aria-label="Stop generating"
        style={{
          width: 32, height: 32, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--ink)', color: 'var(--paper)',
          border: 'none', padding: 0,
          cursor: 'pointer',
          boxShadow: 'var(--shadow-1)',
          animation: 'fade-up 160ms',
        }}
      >
        <I.Stop size={12} />
      </button>
    </div>
  );
}
