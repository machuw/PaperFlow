import { CSSProperties } from 'react';
import type { Paper, OverviewMeta, Note, NoteKind } from '../types';
import type { OverviewState } from '../lib/overview';
import { OverviewView } from './overview-view';
import { NoteView } from './note-view';
import { MemoryView } from './memory-view';
import { t } from '../lib/i18n';

type Tab = 'overview' | 'note' | 'memory';

interface Props {
  paper: Paper;
  tab: Tab;
  setTab: (t: Tab) => void;
  // Overview slice
  overviewMeta: OverviewMeta | null;
  contributionsState: OverviewState;
  keywordsState: OverviewState;
  onRetryContributions: () => void;
  onRetryKeywords: () => void;
  // Note slice
  notes: Note[];
  activeSubtab: NoteKind;
  onSubtabChange: (k: NoteKind) => void;
  flashNoteId: string | null;
  onJumpSource: (n: Note) => void;
  onJumpChat: (n: Note) => void;
  onDeleteNote: (n: Note) => void;
  onRetryNote: (n: Note) => void;
  onEditNote: (n: Note) => void;
  // Memory slice
  onMemoryPatch: (patch: Partial<Paper['memory']>) => void;
  // Shared
  model: string;
  locale: string;
}

export function WorkspacePanel({
  paper, tab, setTab,
  overviewMeta, contributionsState, keywordsState, onRetryContributions, onRetryKeywords,
  notes, activeSubtab, onSubtabChange, flashNoteId, onJumpSource, onJumpChat, onDeleteNote, onRetryNote, onEditNote,
  onMemoryPatch,
  model, locale,
}: Props) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper)',
      borderLeft: '0.5px solid var(--rule)',
    }}>
      <div style={{
        display: 'flex', borderBottom: '0.5px solid var(--rule)',
        padding: '8px 12px 0', gap: 2,
      }}>
        <TabBtn id="overview" label={t('tabs.overview') || 'Overview'} active={tab} onClick={setTab} />
        <TabBtn id="note"     label={t('tabs.note')     || 'Note'}     active={tab} onClick={setTab} />
        {/* Memory tab hidden — view + handler retained (260427). */}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'overview' && (
          <OverviewView
            paper={paper}
            meta={overviewMeta}
            model={model}
            locale={locale}
            contributionsState={contributionsState}
            keywordsState={keywordsState}
            onRetryContributions={onRetryContributions}
            onRetryKeywords={onRetryKeywords}
          />
        )}
        {tab === 'note' && (
          <NoteView
            notes={notes}
            paper={paper}
            activeSubtab={activeSubtab}
            onSubtabChange={onSubtabChange}
            locale={locale}
            model={model}
            flashId={flashNoteId}
            onJumpSource={onJumpSource}
            onJumpChat={onJumpChat}
            onDelete={onDeleteNote}
            onRetry={onRetryNote}
            onEdit={onEditNote}
          />
        )}
        {tab === 'memory' && <MemoryView paper={paper} onPatch={onMemoryPatch} />}
      </div>
    </div>
  );
}

function TabBtn({
  id, label, active, onClick,
}: { id: Tab; label: string; active: Tab; onClick: (t: Tab) => void }) {
  const isActive = active === id;
  const style: CSSProperties = {
    padding: '8px 12px', fontSize: 12,
    color: isActive ? 'var(--ink)' : 'var(--ink-faded)',
    borderBottom: isActive ? '2px solid var(--walnut)' : '2px solid transparent',
    marginBottom: -0.5,
    fontWeight: isActive ? 600 : 400,
  };
  return <button onClick={() => onClick(id)} style={style}>{label}</button>;
}
