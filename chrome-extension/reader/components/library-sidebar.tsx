// chrome-extension/reader/components/library-sidebar.tsx
import { useState, useRef, useEffect } from 'react';
import { useFloating, flip, shift, autoUpdate, type Placement } from '@floating-ui/react-dom';
import { I } from './icons';
import type { LibraryCatalogEntry, TopicCatalogEntry, LibraryRow } from '../types';
import { isEditingInput } from '../lib/is-editing-input';

export type SidebarSelection =
  | { kind: 'all' }
  | { kind: 'uncategorized' }
  | { kind: 'library'; id: string }
  | { kind: 'topic'; id: string };

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
  width?: number;
}

type EditMode =
  | { kind: 'idle' }
  | { kind: 'creating-library' }
  | { kind: 'creating-topic' }
  | { kind: 'renaming'; section: 'library' | 'topic'; id: string };

function InlineNameInput({ initialValue, placeholder, onSubmit, onCancel, ariaLabel }: {
  initialValue: string;
  placeholder?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <input
      ref={ref}
      role="textbox"
      aria-label={ariaLabel}
      defaultValue={initialValue}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const val = (e.currentTarget.value ?? '').trim();
          if (val) onSubmit(val);
        } else if (e.key === 'Escape') {
          onCancel();
        }
      }}
      onBlur={onCancel}
      style={{
        margin: '4px 12px',
        padding: '8px 12px',
        height: 32,
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--ink)',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--walnut)',
        borderRadius: 4,
        width: 'calc(100% - 24px)',
        boxSizing: 'border-box',
        outline: 'none',
      }}
    />
  );
}

interface RowMenuProps {
  anchor: HTMLElement | null;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}
function RowMenu({ anchor, onRename, onDelete, onClose }: RowMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'right-start' as Placement,
    middleware: [flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => { if (anchor) refs.setReference(anchor); }, [anchor, refs]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [onClose, anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={(el) => { refs.setFloating(el); panelRef.current = el; }}
      style={{
        ...floatingStyles,
        background: 'var(--paper)',
        border: '0.5px solid var(--rule)',
        borderRadius: 6,
        boxShadow: 'var(--shadow-2)',
        zIndex: 300,
        minWidth: 140,
      }}
      role="menu"
      aria-label="Row actions"
    >
      <button
        role="menuitem"
        onClick={() => { onRename(); onClose(); }}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: '8px 12px', fontSize: 12,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)',
        }}
      >Rename</button>
      <button
        role="menuitem"
        onClick={() => { onDelete(); onClose(); }}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: '8px 12px', fontSize: 12,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--foxglove)', fontFamily: 'var(--font-mono)',
        }}
      >Delete</button>
    </div>
  );
}

function isSelected(s: SidebarSelection, kind: SidebarSelection['kind'], id?: string): boolean {
  if (s.kind !== kind) return false;
  if (s.kind === 'library' || s.kind === 'topic') {
    if (s.id !== id) return false;
  }
  return true;
}

interface RowProps {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  ariaLabel: string;
  // for user-created entries:
  onMore?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onRename?: () => void;
  onDelete?: () => void;
}
function Row({ active, label, count, onClick, ariaLabel, onMore, onRename, onDelete }: RowProps) {
  const bg = active ? 'var(--paper-deep)' : 'transparent';
  const color = active ? 'var(--ink)' : 'var(--ink-soft)';
  const countColor = active ? 'var(--walnut)' : 'var(--ink-faded)';
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isEditingInput(e)) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); return; }
    if (onRename || onDelete) {
      if (e.key === 'F2' && onRename) { e.preventDefault(); onRename(); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && onDelete) { e.preventDefault(); onDelete(); }
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        height: 28, padding: '6px 12px',
        background: bg, color, cursor: 'pointer',
        borderLeft: active ? '2px solid var(--walnut)' : '2px solid transparent',
        transition: 'background 120ms ease',
        position: 'relative',
      }}
    >
      <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: countColor }}>{count}</span>
      {onMore && (
        <button
          onClick={(e) => { e.stopPropagation(); onMore(e); }}
          aria-label={`More actions for ${label}`}
          className="icon-btn"
          style={{ marginLeft: 4, width: 20, height: 24 }}
        >
          <I.More size={12} />
        </button>
      )}
    </div>
  );
}

