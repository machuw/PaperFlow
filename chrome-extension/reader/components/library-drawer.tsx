import { useEffect, useMemo, useRef, useState } from 'react';
import { useViewportWidth } from '../lib/use-viewport-width';
import type { LibraryRow, LibraryCatalogEntry, TopicCatalogEntry } from '../types';
import { getLibrary, removeLibraryEntry, upsertLibraryEntry } from '../lib/library';
import {
  getLibraries, getTopics,
  createLibrary, createTopic, renameLibrary, renameTopic,
  scheduleDeleteLibrary, scheduleDeleteTopic,
  undoPendingDelete,
  runLibraryV2Migration, sanitizeLibraryRows,
} from '../lib/library-catalog';
import { getItem, setItem } from '../lib/storage-schema';
import { enqueue } from '../lib/sync-queue';
import { supabase } from '../lib/supabase';
import { usePendingDeletesCommit } from '../lib/use-pending-deletes-commit';
import { LibrarySidebar, type SidebarSelection } from './library-sidebar';
import { LibrarySidebarDropdown } from './library-sidebar-dropdown';
import { LibraryRowView } from './library-row';
import { LibraryCapBanner } from './library-cap-banner';
import { ConfirmModal } from './confirm-modal';
import { I } from './icons';
import { showToast } from '../lib/toast-helpers';
import { planNavigateToPaper } from '../lib/navigate-to-paper';
import { t } from '../lib/i18n';

type GroupBy = 'topic' | 'recent';

function headerTitle(
  s: SidebarSelection,
  n: number,
  libs: LibraryCatalogEntry[],
  topics: TopicCatalogEntry[],
): React.ReactNode {
  if (s.kind === 'all')
    return <>Library <span style={{ color: 'var(--ink-faded)' }}>· {n} papers</span></>;
  if (s.kind === 'uncategorized')
    return <>Uncategorized <span style={{ color: 'var(--ink-faded)' }}>· {n}</span></>;
  if (s.kind === 'library')
    return <>{libs.find(l => l.id === s.id)?.name ?? '?'} <span style={{ color: 'var(--ink-faded)' }}>· {n}</span></>;
  if (s.kind === 'topic')
    return <>Tagged '{topics.find(t => t.id === s.id)?.name ?? '?'}' <span style={{ color: 'var(--ink-faded)' }}>· {n}</span></>;
  return null;
}

