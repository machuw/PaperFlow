// chrome-extension/reader/components/conflict-modal.tsx
//
// Phase C Task C2 — M2 conflict resolution modal shown when local AND
// cloud both have papers after login. User chooses merge (default) /
// local-only (destructive on cloud) / cloud-only (destructive on local).
// Spec §7.3 + §14.2.

import { useEffect, useRef } from 'react'
import { trapFocus } from '../lib/focus-trap'
import { t, useT } from '../lib/i18n'
import '../styles/conflict-modal.css'

type Stats = { local: number; cloud: number; overlap: number }

export function ConflictModal({
  stats,
  onChoose,
  onClose,
}: {
  stats: Stats
  onChoose: (c: 'merge' | 'local' | 'cloud') => void
  onClose: () => void
}) {
  useT()  // re-render on locale change
  const firstFocus = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => { firstFocus.current?.focus() }, [])

  useEffect(() => {
    if (!panelRef.current) return
    return trapFocus(panelRef.current)
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const lostCloud = Math.max(0, stats.cloud - stats.overlap)
  const lostLocal = Math.max(0, stats.local - stats.overlap)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
      className="conflict-modal-backdrop"
      onClick={onClose}
    >
      <div ref={panelRef} className="conflict-modal-panel" onClick={e => e.stopPropagation()}>
        <h2 id="conflict-title" className="conflict-modal-title">
          {t('migration.conflict.title')}
        </h2>

        <div className="conflict-modal-stats">
          <div>{t('migration.conflict.local', { n: stats.local })}</div>
          <div>{t('migration.conflict.cloud', { n: stats.cloud })}</div>
          <div>{t('migration.conflict.overlap', { n: stats.overlap })}</div>
        </div>

        <button
          ref={firstFocus}
          onClick={() => onChoose('merge')}
          className="conflict-modal-primary"
        >
          {t('migration.conflict.merge')}
        </button>

        <div className="conflict-modal-secondary-actions">
          <button onClick={() => onChoose('local')} className="conflict-modal-destructive">
            {t('migration.conflict.local_only', { n: lostCloud })}
          </button>
          <button onClick={() => onChoose('cloud')} className="conflict-modal-destructive">
            {t('migration.conflict.cloud_only', { n: lostLocal })}
          </button>
        </div>
      </div>
    </div>
  )
}
