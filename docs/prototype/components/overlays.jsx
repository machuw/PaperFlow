// Library drawer, Command palette (⌘K), Tweaks panel

const LIBRARY = [
  { id: 'p1', title: 'Contextual Residuals: A Lightweight Memory for Long-Horizon Transformers', authors: 'Khan, Voigt et al.', role: 'Background', topic: 'long-context', opened: 'just now', openedSort: 0, hasMemory: true, judgment: 'Plausible but unverified on agentic traces.', pages: 18, annotations: 3, current: true },
  { id: 'p2', title: 'Landmark Attention: Random-Access Infinite Context', authors: 'Mohtashami, Jaggi', role: 'Ancestor', topic: 'long-context', opened: 'yesterday', openedSort: 1, hasMemory: true, judgment: 'Clean idea, discrete landmarks.', pages: 12, annotations: 7 },
  { id: 'p3', title: 'RAG is not enough: evidence from agentic traces', authors: 'Xu et al.', role: 'Counter', topic: 'retrieval', opened: '3 days ago', openedSort: 2, hasMemory: true, judgment: 'Strongest counter-argument I\'ve seen. Re-read §4.2.', pages: 21, annotations: 12 },
  { id: 'p4', title: 'A Survey of Memory in Language Models', authors: 'Ha, Schmidhuber', role: 'Reference', topic: 'memory', opened: '1 week ago', openedSort: 3, hasMemory: false, pages: 34, annotations: 2 },
  { id: 'p5', title: 'Mamba: Linear-Time Sequence Modeling with Selective State Spaces', authors: 'Gu, Dao', role: 'Tangential', topic: 'architectures', opened: '2 weeks ago', openedSort: 4, hasMemory: true, judgment: 'Different axis — state vs memory.', pages: 30, annotations: 0 },
  { id: 'p6', title: 'Infinite-Context Language Modeling via Hierarchical Attention', authors: 'Park, Kim et al.', role: 'Method reference', topic: 'long-context', opened: '3 weeks ago', openedSort: 5, hasMemory: true, judgment: 'Method is promising, ablations are weak.', pages: 16, annotations: 5 },
];

