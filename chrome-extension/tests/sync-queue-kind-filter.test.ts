// chrome-extension/tests/sync-queue-kind-filter.test.ts
import { describe, it, expect } from 'vitest';
import { shouldSyncNote } from '../reader/lib/sync-queue';

describe('sync-queue kind filter', () => {
  it.each([
    ['note', true], ['highlight', true],
    ['explain', false], ['translate', false],
    ['summarize', false], ['ask', false], [undefined, true],
  ])('shouldSyncNote(%s) → %s', (kind, want) => {
    expect(shouldSyncNote(kind as any)).toBe(want);
  });
});
