// Chat + Memory views for the Workspace panel

function ChatView({ paper }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant', id: 'm0',
      text: "I've read the paper. Ask anything — I'll cite paragraphs inline.",
      suggestions: [
        "What's the core mechanism?",
        "How does this compare to Landmark Attention?",
        "Where does it fail?",
      ],
    },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollTo({ top: endRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  const send = (text) => {
    const q = (text || input).trim();
    if (!q) return;
    const userMsg = { role: 'user', id: 'u' + Date.now(), text: q };
    const aiId = 'a' + Date.now();
    setMessages(m => [...m, userMsg, { role: 'assistant', id: aiId, text: '', citations: [] }]);
    setInput('');
    setStreaming(aiId);

    // Fake streamed answer with citations
    const answer = pickAnswer(q);
    let i = 0;
    const tick = () => {
      i += Math.max(2, Math.floor(Math.random() * 6));
      setMessages(m => m.map(msg => msg.id === aiId ? { ...msg, text: answer.text.slice(0, i), citations: i > answer.text.length - 30 ? answer.citations : [] } : msg));
      if (i < answer.text.length) {
        setTimeout(tick, 20 + Math.random() * 40);
      } else {
        setStreaming(null);
      }
    };
    setTimeout(tick, 280);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div ref={endRef} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 4 }}>
        {messages.map(m => <ChatMessage key={m.id} msg={m} streaming={streaming === m.id} onSuggest={send}/>)}
      </div>

      <ChatComposer input={input} setInput={setInput} onSend={() => send()} disabled={!!streaming}/>
    </div>
  );
}

function ChatMessage({ msg, streaming, onSuggest }) {
  if (msg.role === 'user') {
    return (
      <div style={{
        alignSelf: 'flex-end', maxWidth: '85%',
        padding: '8px 12px',
        background: 'var(--paper-deep)',
        border: '0.5px solid var(--rule)',
        borderRadius: '10px 10px 2px 10px',
        fontSize: 13, lineHeight: 1.5,
        fontFamily: 'var(--font-sans)',
        color: 'var(--ink)',
        animation: 'fade-up 140ms',
      }}>
        {msg.text}
      </div>
    );
  }
  return (
    <div style={{ maxWidth: '94%', animation: 'fade-up 180ms' }}>
      <div style={{
        fontFamily: 'var(--font-serif)', fontSize: 13.5, lineHeight: 1.65,
        color: 'var(--ink)',
      }} className={streaming ? 'ink-streaming' : ''}>
        {renderWithCitations(msg.text, msg.citations)}
      </div>
      {msg.citations?.length > 0 && !streaming && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {msg.citations.map((c, i) => <CitationCard key={i} n={i + 1} cite={c}/>)}
        </div>
      )}
      {msg.suggestions && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {msg.suggestions.map(s => (
            <button
              key={s}
              onClick={() => onSuggest(s)}
              style={{
                textAlign: 'left',
                padding: '6px 10px',
                background: 'var(--paper-soft)',
                border: '0.5px solid var(--rule)',
                borderRadius: 6,
                fontFamily: 'var(--font-serif)', fontSize: 12,
                fontStyle: 'italic',
                color: 'var(--ink-soft)',
                transition: 'background 120ms, border-color 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-deep)'; e.currentTarget.style.borderColor = 'var(--walnut-soft)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--paper-soft)'; e.currentTarget.style.borderColor = 'var(--rule)'; }}
            >
              → {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function renderWithCitations(text, citations) {
  if (!citations || !citations.length) return text;
  // Replace [1] [2] etc with superscript
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/\[(\d+)\]/);
    if (m) {
      return <sup key={i} style={{
        fontSize: 10, fontFamily: 'var(--font-mono)',
        color: 'var(--walnut)', cursor: 'pointer', padding: '0 2px',
        fontWeight: 600,
      }}>{m[1]}</sup>;
    }
    return p;
  });
}

function CitationCard({ n, cite }) {
  return (
    <div style={{
      display: 'flex', gap: 8,
      padding: '6px 10px',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 5,
      fontSize: 11,
      cursor: 'pointer',
      transition: 'border-color 120ms',
    }}
    onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--walnut-soft)'}
    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--rule)'}
    >
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--walnut)', fontWeight: 600,
        width: 16, textAlign: 'center', flexShrink: 0,
      }}>{n}</div>
      <div style={{ flex: 1 }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          color: 'var(--ink-faded)', lineHeight: 1.4,
        }}>"{cite.quote}"</div>
        <div style={{
          marginTop: 3,
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--ink-ghost)', letterSpacing: '0.04em',
        }}>
          {cite.loc}
        </div>
      </div>
      <I.ArrowRight size={11} style={{ color: 'var(--ink-faded)', marginTop: 2 }}/>
    </div>
  );
}

