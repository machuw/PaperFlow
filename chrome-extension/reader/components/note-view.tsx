import { useMemo } from 'react';
import type { Note, NoteKind, Paper } from '../types';
import { NoteCard } from './note-card';
import { t } from '../lib/i18n';

interface Props {
  notes: Note[];
  paper: Paper;
  activeSubtab: NoteKind;
  onSubtabChange: (k: NoteKind) => void;
  locale: string;
  model: string;
  onJumpSource: (n: Note) => void;
  onJumpChat: (n: Note) => void;
  onDelete: (n: Note) => void;
  onRetry: (n: Note) => void;
  onEdit: (n: Note) => void;
  flashId?: string | null;
}
const SUBTAB_ORDER: NoteKind[] = ['explain', 'highlight', 'note', 'translate'];

export function NoteView(p: Props) {
  const counts = useMemo(() => {
    const c: Record<NoteKind, number> = { explain: 0, highlight: 0, note: 0, translate: 0 };
    for (const n of p.notes) c[n.kind]++;
    return c;
  }, [p.notes]);
  const list = p.notes.filter((n) => n.kind === p.activeSubtab);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div role="tablist" aria-label="Note kinds"
        style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '0.5px solid var(--rule)' }}>
        {SUBTAB_ORDER.map((k) => (
          <button key={k} role="tab" aria-selected={p.activeSubtab === k}
            onClick={() => p.onSubtabChange(k)}
            style={{
              padding: '4px 10px', fontSize: 12,
              background: p.activeSubtab === k ? 'var(--paper-soft)' : 'transparent',
              border: '0.5px solid var(--rule-soft)', borderRadius: 4,
              color: p.activeSubtab === k ? 'var(--ink)' : 'var(--ink-faded)',
            }}>
            {t(`note.kinds.${k}`) || k}{' '}
            <span style={{ opacity: counts[k] === 0 ? 0.5 : 1 }}>{counts[k]}</span>
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.length === 0 ? <Empty kind={p.activeSubtab} /> : list.map((n) => (
          <NoteCard key={n.id} note={n} paper={p.paper} locale={p.locale} model={p.model}
            flash={p.flashId === n.id}
            onJumpSource={() => p.onJumpSource(n)}
            onJumpChat={() => p.onJumpChat(n)}
            onDelete={() => p.onDelete(n)}
            onRetry={() => p.onRetry(n)}
            onEdit={() => p.onEdit(n)} />
        ))}
      </div>
    </div>
  );
}
function Empty({ kind }: { kind: NoteKind }) {
  return (
    <div style={{ color: 'var(--ink-faded)', textAlign: 'center', padding: 24, fontSize: 14 }}>
      {t(`note.empty.${kind}`) || 'No items yet.'}
    </div>
  );
}
