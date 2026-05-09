// chrome-extension/reader/components/migration-banner.tsx
//
// Phase C Task C3 — Migration progress banner + conflict modal wiring.
// Spec §7 + §14.2. Mounts at reader root; gated on session.
//
// Lifecycle on login:
//   1. resumeIfNeeded()  — pick up a prior crashed/paused upload
//   2. detectAndRoute()  — empty / push-local / pull-only / conflict
//        · push-local  → pushLocalToCloud()
//        · conflict    → show ConflictModal, then applyMergeChoice()
//        · others       → no-op (realtime + queries handle it)
// Progress listener is registered BEFORE any push, so a fast-completion
// path still flips the banner to phase='done' and it hides itself.

import { useEffect, useState } from 'react'
import {
  onProgress,
  detectAndRoute,
  pushLocalToCloud,
  pullCloudToLocal,
  resumeIfNeeded,
  applyMergeChoice,
  type Progress,
} from '../lib/migration'
import { supabase } from '../lib/supabase'
import { ConflictModal } from './conflict-modal'
import { getItem } from '../lib/storage-schema'
import { t, useT } from '../lib/i18n'
import '../styles/migration-banner.css'

type ConflictStats = { local: number; cloud: number; overlap: number }

export function MigrationBanner() {
  useT()  // re-render on locale change
  const [progress, setProgress] = useState<Progress | null>(null)
  const [conflict, setConflict] = useState<ConflictStats | null>(null)
  const [hasSession, setHasSession] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  // Subscribe first — before any push could start — so a fast-complete
  // path (e.g. 0 papers → immediate phase='done' emit) still reaches us.
  useEffect(() => {
    const unsub = onProgress(p => setProgress(p))
    return unsub
  }, [])

  // Gate migration on session. On login (incl. post-OAuth redirect), run
  // resume + detect. On logout, clear local banner state.
  useEffect(() => {
    let cancelled = false

    async function run(session: any) {
      if (cancelled) return
      setHasSession(!!session)
      if (!session) {
        setProgress(null)
        setConflict(null)
        return
      }
      try {
        await resumeIfNeeded()
        if (cancelled) return
        // Short-circuit if the user already reconciled on a prior session.
        // detectAndRoute only looks at "is there data on both sides" — after a
        // successful merge both sides are non-empty FOREVER, so without this
        // guard the ConflictModal would re-prompt on every reader mount.
        const migrationState = await getItem('migrationState')
        if (cancelled) return
        if (migrationState === 'done') return
        const route = await detectAndRoute()
        if (cancelled) return
        if (route.route === 'push-local') {
          await pushLocalToCloud()
        } else if (route.route === 'conflict') {
          setConflict(route.stats)
        } else if (route.route === 'pull-only') {
          // Cross-device login: cloud has papers, local empty. Actively
          // pull into chrome.storage.local 'library' key, then notify
          // open views (LibraryDrawer) to refresh.
          await pullCloudToLocal()
          window.dispatchEvent(new CustomEvent('paperflow-session-refreshed'))
        }
        // 'empty' — nothing to do.
      } catch {
        // pushLocalToCloud sets migrationState='paused' and emits a paused
        // progress event; the banner renders the Retry UI via `progress`.
      }
    }

    supabase.auth.getSession().then(({ data }) => run(data.session))
    const { data: authListener } = supabase.auth.onAuthStateChange((_evt, session) => {
      void run(session)
    })

    return () => {
      cancelled = true
      authListener.subscription.unsubscribe()
    }
  }, [retryCount])

  async function handleRetry() {
    // Re-trigger the session effect (bumps retryCount) so resumeIfNeeded
    // runs again and detectAndRoute can pick up where we left off.
    setRetryCount(c => c + 1)
    try {
      await pushLocalToCloud()
    } catch {
      // Banner updates via onProgress listener.
    }
  }

  async function handleConflictChoice(choice: 'merge' | 'local' | 'cloud') {
    setConflict(null)
    try {
      await applyMergeChoice(choice)
    } catch {
      // Paused phase surfaces via onProgress.
    }
  }

  if (!hasSession) return null

  if (conflict) {
    return (
      <ConflictModal
        stats={conflict}
        onChoose={handleConflictChoice}
        onClose={() => setConflict(null)}
      />
    )
  }

  if (!progress || progress.phase === 'idle' || progress.phase === 'done') return null

  const pct =
    progress.total > 0
      ? Math.min(100, (progress.done / progress.total) * 100)
      : 0

  return (
    <div className="migration-banner" role="status" aria-live="polite">
      {progress.phase === 'paused' ? (
        <div className="migration-banner-paused">
          <span>{t('migration.banner.paused')}</span>
          <button onClick={handleRetry} className="migration-banner-retry">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="migration-banner-text">
            {t('migration.banner', { done: progress.done, total: progress.total })}
          </div>
          <div className="migration-banner-progress">
            <div
              className="migration-banner-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
    </div>
  )
}
