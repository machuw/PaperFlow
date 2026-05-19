import type { Paper, PaperMemory, Highlight, AiConfig, MarginResult, ChatMessage, SummarySection, CanvasLayout, ChatSession, Note, OverviewMeta } from '../types';
import { getItem } from './storage-schema';
import { isCodexBaseURL } from './byok-presets';

// Cache everything except `memory` (stored separately) and mode-specific fields
// (id/urlHash — those come from the URL at load time, not storage).
// Per spec §3.4: "再次打开同一论文直接读缓存，跳过 fetch/parse" requires all
// user-visible metadata to be cached, not just outline+paragraphs.
//
// PARSE_CACHE_VERSION: bump when parseArxivHtml / parsePdf emit a new paragraph
// shape that makes older cached records render incorrectly. getCachedParsed
// returns null on mismatch, forcing a fresh parse + re-cache.
export const PARSE_CACHE_VERSION = 3;

// Bumped when SUMMARY_PROMPTS in ai.ts change shape meaningfully (new
// required sections, new output format). Old cache keys are orphaned —
// callers automatically regenerate because the new key returns a miss.
const SUMMARY_PROMPT_VERSION = 2;

// Bumped when the VARIANT summary prompt (article-style Markdown for the
// Summary variant's full-page render) changes shape. Separate from the
// per-section SUMMARY_PROMPT_VERSION used by the Abstract tab.
const VARIANT_SUMMARY_PROMPT_VERSION = 1;

export type ParsedCache = Pick<
  Paper,
  'title' | 'authors' | 'abstract' | 'venue' | 'outline' | 'paragraphs'
> & { version?: number };

const k = {
  parsed: (key: string) => `paper:${key}:parsed`,
  memory: (key: string) => `paper:${key}:memory`,
  notes: (key: string) => `paper:${key}:notes`,
  highlights: (key: string) => `paper:${key}:highlights`,
  chat: (key: string) => `paper:${key}:chat`,
  canvas: (key: string) => `paper:${key}:canvas`,
  summary: (
    key: string,
    section: 'threeLine' | 'keyTerms' | 'detailed',
    model: string,
    outputLanguage?: string,
  ) => {
    // Include outputLanguage in the cache key so switching the reader's
    // response-language setting naturally triggers regeneration. 'auto'
    // and undefined share the same bucket (legacy behaviour — keeps
    // pre-language cached summaries reachable after the upgrade).
    const langSuffix = outputLanguage && outputLanguage !== 'auto' ? `:${outputLanguage}` : '';
    return `paper:${key}:summary:v${SUMMARY_PROMPT_VERSION}:${section}:${model}${langSuffix}`;
  },
  variantSummary: (key: string, model: string, outputLanguage?: string) => {
    // Separate namespace from :summary: so the Abstract-tab per-section
    // cache and the Summary-variant full-page cache never collide.
    const langSuffix = outputLanguage && outputLanguage !== 'auto' ? `:${outputLanguage}` : '';
    return `paper:${key}:variant-summary:v${VARIANT_SUMMARY_PROMPT_VERSION}:${model}${langSuffix}`;
  },
  chatSessions:        (key: string) => `paper:${key}:chatSessions`,
  chatSessionMessages: (key: string, sid: string) => `paper:${key}:chatSessionMessages:${sid}`,
  activeChatSession:   (key: string) => `paper:${key}:activeChatSession`,
  overviewContrib:     (key: string, model: string, lang: string) => `paper:${key}:overview:contributions:${model}:${lang}`,
  overviewKeywords:    (key: string, model: string, lang: string) => `paper:${key}:overview:keywords:${model}:${lang}`,
  keywordExplain:      (key: string, kw: string, model: string, lang: string) => `paper:${key}:overview:kwexplain:${encodeURIComponent(kw)}:${model}:${lang}`,
  overviewMeta:        (key: string) => `paper:${key}:overviewMeta`,
  workspaceTab:        (key: string) => `paper:${key}:workspace:tab`,
  paperScroll:         (key: string) => `paper:${key}:scroll`,
  lastVisit:           (key: string) => `paper:${key}:lastVisit`,
  noteSubtab:          (key: string) => `paper:${key}:note:activeSubtab`,
};

/**
 * Serialize async storage read-modify-write sequences per key.
 * Two callers with the same key queue behind each other; different keys
 * run in parallel. Returns whatever `fn` returns.
 *
 * Pattern:
 *   withKeyLock(k.notes(key), async () => {
 *     const prev = await get(...);
 *     await set(..., [...prev, next]);
 *   });
 */
const keyLocks = new Map<string, Promise<unknown>>();

export async function withKeyLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyLocks.get(lockKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);   // run fn regardless of previous outcome
  keyLocks.set(lockKey, next);
  try {
    return await next;
  } finally {
    // If no newer caller has taken the slot, clear it so the map doesn't grow unbounded.
    if (keyLocks.get(lockKey) === next) keyLocks.delete(lockKey);
  }
}

