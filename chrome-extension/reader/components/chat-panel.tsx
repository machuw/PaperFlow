import { useState, useEffect, useRef } from 'react';
import type { Paper, ChatSession, ChatMessage, Note, NoteKind } from '../types';
import { ChatView } from './chat-view';
import { ChatSessionTabs } from './chat-session-tabs';
import { ChatSessionHistory } from './chat-session-history';
import * as Sessions from '../lib/chat-sessions';
import { paperKey } from '../lib/ids';

interface Props {
  paper: Paper;
  sessions: ChatSession[];
  activeId: string | null;
  messages: ChatMessage[];
  streamingId: string | null;
  actionStreamingIds?: ReadonlySet<string>;
  askPrefill: string | null;
  locale: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDeleteCurrent: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onHardDelete: (id: string) => void;
  onRestoreAndSwitch: (id: string) => void;
  onSend: (text: string, pinnedSelection: string | null) => void;
  onAbort: () => void;
  onDismissPrefill: () => void;
  onJumpNote?: (actionId: string, kind: NoteKind) => void;
  notes?: Note[];
}
export function ChatPanel(p: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<ChatSession[] | null>(null);
  const tabsAndDrawerRef = useRef<HTMLDivElement>(null);

  // Click outside closes the drawer
  useEffect(() => {
    if (!historyOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (tabsAndDrawerRef.current && !tabsAndDrawerRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [historyOpen]);

  const openHistory = async () => {
    setHistoryOpen(true);
    const pk = paperKey(p.paper);
    const all = await Sessions.listSessions(pk);
    const withContent = await Promise.all(
      all.map(async (s) => {
        const msgs = await Sessions.loadMessages(pk, s.id);
        return msgs.length > 0 ? s : null;
      }),
    );
    setHistorySessions(withContent.filter((s): s is ChatSession => s !== null));
  };

  const closeHistory = () => {
    setHistoryOpen(false);
    setHistorySessions(null);
  };

  // Tabs row + history drawer assembled here and handed to ChatView as a
  // slot. Order matters: drawer first (absolute, opens UPWARD via bottom:100%)
  // then the tabs row itself. The wrapper carries the click-outside ref.
  const tabsBar = (
    <div ref={tabsAndDrawerRef} style={{ position: 'relative' }}>
      {historyOpen && (
        <ChatSessionHistory
          sessions={historySessions ?? []} locale={p.locale}
          loading={historySessions === null}
          onPick={(id, isDeleted) => {
            if (isDeleted) {
              p.onRestoreAndSwitch(id);
            } else {
              p.onSwitch(id);
            }
            closeHistory();
          }}
          onRename={p.onRename}
          onHardDelete={p.onHardDelete}
          onClose={closeHistory} />
      )}
      <ChatSessionTabs
        sessions={p.sessions} activeId={p.activeId}
        onSwitch={p.onSwitch} onNew={p.onNew} onDeleteCurrent={p.onDeleteCurrent}
        onHistory={() => { if (historyOpen) { closeHistory(); } else { void openHistory(); } }} />
    </div>
  );

  return (
    <div role="region" aria-label="AI chat assistant"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--paper)', borderRight: '0.5px solid var(--rule)', position: 'relative' }}>
      <ChatView paper={p.paper} messages={p.messages} streamingId={p.streamingId} actionStreamingIds={p.actionStreamingIds}
        askPrefill={p.askPrefill} onSend={p.onSend} onAbort={p.onAbort}
        onDismissPrefill={p.onDismissPrefill}
        onJumpNote={p.onJumpNote} notes={p.notes}
        tabsBar={tabsBar} />
    </div>
  );
}