function ChatComposer({ input, setInput, onSend, disabled }) {
  return (
    <div style={{
      border: '0.5px solid var(--rule)',
      borderRadius: 10,
      background: 'var(--paper-soft)',
      padding: '8px 10px 6px',
      display: 'flex', flexDirection: 'column', gap: 6,
      transition: 'border-color 120ms',
    }}
    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--walnut-soft)'}
    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--rule)'}
    >
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
        placeholder="Ask about this paper…"
        rows={2}
        style={{
          width: '100%', border: 'none', outline: 'none',
          background: 'none', resize: 'none',
          fontFamily: 'var(--font-sans)', fontSize: 13,
          color: 'var(--ink)', lineHeight: 1.5,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ScopeChip label="Full paper" />
        <span style={{ fontSize: 10, color: 'var(--ink-ghost)', fontFamily: 'var(--font-mono)' }}>14 chunks</span>
        <div style={{ flex: 1 }}/>
        <button
          onClick={onSend}
          disabled={disabled || !input.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px',
            fontSize: 11, fontWeight: 500,
            background: disabled || !input.trim() ? 'var(--paper-deep)' : 'var(--ink)',
            color: disabled || !input.trim() ? 'var(--ink-ghost)' : 'var(--paper)',
            borderRadius: 6,
            transition: 'background 120ms',
          }}
        >
          Send <kbd style={{ fontSize: 9, opacity: 0.6, fontFamily: 'var(--font-mono)' }}>↵</kbd>
        </button>
      </div>
    </div>
  );
}

function ScopeChip({ label }) {
  return (
    <button style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '3px 7px',
      background: 'var(--paper-deep)',
      border: '0.5px solid var(--rule)',
      borderRadius: 4,
      fontSize: 10, fontFamily: 'var(--font-mono)',
      color: 'var(--ink-soft)',
    }}>
      <I.Layers size={10} stroke={1.4}/>
      {label}
      <I.ChevDown size={9} stroke={1.4}/>
    </button>
  );
}

function pickAnswer(q) {
  const ql = q.toLowerCase();
  if (ql.includes('fail') || ql.includes('limit') || ql.includes('weak')) {
    return {
      text: "The honest failure mode is repetition-sensitive tasks [1]. When the correct answer requires noticing that a token appeared exactly three times at specific offsets, the low-rank residual averages the signal away. §3.3's scheduler defers retrieval on such sub-tasks and recovers most of the gap [2], but the authors themselves call it future work.",
      citations: [
        { quote: "when a correct answer requires noticing that a token appeared exactly three times at specific offsets, our low-rank residual averages the signal away", loc: "p. 13 · §6 Discussion · ¶ p9" },
        { quote: "The scheduler in § 3.3 mitigates this by deferring retrieval on such sub-tasks", loc: "p. 13 · §6 Discussion · ¶ p9" },
      ],
    };
  }
  if (ql.includes('landmark') || ql.includes('compare')) {
    return {
      text: "Both store something per chunk, but the mechanisms differ. Landmark Attention appoints discrete token-landmarks that regular attention can then hit; Contextual Residuals instead stores a low-rank projection and injects it as an additive bias to attention logits [1], which keeps the attention matrix the same shape and avoids growing the window.",
      citations: [
        { quote: "we inject it directly into the attention mechanism ... keeps the attention matrix the same shape", loc: "p. 6 · §3.2 · ¶ p6" },
      ],
    };
  }
  return {
    text: "The core mechanism is a decomposition [1]: attention stays short-range, and a separate low-rank residual per chunk handles long-range recall. The residual is stored once at training time and retrieved at inference as a bias to attention logits [2] — so the attention matrix never grows. On LongBench-v2 they close 94 % of the gap to a 128k baseline using 1/8 the FLOPs [3].",
    citations: [
      { quote: "Attention is already an excellent short-range associative memory; it fails long-range chiefly because the signal it would need to retrieve has been averaged away", loc: "p. 1 · §1 · ¶ p2" },
      { quote: "we inject it directly into the attention mechanism", loc: "p. 6 · §3.2 · ¶ p6" },
      { quote: "closes 94 % of the quality gap while requiring 1/8th the attention FLOPs per token", loc: "p. 8 · §4.1 · ¶ p7" },
    ],
  };
}

