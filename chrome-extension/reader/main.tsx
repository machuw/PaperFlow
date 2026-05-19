import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
// @ts-ignore — vite ?url suffix
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// DevX 2026-05-06: surface which Supabase the bundle was built against.
// `npm run build` (production) → hosted; `npm run build:dev` → local.
console.info('[paperflow] supabase env:', import.meta.env.VITE_SUPABASE_URL, '·', import.meta.env.MODE);

import { loadArxivPaper } from './lib/arxiv';
import { parsePdf } from './lib/pdf';
import { normalizeArxivId, normalizePdfFetchUrl, paperKey, prefersPdfForArxiv, urlHash } from './lib/ids';
import { getVisibleParagraphs } from './lib/paper';
import { registerPaperHighlights, findHighlightRangesForParagraph } from './lib/highlight-ranges';
import {
  getCachedParsed, setCachedParsed, getMemory, setMemory,
  getHighlights, addHighlight, removeHighlight, getNotes,
  getConfig, clearOverviewSection,
  setQuotaHandler, QuotaError,
} from './lib/storage';
import { addToLibrary, updateLibraryRow, removeLibraryEntry, getLibrary } from './lib/library';
import { loadPaperFromCache } from './lib/load-paper-from-cache';
import { buildChatMessages, extractCitations, callAI, ProxyError, assertNever } from './lib/ai';
import { adaptiveServerErrorToast, surfaceCodexError } from './lib/toast-helpers';
import { t } from './lib/i18n';
import { emptyMemory, DEFAULT_TWEAKS } from './types';
import type { Paper, PdfRuntime, ReaderVariant, Tweaks, Highlight, TextSelection, MarginResult, ChatMessage, NoteKind, OverviewMeta } from './types';
import type { Note, ChatSession } from './types';
import { runSchemaMigrations_260424, runRestoreContext_260424 } from './lib/schema-migration';
import { pushSnapshot, tryUndo, flushOnPaperChange } from './lib/undo-snapshot';
import { runSelectionAction, retryAction, abortAllForPaper, shouldSyncNote } from './lib/selection-actions';
import * as Sessions from './lib/chat-sessions';
import * as Notes from './lib/notes';
import { ensureOverview, type OverviewState } from './lib/overview';
import { fetchOverviewMeta } from './lib/semantic-scholar';
import { enqueue } from './lib/sync-queue';
import { ToastHost, setToast, showUndoToast } from './components/toast';
import { I } from './components/icons';
import { PaperPage } from './components/paper-page';
import { SelectionToolbar } from './components/selection-toolbar';
import type { SelectionActionKind } from './components/selection-toolbar';
import { TopBar } from './components/top-bar';
import { StatusRail } from './components/status-rail';
import { TweaksPanel } from './components/tweaks-panel';
import { WorkspacePanel } from './components/workspace-panel';
import { CanvasView } from './components/canvas-view';
import { CmdK } from './components/overlays';
import { LibraryDrawer } from './components/library-drawer';
// MarginColumn import removed in 260423-wsn Task 4 — SummaryPage replaces
// it in the summary variant and Classic never used it.
import { SummaryPage } from './components/summary-page';
import { MigrationBanner } from './components/migration-banner';
import { UpgradePrompt, type UpgradeTrigger } from './components/upgrade-prompt';
import { ChurnModal } from './components/churn-modal';
import { ChatPanel } from './components/chat-panel';
import { NoteEditorPopover } from './components/note-editor-popover';
import {
  migrateLegacyByokV12,
  migrateOpenAICompatV16,
  migrateLocalLitellmRemoval,
  onLogin_syncByokConfigs,
  subscribeByokConfigs,
} from './lib/byok-configs';
import { migrateAnthropicViaProxyToManaged } from './lib/managed-models';
import { supabase } from './lib/supabase';

// --- src URL extraction (Phase 1 logic preserved) ---
function readSrc(): string | null {
  if (location.hash.startsWith('#src=')) return location.hash.slice('#src='.length);
  return new URLSearchParams(location.search).get('src');
}

// Phase 27 — `#paperKey=<key>` cache-only entry, used by library card clicks
// when the original src URL was never captured but the paper:* cache is
// intact. Symmetric with readSrc(): no decodeURIComponent (raw value
// convention; see SPEC §A3 + planNavigateToPaper header).
function readPaperKey(): string | null {
  if (location.hash.startsWith('#paperKey=')) return location.hash.slice('#paperKey='.length);
  return null;
}

interface LoadedPaper {
  paper: Paper;
  pdfRuntime: PdfRuntime | null;
}

async function loadPaper(src: string): Promise<LoadedPaper> {
  const arxivId = normalizeArxivId(src);
  const pdfIntent = !!arxivId && prefersPdfForArxiv(src);
  const hash = await urlHash(src);
  const key = arxivId ?? hash;

  const cached = await getCachedParsed(key);
  if (cached) {
    // PDF-origin papers: outline entries all carry a `page` number. Cached
    // text + metadata is fine, but rendering needs a live pdfDoc → re-route
    // through loadPdfPath so parsePdf runs fresh.
    //
    // Also re-route to loadPdfPath when the user explicitly opened /pdf/
    // but the cached record is HTML — their earlier visit came from /abs/
    // or similar, but this click wants PDF, so honor it.
    const isPdfCache =
      cached.outline.length > 0 && cached.outline.every((o) => typeof o.page === 'number');
    if (isPdfCache || pdfIntent) {
      const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : src;
      return loadPdfPath(pdfUrl, arxivId ?? undefined);
    }
    const mem = (await getMemory(key)) ?? emptyMemory();
    return {
      paper: {
        id: arxivId ?? undefined,
        urlHash: hash,
        title: cached.title,
        authors: cached.authors,
        abstract: cached.abstract,
        venue: cached.venue,
        outline: cached.outline,
        paragraphs: cached.paragraphs,
        memory: mem,
      },
      pdfRuntime: null,
    };
  }

  // Explicit /pdf/ intent: skip the HTML fetch and go straight to PDF canvas.
  if (arxivId && pdfIntent) {
    return loadPdfPath(`https://arxiv.org/pdf/${arxivId}`, arxivId);
  }

  if (arxivId) {
    const result = await loadArxivPaper(arxivId);
    if (result.kind === 'ok') {
      const pk = paperKey(result.paper);
      await setCachedParsed(pk, {
        title: result.paper.title,
        authors: result.paper.authors,
        abstract: result.paper.abstract,
        venue: result.paper.venue,
        outline: result.paper.outline,
        paragraphs: result.paper.paragraphs,
      });
      if (!(await getMemory(pk))) await setMemory(pk, emptyMemory());
      return { paper: result.paper, pdfRuntime: null };
    }
    if (result.kind === 'ok-partial') {
      // Skip caching: next open retries the API.
      const pk = paperKey(result.paper);
      if (!(await getMemory(pk))) await setMemory(pk, emptyMemory());
      return { paper: result.paper, pdfRuntime: null };
    }
    if (result.kind === 'fallback-pdf') {
      return loadPdfPath(`https://arxiv.org/pdf/${arxivId}`, arxivId);
    }
    throw new Error(result.message);
  }

  return loadPdfPath(src, undefined);
}

async function loadPdfPath(pdfUrl: string, arxivId: string | undefined): Promise<LoadedPaper> {
  // Host-specific rewrite so the response body is the raw PDF (e.g. Hugging
  // Face /blob/ → /resolve/). Original pdfUrl is preserved for hash/filename
  // below so cache and library keys don't drift across the rewrite.
  const fetchUrl = normalizePdfFetchUrl(pdfUrl);
  let buf: ArrayBuffer;
  try {
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = await res.arrayBuffer();
  } catch {
    const proxyRes = await chrome.runtime.sendMessage({ kind: 'pdf-proxy-fetch', url: fetchUrl });
    if (proxyRes?.kind !== 'ok') throw new Error(proxyRes?.message ?? 'SW proxy failed');
    const bin = atob(proxyRes.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    buf = bytes.buffer;
  }

  const { parsed, doc, pageItemRanges } = await parsePdf(buf);
  try {
    const hash = await urlHash(pdfUrl);
    const key = arxivId ?? hash;
    const filename = pdfUrl.split('/').pop()?.split('?')[0] ?? '';
    const venue = filename ? `PDF · ${filename}` : undefined;

    const paper: Paper = {
      id: arxivId,
      urlHash: hash,
      title: parsed.title,
      authors: parsed.authors,
      abstract: '',
      venue,
      outline: parsed.outline,
      paragraphs: parsed.paragraphs,
      memory: emptyMemory(),
    };
    await setCachedParsed(key, {
      title: paper.title, authors: paper.authors, abstract: paper.abstract,
      venue: paper.venue, outline: paper.outline, paragraphs: paper.paragraphs,
    });
    if (!(await getMemory(key))) await setMemory(key, emptyMemory());
    return { paper, pdfRuntime: { doc, pageItemRanges } };
  } catch (err) {
    doc.destroy().catch(() => {});
    throw err;
  }
}

const WORKSPACE_WIDTH_MIN = 300;
const WORKSPACE_WIDTH_MAX = 760;
const CHAT_WIDTH_MIN = 280;
const CHAT_WIDTH_MAX = 720;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;
const roundZoom = (z: number) => Math.round(z * 10) / 10;

// --- Persistent UI state (localStorage) ---
function usePersistedState<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const setWrap = (next: T) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
  };
  return [v, setWrap];
}

async function handleProxyError(err: ProxyError): Promise<void> {
  switch (err.code) {
    case 'QUOTA_EXCEEDED': {
      // payload is {tier, used, limit, upgrade_url}; limit tells us if trial or monthly
      const trigger = err.payload?.limit === 20 ? 'trial' : 'monthly';
      window.dispatchEvent(new CustomEvent('open-upgrade-prompt', { detail: { trigger } }));
      return;
    }
    case 'TIER_NO_MANAGED_AI': setToast(t('error.403.sync')); return;
    case 'RATE_LIMITED':       setToast(t('error.429')); return;
    case 'UNAUTHENTICATED':    setToast(t('error.auth')); return;
    case 'TIMEOUT':            setToast(t('error.timeout')); return;
    case 'SERVER_ERROR':       setToast(await adaptiveServerErrorToast()); return;
    case 'UNKNOWN':            setToast(t('error.500.nobyok')); return;
    // NEW Phase 21: TIER_LOCKED — Phase 15 tier whitelist reject (model requires higher tier).
    // Distinct from TIER_NO_MANAGED_AI (which is "your tier has no managed AI"); TIER_LOCKED
    // is "this specific model needs Pro" — route to upgrade prompt with distinct trigger.
    case 'TIER_LOCKED': {
      window.dispatchEvent(new CustomEvent('open-upgrade-prompt', { detail: { trigger: 'tier-locked' } }));
      return;
    }
    // NEW Phase 21: MODEL_NOT_FOUND — model id not in MANAGED_MODELS registry (typo / deprecated).
    // Surface generic toast; downstream cleanup (clear stale config_active_managed_model_id)
    // is intentionally NOT done here to preserve user intent; Options page surfaces the
    // missing model and lets them re-pick.
    case 'MODEL_NOT_FOUND': setToast(t('error.500.nobyok')); return;
    // KEEP-AS-IS Phase 21 CONTEXT correction #4: orthogonal BYOK validation code.
    case 'byok-misconfigured': setToast(t('error.500.nobyok')); return;
    default: assertNever(err.code);
  }
}

