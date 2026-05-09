// Main ViewerApp — orchestrates all panels and variants

function ViewerApp() {
  // Theme + tweaks persistent
  const [theme, setTheme] = useState(() => localStorage.getItem('pf-theme') || 'light');
  const [variant, setVariant] = useState(() => localStorage.getItem('pf-variant') || 'summary');
  const [tweaks, setTweaks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pf-tweaks')) || {}; } catch { return {}; }
  });
  const setTweak = (k, v) => setTweaks(t => {
    const next = { ...t, [k]: v };
    localStorage.setItem('pf-tweaks', JSON.stringify(next));
    return next;
  });
  const T = {
    readerFont: 'serif',
    density: 'normal',
    pageWidth: 720,
    margins: true,
    grain: true,
    ...tweaks,
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pf-theme', theme);
  }, [theme]);
  useEffect(() => localStorage.setItem('pf-variant', variant), [variant]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  // UI state
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [cmdKOpen, setCmdKOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [activeOutline, setActiveOutline] = useState('intro');
  const [tab, setTab] = useState('summary');

  // Selection + results
  const [selection, setSelection] = useState(null);
  const [results, setResults] = useState([]);
  const [streamingKey, setStreamingKey] = useState(null);
  const [highlights, setHighlights] = useState([]);

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdKOpen(true); }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); setOutlineOpen(o => !o); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') { e.preventDefault(); setLibraryOpen(true); }
      if (selection && !e.metaKey && !e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === 'e') { e.preventDefault(); runAction('explain', selection); }
        if (key === 's') { e.preventDefault(); runAction('summarize', selection); }
        if (key === 't') { e.preventDefault(); runAction('translate', selection); }
        if (key === 'h') { e.preventDefault(); runAction('highlight', selection); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selection]);

  const runAction = useCallback((kind, sel) => {
    if (kind === 'highlight') {
      setHighlights(h => [...h, { paragraphId: sel.paragraphId, text: sel.text, color: 'yellow' }]);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    const id = `r-${Date.now()}`;
    const body = generateBody(kind, sel.text);
    const paraIndex = window.PAPER.paragraphs.findIndex(p => p.id === sel.paragraphId);
    setResults(r => [...r, {
      id, kind,
      source: sel.text,
      body,
      page: 1,
      paragraphId: sel.paragraphId,
      paragraphRef: (paraIndex >= 0 ? paraIndex + 1 : '?'),
    }]);
    setStreamingKey(id);
    setTab('summary');
    setSelection(null);
    window.getSelection()?.removeAllRanges();

    // Brief ink-ping on the source paragraph to connect selection → margin note
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-pid="${sel.paragraphId}"]`);
      if (!el) return;
      el.classList.add('paragraph-pinged');
      setTimeout(() => el.classList.remove('paragraph-pinged'), 900);
    });
  }, []);

  const onCmdKAction = (item) => {
    setCmdKOpen(false);
    if (item.id === 'lib') setLibraryOpen(true);
    if (['summary', 'classic', 'canvas'].includes(item.id)) setVariant(item.id);
    if (item.id === 'chat') setTab('chat');
    if (item.id.startsWith('role') || item.id.startsWith('judge') || item.id.startsWith('link')) setTab('memory');
  };

  const paper = window.PAPER;

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper-deep)',
      color: 'var(--ink)',
      position: 'relative',
    }}>
      <TopBar
        paper={paper}
        onOpenLibrary={() => setLibraryOpen(true)}
        onOpenCmdK={() => setCmdKOpen(true)}
        onOpenTweaks={() => setTweaksOpen(o => !o)}
        onToggleOutline={() => setOutlineOpen(o => !o)}
        onToggleWorkspace={() => setWorkspaceOpen(o => !o)}
        outlineOpen={outlineOpen}
        workspaceOpen={workspaceOpen}
        variant={variant}
        setVariant={setVariant}
        theme={theme}
        toggleTheme={toggleTheme}
      />

      {variant === 'canvas' ? (
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <CanvasView paper={paper} onBack={() => setVariant('summary')} />
          {workspaceOpen && (
            <div style={{
              position: 'absolute', top: 0, right: 0, bottom: 0,
              width: 380, zIndex: 50,
              boxShadow: 'var(--shadow-3)',
            }}>
              <WorkspacePanel
                paper={paper}
                tab={tab}
                setTab={setTab}
                streamingKey={streamingKey}
                onStreamDone={() => setStreamingKey(null)}
                results={results}
                setResults={setResults}
              />
            </div>
          )}
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex',
          minHeight: 0, overflow: 'hidden',
          background: 'var(--paper-deep)',
        }}>
          {/* Outline column */}
          {outlineOpen && (
            <div style={{ width: 260, flexShrink: 0 }}>
              <OutlinePanel
                paper={paper}
                active={activeOutline}
                onJump={setActiveOutline}
              />
            </div>
          )}

          {/* Reader column */}
          <ReaderColumn
            paper={paper}
            onSelect={setSelection}
            selection={selection}
            setSelection={setSelection}
            onAction={runAction}
            highlights={highlights}
            results={results}
            streamingKey={streamingKey}
            onStreamDone={() => setStreamingKey(null)}
            variant={variant}
            T={T}
          />

          {/* Workspace column */}
          {workspaceOpen && (
            <div style={{ width: 380, flexShrink: 0 }}>
              <WorkspacePanel
                paper={paper}
                tab={tab}
                setTab={setTab}
                streamingKey={streamingKey}
                onStreamDone={() => setStreamingKey(null)}
                results={results}
                setResults={setResults}
              />
            </div>
          )}
        </div>
      )}

      {/* Overlays */}
      <LibraryDrawer open={libraryOpen} onClose={() => setLibraryOpen(false)} onOpenPaper={() => setLibraryOpen(false)}/>
      <CmdK open={cmdKOpen} onClose={() => setCmdKOpen(false)} onAction={onCmdKAction}/>
      <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)} tweaks={T} setTweak={setTweak}/>

      {/* Status rail */}
      <StatusRail paper={paper} />
    </div>
  );
}

// ========== Reader column — changes per variant ==========
function ReaderColumn({ paper, onSelect, selection, setSelection, onAction, highlights, results, streamingKey, onStreamDone, variant, T }) {
  const paperWidth = T.pageWidth || 720;
  const marginColumnWidth = 240;

  if (variant === 'summary') {
    return (
      <div style={{
        flex: 1, minWidth: 0, overflow: 'auto',
        padding: '28px 24px 60px',
        display: 'flex', justifyContent: 'center',
      }}>
        <div
          className={T.grain ? 'paper-grain' : ''}
          style={{
            width: paperWidth,
            background: 'var(--paper)',
            border: '0.5px solid var(--rule)',
            borderRadius: 2,
            boxShadow: 'var(--shadow-2)',
            padding: '56px 60px 80px',
            minHeight: 900,
            flexShrink: 0,
          }}
        >
          <SummaryPage source={paper.summary || ''} />
        </div>
      </div>
    );
  }

  // Classic variant — reader column is just the paper, workspace lives in its own panel
  return (
    <div style={{
      flex: 1, minWidth: 0, overflow: 'auto',
      padding: '28px 24px 60px',
      display: 'flex', justifyContent: 'flex-start',
    }}>
      <div
        className={T.grain ? 'paper-grain' : ''}
        style={{
          width: paperWidth,
          background: 'var(--paper)',
          border: '0.5px solid var(--rule)',
          borderRadius: 2,
          boxShadow: 'var(--shadow-2)',
          padding: '56px 60px 80px',
          position: 'relative',
          minHeight: 900,
          margin: '0 auto',
          flexShrink: 0,
        }}
      >
        <PaperPage
          paper={paper}
          onSelect={onSelect}
          highlights={highlights}
        />
        <SelectionToolbar
          selection={selection}
          onAction={onAction}
          onClose={() => { setSelection(null); window.getSelection()?.removeAllRanges(); }}
        />
      </div>
    </div>
  );
}

// ========== Summary page — pseudo-streamed Markdown summary ==========
// Pseudo-streamed Markdown summary — mirrors chat-memory.jsx tick rhythm exactly.
function SummaryPage({ source }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!source) { setShown(''); return; }
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      i += Math.max(2, Math.floor(Math.random() * 6));
      setShown(source.slice(0, i));
      if (i < source.length) {
        setTimeout(tick, 20 + Math.random() * 40);
      }
    };
    const t0 = setTimeout(tick, 280);
    return () => { cancelled = true; clearTimeout(t0); };
  }, [source]);
  return <Markdown source={shown} />;
}

// Unused after Summary variant redesign (260423-v6a). Kept for now; can be removed in a follow-up.
// ========== Margin column — handwritten-feel notes attached to paragraphs ==========
function MarginColumn({ results, streamingKey, onStreamDone, paper }) {
  const defaultNotes = [
    {
      id: 'd1', kind: 'why',
      title: 'Why this matters — for you',
      body: paper.memory.whyItMatters,
      anchor: 'p2',
    },
    {
      id: 'd2', kind: 'linked',
      title: 'You wrote about this',
      body: '"memory moats" — Oct notes, three weeks ago. You asked whether long-context would fold.',
      anchor: 'p3',
    },
  ];

  const items = [...defaultNotes, ...results.map(r => ({
    ...r, title: r.kind,
    anchor: r.paragraphId || ('p' + r.paragraphRef),
  }))];

  // Compute anchored offsets — align each note to its source paragraph's vertical position
  const [offsets, setOffsets] = useState({});
  useEffect(() => {
    const compute = () => {
      const nextOffsets = {};
      const containerEl = document.querySelector('.margin-column-root');
      if (!containerEl) return;
      const parentTop = containerEl.getBoundingClientRect().top;
      const taken = [];
      const minGap = 110;
      for (const it of items) {
        const el = document.querySelector(`[data-pid="${it.anchor}"]`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        let y = rect.top - parentTop - 12;
        // Avoid overlaps — push down if colliding
        for (const t of taken) {
          if (Math.abs(y - t) < minGap) y = t + minGap;
        }
        taken.push(y);
        nextOffsets[it.id] = y;
      }
      setOffsets(nextOffsets);
    };
    compute();
    const t1 = setTimeout(compute, 120);
    const t2 = setTimeout(compute, 400);
    window.addEventListener('resize', compute);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', compute); };
  }, [items.length, items.map(i => i.anchor).join(',')]);

  return (
    <div className="margin-column-root" style={{
      position: 'relative',
      paddingTop: 12,
      minHeight: '100%',
    }}>
      {items.map((note, i) => (
        <MarginNote
          key={note.id}
          note={note}
          offset={offsets[note.id] ?? (200 + i * 160)}
          streaming={streamingKey === note.id}
          onStreamDone={onStreamDone}
        />
      ))}
    </div>
  );
}

function MarginNote({ note, offset, streaming, onStreamDone }) {
  const [shown, setShown] = useState(streaming ? '' : (note.body || ''));
  useEffect(() => {
    if (!streaming) { setShown(note.body); return; }
    let i = 0;
    const tick = () => {
      i += Math.max(2, Math.floor(Math.random() * 5));
      setShown(note.body.slice(0, i));
      if (i < note.body.length) setTimeout(tick, 18 + Math.random() * 30);
      else onStreamDone && onStreamDone();
    };
    setTimeout(tick, 200);
  }, [streaming]);

  const tones = {
    why: { color: 'var(--walnut)', label: 'why this matters' },
    linked: { color: 'var(--sky)', label: 'linked context' },
    explain: { color: 'var(--sky)', label: 'explain' },
    summarize: { color: 'var(--walnut)', label: 'summarize' },
    translate: { color: 'var(--forest)', label: 'translate' },
    ask: { color: 'var(--foxglove)', label: 'ask' },
  };
  const tone = tones[note.kind] || { color: 'var(--walnut)', label: note.kind };

  return (
    <div style={{
      position: 'absolute', top: offset, left: 0, right: 0,
      animation: 'margin-note-in 380ms cubic-bezier(0.2, 0.9, 0.3, 1)',
    }}>
      {/* leader line — ink-pen draw from paper margin into the note */}
      <svg width="40" height="28" viewBox="0 0 40 28" style={{
        position: 'absolute', left: -36, top: 14, pointerEvents: 'none',
      }}>
        <path
          d="M0 14 C 12 14, 20 18, 36 20"
          stroke={tone.color} strokeWidth="1" fill="none"
          strokeLinecap="round"
          style={{
            strokeDasharray: 60,
            animation: 'ink-pen-draw 520ms cubic-bezier(0.3, 0.7, 0.4, 1) forwards',
          }}
        />
        <circle cx="36" cy="20" r="1.6" fill={tone.color} opacity="0.7" style={{
          animation: 'fade-in 320ms 420ms both',
        }}/>
      </svg>

      <div style={{
        padding: '10px 14px',
        background: 'color-mix(in oklch, ' + tone.color + ' 6%, var(--paper-soft))',
        borderLeft: `2px solid ${tone.color}`,
        borderRadius: '0 6px 6px 0',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: tone.color, fontWeight: 600,
          marginBottom: 5,
        }}>
          {tone.label}
        </div>
        {note.source && (
          <div style={{
            fontFamily: 'var(--font-serif)', fontStyle: 'italic',
            fontSize: 10.5, color: 'var(--ink-faded)',
            borderLeft: '1px solid var(--rule)',
            paddingLeft: 6, marginBottom: 6, lineHeight: 1.4,
          }}>
            "{note.source.slice(0, 80)}{note.source.length > 80 ? '…' : ''}"
          </div>
        )}
        <div
          className={streaming ? 'ink-streaming' : ''}
          style={{
            fontFamily: 'var(--font-serif)', fontSize: 12.5, lineHeight: 1.55,
            color: 'var(--ink)',
          }}
        >
          {shown}
        </div>
      </div>
    </div>
  );
}

// ========== Status rail ==========
function StatusRail({ paper }) {
  return (
    <div style={{
      height: 24, flexShrink: 0,
      background: 'var(--paper)',
      borderTop: '0.5px solid var(--rule)',
      display: 'flex', alignItems: 'center',
      padding: '0 12px', gap: 16,
      fontSize: 10, fontFamily: 'var(--font-mono)',
      color: 'var(--ink-faded)',
    }}>
      <span>⌘K commands</span>
      <span>⌘\ outline</span>
      <span>⌘L library</span>
      <span>E·S·T·H on selection</span>
      <div style={{ flex: 1 }}/>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 5, height: 5, borderRadius: 3, background: 'var(--forest)' }}/>
        local memory · gpt-4.1-mini · BYOK
      </span>
    </div>
  );
}

function generateBody(kind, text) {
  const snippets = {
    explain: `This says that the authors believe most long-range failures aren't an attention-window problem — they're a signal-preservation problem. If preceding layers averaged away the thing you'd need to retrieve, widening attention won't help. Storing a compact residual before averaging happens, and re-injecting it at inference, recovers what was lost.`,
    summarize: `The attention mechanism is already good at short-range recall; long-range failures come from earlier layers smoothing over the relevant signal. A cheap per-chunk residual, re-injected later, fixes that without widening attention.`,
    translate: `注意力机制本身擅长短程关联记忆；长程失败主要是因为前面层已经把需要检索的信号平均掉了。如果在那一步之前便宜地存一份残差，再在推理时重新注入，就能找回大部分原本会丢失的信号，而不需要扩大注意力窗口。`,
    ask: `The paragraph's claim rests on a specific decomposition: attention is kept small, memory is kept separate and cheap. The interesting question is whether the "signal averaged away" framing holds for tasks where the signal was never a single token — e.g., pragmatic inferences. §6's scheduler suggests the authors aren't fully confident it does.`,
  };
  return snippets[kind] || `Result for: "${text.slice(0, 40)}…"`;
}

window.ViewerApp = ViewerApp;
