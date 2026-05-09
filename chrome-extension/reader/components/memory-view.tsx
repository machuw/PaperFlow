import { useEffect, useState } from 'react';
import type { Paper } from '../types';
import { I } from './icons';

const ROLE_STANDARDS = [
  'Background',
  'Method reference',
  'Counter-evidence',
  'Tangential',
  'Central',
] as const;

interface Props {
  paper: Paper;
  onPatch: (patch: Partial<Paper['memory']>) => void;
}

/**
 * MemoryView read-only skeleton. Task 17 adds inline editing. Task 18 adds
 * nextActions add/toggle/delete + empty-state CTAs.
 */
export function MemoryView({ paper, onPatch }: Props) {
  const m = paper.memory;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {!m.role.trim() && !m.judgment.trim() && (
        <div
          style={{
            padding: '10px 12px',
            background: 'color-mix(in oklch, var(--walnut) 8%, var(--paper-soft))',
            border: '0.5px solid var(--walnut-soft)',
            borderRadius: 6,
            fontSize: 12, color: 'var(--ink-soft)',
            fontStyle: 'italic', lineHeight: 1.5,
          }}
        >
          Set role and judgment to ground your memory.
        </div>
      )}

      {m.whyItMatters.trim() ? (
        <div
          style={{
            padding: '16px 16px 14px',
            background: 'linear-gradient(180deg, var(--paper-soft) 0%, var(--paper) 100%)',
            border: '0.5px solid var(--rule)',
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--walnut)', marginBottom: 6,
              fontWeight: 600,
            }}
          >Why this matters — for you</div>
          <div
            style={{
              fontFamily: 'var(--font-serif)', fontSize: 14, lineHeight: 1.6,
              color: 'var(--ink)', fontWeight: 500,
            }}
          >{m.whyItMatters}</div>
        </div>
      ) : null}

      <EditableField
        label="Role in your research"
        value={m.role}
        tone="walnut"
        options={[...ROLE_STANDARDS]}
        onSave={(v) => onPatch({ role: v })}
      />

      <EditableField
        label="Your judgment"
        value={m.judgment}
        tone="foxglove"
        onSave={(v) => onPatch({ judgment: v })}
      />

      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <SectionLabel>Linked context</SectionLabel>
          <button
            className="pf-mem-edit-linked"
            onClick={() => {
              // v1: linked editing is out of scope (§10). CmdK falls through
              // to here. Nothing happens beyond highlighting the Memory tab
              // (the CmdK handler already did that).
            }}
            style={{ fontSize: 10, color: 'var(--ink-ghost)' }}
            title="Linked editing in v1.1"
          >(read-only)</button>
        </div>
        {m.linked.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ink-ghost)', fontStyle: 'italic' }}>
            No linked papers yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {m.linked.map((l, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 12px',
                  background: 'var(--paper-soft)',
                  border: '0.5px solid var(--rule)',
                  borderRadius: 6,
                }}
              >
                <div style={{
                  fontFamily: 'var(--font-serif)', fontSize: 13, fontWeight: 600,
                  color: 'var(--ink)',
                }}>{l.title}</div>
                <div style={{
                  marginTop: 2,
                  fontSize: 10, color: 'var(--ink-faded)',
                  fontFamily: 'var(--font-mono)',
                }}>{l.role}</div>
                <div style={{
                  marginTop: 6,
                  fontFamily: 'var(--font-serif)', fontStyle: 'italic',
                  fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5,
                }}>{l.why}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <NextActionsSection actions={m.nextActions} onPatch={onPatch} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: 'var(--ink-faded)', marginBottom: 8,
      }}
    >{children}</div>
  );
}

interface EditableFieldProps {
  label: string;
  value: string;
  tone: 'walnut' | 'foxglove';
  options?: string[];
  onSave: (v: string) => void;
}