function LibraryDrawer({ open, onClose, onOpenPaper }) {
  const [groupBy, setGroupBy] = useState('topic');  // topic | role | recent
  const [q, setQ] = useState('');
  const [filterMemory, setFilterMemory] = useState(false);

  const filtered = LIBRARY.filter(p =>
    (!q || p.title.toLowerCase().includes(q.toLowerCase()) || p.authors.toLowerCase().includes(q.toLowerCase())) &&
    (!filterMemory || p.hasMemory)
  );

  const groups = useMemo(() => {
    const g = {};
    for (const p of filtered) {
      const key = groupBy === 'topic' ? p.topic : groupBy === 'role' ? p.role : 'Recently opened';
      g[key] = g[key] || [];
      g[key].push(p);
    }
    if (groupBy === 'recent') {
      g['Recently opened'].sort((a, b) => a.openedSort - b.openedSort);
    }
    return g;
  }, [filtered, groupBy]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(20, 16, 8, 0.35)',
        backdropFilter: 'blur(2px)',
        zIndex: 200,
        display: 'flex',
        animation: 'fade-in 150ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(880px, 80%)',
          height: '100%',
          background: 'var(--paper)',
          boxShadow: 'var(--shadow-3)',
          display: 'flex', flexDirection: 'column',
          animation: 'slide-in-right 220ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px 14px',
          borderBottom: '0.5px solid var(--rule)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <I.Library size={16} stroke={1.5}/>
          <div style={{
            fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600,
          }}>Library</div>
          <span style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-faded)',
            padding: '1px 6px', background: 'var(--paper-deep)', borderRadius: 3,
          }}>{LIBRARY.length} papers</span>
          <div style={{ flex: 1 }}/>
          <button onClick={onClose} className="icon-btn"><I.Close size={14}/></button>
        </div>

        {/* Toolbar */}
        <div style={{
          padding: '12px 22px',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '0.5px solid var(--rule)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px',
            background: 'var(--paper-soft)',
            border: '0.5px solid var(--rule)',
            borderRadius: 6, flex: 1, maxWidth: 320,
          }}>
            <I.Search size={12} stroke={1.4} style={{ color: 'var(--ink-faded)' }}/>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, author, note…"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 12, color: 'var(--ink)' }}
            />
          </div>

          <div style={{ fontSize: 11, color: 'var(--ink-faded)', marginLeft: 8 }}>Group by</div>
          <div style={{
            display: 'flex',
            background: 'var(--paper-soft)',
            border: '0.5px solid var(--rule)',
            borderRadius: 5, padding: 2,
          }}>
            {[{ id: 'topic', label: 'Topic' }, { id: 'role', label: 'Role' }, { id: 'recent', label: 'Recent' }].map(g => (
              <button
                key={g.id}
                onClick={() => setGroupBy(g.id)}
                style={{
                  padding: '3px 10px', fontSize: 11, borderRadius: 3,
                  color: groupBy === g.id ? 'var(--ink)' : 'var(--ink-faded)',
                  background: groupBy === g.id ? 'var(--paper)' : 'transparent',
                  fontWeight: groupBy === g.id ? 500 : 400,
                }}
              >{g.label}</button>
            ))}
          </div>

          <button
            onClick={() => setFilterMemory(!filterMemory)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', fontSize: 11,
              borderRadius: 5,
              background: filterMemory ? 'color-mix(in oklch, var(--walnut) 15%, transparent)' : 'var(--paper-soft)',
              color: filterMemory ? 'var(--walnut)' : 'var(--ink-faded)',
              border: '0.5px solid ' + (filterMemory ? 'var(--walnut-soft)' : 'var(--rule)'),
              fontWeight: filterMemory ? 600 : 400,
            }}
          >
            <I.Memory size={11} stroke={1.5}/>
            Has memory
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 22px 20px' }}>
          {Object.entries(groups).map(([key, papers]) => (
            <div key={key} style={{ marginTop: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 0 6px',
                fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--ink-faded)',
                position: 'sticky', top: 0, background: 'var(--paper)', zIndex: 1,
              }}>
                <span>{key}</span>
                <div style={{ flex: 1, height: 0.5, background: 'var(--rule)' }}/>
                <span>{papers.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {papers.map(p => <LibraryRow key={p.id} paper={p} onOpen={() => onOpenPaper(p)}/>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LibraryRow({ paper, onOpen }) {
  return (
    <button
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 14,
        padding: '12px 14px',
        textAlign: 'left',
        borderRadius: 6,
        background: paper.current ? 'var(--paper-soft)' : 'transparent',
        border: '0.5px solid ' + (paper.current ? 'var(--walnut-soft)' : 'transparent'),
        transition: 'background 120ms, border-color 120ms',
      }}
      onMouseEnter={(e) => { if (!paper.current) e.currentTarget.style.background = 'var(--paper-soft)'; }}
      onMouseLeave={(e) => { if (!paper.current) e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Spine */}
      <div style={{
        width: 3, alignSelf: 'stretch',
        borderRadius: 1.5,
        background: paper.current ? 'var(--walnut)' :
                    paper.role === 'Counter' ? 'var(--foxglove)' :
                    paper.role === 'Ancestor' ? 'var(--sky)' :
                    paper.role === 'Background' ? 'var(--walnut-soft)' :
                    paper.role === 'Tangential' ? 'var(--ink-ghost)' :
                    'var(--forest)',
      }}/>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <div style={{
            fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 600,
            color: 'var(--ink)', lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: 1, minWidth: 0,
          }}>
            {paper.title}
          </div>
          {paper.current && (
            <span style={{
              fontSize: 9, fontFamily: 'var(--font-mono)',
              padding: '1px 5px', background: 'var(--walnut)', color: 'var(--paper)',
              borderRadius: 2, letterSpacing: '0.05em', fontWeight: 600,
            }}>NOW</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)', fontStyle: 'italic', marginBottom: 6 }}>
          {paper.authors} · {paper.pages}p · {paper.opened}
        </div>
        {paper.judgment && (
          <div style={{
            paddingLeft: 10,
            borderLeft: '1.5px solid var(--rule)',
            fontFamily: 'var(--font-serif)', fontSize: 12,
            fontStyle: 'italic',
            color: 'var(--ink-soft)', lineHeight: 1.45,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            "{paper.judgment}"
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)',
          padding: '2px 6px', borderRadius: 3,
          background: 'color-mix(in oklch, var(--walnut) 12%, transparent)',
          color: 'var(--walnut)',
        }}>{paper.role}</span>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--ink-ghost)', fontFamily: 'var(--font-mono)' }}>
          {paper.hasMemory && <span title="Has memory"><I.Memory size={10}/></span>}
          {paper.annotations > 0 && <span>✎ {paper.annotations}</span>}
        </div>
      </div>
    </button>
  );
}

// ========== Command palette ==========
function CmdK({ open, onClose, onAction, onOpenLibrary }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);

  const items = useMemo(() => ([
    { cat: 'Paper',  id: 'sum',     label: 'Summarize whole paper',        icon: 'Sparkle',  kbd: '⌘S' },
    { cat: 'Paper',  id: 'trp',     label: 'Translate current page',       icon: 'Translate', kbd: '⌘T' },
    { cat: 'Paper',  id: 'chat',    label: 'Ask question about paper',     icon: 'Chat',     kbd: '/' },
    { cat: 'Memory', id: 'role',    label: 'Set role in my research…',     icon: 'Tag'      },
    { cat: 'Memory', id: 'judge',   label: 'Write my judgment',            icon: 'Edit'     },
    { cat: 'Memory', id: 'link',    label: 'Link to another paper…',       icon: 'Link'     },
    { cat: 'Jump',   id: 'lib',     label: 'Open Library',                 icon: 'Library', kbd: '⌘L' },
    { cat: 'Jump',   id: 's3',      label: 'Jump to § 3 Method',           icon: 'ChevRight' },
    { cat: 'Jump',   id: 's4',      label: 'Jump to § 4 Experiments',      icon: 'ChevRight' },
    { cat: 'View',   id: 'summary', label: 'Layout: Summary (single column)',icon: 'Book' },
    { cat: 'View',   id: 'classic', label: 'Layout: Classic (3 columns)',  icon: 'Grid' },
    { cat: 'View',   id: 'canvas',  label: 'Layout: Canvas (spatial)',     icon: 'Layers' },
  ]), []);

  const filtered = items.filter(x => !q || x.label.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { setI(x => Math.min(x + 1, filtered.length - 1)); e.preventDefault(); }
      if (e.key === 'ArrowUp') { setI(x => Math.max(x - 1, 0)); e.preventDefault(); }
      if (e.key === 'Enter') { const it = filtered[i]; if (it) onAction(it); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, i, filtered, onClose, onAction]);

  useEffect(() => { setI(0); }, [q, open]);

  if (!open) return null;

  const groups = {};
  filtered.forEach(x => { groups[x.cat] = groups[x.cat] || []; groups[x.cat].push(x); });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20, 16, 8, 0.3)',
        backdropFilter: 'blur(3px)', zIndex: 300,
        display: 'flex', justifyContent: 'center', paddingTop: 120,
        animation: 'fade-in 120ms',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxHeight: '60vh',
          background: 'var(--paper-soft)',
          border: '0.5px solid var(--rule)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-3)',
          display: 'flex', flexDirection: 'column',
          animation: 'fade-up 160ms cubic-bezier(0.2, 0.9, 0.3, 1)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderBottom: '0.5px solid var(--rule)',
        }}>
          <I.Search size={14} stroke={1.4} style={{ color: 'var(--ink-faded)' }}/>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask a question, jump, or run an action…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'none',
              fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-sans)',
            }}
          />
          <kbd style={{
            fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-faded)',
            padding: '2px 5px', background: 'var(--paper-deep)', borderRadius: 3,
            border: '0.5px solid var(--rule)',
          }}>esc</kbd>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
          {Object.entries(groups).map(([cat, xs]) => (
            <div key={cat}>
              <div style={{
                padding: '8px 18px 4px',
                fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--ink-faded)',
              }}>{cat}</div>
              {xs.map(x => {
                const Ico = I[x.icon];
                const idx = filtered.indexOf(x);
                const active = idx === i;
                return (
                  <button
                    key={x.id}
                    onMouseEnter={() => setI(idx)}
                    onClick={() => onAction(x)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '8px 18px',
                      background: active ? 'var(--paper-deep)' : 'transparent',
                      fontSize: 13, color: 'var(--ink)',
                      textAlign: 'left',
                    }}
                  >
                    <Ico size={14} stroke={1.4} style={{ color: active ? 'var(--ink)' : 'var(--ink-faded)' }}/>
                    <span style={{ flex: 1 }}>{x.label}</span>
                    {x.kbd && <kbd style={{
                      fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-faded)',
                      padding: '1px 5px', background: 'var(--paper-soft)',
                      border: '0.5px solid var(--rule)',
                      borderRadius: 3,
                    }}>{x.kbd}</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{
          padding: '8px 18px', borderTop: '0.5px solid var(--rule)',
          display: 'flex', gap: 14,
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-faded)',
        }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span style={{ flex: 1 }}/>
          <span>powered by gpt-4.1-mini</span>
        </div>
      </div>
    </div>
  );
}

// ========== Tweaks panel ==========
function TweaksPanel({ open, onClose, tweaks, setTweak }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'absolute', top: 50, right: 10, zIndex: 150,
      width: 260,
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 10,
      boxShadow: 'var(--shadow-2)',
      padding: '14px 16px',
      animation: 'fade-up 140ms',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Tweaks</div>
        <div style={{ flex: 1 }}/>
        <button onClick={onClose} className="icon-btn" style={{ width: 22, height: 22 }}><I.Close size={11}/></button>
      </div>

      <TweakRow label="Reading font">
        <Seg value={tweaks.readerFont} onChange={(v) => setTweak('readerFont', v)} options={[
          { id: 'serif', label: 'Serif' },
          { id: 'sans', label: 'Sans' },
        ]}/>
      </TweakRow>
      <TweakRow label="Density">
        <Seg value={tweaks.density} onChange={(v) => setTweak('density', v)} options={[
          { id: 'cozy', label: 'Cozy' },
          { id: 'normal', label: 'Normal' },
          { id: 'compact', label: 'Compact' },
        ]}/>
      </TweakRow>
      <TweakRow label="Page width">
        <input type="range" min={560} max={900} step={20} value={tweaks.pageWidth}
          onChange={(e) => setTweak('pageWidth', +e.target.value)}
          style={{ width: '100%', accentColor: 'var(--walnut)' }}
        />
      </TweakRow>
      <TweakRow label="Margin notes">
        <Seg value={tweaks.margins ? 'on' : 'off'} onChange={(v) => setTweak('margins', v === 'on')} options={[
          { id: 'on', label: 'On' },
          { id: 'off', label: 'Off' },
        ]}/>
      </TweakRow>
      <TweakRow label="Paper grain">
        <Seg value={tweaks.grain ? 'on' : 'off'} onChange={(v) => setTweak('grain', v === 'on')} options={[
          { id: 'on', label: 'On' },
          { id: 'off', label: 'Off' },
        ]}/>
      </TweakRow>
    </div>
  );
}

function TweakRow({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--ink-faded)', marginBottom: 5,
      }}>{label}</div>
      {children}
    </div>
  );
}

function Seg({ value, onChange, options }) {
  return (
    <div style={{
      display: 'flex',
      background: 'var(--paper-deep)',
      border: '0.5px solid var(--rule)',
      borderRadius: 4, padding: 1.5,
    }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            flex: 1, padding: '4px 6px', fontSize: 11,
            borderRadius: 3,
            color: value === o.id ? 'var(--ink)' : 'var(--ink-faded)',
            background: value === o.id ? 'var(--paper)' : 'transparent',
            fontWeight: value === o.id ? 600 : 400,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}

window.LibraryDrawer = LibraryDrawer;
window.CmdK = CmdK;
window.TweaksPanel = TweaksPanel;