export function LibraryDrawer({ open, onClose, currentPaperKey }: {
  open: boolean;
  onClose: () => void;
  currentPaperKey: string;
}) {
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [libraries, setLibraries] = useState<LibraryCatalogEntry[]>([]);
  const [topics, setTopics] = useState<TopicCatalogEntry[]>([]);
  const [selection, setSelection] = useState<SidebarSelection>({ kind: 'all' });
  const [introSeen, setIntroSeen] = useState(true);
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('recent');
  const [memoryOnly, setMemoryOnly] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: 'library' | 'topic';
    id: string;
    name: string;
    affectedCount: number;
  } | null>(null);

  const vw = useViewportWidth();
  const compact = vw <= 768;
  const sidebarWidth = vw <= 1024 ? 200 : 240;

  usePendingDeletesCommit();

  // Initial load: migrate → sanitize → load state
  useEffect(() => {
    if (!open) return;
    (async () => {
      await runLibraryV2Migration();
      const [r, l, t, seen] = await Promise.all([
        getLibrary(),
        getLibraries(),
        getTopics(),
        getItem('pf:librariesIntroSeen'),
      ]);
      const changed = await sanitizeLibraryRows();
      const finalRows = changed ? await getLibrary() : r;
      setRows(finalRows);
      setLibraries(l);
      setTopics(t);
      setIntroSeen(seen === true);
    })();
  }, [open]);

  // Re-fetch when the central auth orchestrator (migration-banner) signals
  // that local storage was just refreshed from cloud — covers cross-device
  // login where local was empty before SIGNED_IN. Drawer-closed case is
  // handled by the [open] effect above on next open.
  useEffect(() => {
    if (!open) return;
    const handler = () => {
      void (async () => {
        const [r, l, t] = await Promise.all([getLibrary(), getLibraries(), getTopics()]);
        setRows(r);
        setLibraries(l);
        setTopics(t);
      })();
    };
    window.addEventListener('paperflow-session-refreshed', handler);
    return () => window.removeEventListener('paperflow-session-refreshed', handler);
  }, [open]);

  // Filter pipeline
  const idToLibName = useMemo(
    () => new Map(libraries.map(l => [l.id, l.name])),
    [libraries],
  );
  const idToTopicName = useMemo(
    () => new Map(topics.map(t => [t.id, t.name])),
    [topics],
  );

  const scopeFiltered = useMemo(() => rows.filter(r => {
    if (selection.kind === 'all') return true;
    if (selection.kind === 'uncategorized') return r.libraryId === null;
    if (selection.kind === 'library') return r.libraryId === selection.id;
    if (selection.kind === 'topic') return r.topicIds.includes(selection.id);
    return false;
  }), [rows, selection]);

  const haystack = useMemo(() => new Map(rows.map(r => [r.id ?? r.urlHash, [
    r.title, r.authors.join(' '),
    r.libraryId ? idToLibName.get(r.libraryId) ?? '' : '',
    r.topicIds.map(id => idToTopicName.get(id) ?? '').join(' '),
  ].join(' ').toLowerCase()])), [rows, idToLibName, idToTopicName]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return scopeFiltered.filter(r =>
      (!needle || (haystack.get(r.id ?? r.urlHash) ?? '').includes(needle)) &&
      (!memoryOnly || r.hasMemory),
    );
  }, [scopeFiltered, q, memoryOnly, haystack]);

  // Group bucketing with multi-Topic row expansion
  const groups = useMemo(() => {
    const out: Record<string, Array<{ row: LibraryRow; alsoInTopics?: string[] }>> = {};
    if (groupBy === 'topic') {
      for (const r of filtered) {
        if (r.topicIds.length === 0) {
          (out['Uncategorized'] = out['Uncategorized'] ?? []).push({ row: r });
        } else {
          // sort topicIds by topic.createdAt asc for deterministic "first appearance"
          const orderedTopicIds = [...r.topicIds].sort((a, b) => {
            const ta = topics.find(t => t.id === a)?.createdAt ?? 0;
            const tb = topics.find(t => t.id === b)?.createdAt ?? 0;
            return ta - tb;
          });
          orderedTopicIds.forEach((tid, idx) => {
            const tName = idToTopicName.get(tid) ?? '?';
            const otherNames = orderedTopicIds
              .filter(x => x !== tid)
              .map(x => idToTopicName.get(x) ?? '');
            (out[tName] = out[tName] ?? []).push({
              row: r,
              alsoInTopics: idx > 0 ? otherNames.filter(Boolean) : undefined,
            });
          });
        }
      }
    } else {
      const sorted = [...filtered].sort((a, b) => b.lastRead - a.lastRead);
      out['Recently opened'] = sorted.map(row => ({ row }));
    }
    return out;
  }, [filtered, groupBy, idToTopicName, topics]);

  // Mutations
  const refresh = async () => {
    const [r, l, t] = await Promise.all([getLibrary(), getLibraries(), getTopics()]);
    setRows(r);
    setLibraries(l);
    setTopics(t);
  };

  const handleAssignLibrary = async (rowKey: string, libraryId: string | null) => {
    const all = await getLibrary();
    const next = all.map(r => (r.id ?? r.urlHash) === rowKey ? { ...r, libraryId } : r);
    await chrome.storage.local.set({ library: next });
    await refresh();
  };

  // Click-to-jump from library: open the chosen paper in a new tab so the
  // current reader's in-memory state (chat draft, scroll, etc.) is preserved.
  // Logic lives in `planNavigateToPaper` (lib/navigate-to-paper) — this
  // callback is a thin dispatcher over its tagged-union result. The helper is
  // async to support the Phase C paperKey cache lookup; the click handler
  // fires-and-forgets (errors swallowed because the helper itself does not
  // throw — it returns 'toast' on every failure).
  const handleNavigateToPaper = (rowKey: string) => {
    const row = rows.find(r => (r.id ?? r.urlHash) === rowKey);
    if (!row) return;
    void (async () => {
      const action = await planNavigateToPaper({ row, rowKey, currentPaperKey });
      switch (action.kind) {
        case 'close-only':
          onClose();
          return;
        case 'open-tab':
          chrome.tabs.create({ url: action.url, active: true });
          onClose();
          return;
        case 'toast':
          showToast({ message: t(action.messageKey) });
          return;
      }
    })();
  };

  const handleToggleTopic = async (rowKey: string, topicId: string) => {
    const all = await getLibrary();
    const next = all.map(r => {
      if ((r.id ?? r.urlHash) !== rowKey) return r;
      const has = r.topicIds.includes(topicId);
      return { ...r, topicIds: has ? r.topicIds.filter(x => x !== topicId) : [...r.topicIds, topicId] };
    });
    await chrome.storage.local.set({ library: next });
    await refresh();
  };

  const handleUnassignTopic = (rowKey: string, topicId: string) =>
    handleToggleTopic(rowKey, topicId);

  const handleDeleteLibrary = async () => {
    if (!confirm || confirm.kind !== 'library') return;
    const lib = libraries.find(l => l.id === confirm.id);
    if (!lib) return;
    await scheduleDeleteLibrary(confirm.id);
    setConfirm(null);
    if (selection.kind === 'library' && selection.id === confirm.id) {
      setSelection({ kind: 'all' });
    }
    await refresh();
    showToast({
      message: `Library '${lib.name}' deleted.`,
      action: {
        label: 'Undo',
        handler: async () => {
          const pendings = await getItem('pf:lib:pendingDeletes') ?? [];
          const target = pendings.find(p => p.kind === 'library' && p.deletedEntry.id === lib.id);
          if (target) {
            await undoPendingDelete(target.id);
            await refresh();
          }
        },
      },
      timeoutMs: 5000,
    });
  };

  const handleDeleteTopic = async () => {
    if (!confirm || confirm.kind !== 'topic') return;
    const topic = topics.find(t => t.id === confirm.id);
    if (!topic) return;
    await scheduleDeleteTopic(confirm.id);
    setConfirm(null);
    if (selection.kind === 'topic' && selection.id === confirm.id) {
      setSelection({ kind: 'all' });
    }
    await refresh();
    showToast({
      message: `Topic '${topic.name}' deleted.`,
      action: {
        label: 'Undo',
        handler: async () => {
          const pendings = await getItem('pf:lib:pendingDeletes') ?? [];
          const target = pendings.find(p => p.kind === 'topic' && p.deletedEntry.id === topic.id);
          if (target) {
            await undoPendingDelete(target.id);
            await refresh();
          }
        },
      },
      timeoutMs: 5000,
    });
  };

  const handleCreateLibrary = async (name: string) => {
    if (!name?.trim()) return;
    try {
      await createLibrary(name);
      await refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : 'Create failed' });
    }
  };

  const handleCreateTopic = async (name: string) => {
    if (!name?.trim()) return;
    try {
      await createTopic(name);
      await refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : 'Create failed' });
    }
  };

  const handleCreateLibraryFromCard = async (name: string, rowKey: string) => {
    if (!name?.trim()) return;
    try {
      const entry = await createLibrary(name);
      await handleAssignLibrary(rowKey, entry.id);
      await refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : 'Create failed' });
    }
  };

  const handleCreateTopicFromCard = async (name: string, rowKey: string) => {
    if (!name?.trim()) return;
    try {
      const entry = await createTopic(name);
      await handleToggleTopic(rowKey, entry.id);
      await refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : 'Create failed' });
    }
  };

  const handleRenameLibrary = async (id: string, name: string) => {
    if (!name?.trim()) return;
    try {
      await renameLibrary(id, name);
      await refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : 'Rename failed' });
    }
  };

  const handleRenameTopic = async (id: string, name: string) => {
    if (!name?.trim()) return;
    try {
      await renameTopic(id, name);
      await refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : 'Rename failed' });
    }
  };

  const handleRemovePaper = async (rowKey: string) => {
    const all = await getLibrary();
    const target = all.find((r) => (r.id ?? r.urlHash) === rowKey);
    if (!target) return;

    // Optimistic local delete
    await removeLibraryEntry(rowKey);
    await refresh();

    // Deferred cloud delete (cancellable by Undo)
    let undone = false;
    const timer = setTimeout(async () => {
      if (undone) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await enqueue({
          table: 'papers',
          op: 'delete',
          row: { paper_key: rowKey, user_id: user.id },
          ts: Date.now(),
        });
      }
    }, 5000);

    showToast({
      message: `Removed '${target.title}'`,
      action: {
        label: 'Undo',
        handler: async () => {
          undone = true;
          clearTimeout(timer);
          await upsertLibraryEntry(target);
          await refresh();
        },
      },
      timeoutMs: 5000,
    });
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(20, 16, 8, 0.35)',
        backdropFilter: 'blur(2px)',
        zIndex: 200, display: 'flex',
        animation: 'fade-in 150ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1200px, 92%)', height: '100%',
          background: 'var(--paper)',
          boxShadow: 'var(--shadow-3)',
          display: 'flex', flexDirection: compact ? 'column' : 'row',
          animation: 'slide-in-right 220ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Library"
      >
        {compact ? (
          <LibrarySidebarDropdown
            libraries={libraries}
            topics={topics}
            rows={rows}
            selection={selection}
            onSelect={setSelection}
            onCreateLibrary={handleCreateLibrary}
            onCreateTopic={handleCreateTopic}
            onRenameLibrary={handleRenameLibrary}
            onDeleteLibrary={(id) => {
              const lib = libraries.find(l => l.id === id);
              if (!lib) return;
              const affected = rows.filter(r => r.libraryId === id).length;
              setConfirm({ kind: 'library', id, name: lib.name, affectedCount: affected });
            }}
            onRenameTopic={handleRenameTopic}
            onDeleteTopic={(id) => {
              const t = topics.find(x => x.id === id);
              if (!t) return;
              const affected = rows.filter(r => r.topicIds.includes(id)).length;
              setConfirm({ kind: 'topic', id, name: t.name, affectedCount: affected });
            }}
            introSeen={introSeen}
            onDismissIntro={async () => {
              await setItem('pf:librariesIntroSeen', true);
              setIntroSeen(true);
            }}
          />
        ) : (
          <LibrarySidebar
            libraries={libraries}
            topics={topics}
            rows={rows}
            selection={selection}
            onSelect={setSelection}
            onCreateLibrary={handleCreateLibrary}
            onCreateTopic={handleCreateTopic}
            onRenameLibrary={handleRenameLibrary}
            onDeleteLibrary={(id) => {
              const lib = libraries.find(l => l.id === id);
              if (!lib) return;
              const affected = rows.filter(r => r.libraryId === id).length;
              setConfirm({ kind: 'library', id, name: lib.name, affectedCount: affected });
            }}
            onRenameTopic={handleRenameTopic}
            onDeleteTopic={(id) => {
              const t = topics.find(x => x.id === id);
              if (!t) return;
              const affected = rows.filter(r => r.topicIds.includes(id)).length;
              setConfirm({ kind: 'topic', id, name: t.name, affectedCount: affected });
            }}
            introSeen={introSeen}
            onDismissIntro={async () => {
              await setItem('pf:librariesIntroSeen', true);
              setIntroSeen(true);
            }}
            width={sidebarWidth}
          />
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Header */}
          <div style={{
            padding: '18px 22px 14px',
            borderBottom: '0.5px solid var(--rule)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <I.Library size={16} stroke={1.5} />
            <div style={{
              fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600,
              color: 'var(--ink)',
            }}>
              {headerTitle(selection, filtered.length, libraries, topics)}
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} className="icon-btn"><I.Close size={14} /></button>
          </div>

          {/* Free-tier cap banner */}
          <LibraryCapBanner
            onUpgrade={() => {
              onClose();
              window.dispatchEvent(
                new CustomEvent('open-upgrade-prompt', { detail: { trigger: 'library' } }),
              );
            }}
          />

          {/* Toolbar — preserved from existing drawer */}
          <div style={{
            padding: '12px 22px',
            display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: '0.5px solid var(--rule)',
            flexWrap: 'wrap',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px',
              background: 'var(--paper-soft)',
              border: '0.5px solid var(--rule)',
              borderRadius: 6, flex: 1, minWidth: 200, maxWidth: 320,
            }}>
              <I.Search size={12} stroke={1.4} style={{ color: 'var(--ink-faded)' }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search title, author…"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'none',
                  fontSize: 12, color: 'var(--ink)',
                }}
              />
            </div>

            <div style={{ fontSize: 11, color: 'var(--ink-faded)' }}>Group by</div>
            <Seg
              value={groupBy}
              onChange={(v) => setGroupBy(v as GroupBy)}
              options={[
                { id: 'topic', label: 'Topic' },
                { id: 'recent', label: 'Recent' },
              ]}
            />

            <label style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: 'var(--ink-soft)', cursor: 'pointer',
              marginLeft: 'auto',
            }}>
              <input
                type="checkbox"
                checked={memoryOnly}
                onChange={(e) => setMemoryOnly(e.target.checked)}
              />
              Has memory
            </label>
          </div>

          {/* aria-live region for screen-reader announcements */}
          <ScopeLiveRegion
            selection={selection}
            count={filtered.length}
            libs={libraries}
            topics={topics}
          />

          {/* Groups */}
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 18px 18px' }}>
            {Object.entries(groups).length === 0 && (
              <div style={{
                padding: 40,
                fontFamily: 'var(--font-serif)', fontSize: 13, fontStyle: 'italic',
                color: 'var(--ink-faded)', textAlign: 'center',
              }}>
                {rows.length === 0
                  ? 'Open a paper to start your library.'
                  : 'No papers match your filters.'}
              </div>
            )}
            {Object.entries(groups).map(([groupName, items]) => (
              <div key={groupName} style={{ marginTop: 18 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--ink-faded)',
                  padding: '0 4px 6px',
                }}>{groupName} · {items.length}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {items.map(({ row, alsoInTopics }) => (
                    <LibraryRowView
                      key={`${row.id ?? row.urlHash}-${groupName}`}
                      row={row}
                      isCurrent={(row.id ?? row.urlHash) === currentPaperKey}
                      libraries={libraries}
                      topics={topics}
                      alsoInTopics={alsoInTopics}
                      onAssignLibrary={handleAssignLibrary}
                      onToggleTopic={handleToggleTopic}
                      onUnassignTopic={handleUnassignTopic}
                      onCreateLibraryFromCard={handleCreateLibraryFromCard}
                      onCreateTopicFromCard={handleCreateTopicFromCard}
                      onRemove={handleRemovePaper}
                      onPaperClick={handleNavigateToPaper}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {confirm && confirm.kind === 'library' && (
        <ConfirmModal
          open
          title={`Delete library '${confirm.name}'?`}
          body={`${confirm.affectedCount} papers will move to Uncategorized.`}
          dangerLabel="Delete"
          onConfirm={handleDeleteLibrary}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm && confirm.kind === 'topic' && (
        <ConfirmModal
          open
          title={`Delete topic '${confirm.name}'?`}
          body={`It will be removed from ${confirm.affectedCount} papers.`}
          dangerLabel="Delete"
          onConfirm={handleDeleteTopic}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function ScopeLiveRegion({
  selection, count, libs, topics,
}: {
  selection: SidebarSelection;
  count: number;
  libs: LibraryCatalogEntry[];
  topics: TopicCatalogEntry[];
}) {
  const [text, setText] = useState('');
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const scopeName =
        selection.kind === 'all' ? 'all papers' :
        selection.kind === 'uncategorized' ? 'Uncategorized' :
        selection.kind === 'library' ? (libs.find(l => l.id === selection.id)?.name ?? '') :
        `topic ${topics.find(t => t.id === selection.id)?.name ?? ''}`;
      setText(`Showing ${count} papers in ${scopeName}`);
    }, 150);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [selection, count, libs, topics]);
  return (
    <div
      aria-live="polite"
      style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
    >
      {text}
    </div>
  );
}

function Seg<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }> }) {
  return (
    <div style={{
      display: 'flex',
      background: 'var(--paper-deep)',
      border: '0.5px solid var(--rule)',
      borderRadius: 4, padding: 1.5,
    }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '4px 8px', fontSize: 11, borderRadius: 3,
            color: value === o.id ? 'var(--ink)' : 'var(--ink-faded)',
            background: value === o.id ? 'var(--paper)' : 'transparent',
            fontWeight: value === o.id ? 600 : 400,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}