export function LibrarySidebar(props: Props) {
  const [editMode, setEditMode] = useState<EditMode>({ kind: 'idle' });
  const [menuOpenFor, setMenuOpenFor] = useState<{ section: 'library' | 'topic'; id: string; anchor: HTMLElement } | null>(null);
  const totalCount = props.rows.length;
  const uncatCount = props.rows.filter(r => r.libraryId === null).length;
  return (
    <aside
      style={{ width: props.width ?? 240, borderRight: '0.5px solid var(--rule)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
      aria-label="Library scope"
    >
      {!props.introSeen && (
        <FirstUsePill onDismiss={props.onDismissIntro} />
      )}
      <SectionLabel>Libraries</SectionLabel>
      <Row
        active={isSelected(props.selection, 'all')}
        label="All Papers"
        count={totalCount}
        onClick={() => props.onSelect({ kind: 'all' })}
        ariaLabel={`All Papers, ${totalCount} papers`}
      />
      <Row
        active={isSelected(props.selection, 'uncategorized')}
        label="Uncategorized"
        count={uncatCount}
        onClick={() => props.onSelect({ kind: 'uncategorized' })}
        ariaLabel={`Uncategorized, ${uncatCount} papers`}
      />
      {props.libraries.length > 0 && <Divider />}
      {props.libraries.map(lib => (
        editMode.kind === 'renaming' && editMode.section === 'library' && editMode.id === lib.id ? (
          <InlineNameInput
            key={lib.id}
            initialValue={lib.name}
            ariaLabel={`Rename library ${lib.name}`}
            onSubmit={(name) => { props.onRenameLibrary(lib.id, name); setEditMode({ kind: 'idle' }); }}
            onCancel={() => setEditMode({ kind: 'idle' })}
          />
        ) : (
          <Row
            key={lib.id}
            active={isSelected(props.selection, 'library', lib.id)}
            label={lib.name}
            count={props.rows.filter(r => r.libraryId === lib.id).length}
            onClick={() => props.onSelect({ kind: 'library', id: lib.id })}
            ariaLabel={`${lib.name}, ${props.rows.filter(r => r.libraryId === lib.id).length} papers`}
            onMore={(e) => setMenuOpenFor({ section: 'library', id: lib.id, anchor: e.currentTarget })}
            onRename={() => setEditMode({ kind: 'renaming', section: 'library', id: lib.id })}
            onDelete={() => props.onDeleteLibrary(lib.id)}
          />
        )
      ))}
      {editMode.kind === 'creating-library' ? (
        <InlineNameInput
          initialValue=""
          placeholder="New library name"
          ariaLabel="New library name"
          onSubmit={(name) => { props.onCreateLibrary(name); setEditMode({ kind: 'idle' }); }}
          onCancel={() => setEditMode({ kind: 'idle' })}
        />
      ) : (
        <NewButton label="+ New library" onClick={() => setEditMode({ kind: 'creating-library' })} />
      )}

      {props.topics.length > 0 && (
        <>
          <SectionLabel style={{ marginTop: 16 }}>Topics</SectionLabel>
          {props.topics.map(t => (
            editMode.kind === 'renaming' && editMode.section === 'topic' && editMode.id === t.id ? (
              <InlineNameInput
                key={t.id}
                initialValue={t.name}
                ariaLabel={`Rename topic ${t.name}`}
                onSubmit={(name) => { props.onRenameTopic(t.id, name); setEditMode({ kind: 'idle' }); }}
                onCancel={() => setEditMode({ kind: 'idle' })}
              />
            ) : (
              <Row
                key={t.id}
                active={isSelected(props.selection, 'topic', t.id)}
                label={`# ${t.name}`}
                count={props.rows.filter(r => r.topicIds.includes(t.id)).length}
                onClick={() => props.onSelect({ kind: 'topic', id: t.id })}
                ariaLabel={`Topic ${t.name}, ${props.rows.filter(r => r.topicIds.includes(t.id)).length} papers`}
                onMore={(e) => setMenuOpenFor({ section: 'topic', id: t.id, anchor: e.currentTarget })}
                onRename={() => setEditMode({ kind: 'renaming', section: 'topic', id: t.id })}
                onDelete={() => props.onDeleteTopic(t.id)}
              />
            )
          ))}
        </>
      )}
      {editMode.kind === 'creating-topic' ? (
        <InlineNameInput
          initialValue=""
          placeholder="New topic name"
          ariaLabel="New topic name"
          onSubmit={(name) => { props.onCreateTopic(name); setEditMode({ kind: 'idle' }); }}
          onCancel={() => setEditMode({ kind: 'idle' })}
        />
      ) : (
        <NewButton label="+ New topic" onClick={() => setEditMode({ kind: 'creating-topic' })} />
      )}
      {menuOpenFor && (
        <RowMenu
          anchor={menuOpenFor.anchor}
          onRename={() => setEditMode({ kind: 'renaming', section: menuOpenFor.section, id: menuOpenFor.id })}
          onDelete={() => {
            if (menuOpenFor.section === 'library') props.onDeleteLibrary(menuOpenFor.id);
            else props.onDeleteTopic(menuOpenFor.id);
          }}
          onClose={() => setMenuOpenFor(null)}
        />
      )}
    </aside>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{
    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--ink-faded)',
    padding: '14px 12px 6px', ...style,
  }}>{children}</div>;
}
function Divider() {
  return <div style={{ borderTop: '0.5px solid var(--rule-soft)', margin: '6px 12px' }} />;
}
function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        margin: '4px 12px',
        padding: '8px 12px',
        height: 32,
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--ink-faded)',
        background: 'transparent',
        border: '0.5px dashed var(--ink-ghost)',
        borderRadius: 4,
        textAlign: 'left',
      }}
    >{label}</button>
  );
}
function FirstUsePill({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div style={{
      margin: '0 8px 12px 8px',
      padding: '10px 12px',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule-soft)',
      borderRadius: 6,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <I.Sparkle size={12} stroke={1.4} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', color: 'var(--walnut)', textTransform: 'uppercase' }}>NEW</span>
        <button className="icon-btn" onClick={onDismiss} style={{ marginLeft: 'auto', width: 20, height: 20 }} aria-label="Dismiss intro">×</button>
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 12, fontStyle: 'italic', color: 'var(--ink-soft)', lineHeight: 1.5, marginTop: 4 }}>
        Organize papers into libraries and tag them with topics.
      </div>
    </div>
  );
}
