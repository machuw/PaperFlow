import type { Page, BrowserContext } from '@playwright/test';

/**
 * paperKey for the ?e2e=fake-paper bypass in reader/main.tsx.
 * Both `id` and `urlHash` are set to this value, so paperKey() === this string.
 */
export const FAKE_PAPER_KEY = 'e2e-fake-paper';

export interface SeedSelectionOptions {
  /** Drives ActionCard badge / accent / NoteView subtab. */
  kind?: 'explain' | 'translate';
  /** Selected passage rendered as the ActionCard quote + NoteCard quote. */
  quote?: string;
  /**
   * Streamed assistant body. Empty string ⇒ pre-stream / streaming visual
   * state (the assistant message exists but has no text yet).
   */
  aiAnswer?: string;
  /** Stable UUID for the action; defaults to a deterministic test UUID. */
  actionId?: string;
  /** Stable UUID for the chat session; defaults to a deterministic test UUID. */
  sessionId?: string;
}

/**
 * Seed `chrome.storage.local` with a chat session + matching note that share
 * an `actionId` — the structural invariant that drives the cross-panel
 * [→ Note] / [→ Chat] jumps. Reloads the page so reader/main.tsx's restore
 * context effect picks the state up.
 *
 * Returns the IDs so tests can assert against them.
 */
