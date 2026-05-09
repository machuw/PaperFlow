import { useState, useEffect, useRef } from 'react';
import { useFloating, flip, shift, autoUpdate, type Placement } from '@floating-ui/react-dom';
import type { LibraryCatalogEntry, TopicCatalogEntry } from '../types';
import { I } from './icons';
import { trapFocus } from '../lib/focus-trap';

interface LibProps {
  libraries: LibraryCatalogEntry[];
  currentId: string | null;
  onAssign: (id: string | null) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
  anchor?: HTMLElement | null;  // for floating-ui positioning
}

export function LibraryPopover({ libraries, currentId, onAssign, onCreate, onClose, anchor }: LibProps) {
  const [filter, setFilter] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-start' as Placement,
    middleware: [flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  useEffect(() => { if (anchor) refs.setReference(anchor); }, [anchor, refs]);
  useEffect(() => { if (panelRef.current) return trapFocus(panelRef.current); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [onClose, anchor]);

  const trimmed = filter.trim();
  const filtered = libraries.filter(l => !trimmed || l.name.toLowerCase().includes(trimmed.toLowerCase()));
  const exactMatch = libraries.some(l => l.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <div
      ref={(el) => { refs.setFloating(el); panelRef.current = el; }}
      style={{ ...floatingStyles, width: 240, background: 'var(--paper)', border: '0.5px solid var(--rule)', borderRadius: 6, boxShadow: 'var(--shadow-2)', zIndex: 300 }}
      role="dialog"
      aria-label="Choose library"
    >
      <div style={{ padding: 8, borderBottom: '0.5px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <I.Search size={12} stroke={1.4} />
        <input
          autoFocus
          placeholder="Filter or create…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 12 }}
        />
      </div>
      <button
        onClick={() => { onAssign(null); onClose(); }}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, color: currentId === null ? 'var(--ink)' : 'var(--ink-soft)' }}
      >— None —</button>
      {filtered.map(l => (
        <button
          key={l.id}
          onClick={() => { onAssign(l.id); onClose(); }}
          aria-label={`Assign library ${l.name}`}
          style={{ display: 'flex', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, alignItems: 'center', gap: 6 }}
        >
          <span style={{ flex: 1 }}>{l.name}</span>
          {currentId === l.id && <span style={{ color: 'var(--walnut)' }}>✓</span>}
        </button>
      ))}
      {trimmed && !exactMatch && (
        <>
          <div style={{ borderTop: '0.5px solid var(--rule-soft)' }} />
          <button
            onClick={() => { onCreate(trimmed); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'var(--walnut)' }}
          >+ Create "{trimmed}"</button>
        </>
      )}
    </div>
  );
}

interface TopicProps {
  topics: TopicCatalogEntry[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
  anchor?: HTMLElement | null;
}

export function TopicPopover({ topics, selectedIds, onToggle, onCreate, onClose, anchor }: TopicProps) {
  const [filter, setFilter] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-start' as Placement,
    middleware: [flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  useEffect(() => { if (anchor) refs.setReference(anchor); }, [anchor, refs]);
  useEffect(() => { if (panelRef.current) return trapFocus(panelRef.current); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [onClose, anchor]);

  const trimmed = filter.trim();
  const filtered = topics.filter(t => !trimmed || t.name.toLowerCase().includes(trimmed.toLowerCase()));
  const exactMatch = topics.some(t => t.name.toLowerCase() === trimmed.toLowerCase());
  const selectedSet = new Set(selectedIds);

  return (
    <div
      ref={(el) => { refs.setFloating(el); panelRef.current = el; }}
      style={{ ...floatingStyles, width: 240, background: 'var(--paper)', border: '0.5px solid var(--rule)', borderRadius: 6, boxShadow: 'var(--shadow-2)', zIndex: 300 }}
      role="dialog"
      aria-label="Choose topics"
    >
      <div style={{ padding: 8, borderBottom: '0.5px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <I.Search size={12} stroke={1.4} />
        <input
          autoFocus
          placeholder="Filter or create…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 12 }}
        />
      </div>
      {topics.length === 0 && (
        <div style={{ padding: '18px 14px', fontFamily: 'var(--font-serif)', fontStyle: 'italic', color: 'var(--ink-faded)', fontSize: 12 }}>
          Type to create your first topic
        </div>
      )}
      {filtered.map(t => (
        <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            aria-label={t.name}
            checked={selectedSet.has(t.id)}
            onChange={() => onToggle(t.id)}
          />
          <span>{t.name}</span>
        </label>
      ))}
      {trimmed && !exactMatch && (
        <>
          <div style={{ borderTop: '0.5px solid var(--rule-soft)' }} />
          <button onClick={() => onCreate(trimmed)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'var(--walnut)' }}>
            + Create "{trimmed}"
          </button>
        </>
      )}
    </div>
  );
}
