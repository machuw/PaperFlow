// Canvas variant — spatial, Obsidian-like. PDF is one card; AI outputs spawn linked cards.
function CanvasView({ paper, onBack }) {
  const [cards, setCards] = useState([
    { id: 'paper', x: 60, y: 40, w: 520, h: 640, kind: 'paper' },
    { id: 'why', x: 620, y: 40, w: 300, h: 180, kind: 'why' },
    { id: 'summary', x: 620, y: 240, w: 300, h: 250, kind: 'summary' },
    { id: 'linked', x: 620, y: 510, w: 300, h: 170, kind: 'linked' },
    { id: 'chat', x: 950, y: 240, w: 320, h: 440, kind: 'chat' },
  ]);
  const [drag, setDrag] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.8);

  const onMouseDown = (e, id) => {
    const card = cards.find(c => c.id === id);
    setDrag({ id, ox: e.clientX - card.x, oy: e.clientY - card.y });
  };
  useEffect(() => {
    if (!drag) return;
    const mv = (e) => {
      setCards(cs => cs.map(c => c.id === drag.id ? { ...c, x: e.clientX - drag.ox, y: e.clientY - drag.oy } : c));
    };
    const up = () => setDrag(null);
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [drag]);

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      overflow: 'hidden',
      background:
        `radial-gradient(circle at 1px 1px, var(--ink-ghost) 0.6px, transparent 0),` +
        `var(--paper-deep)`,
      backgroundSize: '24px 24px',
    }}>
      {/* Edges/lines between cards */}
      <svg
        width="100%" height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {['why', 'summary', 'linked'].map(id => {
          const a = cards.find(c => c.id === 'paper');
          const b = cards.find(c => c.id === id);
          if (!a || !b) return null;
          return (
            <line key={id}
              x1={a.x + a.w} y1={a.y + 80}
              x2={b.x} y2={b.y + b.h / 2}
              stroke="var(--walnut-soft)" strokeWidth={1} strokeDasharray="3 4" opacity={0.6}
            />
          );
        })}
        {(() => {
          const a = cards.find(c => c.id === 'summary');
          const b = cards.find(c => c.id === 'chat');
          if (!a || !b) return null;
          return (
            <line
              x1={a.x + a.w} y1={a.y + a.h / 2}
              x2={b.x} y2={b.y + b.h / 2}
              stroke="var(--walnut-soft)" strokeWidth={1} strokeDasharray="3 4" opacity={0.6}
            />
          );
        })()}
      </svg>

      {/* Canvas toolbar */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        display: 'flex', gap: 6, alignItems: 'center',
        padding: '6px 10px',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 20,
        boxShadow: 'var(--shadow-1)',
      }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
          color: 'var(--ink-soft)',
        }}>
          <I.ChevLeft size={11}/> Back to reader
        </button>
        <div style={{ width: 0.5, height: 12, background: 'var(--rule)' }}/>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)' }}>
          5 cards · 4 links
        </div>
      </div>

      <div style={{
        position: 'absolute', top: 12, right: 12, zIndex: 10,
        display: 'flex', gap: 4, alignItems: 'center',
        padding: '4px 8px',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 20,
      }}>
        <button className="icon-btn" onClick={() => setZoom(z => Math.max(0.4, z - 0.1))}><I.ZoomOut size={12}/></button>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-faded)', padding: '0 4px' }}>{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" onClick={() => setZoom(z => Math.min(1.4, z + 0.1))}><I.ZoomIn size={12}/></button>
      </div>

      {/* Cards */}
      <div style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
        width: '100%', height: '100%',
      }}>
        {cards.map(c => (
          <CanvasCard key={c.id} card={c} paper={paper}
            onDragStart={(e) => onMouseDown(e, c.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CanvasCard({ card, paper, onDragStart }) {
  const base = {
    position: 'absolute',
    left: card.x, top: card.y,
    width: card.w, height: card.h,
    background: 'var(--paper)',
    border: '0.5px solid var(--rule)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-1)',
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  };

  const Head = ({ icon, label, accent }) => {
    const Ico = I[icon];
    return (
      <div
        onMouseDown={onDragStart}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px',
          borderBottom: '0.5px solid var(--rule)',
          cursor: 'grab',
          background: 'var(--paper-soft)',
          userSelect: 'none',
        }}
      >
        <Ico size={12} stroke={1.5} style={{ color: accent || 'var(--ink-faded)' }}/>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: accent || 'var(--ink-faded)',
          fontWeight: 600,
        }}>{label}</span>
        <div style={{ flex: 1 }}/>
        <button className="icon-btn" style={{ width: 18, height: 18 }}><I.More size={10}/></button>
      </div>
    );
  };

  if (card.kind === 'paper') return (
    <div style={base}>
      <Head icon="Book" label="Paper"/>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{paper.title}</div>
          <div style={{ fontSize: 10, color: 'var(--ink-faded)', fontStyle: 'italic', marginTop: 4 }}>{paper.authors[0]} et al.</div>
        </div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 11, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
          {paper.paragraphs.slice(0, 4).map((p, i) => <p key={i} style={{ margin: '0 0 8px' }}>{p.text}</p>)}
        </div>
      </div>
    </div>
  );

  if (card.kind === 'why') return (
    <div style={base}>
      <Head icon="Sparkle" label="Why this matters" accent="var(--walnut)"/>
      <div style={{ flex: 1, padding: '12px 14px', fontFamily: 'var(--font-serif)', fontSize: 12, lineHeight: 1.55, color: 'var(--ink)' }}>
        {paper.memory.whyItMatters}
      </div>
    </div>
  );

  if (card.kind === 'summary') return (
    <div style={base}>
      <Head icon="Quote" label="3-line summary"/>
      <div style={{ flex: 1, padding: '12px 14px' }}>
        <ol style={{ margin: 0, paddingLeft: 16, fontFamily: 'var(--font-serif)', fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-soft)' }}>
          <li style={{ marginBottom: 6 }}>A low-rank chunk residual lets a 16k model match a 128k baseline.</li>
          <li style={{ marginBottom: 6 }}>Injected as additive bias to attention logits; attention matrix never grows.</li>
          <li>Fails on repetition-sensitive tasks; scheduler patches most of the gap.</li>
        </ol>
      </div>
    </div>
  );

  if (card.kind === 'linked') return (
    <div style={base}>
      <Head icon="Link" label="Linked context"/>
      <div style={{ flex: 1, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {paper.memory.linked.slice(0, 2).map((l, i) => (
          <div key={i} style={{ fontSize: 11 }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, color: 'var(--ink)' }}>→ {l.title}</div>
            <div style={{ fontSize: 10, color: 'var(--ink-faded)', fontFamily: 'var(--font-mono)' }}>{l.role}</div>
          </div>
        ))}
      </div>
    </div>
  );

  if (card.kind === 'chat') return (
    <div style={base}>
      <Head icon="Chat" label="Chat" accent="var(--sky)"/>
      <div style={{ flex: 1, padding: '12px 14px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ alignSelf: 'flex-end', maxWidth: '80%', padding: '6px 10px', background: 'var(--paper-deep)', borderRadius: '8px 8px 2px 8px', fontSize: 11 }}>
          Where does it fail?
        </div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink)' }}>
          Repetition-sensitive sub-tasks <sup style={{ color: 'var(--walnut)', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9 }}>1</sup>. The low-rank projection averages away signal where you need exact counts.
        </div>
        <div style={{
          padding: '6px 8px', background: 'var(--paper-soft)',
          border: '0.5px solid var(--rule)', borderRadius: 4,
          fontSize: 10,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--walnut)', fontWeight: 600 }}>1 · p. 13 · § 6</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', color: 'var(--ink-faded)' }}>
            "…our low-rank residual averages the signal away."
          </div>
        </div>
      </div>
    </div>
  );

  return <div style={base}/>;
}

window.CanvasView = CanvasView;
