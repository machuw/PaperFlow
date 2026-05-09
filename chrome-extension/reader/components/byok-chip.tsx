/**
 * Phase 19 (PICKER-03): BYOKChip is now a thin shell — chip pill + open state +
 * click-outside / esc handlers + DOM anchor for ModelPicker. All popover JSX
 * (system/BYOK rows + bottom CTA) lives in <ModelPicker /> as the controlled
 * child component (per D-CD-05).
 *
 * Phase 19 1-commit hard cutover (T-19-01): the `onChipClick` zero-active
 * short-circuit (former lines 147-150 — opened the Options page directly when
 * no BYOK was active) is DELETED here in the SAME commit that introduces
 * ModelPicker. Without this delete, 0-active users would bypass the unified
 * popover entirely.
 *
 * Chip text 4-fork (PICKER-04) driven by useActiveModel():
 *   - active.kind === 'managed' → managed display_name
 *   - active.kind === 'byok'    → BYOK config name
 *   - active.kind === 'none'    → 'topbar.model-picker.chip.empty' (signed-in, 0-config)
 *   - active.kind === 'loading' → empty string (chip pill still occupies layout)
 *
 * No more direct subscription to byok-configs Realtime / health cache —
 * those move to ModelPicker (the only consumer post-collapse).
 */

import { useEffect, useRef, useState } from 'react';
import { useActiveModel } from '../lib/use-active-model';
import { useT } from '../lib/i18n';
import { ModelPicker } from './model-picker';
import { I } from './icons';
import '../styles/byok-chip.css';

export function BYOKChip() {
  const t = useT();
  const active = useActiveModel();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  // 19-02 A11Y-04: chip button ref threaded to ModelPicker for RAF focus-return on close.
  const chipBtnRef = useRef<HTMLButtonElement>(null);

  // ── Click-outside-to-close (kept verbatim from previous lines 127-134) ──
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // ── Esc-to-close (kept verbatim from previous lines 137-144) ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // ── onChipClick — Phase 19 hard cutover: short-circuit DELETED ──
  // The former zero-active short-circuit block (former lines 147-150 — opened
  // the Options page directly when no BYOK was active) is intentionally
  // absent. ModelPicker handles the 0-active empty state internally per D-B7.
  function onChipClick() {
    setOpen((v) => !v);
  }

  // PICKER-04 chip 4-fork text from useActiveModel discriminated union
  const chipLabel =
    active.kind === 'loading'
      ? ''
      : active.kind === 'managed'
        ? active.display || t('topbar.model-picker.chip.empty')
        : active.kind === 'byok'
          ? active.display || t('topbar.model-picker.chip.empty')
          : /* none */ t('topbar.model-picker.chip.empty');

  // PICKER-05 — full name in aria-label/title; chip CSS truncates with ellipsis
  const chipAria =
    active.kind === 'managed' && active.raw
      ? `${active.raw.display_name} (${active.raw.id})`
      : active.kind === 'byok' && active.raw
        ? `${active.raw.name} · ${active.raw.base_url} · ${active.raw.model}`
        : t('topbar.model-picker.chip.empty');

  // chip-state: 'empty' (none) / 'active' (open) / 'default' (closed + has active)
  const chipDataState =
    active.kind === 'none' || active.kind === 'loading'
      ? 'empty'
      : open
        ? 'active'
        : 'default';

  return (
    <div ref={anchorRef} className="byok-chip-anchor">
      <button
        ref={chipBtnRef}
        type="button"
        className="byok-chip"
        data-state={chipDataState}
        onClick={onChipClick}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={chipAria}
        title={chipAria}
        style={{
          maxWidth: 220,
          textOverflow: 'ellipsis',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }} // PICKER-05
      >
        <span className="byok-chip-label">{chipLabel}</span>
        {(active.kind === 'managed' || active.kind === 'byok') && (
          <I.ChevronDown size={10} stroke={1.5} className="byok-chip-chevron" />
        )}
      </button>

      <ModelPicker
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchorRef.current}
        chipButtonRef={chipBtnRef}
      />
    </div>
  );
}