// --- ViewerApp shell ---
function ViewerApp({ paper, pdfRuntime }: { paper: Paper; pdfRuntime: PdfRuntime | null }) {
  // Snapshot the launching src once so addToLibrary / updateLibraryRow can
  // stamp it into the library row — enables click-to-jump from LibraryDrawer
  // back into the reader. Stays stable for the lifetime of this paper view.
  const currentSrc = readSrc() ?? undefined;
  const [theme, setTheme] = usePersistedState<'light' | 'dark'>('pf-theme', 'light');
  const [persistedVariant, setPersistedVariant] = usePersistedState<ReaderVariant>('pf-variant', 'classic');
  // Canvas entry is hidden (260427) — coerce a stale 'canvas' persisted value
  // back to 'classic' so users with that saved default aren't stranded in a
  // variant they can no longer leave from the top bar.
  const [variant, setVariantInMemory] = useState<ReaderVariant>(
    persistedVariant === 'canvas' ? 'classic' : persistedVariant,
  );

  /**
   * Set the active variant. Pass `{ transient: true }` to avoid persisting
   * the change (spec §3.7.5: Ask's auto-switch to Classic must not clobber
   * the user's saved default). Regular TopBar / CmdK calls omit opts, so
   * the default behavior matches a single persisted setter.
   */
  const setVariant = (v: ReaderVariant, opts?: { transient?: boolean }) => {
    setVariantInMemory(v);
    if (!opts?.transient) setPersistedVariant(v);
  };

  // One-shot migration: legacy 'focus' entries from pre-rename builds coerce
  // to the new default 'classic'. Product hasn't launched so no real users
  // deliberately chose 'focus'; aligning with default avoids surprising anyone
  // who had a stale preference from development. Runs inside an effect (not
  // during render) so state update is safe.
  useEffect(() => {
    if ((persistedVariant as string) === 'focus') {
      setPersistedVariant('classic');
      setVariantInMemory('classic');
    }
    // Run only on mount; persistedVariant is captured at initial read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [tweaks, setTweaks] = usePersistedState<Tweaks>('pf-tweaks', DEFAULT_TWEAKS);
  const setTweak = <K extends keyof Tweaks>(k: K, v: Tweaks[K]) =>
    setTweaks({ ...tweaks, [k]: v });
  // Existing pf-tweaks from before this build's DEFAULT_TWEAKS shape may
  // be missing newer fields (e.g. `zoom`). Read through DEFAULT_TWEAKS
  // so undefined values don't break downstream math / styles.
  const effectiveTweaks: Tweaks = { ...DEFAULT_TWEAKS, ...tweaks };

  // Classic-variant right-side workspace panel width (resizable). Persisted
  // so the user doesn't have to re-drag on every reload. Clamped to the
  // same bounds as the drag handler in WORKSPACE_WIDTH_MIN/MAX below.
  const [workspaceWidth, setWorkspaceWidth] = usePersistedState<number>(
    'pf-workspace-width', 380,
  );
  // Transient width during an active drag — avoids writing localStorage on
  // every mousemove pixel. Commits to workspaceWidth on mouseup.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const startWorkspaceResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = workspaceWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      // Workspace is on the LEFT — drag right edge right (larger clientX) → wider.
      const dx = ev.clientX - startX;
      setDragWidth(clamp(startW + dx, WORKSPACE_WIDTH_MIN, WORKSPACE_WIDTH_MAX));
    };
    const onUp = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      setWorkspaceWidth(clamp(startW + dx, WORKSPACE_WIDTH_MIN, WORKSPACE_WIDTH_MAX));
      setDragWidth(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const activeWorkspaceWidth = dragWidth ?? workspaceWidth;

  const [chatOpen, setChatOpen] = usePersistedState<boolean>('pf-chat-open', true);
  const [chatPanelWidth, setChatPanelWidth] = usePersistedState<number>('pf-chat-width', 360);
  // Transient drag state — committed to chatPanelWidth on mouseup so we don't
  // write localStorage on every mousemove pixel. Mirrors the workspace pattern.
  const [chatDragWidth, setChatDragWidth] = useState<number | null>(null);
  const startChatResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = chatPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      // Chat panel is on the RIGHT — drag left edge left (smaller clientX) → wider.
      const dx = startX - ev.clientX;
      setChatDragWidth(clamp(startW + dx, CHAT_WIDTH_MIN, CHAT_WIDTH_MAX));
    };
    const onUp = (ev: MouseEvent) => {
      const dx = startX - ev.clientX;
      setChatPanelWidth(clamp(startW + dx, CHAT_WIDTH_MIN, CHAT_WIDTH_MAX));
      setChatDragWidth(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const activeChatWidth = chatDragWidth ?? chatPanelWidth;
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [cmdKOpen, setCmdKOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [tab, setTab] = useState<'overview' | 'note' | 'memory'>('overview');

  const [model, setModel] = useState<string>('');
  // Tracks the user's preferred response language. Drives prompt language
  // instruction. Hydrated from config and kept live via storage.onChanged.
  const [outputLanguage, setOutputLanguage] = useState<string>('auto');

  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  // Floating "delete this highlight" popover. Set when the user clicks on
  // a highlighted span without dragging a selection. Coords are viewport
  // (position: fixed) so we don't need a positioned ancestor and dismissal
  // on scroll keeps the affordance from drifting away from its anchor.
  const [highlightPopover, setHighlightPopover] = useState<
    { paragraphId: string; text: string; left: number; top: number } | null
  >(null);
  const [results, setResults] = useState<MarginResult[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [memoryOverlay, setMemoryOverlay] = useState<Paper['memory'] | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // sid → assistant message id of the in-flight stream for that session.
  // Replaces the old global chatStreamingId so a stream started in session A
  // keeps running (and persisting) when the user switches to session B; both
  // sessions can stream concurrently. Derived chatStreamingId below picks the
  // entry for whichever session is currently active.
  const [streamingBySession, setStreamingBySession] = useState<Map<string, string>>(() => new Map());
  // Per-session AbortController for chat-send streams. Lives in a ref so the
  // map identity is stable across renders; entries set by onChatSend at the
  // start of each call and removed in finally. Stop button calls abort() on
  // the entry for the currently active session.
  const chatAbortRef = useRef<Map<string, AbortController>>(new Map());
  // Composer visibility is driven solely by per-session chat-send streams.
  // Selection actions (Explain/Translate from a quote) intentionally do NOT
  // lock the composer: they're background ops that produce ActionCards; the
  // user should be free to send a chat message right after triggering one.
  const chatStreamingId = activeSessionId
    ? streamingBySession.get(activeSessionId) ?? null
    : null;
  // Selection-action streams (Explain/Translate) — tracked separately so the
  // composer stays unlocked but the assistant ActionCard can show typing dots.
  const [actionStreamingIds, setActionStreamingIds] = useState<Set<string>>(() => new Set());
  const onChatAbort = useCallback(() => {
    if (!activeSessionId) return;
    const ctrl = chatAbortRef.current.get(activeSessionId);
    if (ctrl) ctrl.abort();
    // streamingBySession + abort map cleanup happens in onChatSend's finally
    // (the abort triggers the catch path which falls through to finally).
  }, [activeSessionId]);
  const [askPrefill, setAskPrefill] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeSubtab, setActiveSubtab] = useState<NoteKind>('explain');
  const [overviewMeta, setOverviewMeta] = useState<OverviewMeta | null>(null);
  const [contributionsState, setContributionsState] = useState<OverviewState>({ kind: 'idle' });
  const [keywordsState, setKeywordsState] = useState<OverviewState>({ kind: 'idle' });
  const [editingNote, setEditingNote] = useState<{ rect: any; quote: string; loc: any; initial: string } | null>(null);
  const [flashNoteId, setFlashNoteId] = useState<string | null>(null);
  const locale = outputLanguage;
  // Guard: prevents persistence effects from writing default state before boot
  // restore has completed (Problem E — persistence effect overwrites saved tab).
  const restoredRef = useRef(false);

  // UpgradePrompt — opened by a `open-upgrade-prompt` CustomEvent dispatched
  // from the AI router (Task D2/D4) when the user hits a quota / library cap.
  // `null` means hidden; setting a trigger mounts the modal.
  const [upgradeTrigger, setUpgradeTrigger] = useState<UpgradeTrigger | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent<{ trigger: UpgradeTrigger }>).detail;
      if (detail?.trigger) setUpgradeTrigger(detail.trigger);
    };
    window.addEventListener('open-upgrade-prompt', h);
    return () => window.removeEventListener('open-upgrade-prompt', h);
  }, []);

  // Chunks estimate per §3.2: paragraphs merged to ~500 tokens (text/4 ≈ tokens).
  const chunks = Math.max(1, Math.ceil(
    paper.paragraphs.reduce((n, p) => n + p.text.length, 0) / 4 / 500
  ));

  useEffect(() => {
    setQuotaHandler(() => {
      setToast('Storage is full. Clear some notes in Library.');
    });
    return () => setQuotaHandler(null);
  }, []);

  // Phase 12 D-A3 boot-time migration + D-D2 multi-config Realtime subscribe.
  // Pattern Mapper R4: migrate BEFORE subscribe so the Realtime payload from
  // our own INSERT doesn't double-apply. Migration is idempotent + silent —
  // a no-op after the first successful boot.
  useEffect(() => {
    let unsub: (() => void) | null = null;

    async function start() {
      // Migrate first (idempotent — flag-gated, so a no-op after first boot).
      try {
        await migrateLegacyByokV12();
      } catch (e) {
        console.warn('[byok-configs] migration error (non-blocking)', e);
      }
      // Phase 15 D-F1: retire any legacy anthropic-via-proxy BYOK entries +
      // (for Pro users) seed config_active_managed_model_id='claude-haiku-4-5-20251001'.
      // Idempotent + non-blocking — toast UI is owned by Plan 15-04 Task 2.5.
      try {
        await migrateAnthropicViaProxyToManaged();
      } catch (e) {
        console.warn('[managed-models] migration error (non-blocking)', e);
      }
      // Phase 16 D-D1: collapse openai/openrouter/custom preset rows to
      // 'openai-compatible'. Silent (D-D2 — no toast); idempotent +
      // non-blocking. Order matters: anthropic-via-proxy retire (Phase 15)
      // first, then preset id rewrite (Phase 16) — operates on disjoint
      // fields (Phase 15 matches name/base_url; Phase 16 rewrites preset).
      try {
        await migrateOpenAICompatV16();
      } catch (e) {
        console.warn('[openai-compat-v16] migration error (non-blocking)', e);
      }
      // Quick task 260507: rewrite preset='local-litellm' → 'openai-compatible'
      // (claude-code-openai-wrapper BYOK path retired). Silent + idempotent +
      // non-blocking. Order: must run AFTER openai-compat-v16 so a single boot
      // never sees both keys mid-flight on a cross-tab race; both helpers
      // operate on the same `preset` field but on disjoint id sets.
      try {
        await migrateLocalLitellmRemoval();
      } catch (e) {
        console.warn('[byok-local-litellm-removal] migration error (non-blocking)', e);
      }
      // Then subscribe Realtime if logged in.
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        unsub = subscribeByokConfigs(() => {
          // No-op handler: byok-configs.ts's listBYOKConfigs() is what
          // hydrates chrome.storage.local on demand; agent-client.ts reads
          // fresh via getActiveBYOKConfig() on every runAgent call.
        });
      }
    }
    void start();

    const { data: authListener } = supabase.auth.onAuthStateChange((evt, session) => {
      if (evt === 'SIGNED_IN' && session) {
        if (!unsub) unsub = subscribeByokConfigs(() => {});
        // NIT-1 + HIGH-1: onLogin_syncByokConfigs is responsible for pushing
        // the locally cached config (created by migrateLegacyByokV12 on a
        // logged-out boot) to cloud. The 23505 cross-tab race on the upload
        // path is owned by Plan 03 createBYOKConfig orphan cleanup.
        void onLogin_syncByokConfigs();
      }
      if (evt === 'SIGNED_OUT' && unsub) {
        unsub();
        unsub = null;
      }
    });

    return () => {
      if (unsub) unsub();
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Destroy the pdfjs document when the runtime swaps (new paper load) or
  // ViewerApp unmounts. `pdfRuntime` is React state — NEVER persisted on
  // Paper — so this cleanup is the sole owner of the pdfjs worker handle.
  useEffect(() => {
    return () => { pdfRuntime?.doc.destroy().catch(() => {}); };
  }, [pdfRuntime]);

  // Sync overlay with paper prop (new paper load resets memory baseline).
  useEffect(() => { setMemoryOverlay(paper.memory); }, [paper]);

  const effectivePaper: Paper = memoryOverlay ? { ...paper, memory: memoryOverlay } : paper;

  // Total pages (§3.4): PDF mode = max outline[].page; HTML mode = 0.
  const pages = Math.max(0, ...paper.outline.map((o) => o.page ?? 0));

  // Compute is-in-library state from the local 'library' key on paper change.
  // Read-only: NEVER writes a row (LIB-OPTIN-02 — open does not auto-save).
  const [isInLibrary, setIsInLibrary] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getLibrary().then((rows) => {
      if (cancelled) return;
      const k = paperKey(effectivePaper);
      setIsInLibrary(rows.some((r) => (r.id ?? r.urlHash) === k));
    });
    return () => { cancelled = true; };
  // intentionally [paper] not [effectivePaper] — match deleted line-565 dependency
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper]);

  const patchMemory = async (patch: Partial<Paper['memory']>) => {
    const base = memoryOverlay ?? paper.memory;
    const next = { ...base, ...patch };
    setMemoryOverlay(next);
    // Key is URL-derived so paperKey(paper) === paperKey(effectivePaper);
    // use effectivePaper for consistency with every other consumer below.
    await setMemory(paperKey(effectivePaper), next);
    // patchMemory uses the *new* memory for library sync — the overlay setter
    // above is async via React; build a one-shot shape here instead.
    await updateLibraryRow({ ...paper, memory: next }, pages, currentSrc);

    // §3.9 — memory edits change the system prompt; reset overview states
    // so the next tab switch re-triggers generation with fresh memory.
    setContributionsState({ kind: 'idle' });
    setKeywordsState({ kind: 'idle' });
  };

  const handleAddToLibrary = async () => {
    try {
      await addToLibrary(effectivePaper, pages, currentSrc);
      setIsInLibrary(true);
    } catch {
      // local storage write failed (chrome.storage.local.set threw); row is NOT saved.
      // Do NOT set isInLibrary=true — the paper is not in the library.
      setToast(t('topbar.add-to-library.add-failed'));
    }
  };

  const handleRemoveFromLibrary = async () => {
    const key = paperKey(effectivePaper);
    await removeLibraryEntry(key);
    setIsInLibrary(false);
    // Mirror library-drawer.tsx:361-367 — keep cloud row consistent with local
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await enqueue({
          table: 'papers',
          op: 'delete',
          row: { user_id: user.id, paper_key: key },
          ts: Date.now(),
        });
      }
    } catch {
      // best-effort cloud delete; local row already removed
    }
  };

  // Load current model + output language on mount + whenever config changes
  // via storage.onChanged.
  useEffect(() => {
    let cancelled = false;
    getConfig().then((c) => {
      if (cancelled) return;
      setModel(c?.model ?? '');
      setOutputLanguage(c?.outputLanguage ?? 'auto');
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      // Phase 17: v1.1 keys (config_apikey / config_prefs) retired — listener
      // watches Phase 12+13 multi-config keys plus config_outputLanguage.
      if (
        !('config_outputLanguage' in changes) &&
        !('config_byok_configs' in changes) &&
        !('config_apikeys' in changes) &&
        !('config_active_byok_config_id' in changes)
      ) return;
      getConfig().then((c) => {
        if (cancelled) return;
        setModel(c?.model ?? '');
        setOutputLanguage(c?.outputLanguage ?? 'auto');
      });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { cancelled = true; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);

  // Cross-tab sync: when another tab adds/removes the same paper, our button
  // state must reflect it. Read-only listener — only calls setIsInLibrary
  // (no writes, no cascade risk, mirrors status-rail.tsx:13-42 idiom) (T-28-06).
  useEffect(() => {
    const onLibraryChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !('library' in changes)) return;
      const newRows = (changes.library.newValue as import('./types').LibraryRow[] | undefined) ?? [];
      const k = paperKey(paper); // paper and effectivePaper share the same key (id/urlHash only)
      setIsInLibrary(newRows.some((r) => (r.id ?? r.urlHash) === k));
    };
    chrome.storage.onChanged.addListener(onLibraryChanged);
    return () => chrome.storage.onChanged.removeListener(onLibraryChanged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper]);

  const readerScrollRef = useRef<HTMLDivElement>(null);

  // Boot effect: schema migrate + restore context + load sessions/notes.
  useEffect(() => {
    let cancelled = false;
    // Phase 11 Plan 05: expose active paper key to writeCanvas client tool
    // (read via `window.__pfActivePaperPk` so the tool can persist agent nodes
    // under `paper:{pk}:canvas:agentNodes` without prop-drilling).
    window.__pfActivePaperPk = paperKey(paper);
    (async () => {
      const pk = paperKey(paper);
      await runSchemaMigrations_260424(pk);
      const ctx = await runRestoreContext_260424(pk);
      if (cancelled) return;
      setTab(ctx.tab);
      setActiveSubtab(ctx.activeSubtab);
      setActiveSessionIdState(ctx.activeChatSession);
      setSessions(await Sessions.listActiveSessions(pk));
      setNotes(await Notes.listNotes(pk));
      if (ctx.activeChatSession) {
        setChatMessages(await Sessions.loadMessages(pk, ctx.activeChatSession));
      }
      if (ctx.scroll != null) {
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: ctx.scroll! })));
      }
      restoredRef.current = true;
    })();
    return () => {
      cancelled = true;
      restoredRef.current = false;
      flushOnPaperChange(paperKey(paper));
      abortAllForPaper();
      delete window.__pfActivePaperPk;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper]);

  // Seed highlights from storage on mount.
  useEffect(() => {
    // Paper-swap sequence: the dedicated `[paper.urlHash]` cleanup above
    // clears `hl-yellow` first; then React sets `highlights` to the previous
    // paper's snapshot briefly (stale state, no DOM to paint against — the
    // querySelectorAll returns 0 scopes, register no-ops); this seed effect
    // fetches the new paper's highlights; the register effect re-runs with
    // fresh state and paints correctly. Clear-first is intentional.
    let cancelled = false;
    getHighlights(paperKey(paper)).then((hs) => {
      if (!cancelled) setHighlights(hs);
    });
    return () => { cancelled = true; };
  }, [paper]);

  // Seed legacy margin notes for CanvasView (MarginResult[]).
  useEffect(() => {
    let cancelled = false;
    getNotes(paperKey(paper)).then((ns) => {
      if (!cancelled) setResults(ns);
    });
    return () => { cancelled = true; };
  }, [paper]);

  // Lazy-load Overview when tab=overview (300ms dwell before AI calls).
  useEffect(() => {
    if (tab !== 'overview') return;
    const pk = paperKey(paper);
    const arxivId = paper.id ?? null;
    fetchOverviewMeta(pk, arxivId).then((m) => setOverviewMeta(m));
    const t1 = setTimeout(() => {
      void ensureOverview(pk, paper, 'contributions', model, outputLanguage, setContributionsState);
      void ensureOverview(pk, paper, 'keywords', model, outputLanguage, setKeywordsState);
    }, 300);
    return () => clearTimeout(t1);
  }, [tab, paper, model, outputLanguage]);

  // Persist tab + subtab + scroll + lastVisit.
  // Guard: only write after boot restore has completed, so we don't clobber
  // the saved tab/subtab with default values on first render (Problem E).
  useEffect(() => {
    if (!restoredRef.current) return;
    const pk = paperKey(paper);
    void chrome.storage.local.set({ [`paper:${pk}:workspace:tab`]: tab });
  }, [tab, paper]);

  useEffect(() => {
    if (!restoredRef.current) return;
    const pk = paperKey(paper);
    void chrome.storage.local.set({ [`paper:${pk}:note:activeSubtab`]: activeSubtab });
  }, [activeSubtab, paper]);

  useEffect(() => {
    const pk = paperKey(paper);
    let timer: number | null = null;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void chrome.storage.local.set({ [`paper:${pk}:scroll`]: window.scrollY }); }, 1000) as unknown as number;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
      void chrome.storage.local.set({ [`paper:${pk}:lastVisit`]: Date.now() });
    };
  }, [paper]);

  // First-run shortcut toast (⌘\ changed from outline → workspace toggle).
  useEffect(() => {
    (async () => {
      const seen = await chrome.storage.local.get('shortcutToastSeen:260424');
      if (seen['shortcutToastSeen:260424']) return;
      setToast(t('shortcut.toast.260424') || '⌘\\ now toggles the right panel (Outline retired).');
      await chrome.storage.local.set({ 'shortcutToastSeen:260424': 1 });
    })();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Scroll spy: track the paragraph whose top is nearest (but ≤) the viewport
  // mid-line, and reflect its sectionId into `activeSectionId` so OutlinePanel
  // can highlight the corresponding entry (§8.4).
  useEffect(() => {
    // PDF mode: scroll-spy derives activeSectionId from currentPdfPage
    // (computed by the breadcrumb effect). Text-layer spans are not in
    // visual reading order, so the HTML-style span-walk is incorrect here.
    if (pdfRuntime) return;

    const container = readerScrollRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      const rect = container.getBoundingClientRect();
      const mid = rect.top + container.clientHeight / 2;
      const pEls = Array.from(container.querySelectorAll<HTMLElement>('[data-pid]'));
      if (pEls.length === 0) return;
      let chosen: HTMLElement | null = pEls[0];
      for (const el of pEls) {
        if (el.getBoundingClientRect().top <= mid) chosen = el;
        else break;
      }
      const pid = chosen?.getAttribute('data-pid');
      if (!pid) return;
      const para = paper.paragraphs.find((p) => p.id === pid);
      if (para) setActiveSectionId(para.sectionId);
    };

    const onScroll = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(compute, 120);
    };
    container.addEventListener('scroll', onScroll);
    const initial = setTimeout(compute, 200);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearTimeout(initial);
      container.removeEventListener('scroll', onScroll);
    };
  }, [paper, pdfRuntime]);

  // PDF scroll-spy: derive activeSectionId from currentPdfPage. Page N maps
  // to outline[N-1] by construction of the per-page fallback outline in
  // parsePdf. Piggybacks on the breadcrumb effect's page computation, which
  // uses page offsetTop (visually ordered) rather than text-layer spans.
  useEffect(() => {
    if (!pdfRuntime) return;
    const sectionId = paper.outline[currentPdfPage - 1]?.id;
    if (sectionId) setActiveSectionId(sectionId);
  }, [pdfRuntime, currentPdfPage, paper]);

  // PDF page breadcrumb (§3.4 / §9): infer current page from scrollTop + page
  // offsetTop, since pdfjs library mode doesn't emit `pageNumber` events.
  // HTML mode resets to 1 so switching papers doesn't leak stale state.
  useEffect(() => {
    if (!pdfRuntime) { setCurrentPdfPage(1); return; }
    const container = readerScrollRef.current;
    if (!container) return;

    // Cache the .pf-pdf-page NodeList; re-query only when its length doesn't
    // match doc.numPages (skeletons not all mounted yet). Once stable, avoids
    // per-scroll-tick querySelectorAll on 50+ page PDFs.
    // Invariant: PdfPage mounts its root unconditionally and never unmounts
    // during a paper's lifetime, so a stable cache never contains detached
    // nodes. If that ever changes, add a MutationObserver-based invalidator.
    const expected = pdfRuntime.doc.numPages;
    let cached: HTMLElement[] | null = null;
    const getPages = (): HTMLElement[] => {
      if (cached && cached.length === expected) return cached;
      cached = Array.from(container.querySelectorAll<HTMLElement>('.pf-pdf-page'));
      return cached;
    };

    let t: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      const pages = getPages();
      const viewportMid = container.scrollTop + container.clientHeight / 2;
      const idx = pages.findIndex((p) => p.offsetTop + p.offsetHeight > viewportMid);
      // When findIndex returns -1 (scrolled past the last page), clamp to the
      // last page so the breadcrumb reflects the bottom of the document.
      const current = idx === -1 ? Math.max(1, pages.length) : idx + 1;
      setCurrentPdfPage(current);
    };
    const onScroll = () => {
      if (t) clearTimeout(t);
      t = setTimeout(compute, 60);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    compute();
    return () => {
      if (t) clearTimeout(t);
      container.removeEventListener('scroll', onScroll);
    };
  }, [pdfRuntime]);

  // Paper-swap cleanup: clear any leftover highlight paint when navigating to
  // a different paper, or on unmount. Intentionally runs FIRST (via effect
  // ordering) so the register effect below starts fresh. Splitting cleanup
  // from register avoids a 1-frame "unpainted" flicker when only `highlights`
  // changes — CSS.highlights.set replaces atomically, no delete needed.
  useEffect(() => {
    return () => {
      if (typeof CSS !== 'undefined' && (CSS as any).highlights) {
        (CSS as any).highlights.delete('hl-yellow');
      }
    };
  }, [paper.urlHash]);

  // Register highlights via CSS Custom Highlight API. Listens for
  // `pf-textlayer-ready` so lazy-mounted PdfPages get paint on reveal.
  // `CSS.highlights.set('hl-yellow', ...)` replaces atomically on each call,
  // so no cleanup-delete is needed on re-run — the paper-swap effect above
  // handles the only case where a delete is required.
  useEffect(() => {
    const container = readerScrollRef.current;
    if (!container) return;
    const register = () => {
      registerPaperHighlights(container, highlights);
    };
    register();
    container.addEventListener('pf-textlayer-ready', register);
    return () => {
      container.removeEventListener('pf-textlayer-ready', register);
    };
  }, [highlights, paper.urlHash]);

  // Click hit-test on highlighted spans → show "remove highlight" popover.
  //
  // CSS Custom Highlight ranges are not directly hit-testable (they're a
  // paint-only overlay), so we listen at the reader scroll container, find
  // the target paragraph via [data-pid], then re-derive each highlight's
  // ranges in that paragraph and check whether the click point lands inside
  // any rect from getClientRects(). The popover anchors to viewport coords
  // (position: fixed) and dismisses on scroll/resize/Esc/outside-click.
  useEffect(() => {
    const container = readerScrollRef.current;
    if (!container) return;
    if (highlights.length === 0) return;
    const onClick = (e: globalThis.MouseEvent) => {
      // Skip when there's an active text selection — that's the selection-
      // toolbar's territory; opening both at once is confusing.
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Don't re-trigger when clicking the popover's own button.
      if (target.closest('[data-highlight-popover]')) return;
      const pidEl = target.closest('[data-pid]');
      if (!pidEl) return;
      const pid = pidEl.getAttribute('data-pid');
      if (!pid) return;
      const paragraphHighlights = highlights.filter((h) => h.paragraphId === pid);
      if (paragraphHighlights.length === 0) return;
      const x = e.clientX;
      const y = e.clientY;
      for (const h of paragraphHighlights) {
        const ranges = findHighlightRangesForParagraph(container, pid, h.text);
        for (const r of ranges) {
          for (const rect of r.getClientRects()) {
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
              setHighlightPopover({ paragraphId: pid, text: h.text, left: x, top: rect.top });
              return;
            }
          }
        }
      }
    };
    container.addEventListener('click', onClick);
    return () => { container.removeEventListener('click', onClick); };
  }, [highlights, paper.urlHash]);

  // Dismiss the highlight popover on scroll, resize, Esc, or outside click.
  // Outside-click runs at the document level so it catches clicks anywhere
  // outside the popover including other reader chrome.
  useEffect(() => {
    if (!highlightPopover) return;
    const close = () => setHighlightPopover(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onPointer = (e: globalThis.MouseEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest('[data-highlight-popover]')) return;
      // Let the click hit-test effect above handle "click on a different
      // highlight" — pre-clearing here would race it.
      if (t instanceof Element && t.closest('[data-pid]')) {
        const pidEl = t.closest('[data-pid]');
        const pid = pidEl?.getAttribute('data-pid');
        const sameParagraph = pid === highlightPopover.paragraphId;
        if (sameParagraph) {
          // Could be another highlight in the same paragraph — let the
          // click handler decide. If it doesn't open a new popover, an
          // immediate setTimeout(close) keeps the current one from
          // sticking on a non-highlight click.
          setTimeout(close, 0);
          return;
        }
      }
      close();
    };
    const container = readerScrollRef.current;
    container?.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      container?.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [highlightPopover]);

  // Live selection highlight + pointer-driven selection construction for
  // PDF text layers.
  //
  // Why pointer-driven: pdfjs emits each text run as its own absolutely-
  // positioned <span>. Chrome's mouse-drag selection on absolutely-
  // positioned elements produces wildly unreliable ranges:
  //
  // - Drag within a span: OK (single-span range).
  // - Drag overshoot (even 10px past a span's right edge): Chrome sets
  //   endContainer to a SPAN element far down in DOM at offset=0 — a
  //   range that spans hundreds of unintended lines. `sel.toString()`
  //   returns 4000+ chars from unrelated sections.
  // - Multi-line drag: Chrome cuts middle lines at the pointer's X
  //   coordinate (rectangle selection), not the natural end-of-line.
  //
  // Fix: on pointerdown in a text layer, record the caret position at
  // the cursor via caretPositionFromPoint; on pointermove, compute the
  // focus caret the same way and build a DOM range between them. Middle
  // spans are automatically fully included by DOM-range semantics. The
  // range goes back into the native Selection (so copy-paste returns
  // exactly what was highlighted) and into the `pf-selection` Custom
  // Highlight (which paints continuous per-line rectangles, bridging
  // the per-span seams left by native ::selection paint).
  //
  // HTML-mode text uses normal flow layout — Chrome's native selection
  // there works fine and we intentionally don't touch it.
  useEffect(() => {
    if (typeof CSS === 'undefined' || !(CSS as any).highlights) return;
    const highlightsApi = (CSS as any).highlights as Map<string, unknown>;
    const HighlightCtor: any = (window as any).Highlight;
    if (!HighlightCtor) return;

    const clear = () => { highlightsApi.delete('pf-selection'); };

    const spanForNode = (node: Node, layer: Element): HTMLSpanElement | null => {
      let n: Node | null = node;
      while (n && n !== layer) {
        if (n instanceof HTMLSpanElement && n.parentElement === layer) return n;
        n = n.parentNode;
      }
      return null;
    };

    // Polyfill wrapper — document.caretPositionFromPoint is the spec;
    // older Chrome versions only expose caretRangeFromPoint.
    const caretAt = (x: number, y: number): { node: Node; offset: number } | null => {
      const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      if (doc.caretPositionFromPoint) {
        const p = doc.caretPositionFromPoint(x, y);
        if (p && p.offsetNode) return { node: p.offsetNode, offset: p.offset };
      }
      if (doc.caretRangeFromPoint) {
        const r = doc.caretRangeFromPoint(x, y);
        if (r) return { node: r.startContainer, offset: r.startOffset };
      }
      return null;
    };

    // Caret clamped to a span inside `layer`. If caretPositionFromPoint
    // returns a position inside a span, use it. Otherwise find the span
    // visually closest to (x, y) and compute an offset within its text
    // based on the pointer's X relative to the span's bounding box.
    // This is the key to surviving drags that overshoot past a span's
    // right edge — Chrome's native selection loses its mind there, but
    // we just snap to the nearest in-layer text.
    const snapCaret = (
      x: number, y: number, layer: Element,
    ): { node: Node; offset: number } | null => {
      const raw = caretAt(x, y);
      if (raw && spanForNode(raw.node, layer)) return raw;
      const spans = Array.from(
        layer.querySelectorAll(':scope > span'),
      ) as HTMLSpanElement[];
      let best: HTMLSpanElement | null = null;
      let bestDist = Infinity;
      for (const s of spans) {
        const r = s.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const dx = Math.max(0, Math.max(r.left - x, x - r.right));
        const dy = Math.max(0, Math.max(r.top - y, y - r.bottom));
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; best = s; }
      }
      if (!best) return null;
      const text = best.firstChild;
      if (!(text instanceof Text)) return null;
      const r = best.getBoundingClientRect();
      if (x <= r.left) return { node: text, offset: 0 };
      if (x >= r.right) return { node: text, offset: text.length };
      const frac = (x - r.left) / r.width;
      return { node: text, offset: Math.round(frac * text.length) };
    };

    // Given two carets (anchor, focus) inside the same text layer,
    // produce a DOM range that covers anchor→focus in document order,
    // fully including every span in between.
    const buildRange = (
      layer: Element,
      anchor: { node: Node; offset: number },
      focus: { node: Node; offset: number },
    ): Range | null => {
      const anchorSpan = spanForNode(anchor.node, layer);
      const focusSpan = spanForNode(focus.node, layer);
      if (!anchorSpan || !focusSpan) return null;
      const pos = anchorSpan.compareDocumentPosition(focusSpan);
      const focusAfter = (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const sameSpan = anchorSpan === focusSpan;

      let startNode: Node, startOff: number, endNode: Node, endOff: number;
      if (sameSpan) {
        if (anchor.offset <= focus.offset) {
          startNode = anchor.node; startOff = anchor.offset;
          endNode = focus.node;    endOff = focus.offset;
        } else {
          startNode = focus.node;  startOff = focus.offset;
          endNode = anchor.node;   endOff = anchor.offset;
        }
      } else if (focusAfter) {
        startNode = anchor.node; startOff = anchor.offset;
        endNode = focus.node;    endOff = focus.offset;
      } else {
        startNode = focus.node;  startOff = focus.offset;
        endNode = anchor.node;   endOff = anchor.offset;
      }

      const range = document.createRange();
      try {
        range.setStart(startNode, startOff);
        range.setEnd(endNode, endOff);
      } catch {
        return null;
      }
      return range;
    };

    // Pointer-drag state.
    let anchor: { node: Node; offset: number } | null = null;
    let anchorLayer: Element | null = null;
    let dragging = false;

    const applyRange = (range: Range) => {
      const sel = document.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      try {
        highlightsApi.set('pf-selection', new HighlightCtor(range));
      } catch {
        clear();
      }
    };

    // Mousedown on a PDF text layer: intercept and preventDefault so
    // Chrome's native drag-selection never begins. Pointerdown's
    // preventDefault doesn't cancel the mousedown default; we must
    // handle mousedown itself.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const layer = target.closest('.pf-pdf-text-layer');
      if (!layer) return;
      const pos = snapCaret(e.clientX, e.clientY, layer);
      if (!pos) return;
      e.preventDefault();
      anchor = pos;
      anchorLayer = layer;
      dragging = true;
      const collapsed = document.createRange();
      collapsed.setStart(pos.node, pos.offset);
      collapsed.setEnd(pos.node, pos.offset);
      const s = document.getSelection();
      if (s) { s.removeAllRanges(); s.addRange(collapsed); }
      clear();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging || !anchor || !anchorLayer) return;
      const pos = snapCaret(e.clientX, e.clientY, anchorLayer);
      if (!pos) return;
      const range = buildRange(anchorLayer, anchor, pos);
      if (range && !range.collapsed) applyRange(range);
    };

    const onMouseUp = () => {
      anchor = null;
      anchorLayer = null;
      dragging = false;
    };

    // Fallback for selections made without a pointer drag (keyboard,
    // double/triple click, shift-click). Just mirror native selection
    // into the Custom Highlight — don't rewrite it.
    const onSelectionChange = () => {
      if (dragging) return;
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        clear();
        return;
      }
      const range = sel.getRangeAt(0);
      const anc = range.commonAncestorContainer;
      const el = anc instanceof Element ? anc : anc.parentElement;
      if (!el?.closest('.pf-pdf-text-layer')) {
        clear();
        return;
      }
      try {
        highlightsApi.set('pf-selection', new HighlightCtor(range));
      } catch {
        clear();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      clear();
    };
  }, [paper.urlHash]);

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  const runAction = useCallback(async (kind: SelectionActionKind, sel: TextSelection) => {
    // Clear selection UI early regardless of action branch.
    setSelection(null);
    window.getSelection()?.removeAllRanges();

    if (kind === 'note') {
      setEditingNote({ rect: sel.rect, quote: sel.text, loc: { paragraph: sel.paragraphId }, initial: '' });
      return;
    }

    if (kind === 'highlight') {
      if (!sel.paragraphId) { setToast('Selection must be inside a paragraph to highlight.'); return; }
      if (sel.paragraphId === 'abs') { setToast("Highlights on the abstract aren't supported yet."); return; }
      const pid = sel.paragraphId;
      let next;
      try {
        next = await addHighlight(paperKey(paper), {
          paragraphId: pid, text: sel.text, color: 'yellow',
        });
      } catch (err) {
        if (err instanceof QuotaError) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setToast(`Highlight failed: ${msg.slice(0, 140)}`);
        return;
      }
      setHighlights(next);
      updateLibraryRow(effectivePaper, pages, currentSrc).catch(() => {});
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-pid="${pid}"]`);
        if (!el) return;
        el.classList.add('paragraph-pinged');
        setTimeout(() => el.classList.remove('paragraph-pinged'), 900);
      });
      // Dispatch to new Notes store so NoteView reflects the highlight.
      const pk = paperKey(paper);
      const result = await runSelectionAction({
        kind: 'highlight', paperKey: pk, paper, sel,
        currentSessionId: activeSessionId, model, lang: outputLanguage,
      });
      setNotes(await Notes.listNotes(pk));
      if (shouldSyncNote('highlight')) {
        // A5 fix: highlights live in their own `highlights` table (margin_notes
        // is for AI/note kinds — its schema has no `quote` column, which made
        // every prior write 503 with PGRST204). `paper_key` is virtual; sync
        // queue resolves it to papers.id at drain time.
        void enqueue({
          table: 'highlights',
          op: 'upsert',
          row: {
            id: result.actionId,
            paper_key: pk,
            paragraph_id: sel.paragraphId ?? '',
            text: sel.text,
            created_at: new Date().toISOString(),
          },
          ts: Date.now(),
        });
      }
      return;
    }

    // explain or translate — AI streaming via runSelectionAction
    const pk = paperKey(paper);
    try {
      const result = await runSelectionAction({
        kind, paperKey: pk, paper, sel,
        currentSessionId: activeSessionId, model, lang: outputLanguage,
        onChatPatch: (_sid, msgId, text) => setChatMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, text } : m)),
        onNotePatch: (id, body) => setNotes((prev) => prev.map((n) => n.id === id ? { ...n, aiAnswer: body } : n)),
        onMessagesAppended: async (sid, msgs) => {
          setActiveSessionIdState(sid);
          setChatMessages(msgs);
          setSessions(await Sessions.listActiveSessions(pk));
        },
        onActionStreamStart: (id) => setActionStreamingIds((prev) => { const n = new Set(prev); n.add(id); return n; }),
        onActionStreamEnd:   (id) => setActionStreamingIds((prev) => { const n = new Set(prev); n.delete(id); return n; }),
      });
      setSessions(await Sessions.listActiveSessions(pk));
      if (result.sessionId) {
        setActiveSessionIdState(result.sessionId);
        setChatMessages(await Sessions.loadMessages(pk, result.sessionId));
      }
      setNotes(await Notes.listNotes(pk));
      // Brief ink-ping animation on the source paragraph.
      if (sel.paragraphId) {
        const pid = sel.paragraphId;
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-pid="${pid}"]`);
          if (!el) return;
          el.classList.add('paragraph-pinged');
          setTimeout(() => el.classList.remove('paragraph-pinged'), 900);
        });
      }
    } catch (err) {
      if (err instanceof ProxyError) await handleProxyError(err);
      else setToast(t('error.500.nobyok'));
    } finally {
      setAskPrefill(null);
    }
  }, [paper, effectivePaper, variant, memoryOverlay, pages, activeSessionId, model, outputLanguage]);

  const onSummarizePaper = useCallback(() => {
    setVariant('classic');
    setTab('overview');
  }, []);

  const onTranslatePage = useCallback(async () => {
    const container = readerScrollRef.current;
    if (!container) return;
    const visible = getVisibleParagraphs(container);
    if (visible.length === 0) { setToast('No paragraphs visible on this page.'); return; }
    // Translate each visible paragraph by kicking off a runAction call.
    // Each call handles streaming/persistence independently.
    for (const el of visible) {
      const pid = el.getAttribute('data-pid');
      if (!pid) continue;
      const para = effectivePaper.paragraphs.find((p) => p.id === pid);
      if (!para) continue;
      await runAction('translate', {
        text: para.text,
        paragraphId: pid,
        rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0 },
      });
    }
  }, [effectivePaper, runAction]);

  const onAskAboutPaper = useCallback(() => {
    setChatOpen(true);
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>('.pf-chat-composer');
      el?.focus();
    }, 100);
  }, [setChatOpen]);

  const focusMemoryField = useCallback((field: 'role' | 'judgment' | 'linked') => {
    setVariant('classic');
    setTab('memory');
    setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>(`.pf-mem-edit-${field}`);
      btn?.click();
    }, 100);
  }, []);

  const onSetRole       = useCallback(() => focusMemoryField('role'),     [focusMemoryField]);
  const onWriteJudgment = useCallback(() => focusMemoryField('judgment'), [focusMemoryField]);
  const onLinkPaper     = useCallback(() => focusMemoryField('linked'),   [focusMemoryField]);

  // Chat send handler — wired to ChatPanel's onSend prop.
  // Uses Sessions.appendMessage to persist, then streams via callAI.
  const onChatSend = useCallback(async (userText: string, pinnedSelection: string | null) => {
    const config = await getConfig();

    // Ask prefill wraps the user message per §3.7.5.
    const finalUserText = pinnedSelection
      ? `About this passage:\n> ${pinnedSelection}\n\n${userText || 'What does this mean?'}`
      : userText;

    const pk = paperKey(paper);

    // Ensure an active session exists.
    let sid = activeSessionId;
    if (!sid) {
      const s = await Sessions.createSession(pk);
      await Sessions.setActive(pk, s.id);
      setSessions(await Sessions.listActiveSessions(pk));
      setActiveSessionIdState(s.id);
      sid = s.id;
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      text: finalUserText,
      createdAt: Date.now(),
    };
    const assistantId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const assistantPending: ChatMessage = {
      id: assistantId, role: 'assistant', text: '', createdAt: Date.now(),
    };

    // Snapshot prior history BEFORE appending so buildChatMessages sees correct turns.
    const priorHistory = chatMessages;

    setChatMessages((prev) => [...prev, userMsg, assistantPending]);
    setAskPrefill(null);
    // Mark this session as streaming BEFORE awaiting any storage write so the
    // typing indicator flashes immediately even if appendMessage takes a tick.
    setStreamingBySession((prev) => new Map(prev).set(sid!, assistantId));

    try {
      // Persist BOTH the user message and the empty assistant placeholder
      // up front. Without persisting the placeholder, switching sessions
      // mid-stream loses the assistant message — patchMessage at end of
      // stream is a list.map() that no-ops if the id isn't already there.
      await Sessions.appendMessage(pk, sid, userMsg);
      await Sessions.appendMessage(pk, sid, assistantPending);
    } catch (err) {
      setChatMessages((prev) => prev.filter((m) => m.id !== userMsg.id && m.id !== assistantId));
      setStreamingBySession((prev) => { const n = new Map(prev); n.delete(sid!); return n; });
      if (err instanceof QuotaError) return;
      const msg = err instanceof Error ? err.message : String(err);
      setToast(`AI request failed: ${msg.slice(0, 140)}`);
      return;
    }

    const messages = buildChatMessages(effectivePaper, priorHistory, finalUserText, config?.outputLanguage);

    let accum = '';
    // Throttled persist of partial text. UI updates run on every chunk for
    // smoothness; storage writes run at most once per ~400ms. Without this,
    // returning to a session mid-stream loads stale storage and only catches
    // up on the next chunk — which can be many seconds away on slow models.
    let lastPersistTs = 0;
    const PERSIST_INTERVAL_MS = 400;
    // Per-stream AbortController so the stop button can cancel mid-flight.
    // Stored in the per-session map so the button (which only knows the
    // active sid) can find it.
    const ctrl = new AbortController();
    chatAbortRef.current.set(sid, ctrl);
    try {
      await callAI(messages, 'chat', (chunk) => {
        accum += chunk;
        // UI: prev.map is a no-op if the user has switched away (their
        // chatMessages array no longer contains assistantId), so this is
        // safe to fire unconditionally. When they switch back, the next
        // tick of loadMessages re-seeds prev with the persisted partial.
        setChatMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, text: accum } : m)
        );
        const now = Date.now();
        if (now - lastPersistTs > PERSIST_INTERVAL_MS) {
          lastPersistTs = now;
          // Fire-and-forget; ordering across patches is fine because each
          // write carries the full accum string.
          void Sessions.patchMessage(pk, sid!, assistantId, { text: accum });
        }
      }, {
        signal: ctrl.signal,
        // Quick 260506-8ov: per-chat-request telemetry (DevTools console; opt-in in prod).
        telemetry: { paperId: effectivePaper.id ?? effectivePaper.urlHash ?? null, sessionId: sid },
      });

      // Citation pass at stream done (§3.7.4 — never during stream).
      const citations = extractCitations(accum, effectivePaper);
      const completed: ChatMessage = {
        ...assistantPending,
        text: accum,
        citations: citations.length > 0 ? citations : undefined,
      };
      setChatMessages((prev) =>
        prev.map((m) => m.id === assistantId ? completed : m)
      );
      await Sessions.patchMessage(pk, sid, assistantId, completed);
      setSessions(await Sessions.listActiveSessions(pk));
    } catch (err: any) {
      // User clicked stop. Keep whatever partial text was streamed (already
      // persisted via throttled patches) and finalize. No toast — the abort
      // was user-initiated, not an error.
      if (err?.name === 'AbortError' || ctrl.signal.aborted) {
        if (accum) {
          const completed: ChatMessage = { ...assistantPending, text: accum };
          setChatMessages((prev) => prev.map((m) => m.id === assistantId ? completed : m));
          await Sessions.patchMessage(pk, sid, assistantId, completed);
        } else {
          // Nothing arrived before abort — drop the empty placeholder.
          setChatMessages((prev) => prev.filter((m) => m.id !== assistantId));
          await Sessions.removeMessage(pk, sid, assistantId);
        }
        return;
      }
      if (err instanceof ProxyError) {
        setChatMessages((prev) => prev.filter((m) => m.id !== assistantId));
        await Sessions.removeMessage(pk, sid, assistantId);
        await handleProxyError(err);
        return;
      }
      if (err instanceof QuotaError) {
        setChatMessages((prev) => prev.filter((m) => m.id !== assistantId));
        await Sessions.removeMessage(pk, sid, assistantId);
        return;
      }
      // Slice 3 #12: codex relogin / api-changed → action toast instead of a
      // raw status-code message the user can't act on.
      if (surfaceCodexError(err)) {
        setChatMessages((prev) => prev.filter((m) => m.id !== assistantId));
        await Sessions.removeMessage(pk, sid, assistantId);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setToast(`AI request failed: ${msg.slice(0, 140)}`);
      setChatMessages((prev) => prev.filter((m) => m.id !== assistantId));
      await Sessions.removeMessage(pk, sid, assistantId);
    } finally {
      if (chatAbortRef.current.get(sid!) === ctrl) chatAbortRef.current.delete(sid!);
      setStreamingBySession((prev) => {
        if (prev.get(sid!) !== assistantId) return prev;  // stale; another stream took over
        const n = new Map(prev); n.delete(sid!); return n;
      });
    }
  }, [paper, effectivePaper, chatMessages, activeSessionId]);

  // Note save handler — called from NoteEditorPopover.
  const handleNoteSave = useCallback(async (text: string) => {
    if (!editingNote) return;
    const pk = paperKey(paper);
    const id = crypto.randomUUID();
    const now = Date.now();
    await Notes.upsertNote(pk, {
      id, kind: 'note', quote: editingNote.quote, loc: editingNote.loc,
      userText: text, createdAt: now, updatedAt: now,
    });
    setNotes(await Notes.listNotes(pk));
    setEditingNote(null);
    setAskPrefill(null);
    if (shouldSyncNote('note')) {
      // A5 fix: align with margin_notes production schema (paper_id uuid /
      // paragraph_id / source / body) — prior payload was {id, kind, quote}
      // which 503'd with PGRST204 for the missing `quote` column. drain()
      // resolves paper_key → papers.id + fills user_id from session.
      void enqueue({
        table: 'margin_notes',
        op: 'upsert',
        row: {
          id,
          paper_key: pk,
          paragraph_id: editingNote.loc?.paragraphId ?? '',
          kind: 'note',
          source: editingNote.quote ?? '',
          body: text,
          created_at: new Date(now).toISOString(),
        },
        ts: now,
      });
    }
  }, [editingNote, paper]);

  // Cross-jump: scroll NoteView to a note card.
  const jumpToNote = useCallback((actionId: string, kind: NoteKind) => {
    setTab('note');
    setActiveSubtab(kind);
    setFlashNoteId(actionId);
    setTimeout(() => setFlashNoteId(null), 700);
  }, []);

  // Cross-jump: scroll the paper view to the note's source paragraph and ping it.
  const jumpToSource = useCallback((n: Note) => {
    const pid = n.loc?.paragraphId;
    if (!pid) {
      console.warn('[jumpToSource] note has no paragraphId — created before that field existed', n);
      return;
    }
    const target = document.querySelector<HTMLElement>(`[data-pid="${CSS.escape(pid)}"]`);
    if (!target) {
      console.warn(`[jumpToSource] no [data-pid="${pid}"] in DOM — paper may not be rendered yet`);
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('paragraph-pinged');
    setTimeout(() => target.classList.remove('paragraph-pinged'), 1000);
  }, []);

  // Cross-jump: open ChatPanel on a specific session linked to a note.
  const jumpToChat = useCallback(async (n: Note) => {
    if (!n.chatSessionId) return;
    setChatOpen(true);
    const pk = paperKey(paper);
    setActiveSessionIdState(n.chatSessionId);
    setChatMessages(await Sessions.loadMessages(pk, n.chatSessionId));
  }, [paper, setChatOpen]);

  // Delete session with 5s undo (soft-delete: sets deletedAt, keeps messages).
  const handleDeleteSession = useCallback(async (sid: string) => {
    const pk = paperKey(paper);
    const target = (await Sessions.listSessions(pk)).find((s) => s.id === sid);
    if (!target) return;
    await Sessions.deleteSession(pk, sid);
    setSessions(await Sessions.listActiveSessions(pk));
    if (activeSessionId === sid) { setActiveSessionIdState(null); setChatMessages([]); }
    pushSnapshot({
      paperKey: pk, kind: 'chat-session', payload: { sessionId: sid },
      onExpire: () => {},
      onRestore: async () => {
        await Sessions.restoreSession(pk, sid);
        setSessions(await Sessions.listActiveSessions(pk));
      },
    });
    showUndoToast({ text: t('delete.toast.session') || 'Conversation deleted', onUndo: () => { void tryUndo(); } });
  }, [paper, activeSessionId]);

  // Permanent delete from history drawer — no undo.
  const handleHardDeleteSession = useCallback(async (sid: string) => {
    const pk = paperKey(paper);
    const ok = window.confirm(t('chat.history.hardDeleteConfirm') || '永久删除此对话？此操作不可撤销。');
    if (!ok) return;
    await Sessions.hardDeleteSession(pk, sid);
    setSessions(await Sessions.listActiveSessions(pk));
    if (activeSessionId === sid) { setActiveSessionIdState(null); setChatMessages([]); }
  }, [paper, activeSessionId]);

  // Restore a soft-deleted session from history drawer and switch to it.
  const handleRestoreAndSwitch = useCallback(async (sid: string) => {
    const pk = paperKey(paper);
    await Sessions.restoreSession(pk, sid);
    setSessions(await Sessions.listActiveSessions(pk));
    setActiveSessionIdState(sid);
    setChatMessages(await Sessions.loadMessages(pk, sid));
    await Sessions.setActive(pk, sid);
  }, [paper]);

  // Resolve which row in `paper:{pk}:highlights` corresponds to a kind:'highlight'
  // Note. New notes carry the full `paragraphId` (sec0-p2) on `loc.paragraphId`;
  // legacy highlight notes only have the lossy numeric `loc.paragraph` and we
  // best-effort match by suffix (`-p<N>`) plus quote text. Returns null if we
  // can't unambiguously identify the row.
  const resolveHighlightForNote = useCallback(async (n: Note): Promise<Highlight | null> => {
    if (n.kind !== 'highlight') return null;
    const pid = n.loc?.paragraphId;
    const list = await getHighlights(paperKey(paper));
    if (pid) {
      return list.find((h) => h.paragraphId === pid && h.text === n.quote) ?? null;
    }
    if (typeof n.loc?.paragraph === 'number') {
      const suffix = `-p${n.loc.paragraph}`;
      return list.find((h) => h.paragraphId.endsWith(suffix) && h.text === n.quote) ?? null;
    }
    return null;
  }, [paper]);

  // Delete note with 5s undo. For kind:'highlight', also wipes the matching
  // row from `paper:{pk}:highlights` so the painted highlight in the paper
  // disappears in lockstep with the note card; restore on undo re-adds both.
  const handleDeleteNote = useCallback(async (n: Note) => {
    const pk = paperKey(paper);
    const hl = await resolveHighlightForNote(n);
    if (hl) {
      const next = await removeHighlight(pk, hl.paragraphId, hl.text);
      setHighlights(next);
    }
    await Notes.deleteNote(pk, n.id);
    setNotes(await Notes.listNotes(pk));
    pushSnapshot({
      paperKey: pk, kind: 'note-card', payload: n,
      onExpire: () => {},
      onRestore: async () => {
        await Notes.upsertNote(pk, n);
        setNotes(await Notes.listNotes(pk));
        if (hl) {
          const next = await addHighlight(pk, hl);
          setHighlights(next);
        }
      },
    });
    const toastKey = n.kind === 'highlight' ? 'delete.toast.highlight' : 'delete.toast.note';
    const toastFallback = n.kind === 'highlight' ? 'Highlight deleted' : 'Note deleted';
    showUndoToast({ text: t(toastKey) || toastFallback, onUndo: () => { void tryUndo(); } });
  }, [paper, resolveHighlightForNote]);

  // Paper-side delete: invoked by the floating popover when the user clicks
  // a highlight span. We look up the corresponding kind:'highlight' Note and
  // route through `handleDeleteNote` so the undo snapshot path stays unified.
  // If no Note matches (orphan highlight from a pre-sync bug), we fall back
  // to a plain highlight remove with no undo toast.
  const handleDeleteHighlightFromPaper = useCallback(async (
    paragraphId: string, text: string,
  ): Promise<void> => {
    const pk = paperKey(paper);
    const all = await Notes.listNotes(pk);
    const note = all.find((n) =>
      n.kind === 'highlight' && n.quote === text && (
        n.loc?.paragraphId === paragraphId
        || (typeof n.loc?.paragraph === 'number'
          && paragraphId.endsWith(`-p${n.loc.paragraph}`))
      )
    );
    if (note) {
      await handleDeleteNote(note);
      return;
    }
    const next = await removeHighlight(pk, paragraphId, text);
    setHighlights(next);
  }, [paper, handleDeleteNote]);

  // jumpToNote wired to ChatPanel → ActionCard → Note jump button.
  // chunks used transitively for quota estimates; keep declaration.
  void chunks;

  // Global keydown handler (§3.3). ⌘-combos fire regardless of focus;
  // selection-dependent E/H/N/T are skipped when focus is in editable fields.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setCmdKOpen(true); return;
      }
      // ⌘\ toggles left workspace panel (outline retired).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === '\\') {
        e.preventDefault(); setWorkspaceOpen((v) => !v); return;
      }
      // ⌘⇧\ toggles right chat panel.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '\\') {
        e.preventDefault(); setChatOpen(!chatOpen); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault(); setLibraryOpen(true); return;
      }

      if (isEditable) return;
      if (!selection || e.metaKey || e.ctrlKey) return;

      const k = e.key.toLowerCase();
      if (k === 'e') { e.preventDefault(); runAction('explain', selection); }
      else if (k === 'n') { e.preventDefault(); runAction('note', selection); }
      else if (k === 't') { e.preventDefault(); runAction('translate', selection); }
      else if (k === 'h') { e.preventDefault(); runAction('highlight', selection); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, workspaceOpen, chatOpen, runAction, setChatOpen]);

  const closeSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  // Shared ChatPanel inner JSX (resize handle + ChatPanel) — reused by both
  // classic flex column (right side) and canvas overlay (right side).
  const chatPanelInner = (
    <>
      <div
        onMouseDown={startChatResize}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        style={{
          position: 'absolute', left: -3, top: 0, bottom: 0,
          width: 6, cursor: 'col-resize', zIndex: 5,
          background: chatDragWidth != null ? 'var(--walnut-soft)' : 'transparent',
          transition: 'background 120ms',
        }}
        onMouseEnter={(e) => {
          if (chatDragWidth == null) e.currentTarget.style.background = 'var(--rule)';
        }}
        onMouseLeave={(e) => {
          if (chatDragWidth == null) e.currentTarget.style.background = 'transparent';
        }}
      />
      <ChatPanel
        paper={effectivePaper}
        sessions={sessions}
        activeId={activeSessionId}
        messages={chatMessages}
        streamingId={chatStreamingId}
        actionStreamingIds={actionStreamingIds}
        askPrefill={askPrefill}
        locale={locale}
        onSwitch={async (id) => {
          const pk = paperKey(paper);
          setActiveSessionIdState(id);
          setChatMessages(await Sessions.loadMessages(pk, id));
          setAskPrefill(null);
          await Sessions.setActive(pk, id);
        }}
        onNew={async () => {
          const pk = paperKey(paper);
          try {
            const s = await Sessions.createSession(pk);
            await Sessions.setActive(pk, s.id);
            setSessions(await Sessions.listActiveSessions(pk));
            setActiveSessionIdState(s.id);
            setChatMessages([]);
          } catch (err) {
            if (err instanceof Sessions.SessionCapError) {
              setToast(`最多 ${Sessions.MAX_ACTIVE_SESSIONS} 个会话`);
              return;
            }
            throw err;
          }
        }}
        onDeleteCurrent={async () => {
          if (!activeSessionId) return;
          await handleDeleteSession(activeSessionId);
          const pk = paperKey(paper);
          const remaining = await Sessions.listActiveSessions(pk);
          const sorted = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
          if (sorted.length > 0) {
            setActiveSessionIdState(sorted[0].id);
            setChatMessages(await Sessions.loadMessages(pk, sorted[0].id));
            await Sessions.setActive(pk, sorted[0].id);
          }
        }}
        onRename={async (id, title) => {
          const pk = paperKey(paper);
          await Sessions.renameSession(pk, id, title);
          setSessions(await Sessions.listActiveSessions(pk));
        }}
        onDelete={handleDeleteSession}
        onHardDelete={handleHardDeleteSession}
        onRestoreAndSwitch={handleRestoreAndSwitch}
        onSend={onChatSend}
        onAbort={onChatAbort}
        onDismissPrefill={() => setAskPrefill(null)}
        onJumpNote={jumpToNote}
        notes={notes}
      />
    </>
  );

  // Shared WorkspacePanel props (used in both canvas overlay and classic/summary inline).
  const workspacePanelProps = {
    paper: effectivePaper,
    tab,
    setTab,
    overviewMeta,
    contributionsState,
    keywordsState,
    onRetryContributions: async () => {
      const pk = paperKey(paper);
      await clearOverviewSection(pk, 'contributions', model, outputLanguage);
      setContributionsState({ kind: 'idle' });
      void ensureOverview(pk, paper, 'contributions', model, outputLanguage, setContributionsState);
    },
    onRetryKeywords: async () => {
      const pk = paperKey(paper);
      await clearOverviewSection(pk, 'keywords', model, outputLanguage);
      setKeywordsState({ kind: 'idle' });
      void ensureOverview(pk, paper, 'keywords', model, outputLanguage, setKeywordsState);
    },
    notes,
    activeSubtab,
    onSubtabChange: setActiveSubtab,
    flashNoteId,
    onJumpSource: jumpToSource,
    onJumpChat: jumpToChat,
    onDeleteNote: handleDeleteNote,
    onRetryNote: (n: Note) => retryAction({ paperKey: paperKey(paper), paper, actionId: n.id, model, lang: outputLanguage }),
    onEditNote: (n: Note) => setEditingNote({ rect: { left: 0, top: 0, right: 0, bottom: 0 }, quote: n.quote, loc: n.loc, initial: n.userText ?? '' }),
    onMemoryPatch: patchMemory,
    model,
    locale,
  };

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper-deep)',
      color: 'var(--ink)',
      position: 'relative',
    }}>
      <TopBar
        paper={effectivePaper}
        variant={variant}
        setVariant={setVariant}
        theme={theme}
        toggleTheme={toggleTheme}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(!chatOpen)}
        workspaceOpen={workspaceOpen}
        onToggleWorkspace={() => setWorkspaceOpen((v) => !v)}
        onOpenLibrary={() => setLibraryOpen(true)}
        isInLibrary={isInLibrary}
        onAddToLibrary={handleAddToLibrary}
        onRemoveFromLibrary={handleRemoveFromLibrary}
        onOpenCmdK={() => setCmdKOpen(true)}
        onOpenTweaks={() => setTweaksOpen(!tweaksOpen)}
        activeSectionId={activeSectionId}
        pageLabel={pdfRuntime
          ? `p. ${currentPdfPage}/${pdfRuntime.doc.numPages}`
          : '—/—'}
      />

      <MigrationBanner />

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left: workspace panel */}
        {workspaceOpen && (
            <div style={{
              width: activeWorkspaceWidth, flexShrink: 0,
              position: 'relative',
            }}>
              <div
                onMouseDown={startWorkspaceResize}
                role="separator"
                aria-orientation="vertical"
                title="Drag to resize"
                style={{
                  position: 'absolute', right: -3, top: 0, bottom: 0,
                  width: 6, cursor: 'col-resize', zIndex: 5,
                  background: dragWidth != null ? 'var(--walnut-soft)' : 'transparent',
                  transition: 'background 120ms',
                }}
                onMouseEnter={(e) => {
                  if (dragWidth == null) e.currentTarget.style.background = 'var(--rule)';
                }}
                onMouseLeave={(e) => {
                  if (dragWidth == null) e.currentTarget.style.background = 'transparent';
                }}
              />
              <WorkspacePanel {...workspacePanelProps} />
            </div>
          )}
          {/* Center: paper reader / summary / canvas */}
          <div style={{
            flex: 1, minWidth: 0,
            position: 'relative',
            display: 'flex', flexDirection: 'column',
          }}>
          {variant === 'canvas' ? (
            <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
              <CanvasView
                paper={effectivePaper}
                notes={results}
                chat={chatMessages}
                threeLineSummary={null}
                onBack={() => setVariant('classic')}
              />
            </div>
          ) : variant === 'summary' ? (
            <div
              ref={readerScrollRef}
              data-reader-scroll
              style={{
                flex: 1, minWidth: 0, overflow: 'auto',
                padding: '28px 24px 60px',
                display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
              }}
            >
              <div
                className={tweaks.grain ? 'paper-grain' : ''}
                style={{
                  width: tweaks.pageWidth,
                  background: 'var(--paper)',
                  border: '0.5px solid var(--rule)',
                  borderRadius: 2,
                  boxShadow: 'var(--shadow-2)',
                  padding: '40px 48px',
                  minHeight: 600,
                  zoom: effectiveTweaks.zoom,
                }}
              >
                <SummaryPage paper={effectivePaper} />
              </div>
            </div>
          ) : (
          <div
            ref={readerScrollRef}
            data-reader-scroll
            style={{
              flex: 1, minWidth: 0, overflow: 'auto',
              padding: '28px 24px 60px',
              display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: pdfRuntime ? 'max-content' : `${tweaks.pageWidth}px`,
                gap: 0,
                position: 'relative',
                margin: '0 auto',
                minWidth: 'min-content',
                zoom: pdfRuntime ? 1 : effectiveTweaks.zoom,
              }}
            >
              <div
                className={!pdfRuntime && tweaks.grain ? 'paper-grain' : ''}
                style={{
                  background: pdfRuntime ? 'transparent' : 'var(--paper)',
                  border: pdfRuntime ? 'none' : '0.5px solid var(--rule)',
                  borderRadius: pdfRuntime ? 0 : 2,
                  boxShadow: pdfRuntime ? 'none' : 'var(--shadow-2)',
                  padding: pdfRuntime ? 0 : '56px 60px 80px',
                  position: 'relative',
                  minHeight: pdfRuntime ? 0 : 900,
                }}
              >
                <PaperPage
                  paper={effectivePaper}
                  onSelect={setSelection}
                  font={tweaks.readerFont}
                  pdfRuntime={pdfRuntime}
                  zoom={effectiveTweaks.zoom}
                />
                <SelectionToolbar
                  selection={selection}
                  onAction={runAction}
                  onClose={closeSelection}
                  paperCardWidth={tweaks.pageWidth}
                />
              </div>
            </div>
          </div>
          )}
          {variant !== 'canvas' && (
            <ZoomControl
              zoom={effectiveTweaks.zoom}
              setZoom={(z) => setTweak('zoom', clamp(roundZoom(z), ZOOM_MIN, ZOOM_MAX))}
            />
          )}
          {variant !== 'canvas' && editingNote && (
            <NoteEditorPopover
              rect={editingNote.rect}
              initial={editingNote.initial}
              onCancel={() => setEditingNote(null)}
              onSave={handleNoteSave}
            />
          )}
          </div>
        {/* Right: Chat panel */}
        {chatOpen && (
          <div style={{ width: activeChatWidth, flexShrink: 0, minHeight: 0, position: 'relative' }}>
            {chatPanelInner}
          </div>
        )}
      </div>

      <LibraryDrawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        currentPaperKey={paperKey(paper)}
      />
      <CmdK
        open={cmdKOpen}
        onClose={() => setCmdKOpen(false)}
        variant={variant}
        setVariant={setVariant}
        onOpenLibrary={() => setLibraryOpen(true)}
        onSummarizePaper={onSummarizePaper}
        onTranslatePage={onTranslatePage}
        onAskAboutPaper={onAskAboutPaper}
        onSetRole={onSetRole}
        onWriteJudgment={onWriteJudgment}
        onLinkPaper={onLinkPaper}
      />

      <TweaksPanel
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        tweaks={tweaks}
        setTweak={setTweak}
      />

      <StatusRail hidden={variant === 'canvas'} />
      {upgradeTrigger && (
        <UpgradePrompt
          trigger={upgradeTrigger}
          onClose={() => setUpgradeTrigger(null)}
        />
      )}
      <ChurnModal />
      <ToastHost />
      {highlightPopover && (
        <HighlightActionPopover
          left={highlightPopover.left}
          top={highlightPopover.top}
          onRemove={async () => {
            const { paragraphId, text } = highlightPopover;
            setHighlightPopover(null);
            await handleDeleteHighlightFromPaper(paragraphId, text);
          }}
          onClose={() => setHighlightPopover(null)}
        />
      )}
    </div>
  );
}

