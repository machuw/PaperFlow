import { useEffect } from 'react';
import { commitElapsedPendingDeletes } from './library-catalog';

export function usePendingDeletesCommit(): void {
  useEffect(() => {
    let cancelled = false;
    // Run once on mount (catches up after SW restart / Chrome reopen)
    commitElapsedPendingDeletes().catch(() => {});
    const tick = setInterval(() => {
      if (cancelled) return;
      commitElapsedPendingDeletes().catch(() => {});
    }, 1000);
    return () => { cancelled = true; clearInterval(tick); };
  }, []);
}
