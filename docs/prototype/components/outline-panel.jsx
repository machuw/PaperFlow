// Outline sidebar
function OutlinePanel({ paper, active, onJump, collapsed, onToggleCollapse }) {
  const [q, setQ] = useState('');
  const filtered = paper.outline.filter(o => o.label.toLowerCase().includes(q.toLowerCase()));

  if (collapsed) return null;

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper)',
      borderRight: '0.5px solid var(--rule)',
    }}>
      {/* Paper card */}
      <div style={{ padding: '14px 14px 12px', borderBottom: '0.5px solid var(--rule)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-faded)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
          Currently reading
        </div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: 'var(--ink)', marginBottom: 6 }}>
          {paper.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-faded)', fontStyle: 'italic', fontFamily: 'var(--font-serif)' }}>
          {paper.authors[0]} et al. · {paper.venue.split(' ')[0]}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <RoleChip label="Background" />
          <TopicChip label="long-context" />
          <TopicChip label="retrieval" />
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '10px 12px 6px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px',
          background: 'var(--paper-deep)',
          borderRadius: 6,
          border: '0.5px solid transparent',
        }}>
          <I.Search size={12} stroke={1.4} style={{ color: 'var(--ink-faded)' }}/>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to section…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--ink)',
            }}
          />
          <kbd style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--ink-faded)',
            padding: '1px 4px', background: 'var(--paper)', borderRadius: 3,
            border: '0.5px solid var(--rule)',
          }}>⌘K</kbd>
        </div>
      </div>

      {/* Outline */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0 12px' }}>
        {filtered.map(item => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              onClick={() => onJump(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%',
                padding: `5px 12px 5px ${12 + item.level * 14}px`,
                textAlign: 'left',
                fontSize: 12,
                color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
                fontWeight: isActive ? 600 : 400,
                fontFamily: item.level === 0 ? 'var(--font-sans)' : 'var(--font-serif)',
                position: 'relative',
                lineHeight: 1.35,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-deep)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {isActive && (
                <div style={{
                  position: 'absolute', left: 0, top: 6, bottom: 6, width: 2,
                  background: 'var(--walnut)', borderRadius: 2,
                }}/>
              )}
              <span style={{ flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {item.label}
              </span>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-ghost)' }}>
                {item.page}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer — reading progress */}
      <div style={{
        padding: '10px 14px',
        borderTop: '0.5px solid var(--rule)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)' }}>
          Page 1 / 18
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faded)' }}>
          ~42 min
        </div>
      </div>
    </div>
  );
}

function RoleChip({ label }) {
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--font-mono)',
      padding: '2px 6px',
      background: 'color-mix(in oklch, var(--walnut) 15%, transparent)',
      color: 'var(--walnut)',
      borderRadius: 3,
      letterSpacing: '0.02em',
    }}>{label}</span>
  );
}

function TopicChip({ label }) {
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--font-mono)',
      padding: '2px 6px',
      color: 'var(--ink-faded)',
      borderRadius: 3,
      border: '0.5px solid var(--rule)',
    }}>#{label}</span>
  );
}

window.OutlinePanel = OutlinePanel;
window.RoleChip = RoleChip;
window.TopicChip = TopicChip;