// ========== Memory view ==========
function MemoryView({ paper }) {
  const m = paper.memory;
  const [role, setRole] = useState(m.role);
  const [editingRole, setEditingRole] = useState(false);
  const [judgment, setJudgment] = useState(m.judgment);
  const [editingJudgment, setEditingJudgment] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Why it matters — headline */}
      <div style={{
        padding: '16px 16px 14px',
        background: 'linear-gradient(180deg, var(--paper-soft) 0%, var(--paper) 100%)',
        border: '0.5px solid var(--rule)',
        borderRadius: 8,
        position: 'relative',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--walnut)', marginBottom: 6,
          fontWeight: 600,
        }}>
          Why this matters — for you
        </div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 14, lineHeight: 1.6,
          color: 'var(--ink)', fontWeight: 500,
        }}>
          {m.whyItMatters}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
          <MiniBtn icon="Check" label="Keep"/>
          <MiniBtn icon="Edit" label="Rewrite"/>
          <MiniBtn icon="Close" label="Doesn't fit"/>
        </div>
      </div>

      {/* Role + Judgment — side by side */}
      <MemoryField
        label="Role in your research"
        value={role}
        editing={editingRole}
        onEdit={() => setEditingRole(true)}
        onSave={(v) => { setRole(v); setEditingRole(false); }}
        options={['Background', 'Method reference', 'Counter-evidence', 'Tangential', 'Central']}
      />
      <MemoryField
        label="Your judgment"
        value={judgment}
        editing={editingJudgment}
        onEdit={() => setEditingJudgment(true)}
        onSave={(v) => { setJudgment(v); setEditingJudgment(false); }}
        tone="foxglove"
      />

      {/* Linked context */}
      <section>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-faded)', marginBottom: 8,
        }}>Linked context</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {m.linked.map((l, i) => <LinkedCard key={i} link={l}/>)}
        </div>
      </section>

      {/* Next actions */}
      <section>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-faded)', marginBottom: 8,
        }}>Next actions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {m.nextActions.map((a, i) => (
            <label key={i} style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              padding: '8px 10px',
              background: 'var(--paper-soft)',
              border: '0.5px solid var(--rule)',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'var(--font-serif)', fontSize: 12.5, lineHeight: 1.5,
              color: 'var(--ink-soft)',
            }}>
              <input type="checkbox" style={{ marginTop: 3 }}/>
              <span style={{ flex: 1 }}>{a}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function MemoryField({ label, value, editing, onEdit, onSave, options, tone }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const toneColor = tone === 'foxglove' ? 'var(--foxglove)' : 'var(--walnut)';

  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-faded)',
        }}>{label}</div>
        {!editing && (
          <button onClick={onEdit} style={{
            fontSize: 10, color: 'var(--ink-faded)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <I.Edit size={10} stroke={1.4}/> edit
          </button>
        )}
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'var(--paper-soft)',
              border: `0.5px solid ${toneColor}`,
              borderRadius: 6,
              fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.55,
              color: 'var(--ink)', resize: 'vertical',
              outline: 'none',
            }}
            rows={3}
          />
          {options && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {options.map(o => (
                <button key={o} onClick={() => setDraft(o + ' — ' + draft.split(' — ').slice(1).join(' — '))} style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 3,
                  border: '0.5px solid var(--rule)',
                  color: 'var(--ink-faded)',
                  fontFamily: 'var(--font-mono)',
                }}>{o}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => onSave(value)} style={{ fontSize: 11, color: 'var(--ink-faded)', padding: '4px 10px' }}>Cancel</button>
            <button onClick={() => onSave(draft)} style={{
              fontSize: 11, padding: '4px 10px',
              background: 'var(--ink)', color: 'var(--paper)',
              borderRadius: 4, fontWeight: 500,
            }}>Save</button>
          </div>
        </div>
      ) : (
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.6,
          color: 'var(--ink)',
          padding: '2px 0',
        }}>
          {value}
        </div>
      )}
    </section>
  );
}

function LinkedCard({ link }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 6,
      cursor: 'pointer',
      transition: 'border-color 120ms, background 120ms',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--walnut-soft)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--rule)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <I.Link size={11} stroke={1.4} style={{ color: 'var(--walnut)', transform: 'translateY(2px)' }}/>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            {link.title}
          </div>
          <div style={{
            fontSize: 10, color: 'var(--ink-faded)',
            fontFamily: 'var(--font-mono)', marginTop: 2,
          }}>
            {link.role}
          </div>
        </div>
      </div>
      <div style={{
        marginTop: 6,
        paddingLeft: 19,
        fontFamily: 'var(--font-serif)', fontStyle: 'italic',
        fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5,
      }}>
        {link.why}
      </div>
    </div>
  );
}

function MiniBtn({ icon, label }) {
  const Ico = I[icon];
  return (
    <button style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', fontSize: 11,
      background: 'var(--paper)',
      border: '0.5px solid var(--rule)',
      borderRadius: 4,
      color: 'var(--ink-soft)',
      transition: 'background 120ms, border-color 120ms',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-deep)'; e.currentTarget.style.borderColor = 'var(--walnut-soft)';}}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--paper)'; e.currentTarget.style.borderColor = 'var(--rule)';}}
    >
      <Ico size={11} stroke={1.4}/>
      {label}
    </button>
  );
}

window.ChatView = ChatView;
window.MemoryView = MemoryView;