async function get<T>(key: string): Promise<T | null> {
  const rec = await chrome.storage.local.get(key);
  return (rec[key] as T) ?? null;
}

type QuotaHandler = () => void;
let onQuotaExceeded: QuotaHandler | null = null;

export function setQuotaHandler(fn: QuotaHandler | null): void {
  onQuotaExceeded = fn;
}

/**
 * Sentinel error for `chrome.storage.local` quota failures. Callers that
 * have a generic AI try/catch (e.g. `main.tsx` stream paths) can check
 * `err instanceof QuotaError` and skip their own error UI — the quota
 * toast from `setQuotaHandler` has already fired.
 */
export class QuotaError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'QuotaError';
  }
}

async function set(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('QUOTA') || msg.toLowerCase().includes('quota')) {
      console.warn('[PaperFlow] storage quota exceeded:', msg);
      onQuotaExceeded?.();
      throw new QuotaError(msg, err);
    }
    console.error('[PaperFlow] storage set failed:', err);
    throw err;
  }
}

export async function getCachedParsed(paperKey: string): Promise<ParsedCache | null> {
  const rec = await get<ParsedCache>(k.parsed(paperKey));
  if (!rec) return null;
  // Treat cache records older than the current parser version as a miss —
  // bug fixes to parseArxivHtml / parsePdf won't be picked up otherwise.
  if (rec.version !== PARSE_CACHE_VERSION) return null;
  // Strip the internal version field so callers see just the Paper subset.
  const { version: _v, ...payload } = rec;
  return payload;
}

export async function setCachedParsed(paperKey: string, value: ParsedCache): Promise<void> {
  await set(k.parsed(paperKey), { ...value, version: PARSE_CACHE_VERSION });
}

export async function getMemory(paperKey: string): Promise<PaperMemory | null> {
  return get<PaperMemory>(k.memory(paperKey));
}

export async function setMemory(paperKey: string, value: PaperMemory): Promise<void> {
  await set(k.memory(paperKey), value);
}

export async function getCanvasLayout(paperKey: string): Promise<CanvasLayout | null> {
  return get<CanvasLayout>(k.canvas(paperKey));
}

export async function setCanvasLayout(paperKey: string, value: CanvasLayout): Promise<void> {
  await set(k.canvas(paperKey), value);
}

export async function clearPaper(paperKey: string): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const toRemove = Object.keys(all).filter(x => x.startsWith(`paper:${paperKey}:`));
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

// Key builders exposed for Plan 2-5 (notes/highlights/chat/canvas/summary)
export const keys = k;

export async function getHighlights(paperKey: string): Promise<Highlight[]> {
  return (await get<Highlight[]>(k.highlights(paperKey))) ?? [];
}

export async function setHighlights(paperKey: string, value: Highlight[]): Promise<void> {
  await set(k.highlights(paperKey), value);
}

/**
 * Append a highlight, deduped by paragraphId + text (§3.4).
 * Returns the updated list.
 */
export async function addHighlight(paperKey: string, h: Highlight): Promise<Highlight[]> {
  return withKeyLock(k.highlights(paperKey), async () => {
    const existing = await getHighlights(paperKey);
    const isDup = existing.some((e) => e.paragraphId === h.paragraphId && e.text === h.text);
    if (isDup) return existing;
    const next = [...existing, h];
    await setHighlights(paperKey, next);
    return next;
  });
}

/**
 * Remove the highlight matching (paragraphId, text). Idempotent — returns
 * the list unchanged if no match exists. Used to keep `paper:{pk}:highlights`
 * in sync with the corresponding `kind:'highlight'` Note when either side
 * is deleted.
 */
export async function removeHighlight(
  paperKey: string,
  paragraphId: string,
  text: string,
): Promise<Highlight[]> {
  return withKeyLock(k.highlights(paperKey), async () => {
    const existing = await getHighlights(paperKey);
    const next = existing.filter((e) => !(e.paragraphId === paragraphId && e.text === text));
    if (next.length === existing.length) return existing;
    await setHighlights(paperKey, next);
    return next;
  });
}

const LIBRARY_KEY = 'library';
export const LIB_LOCK_KEY = 'library:lock';

// CONFIG_KEY removed (legacy combined blob no longer written).

/**
 * Compose the AiConfig.
 *
 * Phase 17: Phase 12+13 multi-config is the ONLY BYOK source of truth.
 * The v1.1 single-config fallback (config_apikey + config_prefs) was
 * physically retired by the boot-time migrateLegacyByokV12 retire pass
 * (Phase 17 D-A1); storage-schema.ts no longer declares config_apikey
 * or config_prefs.
 *
 * - Phase 13 path: getActiveBYOKConfig() returns row + apiKey merged
 * - outputLanguage: config_outputLanguage (unchanged)
 *
 * Returns null when there is no active multi-config row OR the row has
 * no apiKey — caller routes to managed proxy.
 */
