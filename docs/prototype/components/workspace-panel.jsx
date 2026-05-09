// AI Workspace — right-side panel with Summary / Chat / Memory tabs
function WorkspacePanel({ paper, tab, setTab, streamingKey, onStreamDone, results, setResults }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper)',
      borderLeft: '0.5px solid var(--rule)',
    }}>
      <WorkspaceTabs tab={tab} setTab={setTab} />
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
        {tab === 'summary' && <SummaryView paper={paper} streamingKey={streamingKey} onStreamDone={onStreamDone} results={results}/>}
        {tab === 'chat' && <ChatView paper={paper} />}
        {tab === 'memory' && <MemoryView paper={paper} />}
      </div>
    </div>
  );
}

function WorkspaceTabs({ tab, setTab }) {
  const tabs = [
    { id: 'summary', label: 'Abstract', icon: 'Sparkle' },
    { id: 'chat', label: 'Chat', icon: 'Chat' },
    { id: 'memory', label: 'Memory', icon: 'Memory' },
  ];
  return (
    <div style={{
      display: 'flex',
      padding: '10px 12px 0',
      borderBottom: '0.5px solid var(--rule)',
      gap: 4,
    }}>
      {tabs.map(t => {
        const Ico = I[t.icon];
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 12px 9px',
              fontSize: 12,
              fontWeight: 500,
              color: active ? 'var(--ink)' : 'var(--ink-faded)',
              borderBottom: `1.5px solid ${active ? 'var(--walnut)' : 'transparent'}`,
              marginBottom: -0.5,
              transition: 'color 120ms',
            }}
          >
            <Ico size={13} stroke={1.6}/>
            {t.label}
          </button>
        );
      })}
      <div style={{ flex: 1 }}/>
      <button className="icon-btn" title="More">
        <I.More size={14}/>
      </button>
    </div>
  );
}

// ========== Summary ==========
const SUMMARY_BLOCKS = {
  keyTerms: [
    { term: 'Contextual Residuals', def: 'Low-rank per-chunk memory injected as attention bias.' },
    { term: 'Retrieval as attention bias', def: 'Instead of concatenating retrieved tokens, add a scalar bias to attention logits.' },
    { term: 'LongBench-v2', def: 'Benchmark for long-context comprehension; v2 emphasizes selective recall.' },
  ],
  threeLine: [
    "A low-rank chunk residual, stored cheaply, lets a 16k-context model match a 128k baseline on LongBench-v2.",
    "The residual is injected as an additive bias to attention logits, so the attention matrix never grows.",
    "Fails on repetition-sensitive tasks; a scheduler that defers retrieval recovers most of the gap.",
  ],
  detailed: "The paper decomposes long-context recall into two problems: (a) where to put information the attention window can't hold, and (b) how to bring it back without paying attention's quadratic cost. Rather than widening attention, the authors store a low-rank projection of each past chunk and, at inference, retrieve the top-m relevant residuals and add them as a bias to the attention logits. The attention matrix keeps its shape; only the bias changes.\n\nEmpirically, this closes 94 % of the quality gap to a 128k baseline on LongBench-v2 while using 1/8th the attention FLOPs. The method's weakness is honest and specific: repetition-sensitive sub-tasks where the low-rank projection averages away the signal you need to count. §3.3's scheduler patches this but the fix feels heuristic.",
};

