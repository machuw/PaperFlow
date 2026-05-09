// chrome-extension/reader/lib/byok-sync.ts
//
// Phase 17 D-B4: v1.1 byok_prefs cloud-sync retired.
//
// BYOK is local-only (D-A2 invariant from Phase 12 R1+R2). Phase 17 deletes
// setItem('config_prefs', ...) writes from this module because the
// storage-schema field is gone. The exports remain as no-op stubs so callers
// (reader/main.tsx + options/main.tsx) can be cleaned up in this task
// (reader/main.tsx in Step F, options/main.tsx in Step F-bis). After Plan
// 17-02 Task 1 deletes the legacy `<details>` block, the stub file itself
// becomes a candidate for full deletion in a future cleanup phase.
//
// The byok_prefs Postgres table is not touched in Phase 17 — it becomes
// orphaned dead-data (RLS already restricts to user_id=auth.uid()). v1.5+
// may add a migration to drop the table.

export async function onLogin_syncByokPrefs(): Promise<void> {
  // No-op: v1.1 cloud sync retired. Caller in reader/main.tsx is deleted in Step F.
}

export async function pushByokPrefs(_baseURL: string, _model: string): Promise<void> {
  // No-op: v1.1 config_prefs storage retired. Caller in options/main.tsx is deleted in Step F-bis.
}

export function subscribeByokPrefs(): () => void {
  // No-op: v1.1 byok_prefs realtime subscription retired. Caller in reader/main.tsx is deleted in Step F.
  return () => {};
}