export async function getConfig(): Promise<AiConfig | null> {
  const outputLanguage = await getItem('config_outputLanguage');

  // Phase 17: Phase 12+13 multi-config is the ONLY BYOK source of truth.
  try {
    const { getActiveBYOKConfig } = await import('./byok-configs');
    const active = await getActiveBYOKConfig();
    // Slice 2 #9: codex preset's sentinel baseURL is a valid active config
    // even though apiKey is empty (credentials come from codex-auth OAuth
    // tokens, not a user-supplied key). All other presets still require
    // apiKey before they're considered "configured".
    const isCodex = isCodexBaseURL(active?.base_url);
    if (active && (active.apiKey || isCodex)) {
      return {
        baseURL: active.base_url ?? '',
        apiKey: active.apiKey,
        model: active.model ?? '',
        outputLanguage: outputLanguage ?? undefined,
      };
    }
  } catch {
    // No active config — return null (caller routes to managed proxy).
  }

  return null;
}

export async function getNotes(paperKey: string): Promise<MarginResult[]> {
  return (await get<MarginResult[]>(k.notes(paperKey))) ?? [];
}

export async function setNotes(paperKey: string, value: MarginResult[]): Promise<void> {
  await set(k.notes(paperKey), value);
}

/** Append a completed note. Serialized per key via withKeyLock. */
export async function addNote(paperKey: string, note: MarginResult): Promise<MarginResult[]> {
  return withKeyLock(k.notes(paperKey), async () => {
    const existing = await getNotes(paperKey);
    const next = [...existing, note];
    await setNotes(paperKey, next);
    return next;
  });
}

export async function getLibraryRaw(): Promise<unknown> {
  return get(LIBRARY_KEY);
}

export async function setLibraryRaw(value: unknown): Promise<void> {
  await set(LIBRARY_KEY, value);
}

export async function getChat(paperKey: string): Promise<ChatMessage[]> {
  return (await get<ChatMessage[]>(k.chat(paperKey))) ?? [];
}

export async function setChat(paperKey: string, value: ChatMessage[]): Promise<void> {
  await set(k.chat(paperKey), value);
}

export async function appendChatMessage(paperKey: string, msg: ChatMessage): Promise<ChatMessage[]> {
  return withKeyLock(k.chat(paperKey), async () => {
    const existing = await getChat(paperKey);
    const next = [...existing, msg];
    await setChat(paperKey, next);
    return next;
  });
}

export async function getSummarySection(
  paperKey: string, section: SummarySection, model: string,
  outputLanguage?: string,
): Promise<string | null> {
  return get<string>(k.summary(paperKey, section, model, outputLanguage));
}

export async function setSummarySection(
  paperKey: string, section: SummarySection, model: string, value: string,
  outputLanguage?: string,
): Promise<void> {
  await set(k.summary(paperKey, section, model, outputLanguage), value);
}

export async function clearSummarySection(
  paperKey: string, section: SummarySection, model: string,
  outputLanguage?: string,
): Promise<void> {
  const key = k.summary(paperKey, section, model, outputLanguage);
  const rec = await chrome.storage.local.get(key);
  if (key in rec) {
    await chrome.storage.local.remove(key);
  }
}

export async function getVariantSummary(
  paperKey: string, model: string, outputLanguage?: string,
): Promise<string | null> {
  return get<string>(k.variantSummary(paperKey, model, outputLanguage));
}

export async function setVariantSummary(
  paperKey: string, model: string, value: string, outputLanguage?: string,
): Promise<void> {
  await set(k.variantSummary(paperKey, model, outputLanguage), value);
}

export async function clearVariantSummary(
  paperKey: string, model: string, outputLanguage?: string,
): Promise<void> {
  const key = k.variantSummary(paperKey, model, outputLanguage);
  const rec = await chrome.storage.local.get(key);
  if (key in rec) await chrome.storage.local.remove(key);
}

// ---------------------------------------------------------------------------
// Chat-session helpers
// ---------------------------------------------------------------------------

export async function getChatSessions(key: string): Promise<ChatSession[]> {
  const r = await chrome.storage.local.get(k.chatSessions(key));
  return (r[k.chatSessions(key)] as ChatSession[]) ?? [];
}

export async function setChatSessions(key: string, v: ChatSession[]): Promise<void> {
  await chrome.storage.local.set({ [k.chatSessions(key)]: v });
}

export async function getChatSessionMessages(key: string, sid: string): Promise<ChatMessage[]> {
  const r = await chrome.storage.local.get(k.chatSessionMessages(key, sid));
  return (r[k.chatSessionMessages(key, sid)] as ChatMessage[]) ?? [];
}

