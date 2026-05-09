import { useState, useRef, useEffect } from 'react';
import { t } from '../lib/i18n';

interface Props {
  rect: { left: number; top: number; right: number; bottom: number };
  initial?: string;
  onCancel: () => void;
  onSave: (text: string) => Promise<void> | void;
}

export function NoteEditorPopover({ rect, initial = '', onCancel, onSave }: Props) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ta.current?.focus(); }, []);

  async function save() {
    if (saving) return;
    setSaving(true); setErr(null);
    try { await onSave(text); }
    catch { setErr(t('note.editor.saveFailed') || 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div role="dialog" aria-label="Note editor"
      style={{ position: 'absolute', top: rect.bottom + 6, left: rect.left, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, boxShadow: 'var(--shadow-2)', padding: 10, width: 320, zIndex: 100 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
      }}>
      <div style={{ fontSize: 11, color: 'var(--ink-faded)', marginBottom: 6 }}>{t('note.editor.title') || 'Note'}</div>
      <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={t('note.editor.placeholder') || 'Write your note…'}
        style={{ width: '100%', minHeight: 80, border: '1px solid var(--rule)', borderRadius: 4, fontFamily: 'var(--font-serif)', fontSize: 13, padding: 6, resize: 'vertical' }} />
      {err && <div style={{ color: 'var(--foxglove)', fontSize: 12, marginTop: 4 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button onClick={onCancel}>{t('action.cancel') || 'Cancel'}</button>
        <button onClick={save} disabled={saving}
          style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '4px 12px', borderRadius: 4 }}>
          {saving ? (t('action.saving') || 'Saving…') : (t('action.save') || 'Save')}
        </button>
      </div>
    </div>
  );
}
