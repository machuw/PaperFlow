import { type CSSProperties, type ReactNode } from 'react';
import type { ChatSession } from '../types';
import { I } from './icons';
import { MAX_ACTIVE_SESSIONS } from '../lib/chat-sessions';

interface Props {
  sessions: ChatSession[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDeleteCurrent: () => void;
  onHistory: () => void;
}

export function ChatSessionTabs(p: Props) {
  const atMax = p.sessions.length >= MAX_ACTIVE_SESSIONS;
  const noActive = p.activeId == null;
  return (
    <div role="tablist" aria-label="Chat sessions" style={containerStyle}>
      <div style={tabsScrollStyle}>
        {p.sessions.map((s) => {
          const active = s.id === p.activeId;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={active}
              onClick={() => p.onSwitch(s.id)}
              style={tabBtn(active)}
            >{s.seq}</button>
          );
        })}
      </div>
      <div style={controlsStyle}>
        <IconBtn
          label={atMax ? `最多 ${MAX_ACTIVE_SESSIONS} 个会话` : 'New chat'}
          onClick={p.onNew}
          disabled={atMax}
        ><I.Plus size={14} /></IconBtn>
        <IconBtn
          label="Delete current chat"
          onClick={p.onDeleteCurrent}
          disabled={noActive}
        ><I.Close size={14} /></IconBtn>
        <IconBtn label="History" onClick={p.onHistory}><I.Clock size={14} /></IconBtn>
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  height: 32, display: 'flex', alignItems: 'stretch',
};

const tabsScrollStyle: CSSProperties = {
  flex: 1, display: 'flex', overflowX: 'auto', scrollbarWidth: 'none',
};

const controlsStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 0, paddingRight: 4 };

const tabBtn = (active: boolean): CSSProperties => ({
  padding: '0 10px', height: 32, lineHeight: '32px',
  background: 'transparent', border: 'none',
  borderBottom: active ? '1.5px solid var(--walnut)' : '1.5px solid transparent',
  marginBottom: -0.5,
  color: active ? 'var(--ink)' : 'var(--ink-faded)',
  fontFamily: 'var(--font-sans)', fontSize: 12,
  cursor: 'pointer',
});

function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="icon-btn"
      style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1 }}
    >{children}</button>
  );
}