export async function setChatSessionMessages(key: string, sid: string, v: ChatMessage[]): Promise<void> {
  await chrome.storage.local.set({ [k.chatSessionMessages(key, sid)]: v });
}

export async function appendChatSessionMessage(key: string, sid: string, m: ChatMessage): Promise<void> {
  await withKeyLock(k.chatSessionMessages(key, sid), async () => {
    const prev = await getChatSessionMessages(key, sid);
    await setChatSessionMessages(key, sid, [...prev, m]);
  });
}

export async function getActiveChatSession(key: string): Promise<string | null> {
  const r = await chrome.storage.local.get(k.activeChatSession(key));
  return (r[k.activeChatSession(key)] as string | null) ?? null;
}

export async function setActiveChatSession(key: string, sid: string | null): Promise<void> {
  await chrome.storage.local.set({ [k.activeChatSession(key)]: sid });
}

// ---------------------------------------------------------------------------
// Note helpers (v2 — defaults missing `kind` to 'note')
// ---------------------------------------------------------------------------

export async function getNotesV2(key: string): Promise<Note[]> {
  const r = await chrome.storage.local.get(`paper:${key}:notes`);
  const arr = (r[`paper:${key}:notes`] as any[]) ?? [];
  return arr.map((n) => ({ ...n, kind: n.kind ?? 'note' }));
}

export async function setNotesV2(key: string, v: Note[]): Promise<void> {
  await chrome.storage.local.set({ [`paper:${key}:notes`]: v });
}

// ---------------------------------------------------------------------------
// Overview helpers
// ---------------------------------------------------------------------------

export async function getOverviewSection(key: string, kind: 'contributions' | 'keywords', model: string, lang: string): Promise<string | null> {
  const builder = kind === 'contributions' ? k.overviewContrib : k.overviewKeywords;
  const r = await chrome.storage.local.get(builder(key, model, lang));
  return (r[builder(key, model, lang)] as string) ?? null;
}

export async function setOverviewSection(key: string, kind: 'contributions' | 'keywords', model: string, lang: string, body: string): Promise<void> {
  const builder = kind === 'contributions' ? k.overviewContrib : k.overviewKeywords;
  await chrome.storage.local.set({ [builder(key, model, lang)]: body });
}

export async function clearOverviewSection(key: string, kind: 'contributions' | 'keywords', model: string, lang: string): Promise<void> {
  const builder = kind === 'contributions' ? k.overviewContrib : k.overviewKeywords;
  await chrome.storage.local.remove(builder(key, model, lang));
}

export async function getKeywordExplain(key: string, kw: string, model: string, lang: string): Promise<string | null> {
  const r = await chrome.storage.local.get(k.keywordExplain(key, kw, model, lang));
  return (r[k.keywordExplain(key, kw, model, lang)] as string) ?? null;
}

export async function setKeywordExplain(key: string, kw: string, model: string, lang: string, body: string): Promise<void> {
  await chrome.storage.local.set({ [k.keywordExplain(key, kw, model, lang)]: body });
}

export async function getOverviewMeta(key: string): Promise<OverviewMeta | null> {
  const r = await chrome.storage.local.get(k.overviewMeta(key));
  return (r[k.overviewMeta(key)] as OverviewMeta) ?? null;
}

export async function setOverviewMeta(key: string, v: OverviewMeta): Promise<void> {
  await chrome.storage.local.set({ [k.overviewMeta(key)]: v });
}

// ---------------------------------------------------------------------------
// UI-state helpers
// ---------------------------------------------------------------------------

export async function getWorkspaceTab(key: string): Promise<'overview' | 'note' | 'memory' | null> {
  const r = await chrome.storage.local.get(k.workspaceTab(key));
  return (r[k.workspaceTab(key)] as any) ?? null;
}

export async function setWorkspaceTab(key: string, v: 'overview' | 'note' | 'memory'): Promise<void> {
  await chrome.storage.local.set({ [k.workspaceTab(key)]: v });
}

export async function setPaperScroll(key: string, v: number): Promise<void> {
  await chrome.storage.local.set({ [k.paperScroll(key)]: v });
}

export async function setLastVisit(key: string, v: number): Promise<void> {
  await chrome.storage.local.set({ [k.lastVisit(key)]: v });
}

export async function getNoteSubtab(key: string): Promise<'explain' | 'highlight' | 'note' | 'translate' | null> {
  const r = await chrome.storage.local.get(k.noteSubtab(key));
  return (r[k.noteSubtab(key)] as any) ?? null;
}

export async function setNoteSubtab(key: string, v: 'explain' | 'highlight' | 'note' | 'translate'): Promise<void> {
  await chrome.storage.local.set({ [k.noteSubtab(key)]: v });
}
