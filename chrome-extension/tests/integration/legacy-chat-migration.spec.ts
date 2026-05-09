/**
 * Integration test: legacy chat → ChatSession migration (L5-2)
 *
 * Spec §17.B.5:
 *   paper:${k}:chat flat data → ChatSessions schema — content + order preserved.
 *
 * Exercises the full runSchemaMigrations_260424() pipeline with realistic
 * fixtures. No Supabase required — purely local chrome.storage.
 *
 * Cases covered:
 *   1. Mixed user/assistant ordering with real timestamps — exact order + ts preserved.
 *   2. Large array (50 messages) — no truncation, ids + content intact.
 *   3. Idempotency at integration layer — running migration twice yields identical state.
 *   4. {turns} shape with realistic content (newlines, citations, special chars) —
 *      content survives the content→text field rename.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runSchemaMigrations_260424 } from '../../reader/lib/schema-migration';

// ---------------------------------------------------------------------------
// Chrome storage shim — same in-memory pattern used by schema-migration.test.ts
// ---------------------------------------------------------------------------
const storageMock: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(storageMock)) delete storageMock[key];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) {
            return Promise.resolve({ ...storageMock });
          }
          if (Array.isArray(k)) {
            const out: Record<string, unknown> = {};
            for (const key of k) if (key in storageMock) out[key] = storageMock[key];
            return Promise.resolve(out);
          }
          return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {});
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(storageMock, obj);
          return Promise.resolve();
        },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k];
          for (const key of keys) delete storageMock[key];
          return Promise.resolve();
        },
        clear: () => {
          for (const key of Object.keys(storageMock)) delete storageMock[key];
          return Promise.resolve();
        },
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getChatSessions(pk: string): Promise<any[]> {
  const result = await chrome.storage.local.get(`paper:${pk}:chatSessions`);
  return result[`paper:${pk}:chatSessions`] ?? [];
}

async function getChatMessages(pk: string, sid: string): Promise<any[]> {
  const result = await chrome.storage.local.get(`paper:${pk}:chatSessionMessages:${sid}`);
  return result[`paper:${pk}:chatSessionMessages:${sid}`] ?? [];
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('legacy-chat-migration integration', () => {

  /**
   * Case #3 — Mixed user/assistant ordering with realistic timestamps.
   *
   * Seeds 10 messages alternating user/assistant, each 60s apart.
   * After migration the messages array must be in the EXACT original order
   * (no sorting by the migration code) and all timestamps unchanged.
   */
  it('preserves exact order and timestamps for alternating user/assistant messages', async () => {
    const pk = 'integ-mixed-order';
    const BASE_TS = 1_700_000_000_000; // realistic epoch ms

    const fixture = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `Message number ${i}`,
      createdAt: BASE_TS + i * 60_000,
    }));

    await chrome.storage.local.set({ [`paper:${pk}:chat`]: fixture });
    await runSchemaMigrations_260424(pk);

    const sessions = await getChatSessions(pk);
    expect(sessions).toHaveLength(1);

    const sid = sessions[0].id;
    const msgs = await getChatMessages(pk, sid);

    expect(msgs).toHaveLength(10);

    // Exact order: every message must match its original id, role, text, createdAt.
    for (let i = 0; i < fixture.length; i++) {
      expect(msgs[i].id).toBe(fixture[i].id);
      expect(msgs[i].role).toBe(fixture[i].role);
      expect(msgs[i].text).toBe(fixture[i].text);
      expect(msgs[i].createdAt).toBe(fixture[i].createdAt);
    }

    // Title comes from first user message (index 0).
    expect(sessions[0].title).toContain('Message number 0');
  });

  /**
   * Case #5 — Large array (50 messages).
   *
   * After migration all 50 messages must be in the chatSessionMessages key —
   * no truncation, ids and content preserved.
   */
  it('migrates 50 messages without truncation — ids and content intact', async () => {
    const pk = 'integ-large-array';

    const fixture = Array.from({ length: 50 }, (_, i) => ({
      id: `large-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `Content for message ${i}: ${'x'.repeat(80)}`,
      createdAt: 1_000_000 + i * 30,
    }));

    await chrome.storage.local.set({ [`paper:${pk}:chat`]: fixture });
    await runSchemaMigrations_260424(pk);

    const sessions = await getChatSessions(pk);
    expect(sessions).toHaveLength(1);

    const sid = sessions[0].id;
    const msgs = await getChatMessages(pk, sid);

    expect(msgs).toHaveLength(50);

    // Spot-check first, last, and a mid-point entry.
    for (const i of [0, 24, 49]) {
      expect(msgs[i].id).toBe(fixture[i].id);
      expect(msgs[i].text).toBe(fixture[i].text);
      expect(msgs[i].createdAt).toBe(fixture[i].createdAt);
    }
  });

  /**
   * Idempotency at the integration layer.
   *
   * Running migration twice on the same paper must leave state identical.
   * (L1.1-5 covered this with a minimal fixture; here we use a larger
   * realistic fixture to exercise the full pipeline path.)
   */
  it('is idempotent — running migration twice produces identical storage state', async () => {
    const pk = 'integ-idempotent';

    const fixture = Array.from({ length: 8 }, (_, i) => ({
      id: `idem-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `Idempotency message ${i}`,
      createdAt: 2_000_000 + i * 100,
    }));

    await chrome.storage.local.set({ [`paper:${pk}:chat`]: fixture });

    await runSchemaMigrations_260424(pk);
    const stateAfterFirst = await chrome.storage.local.get(null);

    await runSchemaMigrations_260424(pk);
    const stateAfterSecond = await chrome.storage.local.get(null);

    expect(stateAfterSecond).toEqual(stateAfterFirst);
  });

  /**
   * Case #2 / {turns} shape — realistic content with newlines, citations,
   * and special characters.
   *
   * Verifies the content→text field rename survives the migration with
   * full fidelity: newlines, Unicode, citation brackets, and backslashes
   * must be unchanged.
   */
  it('{turns} shape: realistic content with newlines, citations, special chars survives rename', async () => {
    const pk = 'integ-turns-realistic';

    const userContent = 'What does equation (3) mean?\n\nSpecifically: \\( f(x) = \\int_0^\\infty e^{-x^2} dx \\)\n\nSee [1] and [2, §4].';
    const assistantContent = 'Great question!\n\nEquation (3) is the Gaussian integral:\n\n> \\( f(x) = \\sqrt{\\pi}/2 \\)\n\nReferences:\n[1] Smith et al., 2023 — DOI: 10.1234/abc\n[2] Müller & Königs "Über die…" — special chars: <>&\'"';

    const fixture = {
      turns: [
        { id: 't-user-1', role: 'user', content: userContent, ts: 1_600_000_000 },
        { id: 't-asst-1', role: 'assistant', content: assistantContent, ts: 1_600_000_060 },
      ],
    };

    await chrome.storage.local.set({ [`paper:${pk}:chat`]: fixture });
    await runSchemaMigrations_260424(pk);

    const sessions = await getChatSessions(pk);
    expect(sessions).toHaveLength(1);

    const sid = sessions[0].id;
    const msgs = await getChatMessages(pk, sid);

    expect(msgs).toHaveLength(2);

    // User turn: content → text, ts → createdAt.
    expect(msgs[0].id).toBe('t-user-1');
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].text).toBe(userContent);
    expect(msgs[0].createdAt).toBe(1_600_000_000);

    // Assistant turn: same field renames, content fully preserved.
    expect(msgs[1].id).toBe('t-asst-1');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].text).toBe(assistantContent);
    expect(msgs[1].createdAt).toBe(1_600_000_060);

    // Title derived from first user turn text (truncated to 30 chars).
    expect(sessions[0].title).toBe(userContent.slice(0, 30));
  });

});