function HighlightActionPopover({ left, top, onRemove, onClose }: {
  left: number; top: number;
  onRemove: () => void; onClose: () => void;
}) {
  // Position above the highlight rect so the chip doesn't cover the text
  // we're about to act on. 38px lift = chip height (~28) + 8px breathing.
  // Clamp to viewport so the chip never escapes the screen edge.
  const POPOVER_HEIGHT_OFFSET = 38;
  const HORIZONTAL_INSET = 8;
  const popoverTop = Math.max(8, top - POPOVER_HEIGHT_OFFSET);
  const popoverLeft = Math.min(
    Math.max(HORIZONTAL_INSET, left),
    window.innerWidth - 120,
  );
  return (
    <div
      data-highlight-popover="true"
      role="toolbar"
      aria-label={t('highlight.popover.aria') || 'Highlight actions'}
      style={{
        position: 'fixed',
        top: popoverTop,
        left: popoverLeft,
        transform: 'translateX(-50%)',
        background: 'var(--paper-soft)',
        border: '0.5px solid var(--rule)',
        borderRadius: 999,
        boxShadow: 'var(--shadow-2)',
        padding: '4px 4px',
        display: 'flex', alignItems: 'center', gap: 2,
        zIndex: 100,
        animation: 'fade-up 140ms cubic-bezier(0.2, 0.9, 0.3, 1)',
      }}
    >
      <button
        onClick={onRemove}
        title={t('highlight.popover.remove') || 'Remove highlight'}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px',
          borderRadius: 999,
          color: 'var(--ink-soft)',
          fontSize: 12, fontWeight: 500,
          background: 'transparent', border: 'none', cursor: 'pointer',
          transition: 'background 120ms, color 120ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--paper-deep)';
          e.currentTarget.style.color = 'var(--foxglove)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--ink-soft)';
        }}
      >
        <I.Trash size={13} stroke={1.6} />
        {t('highlight.popover.remove') || 'Remove highlight'}
      </button>
      <div style={{ width: 1, height: 14, background: 'var(--rule)', margin: '0 2px' }} />
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          width: 24, height: 24, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 999, color: 'var(--ink-soft)',
          background: 'transparent', border: 'none', cursor: 'pointer',
        }}
      >
        <I.Close size={12} />
      </button>
    </div>
  );
}

