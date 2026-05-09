// chrome-extension/tests/chat-telemetry.test.ts
//
// Quick 260506-8ov — chat telemetry payload composition smoke.
//
// Coverage:
//   it 1 — composeMessageStats: minimal system + user (B1)
//   it 2 — composeMessageStats: system + history + final user (B2 — the
//          load-bearing math for "full history re-sent every turn" diagnostic)
//   it 3 — composeMessageStats: no user messages → user_chars=0, query=''
//   it 4 — composeMessageStats: query truncated to 500 chars
//   it 5 — logChatTelemetry: emits when DEV=true regardless of storage flag
//   it 6 — logChatTelemetry: silent when DEV=false and storage flag absent
//
// We do NOT test the fetch / SSE loop integration here (too brittle, per spec)
// nor the callAI router branching (covered by typecheck + manual smoke).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// jsdom doesn't provide chrome.storage — minimal in-memory shim for the gate
// tests that exercise getItem('debug:chatTelemetry'). Mirror the
// byok-configs.test.ts:42-105 / active-model.test.ts:41-108 pattern.
const storageMock: Record<string, unknown> = {};

beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k];
  // Reset modules so the cachedEnabled module-level state in telemetry.ts
  // starts fresh for each gate test.
  vi.resetModules();
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) return Promise.resolve({ ...storageMock });
          if (Array.isArray(k)) {
            const out: Record<string, unknown> = {};
            for (const key of k) if (key in storageMock) out[key] = storageMock[key];
            return Promise.resolve(out);
          }
          return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {});
        },
        set: (obj: Record<string, unknown>) => {
          for (const [key, val] of Object.entries(obj)) storageMock[key] = val;
          return Promise.resolve();
        },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k];
          for (const key of keys) delete storageMock[key];
          return Promise.resolve();
        },
      },
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('composeMessageStats', () => {
  it('B1: minimal system + user', async () => {
    const { composeMessageStats } = await import('../reader/lib/telemetry');
    const stats = composeMessageStats([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
    ]);
    expect(stats.messages_count).toBe(2);
    expect(stats.system_chars).toBe(3);
    expect(stats.history_chars).toBe(0);
    expect(stats.user_chars).toBe(2);
    expect(stats.total_chars).toBe(5);
    expect(stats.est_input_tokens).toBe(1); // round(5/4)
    expect(stats.query).toBe('q1');
  });

  it('B2: system + history (user, assistant) + final user', async () => {
    const { composeMessageStats } = await import('../reader/lib/telemetry');
    const stats = composeMessageStats([
      { role: 'system', content: 'sysxx' },          // 5
      { role: 'user', content: 'old' },              // 3 → history (not last user)
      { role: 'assistant', content: 'aaaa' },        // 4 → history
      { role: 'user', content: 'new question' },     // 12 → user_chars (last user)
    ]);
    expect(stats.system_chars).toBe(5);
    expect(stats.history_chars).toBe(7); // 3 + 4
    expect(stats.user_chars).toBe(12);
    expect(stats.total_chars).toBe(24);
    expect(stats.est_input_tokens).toBe(6); // round(24/4)
    expect(stats.query).toBe('new question');
  });

  it('B3: no user messages → user_chars=0, query empty', async () => {
    const { composeMessageStats } = await import('../reader/lib/telemetry');
    const stats = composeMessageStats([
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: 'a' },
    ]);
    expect(stats.user_chars).toBe(0);
    expect(stats.query).toBe('');
    // assistant content counts as history when there is no last-user pivot.
    expect(stats.history_chars).toBe(1);
  });

  it('B4: long query truncated to 500 chars', async () => {
    const { composeMessageStats } = await import('../reader/lib/telemetry');
    const stats = composeMessageStats([
      { role: 'user', content: 'x'.repeat(800) },
    ]);
    expect(stats.query.length).toBe(500);
    expect(stats.user_chars).toBe(800); // user_chars is full length, not truncated
  });
});

describe('logChatTelemetry gate', () => {
  const fixtureRecord = {
    ts: '2026-05-06T00:00:00.000Z',
    paperId: 'pf-test',
    sessionId: 's-test',
    query: 'hi',
    messages_count: 2,
    system_chars: 10,
    history_chars: 0,
    user_chars: 2,
    total_chars: 12,
    est_input_tokens: 3,
    model: 'test-model',
    route: 'byok' as const,
    ttft_ms: 100,
    total_stream_ms: 500,
    output_chars: 50,
    status: 'ok' as const,
  };

  it('B5: emits when DEV=true regardless of storage flag', async () => {
    vi.stubEnv('DEV', true);
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { logChatTelemetry } = await import('../reader/lib/telemetry');
    await logChatTelemetry(fixtureRecord);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('[pf-chat-telemetry]', fixtureRecord);
  });

  it('B6: silent when DEV=false and storage flag absent', async () => {
    vi.stubEnv('DEV', false);
    // storageMock has no 'debug:chatTelemetry' key (cleared in beforeEach)
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { logChatTelemetry } = await import('../reader/lib/telemetry');
    await logChatTelemetry(fixtureRecord);
    // Flush any pending microtasks from the storage round-trip.
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });
});
