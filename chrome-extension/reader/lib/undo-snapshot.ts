/** Single-slot in-memory snapshot for the spec §4.A 5-second undo
 *  (chat-session and note-card deletes). Paper-scoped: flushed on paper change. */
type Snapshot = {
  paperKey: string;
  kind: 'chat-session' | 'note-card';
  payload: any;
  timeoutId: number;
  onExpire: () => void;
  onRestore: () => Promise<void>;
};
let active: Snapshot | null = null;
export function pushSnapshot(snap: Omit<Snapshot, 'timeoutId'>): void {
  if (JSON.stringify(snap.payload).length > 1_000_000) {
    console.warn('[undo-snapshot] payload >1MB, skipping snapshot');
    return;
  }
  if (active) clearTimeout(active.timeoutId);
  active = {
    ...snap,
    timeoutId: setTimeout(() => { active?.onExpire(); active = null; }, 5000) as unknown as number,
  };
}
export async function tryUndo(): Promise<boolean> {
  if (!active) return false;
  clearTimeout(active.timeoutId);
  const a = active; active = null;
  await a.onRestore();
  return true;
}
export function flushOnPaperChange(newPaperKey: string): void {
  if (active && active.paperKey !== newPaperKey) {
    clearTimeout(active.timeoutId);
    active = null;
  }
}
export function _resetForTest(): void { if (active) clearTimeout(active.timeoutId); active = null; }
