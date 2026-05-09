import { useState, useRef, useEffect } from 'react';
import type { LibraryCatalogEntry, TopicCatalogEntry, LibraryRow } from '../types';
import { LibrarySidebar, type SidebarSelection } from './library-sidebar';
import { I } from './icons';

interface Props {
  libraries: LibraryCatalogEntry[];
  topics: TopicCatalogEntry[];
  rows: LibraryRow[];
  selection: SidebarSelection;
  onSelect: (s: SidebarSelection) => void;
  onCreateLibrary: (name: string) => void | Promise<void>;
  onCreateTopic: (name: string) => void | Promise<void>;
  onRenameLibrary: (id: string, name: string) => void | Promise<void>;
  onDeleteLibrary: (id: string) => void;
  onRenameTopic: (id: string, name: string) => void | Promise<void>;
  onDeleteTopic: (id: string) => void;
  introSeen: boolean;
  onDismissIntro: () => void;
}

function scopeLabel(s: SidebarSelection, libs: LibraryCatalogEntry[], topics: TopicCatalogEntry[]): string {
  if (s.kind === 'all') return 'All Papers';
  if (s.kind === 'uncategorized') return 'Uncategorized';
  if (s.kind === 'library') return libs.find(l => l.id === s.id)?.name ?? '?';
  return `# ${topics.find(t => t.id === s.id)?.name ?? '?'}`;
}

export function LibrarySidebarDropdown(props: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Wrap onSelect to close popover
  const handleSelect = (s: SidebarSelection) => {
    props.onSelect(s);
    setOpen(false);
  };

  return (
    <div style={{ borderBottom: '0.5px solid var(--rule)', padding: '10px 14px' }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`Library scope: ${scopeLabel(props.selection, props.libraries, props.topics)}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--font-mono)', fontSize: 11,
          padding: '6px 10px', background: 'var(--paper-deep)',
          border: '0.5px solid var(--rule)', borderRadius: 4,
          color: 'var(--ink-soft)',
        }}
      >
        <I.Folder size={11} stroke={1.4} />
        Library: {scopeLabel(props.selection, props.libraries, props.topics)}
        <I.ChevronDown size={9} stroke={1.5} />
      </button>
      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Library scope"
          style={{
            position: 'absolute', marginTop: 4, zIndex: 250,
            background: 'var(--paper)', border: '0.5px solid var(--rule)',
            borderRadius: 6, boxShadow: 'var(--shadow-2)',
            maxHeight: '70vh', overflowY: 'auto',
          }}
        >
          <LibrarySidebar
            {...props}
            onSelect={handleSelect}
            width={280}
          />
        </div>
      )}
    </div>
  );
}