export async function seedSelectionFixture(page: Page, opts: SeedSelectionOptions = {}) {
  const actionId = opts.actionId ?? '11111111-1111-1111-1111-111111111111';
  const sessionId = opts.sessionId ?? '22222222-2222-2222-2222-222222222222';
  const kind = opts.kind ?? 'explain';
  const quote = opts.quote ?? 'The selected passage';
  const aiAnswer = opts.aiAnswer ?? 'This passage claims X about Y.';
  const now = Date.now();

  await page.evaluate(({ pk, actionId, sessionId, kind, quote, aiAnswer, now }) => {
    const userMsgId = 'u-' + actionId;
    const assistantMsgId = 'a-' + actionId;
    return chrome.storage.local.set({
      [`paper:${pk}:chatSessions`]: [
        { id: sessionId, seq: 1, title: '', createdAt: now, updatedAt: now },
      ],
      [`paper:${pk}:chatSessionMessages:${sessionId}`]: [
        {
          id: userMsgId,
          role: 'user',
          kind: 'actionCard',
          action: { kind, actionId, quote, loc: { paragraph: 1 } },
          text: quote,
          createdAt: now,
        },
        {
          id: assistantMsgId,
          role: 'assistant',
          text: aiAnswer,
          createdAt: now + 1,
        },
      ],
      [`paper:${pk}:activeChatSession`]: sessionId,
      [`paper:${pk}:notes`]: [
        {
          id: actionId,
          kind,
          quote,
          loc: { paragraph: 1 },
          chatSessionId: sessionId,
          chatMessageId: assistantMsgId,
          aiAnswer,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  }, { pk: FAKE_PAPER_KEY, actionId, sessionId, kind, quote, aiAnswer, now });

  await page.reload();
  await page.locator('#root').waitFor({ state: 'visible' });
  return { actionId, sessionId };
}

export interface SeedByokOptions {
  baseURL?: string;
  model?: string;
  apiKey?: string;
}

/**
 * Write BYOK config to chrome.storage.local so callAI (reader/lib/ai.ts:580)
 * routes through `streamBYOK` → fetch(`${baseURL}/chat/completions`).
 * Pair with `mockChatCompletions` to intercept that fetch.
 *
 * Default baseURL points at a `.invalid` host — RFC-reserved, never resolves
 * via DNS — so an unmocked test would fail loudly instead of leaking a real
 * request to the user's configured BYOK endpoint.
 */
export async function seedByokConfig(page: Page, opts: SeedByokOptions = {}) {
  const baseURL = opts.baseURL ?? 'https://e2e-mock.invalid/v1';
  const model = opts.model ?? 'mock-model';
  const apiKey = opts.apiKey ?? 'sk-test-key';
  await page.evaluate(
    async ({ baseURL, model, apiKey }) => {
      await chrome.storage.local.set({
        config_apikey: apiKey,
        config_prefs: { baseURL, model },
      });
    },
    { baseURL, model, apiKey },
  );
}

export interface MockChatOptions {
  baseURL?: string;
  /** Each entry becomes one OpenAI-shaped SSE delta frame. */
  chunks?: string[];
  /** Delay before responding — long enough for the in-flight UI to be observable. */
  delayMs?: number;
  /** Override the response status to exercise error paths (e.g. 500). */
  status?: number;
}

/**
 * Intercept BYOK `${baseURL}/chat/completions` calls and return a synthetic
 * OpenAI-compatible SSE response. Combined with `delayMs`, the request appears
 * in-flight long enough for assertions on streaming UI (TypingDots,
 * ink-streaming cursor) to observe the streaming state before the body
 * arrives.
 *
 * route.fulfill delivers the body as a single chunk — chunk-by-chunk
 * arrival is NOT observable over time. The streaming UI is driven by React
 * state set BEFORE the fetch resolves, so the in-flight window is what gives
 * the test its assertion gap.
 */
export async function mockChatCompletions(page: Page, opts: MockChatOptions = {}) {
  const baseURL = opts.baseURL ?? 'https://e2e-mock.invalid/v1';
  const chunks = opts.chunks ?? ['Hello, ', 'world!'];
  const delayMs = opts.delayMs ?? 600;
  const status = opts.status ?? 200;
  const body =
    chunks
      .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
      .join('') + 'data: [DONE]\n\n';
  await page.route(`${baseURL}/chat/completions`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status,
      headers: { 'content-type': 'text/event-stream' },
      body,
    });
  });
}

/**
 * Programmatically select the entire text content of the first text node
 * inside the paragraph identified by `pid` (matches `data-pid="…"`), then
 * dispatch a bubbling `mouseup` so PaperPage.handleMouseUp picks it up
 * (paper-page.tsx:19-43). The fake-paper bypass in main.tsx defines two
 * paragraphs (`sec0-p1`, `sec0-p2`) for tests to hook against.
 */
export async function selectTextInParagraph(page: Page, pid: string): Promise<void> {
  await page.evaluate((pid) => {
    const el = document.querySelector(`[data-pid="${pid}"]`);
    if (!el) throw new Error(`No paragraph with data-pid="${pid}"`);
    let textNode: Text | null = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      if ((n as Text).data.trim().length >= 5) {
        textNode = n as Text;
        break;
      }
      n = walker.nextNode();
    }
    if (!textNode) throw new Error(`No text node ≥ 5 chars in paragraph "${pid}"`);
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, pid);
  // Dispatch native mouseup; React's synthetic onMouseUp on the PaperPage
  // container (paper-page.tsx:65) catches the bubbling event and reads
  // window.getSelection() to emit `setSelection` upward.
  await page.dispatchEvent(`[data-pid="${pid}"]`, 'mouseup');
}

/**
 * Wait for the SelectionToolbar to appear (rendered when `selection !== null`)
 * and click the action button matching `label`. Scope is the toolbar role
 * so it doesn't collide with workspace tab buttons (Overview / Note / Memory)
 * that share text with toolbar action labels.
 */
export async function clickToolbarAction(
  page: Page,
  label: 'Explain' | 'Highlight' | 'Note' | 'Translate',
): Promise<void> {
  const toolbar = page.getByRole('toolbar', { name: 'Selection actions' });
  await toolbar.waitFor({ state: 'visible' });
  await toolbar.getByRole('button', { name: label, exact: true }).click();
}

// ───────────────────────────────────────────────────────────────────
// Phase 13 (UI-01 / WARN-6): seedConfigs — multi-config writer for the
// Phase 12 D-D1 schema (config_byok_configs[], config_apikeys{}, config_active_byok_config_id).
//
// Counterpart to seedByokConfig (the v1.1 single-config flat-keys
// writer that targets config_apikey + config_prefs). Use seedConfigs
// for any test that exercises listBYOKConfigs / setActiveBYOKConfig /
// subscribeByokConfigsRealtime — i.e. the BYOKChip popover and the
// multi-config Options page table.
//
// Written via the service worker's chrome.storage.local because:
//   - The SW is the canonical write context for MV3 chrome.storage.
//   - sw.evaluate() can run with chrome.* in scope (the SW has a real
//     chrome global, unlike a content-script page.evaluate).
//   - Tests that call this BEFORE navigating to the reader/options
//     page can rely on the data being visible to listBYOKConfigs at
//     mount time (no race against the page's load handlers).
//
// Note: this helper does NOT seed byokHealthCache — pair with a
// separate seedHealthCache helper or write directly via
// chrome.storage.local.set if a test needs a pre-populated cache.
// ───────────────────────────────────────────────────────────────────

export interface SeedConfigInput {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  isActive: boolean;
  apiKey?: string;
}

export async function seedConfigs(
  context: BrowserContext,
  extensionId: string,
  configs: SeedConfigInput[],
): Promise<void> {
  // Find the extension's service worker. Tests run with a freshly
  // launched persistent context (per _fixtures.ts), so the SW is
  // either already attached or about to be — wait if needed.
  let sw = context.serviceWorkers().find((s) => s.url().includes(extensionId));
  if (!sw) {
    sw = await context.waitForEvent('serviceworker');
  }

  const now = new Date().toISOString();
  const rows = configs.map((c) => ({
    id: c.id,
    user_id: '00000000-0000-0000-0000-000000000000',
    name: c.name,
    base_url: c.baseUrl,
    model: c.model,
    is_active: c.isActive,
    created_at: now,
    updated_at: now,
  }));
  const apikeys = Object.fromEntries(
    configs.filter((c) => c.apiKey !== undefined).map((c) => [c.id, c.apiKey!]),
  );
  const activeId = configs.find((c) => c.isActive)?.id ?? null;

  // Pass a single object payload so destructuring inside sw.evaluate
  // is straightforward and TypeScript narrows the chrome global on
  // the worker side (sw.evaluate runs in a SW scope where `chrome`
  // is globally available; the typing for sw.evaluate's argument is
  // generic, but the resolved scope has chrome.storage at runtime).
  await sw.evaluate(
    async (payload: {
      rows: typeof rows;
      apikeys: typeof apikeys;
      activeId: string | null;
    }) => {
      // chrome.* is resolved at runtime inside the worker; the cast
      // keeps tsc clean without needing a global.d.ts in tests/.
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      await c.storage.local.set({
        config_byok_configs: payload.rows,
        config_apikeys: payload.apikeys,
        config_active_byok_config_id: payload.activeId,
      });
    },
    { rows, apikeys, activeId },
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 20 OPT-03: cross-context active-model seed for popover ↔ Options
// sync e2e. Mirrors seedConfigs (above) but writes the 4 chrome.storage
// keys that useActiveModel + useManagedModels subscribe to (Phase 18
// WATCHED_KEYS in use-active-model.ts:75-80).
//
// Use this helper to set up cross-context sync test scenarios where
// BOTH a popover (in reader page or new tab) AND the Options page
// need to render the same initial active-model state, then verify
// onChanged propagates a single setActiveModel call to both consumers.
// ─────────────────────────────────────────────────────────────────────

export interface SeedActiveModelInput {
  /** Sets config_active_managed_model_id when present. Pass '' to clear. */
  managedId?: string;
  /** Sets config_active_byok_config_id when present. Pass null to clear. */
  byokId?: string | null;
  /** Sets managedModelsCache; required if popover renders the system
   *  models section (anonymous users see [], Pro users see [...models]). */
  managedModelsCache?: { models: Array<{ id: string; display_name: string; locked?: boolean }> };
  /** Sets config_byok_configs; pair with managedModelsCache for tests
   *  that mix system + BYOK rows. Reuses BYOK row shape from seedConfigs. */
  byokConfigs?: Array<{
    id: string;
    user_id?: string;
    name: string;
    base_url: string;
    model: string;
    is_active?: boolean;
  }>;
}

export async function seedActiveModelKeys(
  context: BrowserContext,
  extensionId: string,
  input: SeedActiveModelInput,
): Promise<void> {
  // Find the extension's service worker (mirror seedConfigs lines 246-249)
  let sw = context.serviceWorkers().find((s) => s.url().includes(extensionId));
  if (!sw) {
    sw = await context.waitForEvent('serviceworker');
  }

  const now = new Date().toISOString();
  // Normalize byokConfigs to the storage row shape (matches seedConfigs).
  const byokRows = (input.byokConfigs ?? []).map((c) => ({
    id: c.id,
    user_id: c.user_id ?? '00000000-0000-0000-0000-000000000000',
    name: c.name,
    base_url: c.base_url,
    model: c.model,
    is_active: c.is_active ?? false,
    created_at: now,
    updated_at: now,
  }));
  // Normalize managedModelsCache to the runtime shape stored by Phase 15
  // managed-models.ts (object with `models` field; cache also typically
  // carries a `ts` timestamp — write conservatively here per
  // storage-schema.ts:97-107 shape).
  const managedCache = input.managedModelsCache
    ? {
        ts: Date.now(),
        models: input.managedModelsCache.models.map((m) => ({
          id: m.id,
          display_name: m.display_name,
          min_tier: 'free' as const,
          locked: m.locked ?? false,
          provider: 'newapi',
          upstream_model: m.id,
        })),
      }
    : null;

  await sw.evaluate(
    async (payload: {
      managedId: string | undefined;
      byokId: string | null | undefined;
      managedCache: { ts: number; models: unknown[] } | null;
      byokRows: typeof byokRows;
    }) => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      // Build the set object only with keys the caller specified, so
      // tests can target ONE storage key at a time without unintended
      // resets clearing pre-existing state.
      const writes: Record<string, unknown> = {};
      if (payload.managedId !== undefined) {
        writes['config_active_managed_model_id'] = payload.managedId;
      }
      if (payload.byokId !== undefined) {
        writes['config_active_byok_config_id'] = payload.byokId;
      }
      if (payload.managedCache !== null) {
        writes['managedModelsCache'] = payload.managedCache;
      }
      if (payload.byokRows.length > 0) {
        writes['config_byok_configs'] = payload.byokRows;
      }
      if (Object.keys(writes).length > 0) {
        await c.storage.local.set(writes);
      }
    },
    {
      managedId: input.managedId,
      byokId: input.byokId,
      managedCache,
      byokRows,
    },
  );
}
