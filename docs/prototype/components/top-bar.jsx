// Top toolbar, Library drawer, Command palette, Tweaks panel, Margin notes

function TopBar({ paper, onOpenLibrary, onOpenCmdK, onOpenTweaks, onToggleOutline, onToggleWorkspace, outlineOpen, workspaceOpen, variant, setVariant, theme, toggleTheme }) {
  return (
    <div style={{
      height: 42, flexShrink: 0,
      background: 'var(--paper)',
      borderBottom: '0.5px solid var(--rule)',
      display: 'flex', alignItems: 'center', padding: '0 8px',
      gap: 2,
    }}>
      {/* Left — logo + sidebar toggle */}
      <button
        className="icon-btn"
        onClick={onToggleOutline}
        title="Toggle outline (⌘\\)"
        style={outlineOpen ? { color: 'var(--ink)' } : {}}
      >
        <I.Sidebar size={15}/>
      </button>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 4px',
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: 4,
          background: 'var(--ink)', color: 'var(--paper)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-serif)', fontSize: 12, fontWeight: 700,
          fontStyle: 'italic',
        }}>P</div>
        <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: '-0.01em' }}>PaperFlow</span>
      </div>

      <div style={{ width: 0.5, height: 18, background: 'var(--rule)', margin: '0 4px' }}/>

      <button
        onClick={onOpenLibrary}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px', borderRadius: 5,
          fontSize: 12, color: 'var(--ink-soft)',
          transition: 'background 120ms',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-deep)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <I.Library size={13} stroke={1.4}/>
        Library
      </button>

      {/* Breadcrumb — current paper */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 12px',
          background: 'var(--paper-soft)',
          border: '0.5px solid var(--rule)',
          borderRadius: 999,
          maxWidth: 520, minWidth: 0,
        }}>
          <I.Book size={12} stroke={1.4} style={{ color: 'var(--ink-faded)', flexShrink: 0 }}/>
          <span style={{
            fontSize: 12, color: 'var(--ink-soft)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          }}>
            {paper.title}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-ghost)', flexShrink: 0 }}>
            p. 1/18
          </span>
        </div>
      </div>

      {/* Right */}
      <button
        onClick={onOpenCmdK}
        className="icon-btn"
        title="Command (⌘K)"
      >
        <I.Command size={14}/>
      </button>

      {/* Layout variant switcher */}
      <VariantSwitcher variant={variant} setVariant={setVariant}/>

      <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
        {theme === 'dark' ? <I.Sun size={14}/> : <I.Moon size={14}/>}
      </button>

      <button className="icon-btn" onClick={onOpenTweaks} title="Tweaks">
        <I.Settings size={14}/>
      </button>

      <button
        className="icon-btn active"
        onClick={onToggleWorkspace}
        title="Toggle AI workspace"
        style={workspaceOpen ? {} : { color: 'var(--ink-faded)', background: 'transparent' }}
      >
        <I.Sparkle size={14}/>
      </button>
    </div>
  );
}

function VariantSwitcher({ variant, setVariant }) {
  const opts = [
    { id: 'summary', label: 'Summary', icon: 'Book' },
    { id: 'classic', label: 'Classic', icon: 'Grid' },
    { id: 'canvas',  label: 'Canvas',  icon: 'Layers' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 5,
      padding: 2,
      margin: '0 4px',
    }}>
      {opts.map(o => {
        const Ico = I[o.icon];
        const active = variant === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setVariant(o.id)}
            title={`${o.label} layout`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 3,
              fontSize: 11,
              color: active ? 'var(--ink)' : 'var(--ink-faded)',
              background: active ? 'var(--paper)' : 'transparent',
              boxShadow: active ? 'var(--shadow-1)' : 'none',
              transition: 'all 120ms',
              fontWeight: active ? 600 : 400,
            }}
          >
            <Ico size={11} stroke={1.5}/>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

window.TopBar = TopBar;
