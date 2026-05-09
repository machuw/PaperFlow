// Selection floating toolbar — appears on text selection
function SelectionToolbar({ selection, onAction, onClose }) {
  if (!selection) return null;
  const { rect } = selection;
  const top = Math.max(rect.top - 44, 8);
  const left = Math.min(Math.max(rect.left + rect.width / 2, 120), 540);

  const actions = [
    { id: 'explain',   label: 'Explain',    icon: 'Sparkle',   kbd: 'E' },
    { id: 'summarize', label: 'Summarize',  icon: 'Quote',     kbd: 'S' },
    { id: 'translate', label: 'Translate',  icon: 'Translate', kbd: 'T' },
    { id: 'highlight', label: 'Highlight',  icon: 'Highlight', kbd: 'H' },
    { id: 'ask',       label: 'Ask about…', icon: 'Chat',      kbd: '?' },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        top, left,
        transform: 'translateX(-50%)',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 999,
        boxShadow: 'var(--shadow-2)',
        padding: '4px 4px',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        zIndex: 100,
        animation: 'fade-up 140ms cubic-bezier(0.2, 0.9, 0.3, 1)',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {actions.map((a, i) => {
        const Ico = I[a.icon];
        return (
          <button
            key={a.id}
            onClick={() => onAction(a.id, selection)}
            title={`${a.label} (${a.kbd})`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px',
              borderRadius: 999,
              color: 'var(--ink-soft)',
              fontSize: 12,
              fontWeight: 500,
              transition: 'background 120ms, color 120ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-deep)'; e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-soft)'; }}
          >
            <Ico size={13} stroke={1.6}/>
            {a.label}
          </button>
        );
      })}
      <div style={{ width: 1, height: 14, background: 'var(--rule)', margin: '0 2px' }}/>
      <button className="icon-btn" onClick={onClose} style={{ width: 24, height: 24 }}>
        <I.Close size={12} />
      </button>
    </div>
  );
}

window.SelectionToolbar = SelectionToolbar;