// --- Boot ---
function Boot() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; paper: Paper; pdfRuntime: PdfRuntime | null }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    // E2E test-only bypass: ?e2e=fake-paper renders a minimal stub paper so
    // Playwright specs can exercise drawer / sidebar / chip flows without
    // hitting arXiv. Stripped from production by no UI surface using it.
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('e2e') === 'fake-paper') {
        const fake: Paper = {
          id: 'e2e-fake-paper',
          urlHash: 'e2e-fake-paper',
          title: 'E2E Fake Paper',
          authors: ['Test Author'],
          abstract: 'Stub abstract for E2E.',
          venue: undefined,
          outline: [{ id: 'sec0', label: 'Introduction', level: 0, page: 1 }],
          paragraphs: [
            // E2E test paragraphs — give specs real selectable text so the
            // selection toolbar / runSelectionAction path can be exercised.
            // sectionId points at the outline entry above so highlight / note
            // location strings (formatLoc) resolve cleanly.
            {
              id: 'sec0-p1',
              sectionId: 'sec0',
              section: 'Introduction',
              text: 'The first paragraph contains some selectable content for E2E testing.',
            },
            {
              id: 'sec0-p2',
              sectionId: 'sec0',
              section: 'Introduction',
              text: 'A second paragraph with more selectable content for additional spec coverage.',
            },
          ],
          memory: emptyMemory(),
        };
        setState({ kind: 'ok', paper: fake, pdfRuntime: null });
        return;
      }
    }
    let cancelled = false;
    // Phase 27 — `#paperKey=` cache-only entry: render straight from
    // chrome.storage without re-fetching the source URL. Preferred over
    // `#src=` when the library card click had no captured src and no
    // arxiv-id fallback (third priority in planNavigateToPaper).
    const paperKeyParam = readPaperKey();
    if (paperKeyParam) {
      loadPaperFromCache(paperKeyParam)
        .then((loaded) => {
          if (cancelled) return;
          if (!loaded) {
            setState({
              kind: 'error',
              message: `No cached content for paperKey="${paperKeyParam}". Open the paper from its original URL once.`,
            });
            return;
          }
          setState({ kind: 'ok', paper: loaded.paper, pdfRuntime: loaded.pdfRuntime });
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setState({ kind: 'error', message: String(err.message ?? err) });
        });
      return () => { cancelled = true; };
    }

    const src = readSrc();
    if (!src) {
      setState({ kind: 'error', message: 'No #src= in URL' });
      return;
    }
    loadPaper(src)
      .then((loaded) => {
        if (cancelled) {
          // Swap happened before our load resolved — drop the orphan pdfDoc.
          loaded.pdfRuntime?.doc.destroy().catch(() => {});
          return;
        }
        setState({ kind: 'ok', paper: loaded.paper, pdfRuntime: loaded.pdfRuntime });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState({ kind: 'error', message: String(err.message ?? err) });
      });
    return () => { cancelled = true; };
  }, []);

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, color: 'var(--ink-faded)', fontStyle: 'italic' }}>Loading paper…</div>;
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, color: 'var(--foxglove)' }}>Error: {state.message}</div>;
  }
  return <ViewerApp paper={state.paper} pdfRuntime={state.pdfRuntime} />;
}

