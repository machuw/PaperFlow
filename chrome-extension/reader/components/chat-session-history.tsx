// chrome-extension/reader/components/chat-session-history.tsx
import { useState } from 'react';
import type { ChatSession } from '../types';
import { I } from './icons';
import { formatSessionHistoryRow } from '../lib/format';
import { t } from '../lib/i18n';

interface Props {
  sessions: ChatSession[];
  locale: string;
  loading?: boolean;
  onPick: (id: string, isDeleted: boolean) => void;
  onRename: (id: string, title: string) => void;
  onHardDelete: (id: string) => void;
  onClose: () => void;
}
export function ChatSessionHistory({ sessions, locale, loading, onPick, onRename, onHardDelete, onClose }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div role="dialog" aria-label={t('chat.history.title') || 'Chat history'} style={drawerStyle}
         onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div style={headerStyle}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-faded)' }}>
          {t('chat.history.title') || 'CONVERSATIONS'}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ width: 28, height: 28 }}><I.Close size={12} /></button>
      </div>
      {loading ? (
        <div style={emptyStyle}>
          <div style={{ color: 'var(--ink-faded)', fontSize: 12 }}>Loading…</div>
        </div>
      ) : sorted.length === 0 ? (
        <div style={emptyStyle}>
          <div>{t('chat.history.empty') || 'No conversations yet.'}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-faded)', marginTop: 4 }}>{t('chat.history.emptyHint') || 'Try asking about this paper.'}</div>
        </div>
      ) : (
        <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
          {sorted.map((s) => (
            <SessionRow key={s.id} s={s} locale={locale}
              editing={editing === s.id} draftTitle={draftTitle} setDraftTitle={setDraftTitle}
              onStartEdit={() => { setEditing(s.id); setDraftTitle(s.title); }}
              onCommit={() => { onRename(s.id, draftTitle); setEditing(null); }}
              onCancel={() => setEditing(null)}
              onPick={() => onPick(s.id, s.deletedAt != null)}
              onHardDelete={() => onHardDelete(s.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
function SessionRow({ s, locale, editing, draftTitle, setDraftTitle, onStartEdit, onCommit, onCancel, onPick, onHardDelete }: any) {
  const [hover, setHover] = useState(false);
  const isDeleted = s.deletedAt != null;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={rowStyle}>
      <div style={{ flex: 1, cursor: 'pointer' }} onClick={editing ? undefined : onPick}>
        {editing ? (
          <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel(); }}
            autoFocus style={{ width: '100%', font: 'inherit', border: '1px solid var(--rule)', padding: 2 }} />
        ) : (
          <>
            <div style={{ color: isDeleted ? 'var(--ink-faded)' : 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
              {s.title || `Chat #${s.seq}`}
              {isDeleted && (
                <span style={{ marginLeft: 4, fontSize: 10, padding: '1px 6px', border: '0.5px solid var(--rule-soft)', borderRadius: 3, color: 'var(--ink-faded)', flexShrink: 0 }}>
                  {t('chat.history.deleted') || '已删除'}
                </span>
              )}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)', marginTop: 2 }}>{formatSessionHistoryRow(s.updatedAt, locale)}</div>
          </>
        )}
      </div>
      {hover && !editing && (
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="icon-btn" onClick={onStartEdit} aria-label="Rename"><I.Edit size={12} /></button>
          <button className="icon-btn" onClick={onHardDelete} aria-label="Delete permanently"><I.Trash size={12} /></button>
        </div>
      )}
    </div>
  );
}
// Tabs row now sits at the bottom of the chat panel (above the composer),
// so the history drawer must open UPWARD. `bottom: '100%'` anchors the
// drawer's bottom edge at the parent's top edge — the drawer floats above
// the tabs row instead of below it.
const drawerStyle: any = { position: 'absolute', left: 0, bottom: '100%', width: '100%', background: 'var(--paper)', border: '0.5px solid var(--rule)', boxShadow: 'var(--shadow-2)', zIndex: 50, padding: 8 };
const headerStyle: any = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 4px 8px' };
const rowStyle: any = { display: 'flex', alignItems: 'flex-start', padding: '8px 6px', borderTop: '0.5px solid var(--rule-soft)' };
const emptyStyle: any = { textAlign: 'center', padding: '24px 12px', color: 'var(--ink-faded)' };