function EditableField({ label, value, tone, options, onSave }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const toneColor = tone === 'foxglove' ? 'var(--foxglove)' : 'var(--walnut)';

  // Sync draft when incoming value changes (e.g. after patch round-trip).
  // Only overwrite when not currently editing to avoid clobbering user input.
  // useEffect (not render-time setState) is required — setState during render
  // triggers React's "Cannot update a component while rendering" warning
  // under StrictMode.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const applyOption = (opt: string) => {
    // Format: "{opt} — {freeform suffix}". If draft already had a " — " suffix,
    // preserve it. Otherwise just set draft to "{opt} — ".
    const rest = draft.split(' — ').slice(1).join(' — ');
    setDraft(rest ? `${opt} — ${rest}` : `${opt} — `);
  };

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
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            className={
              label.toLowerCase().includes('role') ? 'pf-mem-edit-role'
              : label.toLowerCase().includes('judgment') ? 'pf-mem-edit-judgment'
              : ''
            }
            style={{
              fontSize: 10, color: 'var(--ink-faded)',
              display: 'flex', alignItems: 'center', gap: 3,
            }}
          ><I.Edit size={10} stroke={1.4} /> edit</button>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            rows={3}
            style={{
              width: '100%', padding: '8px 10px',
              background: 'var(--paper-soft)',
              border: `0.5px solid ${toneColor}`,
              borderRadius: 6,
              fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.55,
              color: 'var(--ink)', resize: 'vertical', outline: 'none',
            }}
          />
          {options && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {options.map((o) => {
                const isSelected = draft.split(' — ', 1)[0].trim() === o;
                return (
                  <button
                    key={o}
                    onClick={() => applyOption(o)}
                    style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 3,
                      border: `0.5px solid ${isSelected ? toneColor : 'var(--rule)'}`,
                      background: isSelected
                        ? `color-mix(in oklch, ${toneColor} 12%, transparent)`
                        : 'transparent',
                      color: isSelected ? toneColor : 'var(--ink-faded)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >{o}</button>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setDraft(value); setEditing(false); }}
              style={{ fontSize: 11, color: 'var(--ink-faded)', padding: '4px 10px' }}
            >Cancel</button>
            <button
              onClick={() => { onSave(draft); setEditing(false); }}
              style={{
                fontSize: 11, padding: '4px 10px',
                background: 'var(--ink)', color: 'var(--paper)',
                borderRadius: 4, fontWeight: 500,
              }}
            >Save</button>
          </div>
        </div>
      ) : (
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.6,
          color: value.trim() ? 'var(--ink)' : 'var(--ink-ghost)',
          padding: '2px 0', fontStyle: value.trim() ? 'normal' : 'italic',
        }}>
          {value.trim() || '(not set)'}
        </div>
      )}
    </section>
  );
}

interface NextActionsProps {
  actions: Paper['memory']['nextActions'];
  onPatch: (patch: Partial<Paper['memory']>) => void;
}

function NextActionsSection({ actions, onPatch }: NextActionsProps) {
  const [draft, setDraft] = useState('');

  const toggle = (i: number) => {
    const next = actions.map((a, j) => (j === i ? { ...a, done: !a.done } : a));
    onPatch({ nextActions: next });
  };

  const remove = (i: number) => {
    onPatch({ nextActions: actions.filter((_, j) => j !== i) });
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onPatch({ nextActions: [...actions, { text, done: false }] });
    setDraft('');
  };

  return (
    <section>
      <SectionLabel>Next actions</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {actions.map((a, i) => (
          <div
            key={i}
            className="nx-row"
            style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              padding: '8px 10px',
              background: 'var(--paper-soft)',
              border: '0.5px solid var(--rule)',
              borderRadius: 6,
              fontFamily: 'var(--font-serif)', fontSize: 12.5, lineHeight: 1.5,
              color: 'var(--ink-soft)',
            }}
          >
            <input
              type="checkbox"
              checked={a.done}
              onChange={() => toggle(i)}
              style={{ marginTop: 3, cursor: 'pointer' }}
            />
            <span style={{ flex: 1, textDecoration: a.done ? 'line-through' : 'none' }}>{a.text}</span>
            <button
              className="nx-del"
              onClick={() => remove(i)}
              title="Remove action"
              style={{
                color: 'var(--ink-faded)',
                padding: 0, marginLeft: 6, fontSize: 14, lineHeight: 1,
              }}
            >×</button>
          </div>
        ))}
        <div
          style={{
            display: 'flex', gap: 6, alignItems: 'center',
            padding: '6px 10px',
            background: 'var(--paper-soft)',
            border: '0.5px dashed var(--rule)',
            borderRadius: 6,
          }}
        >
          <I.Plus size={11} stroke={1.5} style={{ color: 'var(--ink-faded)' }} />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="Add action…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontFamily: 'var(--font-serif)', fontSize: 12.5, color: 'var(--ink)',
            }}
          />
          {draft.trim() && (
            <button
              onClick={add}
              style={{
                fontSize: 11, padding: '2px 8px',
                background: 'var(--ink)', color: 'var(--paper)',
                borderRadius: 3,
              }}
            >Add</button>
          )}
        </div>
      </div>
    </section>
  );
}