function SummaryView({ paper, streamingKey, onStreamDone, results }) {
  // Show selection-triggered result at the top, if any
  const latest = results[results.length - 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {latest && (
        <SelectionResultCard
          key={latest.id}
          result={latest}
          streamingKey={streamingKey === latest.id ? latest.id : null}
          onDone={onStreamDone}
        />
      )}

      <SummarySection title="Three-line summary" refreshable>
        <ol style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SUMMARY_BLOCKS.threeLine.map((t, i) => (
            <li key={i} style={{
              fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.55,
              color: 'var(--ink-soft)',
            }}>{t}</li>
          ))}
        </ol>
      </SummarySection>

      <SummarySection title="Key terms">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {SUMMARY_BLOCKS.keyTerms.map((t, i) => (
            <div key={i}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
                {t.term}
              </div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 12, color: 'var(--ink-faded)', lineHeight: 1.5 }}>
                {t.def}
              </div>
            </div>
          ))}
        </div>
      </SummarySection>

      <SummarySection title="Detailed summary" refreshable>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.7,
          color: 'var(--ink-soft)', whiteSpace: 'pre-wrap',
        }}>
          {SUMMARY_BLOCKS.detailed}
        </div>
      </SummarySection>

      <ContextIndicator />
    </div>
  );
}

function SummarySection({ title, children, refreshable }) {
  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-faded)',
        }}>
          {title}
        </div>
        {refreshable && (
          <button className="icon-btn" title="Regenerate" style={{ width: 22, height: 22 }}>
            <I.Refresh size={11} stroke={1.4}/>
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function ContextIndicator() {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 11, color: 'var(--ink-faded)',
    }}>
      <I.Layers size={12} stroke={1.4}/>
      <span style={{ flex: 1 }}>
        Generated from <strong style={{ color: 'var(--ink-soft)' }}>full paper</strong> · 14 chunks · via <span style={{ fontFamily: 'var(--font-mono)' }}>gpt-4.1-mini</span>
      </span>
      <button style={{ fontSize: 11, color: 'var(--walnut)' }}>Change</button>
    </div>
  );
}

// ========== Selection result card (with streaming) ==========
function SelectionResultCard({ result, streamingKey, onDone }) {
  const [shown, setShown] = useState(streamingKey ? '' : result.body);
  const full = result.body;

  useEffect(() => {
    if (!streamingKey) return;
    let i = 0;
    const step = () => {
      i += Math.max(2, Math.floor(Math.random() * 5));
      setShown(full.slice(0, i));
      if (i < full.length) {
        rafId = requestAnimationFrame(step);
      } else {
        onDone && onDone();
      }
    };
    let rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [streamingKey, full]);

  const tone = {
    explain: { label: 'Explain', color: 'var(--sky)' },
    summarize: { label: 'Summarize', color: 'var(--walnut)' },
    translate: { label: 'Translate', color: 'var(--forest)' },
    ask: { label: 'Ask', color: 'var(--foxglove)' },
  }[result.kind] || { label: result.kind, color: 'var(--walnut)' };

  const streaming = streamingKey === result.id;

  return (
    <div style={{
      padding: '14px 14px',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 8,
      animation: 'fade-up 180ms ease-out',
      position: 'relative',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: 6, background: tone.color,
          animation: streaming ? 'pulse-ink 1.1s infinite' : 'none',
        }}/>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: tone.color, fontWeight: 600,
        }}>{tone.label}</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-ghost)',
        }}>· page {result.page} · ¶ {result.paragraphRef}</span>
        <div style={{ flex: 1 }}/>
        <button className="icon-btn" style={{ width: 20, height: 20 }}><I.Copy size={10}/></button>
        <button className="icon-btn" style={{ width: 20, height: 20 }}><I.Close size={10}/></button>
      </div>

      {/* Quoted source — always visible so reference is never lost */}
      <blockquote style={{
        margin: '0 0 10px',
        padding: '4px 10px',
        borderLeft: '2px solid var(--walnut-soft)',
        fontFamily: 'var(--font-serif)', fontSize: 11.5,
        fontStyle: 'italic', color: 'var(--ink-faded)',
        lineHeight: 1.5,
      }}>
        "{result.source}"
      </blockquote>

      <div style={{
        fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.65,
        color: 'var(--ink)',
      }} className={streaming ? 'ink-streaming' : ''}>
        {shown}
      </div>
    </div>
  );
}

window.WorkspacePanel = WorkspacePanel;
window.SelectionResultCard = SelectionResultCard;