function ZoomControl({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const atMin = zoom <= ZOOM_MIN + 0.001;
  const atMax = zoom >= ZOOM_MAX - 0.001;
  const btnStyle = (disabled: boolean): CSSProperties => ({
    padding: '6px 12px', border: 'none', background: 'transparent',
    color: 'var(--ink-soft)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.3 : 1,
    fontSize: 14, lineHeight: 1,
    fontFamily: 'var(--font-sans)',
  });
  return (
    <div style={{
      position: 'absolute', bottom: 20, right: 20, zIndex: 4,
      display: 'inline-flex', alignItems: 'center',
      background: 'var(--paper)',
      border: '0.5px solid var(--rule)',
      borderRadius: 999,
      boxShadow: 'var(--shadow-2)',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setZoom(zoom - ZOOM_STEP)}
        disabled={atMin}
        title="Zoom out"
        style={btnStyle(atMin)}
      >−</button>
      <button
        onClick={() => setZoom(1.0)}
        title="Reset to 100%"
        style={{
          minWidth: 48, padding: '6px 6px', border: 'none',
          background: 'transparent', color: 'var(--ink)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          borderLeft: '0.5px solid var(--rule)',
          borderRight: '0.5px solid var(--rule)',
        }}
      >{Math.round(zoom * 100)}%</button>
      <button
        onClick={() => setZoom(zoom + ZOOM_STEP)}
        disabled={atMax}
        title="Zoom in"
        style={btnStyle(atMax)}
      >+</button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Boot />);
