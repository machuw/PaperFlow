import type { ItemRange } from './lib/pdf-items';

/**
 * Phase 11 Plan 05: writeCanvas client tool reads the active paper key from
 * `window.__pfActivePaperPk`. main.tsx sets it on paper open / clears on close.
 */
declare global {
  interface Window {
    __pfActivePaperPk?: string;
  }
}

export interface Paper {
  id?: string;            // arXiv ID, version-stripped; undefined in PDF mode
  urlHash: string;        // SHA-256(url).hex.slice(0,12); present in both modes
  title: string;
  authors: string[];
  affiliations?: string[];
  venue?: string;
  abstract: string;
  outline: OutlineItem[];
  paragraphs: Paragraph[];
  figures?: Figure[];
  memory: PaperMemory;
}

export interface OutlineItem {
  id: string;
  label: string;
  level: number;          // 0 = section, 1 = subsection
  page?: number;
}

export interface Paragraph {
  id: string;             // "sec{sectionIndex}-p{pInSection}"; matches data-pid
  sectionId: string;      // OutlineItem.id, deepest nested (not level-0)
  section: string;        // display, = deepest OutlineItem.label
  text: string;           // AI context always uses this (plain)
  /**
   * UI prefers this when present (enriched HTML fragment). Rendered via
   * React's `dangerouslySetInnerHTML`. Populated ONLY by `parseArxivHtml`
   * from arxiv.org fetches. DO NOT set from user input or other sources —
   * doing so widens the XSS attack surface.
   */
  html?: string;
  important?: boolean;
}

export interface Figure {
  id: string;
  label: string;
  caption: string;
  page?: number;
}

export interface PaperMemory {
  whyItMatters: string;
  role: string;           // free-text, format "{standard} — {freeform}"
  judgment: string;
  linked: { title: string; why: string; role: string }[];
  nextActions: { text: string; done: boolean }[];
}

export function emptyMemory(): PaperMemory {
  return {
    whyItMatters: '',
    role: '',
    judgment: '',
    linked: [],
    nextActions: [],
  };
}

export interface Highlight {
  paragraphId: string;
  text: string;
  color: 'yellow';   // v1: single color; schema reserves the field for future multi-color support (§3.4)
}

export type ReaderVariant = 'summary' | 'classic' | 'canvas';

export interface Tweaks {
  readerFont: 'serif' | 'sans';
  pageWidth: number;    // 560..900 (spec §9)
  margins: boolean;     // show margin notes column in Focus
  grain: boolean;       // paper-grain CSS class
  zoom: number;         // 0.7..1.6, applies to paper reading area only
}

export const DEFAULT_TWEAKS: Tweaks = {
  readerFont: 'serif',
  pageWidth: 720,
  margins: true,
  grain: true,
  zoom: 1.0,
};

/**
 * Transient UI state: a text selection inside PaperPage, captured at mouseup.
 * Named `TextSelection` (not `Selection`) to avoid colliding with the DOM
 * `Selection` global type. Not persisted; lives in ViewerApp state.
 */
export interface TextSelection {
  text: string;
  rect: { left: number; top: number; right: number; bottom: number; width: number };
  paragraphId: string | null;
}

/**
 * OpenAI-compatible BYOK config. `baseURL` is normalized (no trailing slash)
 * when saved. Missing fields mean "not configured"; §3.8 BYOK error path
 * gates on `!config.apiKey`.
 */
export interface AiConfig {
  baseURL: string;   // e.g. 'https://api.openai.com/v1'
  apiKey: string;
  model: string;     // e.g. 'gpt-4.1-mini'
  /** Output language code — see lib/ai.ts OUTPUT_LANGUAGES for choices.
   *  'auto' (or missing) lets the model pick from the user's prompt
   *  language, defaulting to English. */
  outputLanguage?: string;
}

export const EMPTY_AI_CONFIG: AiConfig = {
  baseURL: '', apiKey: '', model: '', outputLanguage: 'auto',
};

/**
 * AI action kinds that generate a margin-note / selection-result card.
 * Matches selection-toolbar.tsx `SelectionActionKind` minus 'highlight'
 * (highlights don't produce AI output) and minus 'ask' (Plan 4).
 */
export type AiActionKind =
  | 'explain' | 'translate'
  | 'overviewContributions' | 'overviewKeywords' | 'keywordExplain'
  | 'summarize' | 'ask';   // deprecated; not written by new code (§17.A.1)

/**
 * A completed or in-progress AI result anchored to a paragraph (§3.4).
 * CanvasView and storage layer use this shape; `body` grows as stream chunks
 * arrive; `createdAt` is the moment the stream began.
 */
export interface MarginResult {
  id: string;            // 'r-' + Date.now() + '-' + rand
  kind: AiActionKind;
  source: string;        // selected text
  body: string;
  paragraphId: string;   // anchor
  createdAt: number;     // epoch ms
}

export interface LibraryCatalogEntry {
  id: string;           // crypto.randomUUID()
  name: string;
  createdAt: number;
}

export interface TopicCatalogEntry {
  id: string;
  name: string;
  createdAt: number;
}

/**
 * Library row (§3.4). A single entry per paper in the global library.
 * Keyed by arXiv id when present, else urlHash.
 *
 * `role` is pre-computed via extractRolePrefix — a standard value or ''.
 * `libraryId` references a `LibraryCatalogEntry.id` (null = unfiled).
 * `topicIds` references zero or more `TopicCatalogEntry.id` values ([] = no tags).
 * `annotations` and `hasMemory` are snapshot values refreshed at every
 * mutation (note, highlight, memory patch).
 */
export interface LibraryRow {
  id?: string;
  urlHash: string;
  title: string;
  authors: string[];
  role: string;          // '' or one of the 6 §3.6 standard values
  judgment: string;
  addedAt: number;
  lastRead: number;
  pages: number;
  annotations: number;
  hasMemory: boolean;
  libraryId: string | null;   // references pf:libraries entry; null = unfiled
  topicIds: string[];         // references pf:topics entries; [] = no tags
  src?: string;               // original URL (or arxiv ID) used to load — enables click-to-jump from library
}

export interface Citation {
  n: number;            // 1-based display index (dedup'd by first occurrence)
  kind: 'paragraph' | 'abstract';
  quote: string;        // truncated to 140 chars
  loc: string;          // formatLoc result, e.g. 'p. 13 · §6 Discussion · ¶ p9'
}

export interface ChatMessage {
  id: string;           // 'u-' or 'a-' prefixed
  role: 'user' | 'assistant';
  kind?: 'actionCard';
  action?: {
    kind: 'explain' | 'translate';
    actionId: string;
    quote: string;
    loc?: { page?: number; paragraph?: number };
  };
  text: string;         // raw model output (still contains [pN] / [abs] tokens)
  citations?: Citation[]; // populated after stream done; absent while streaming
  createdAt: number;
}

export interface ChatSession {
  id: string;
  seq: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;   // soft-delete timestamp; undefined/missing = active
}

export type NoteKind = 'highlight' | 'note' | 'explain' | 'translate';

export interface Note {
  id: string;
  kind: NoteKind;
  quote: string;
  /**
   * `paragraphId` is the full DOM-anchor id (e.g. `sec0-p2`); it lets a
   * highlight Note resolve back to its row in `paper:{pk}:highlights` for
   * synchronized delete. Older highlight Notes (created before this field
   * existed) fall back to `paragraph` numeric matching at delete time.
   */
  loc: { page?: number; paragraph?: number; paragraphId?: string; charRange?: [number, number] };
  color?: string;
  aiAnswer?: string;
  userText?: string;
  chatSessionId?: string;
  chatMessageId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OverviewMeta {
  venue?: string;
  citations?: number;
  codeUrl?: string;
  field?: string;
  fetchedAt: number;
  expiresAt: number;
  failed?: boolean;
  failedAt?: number;
}

export type SummarySection = 'threeLine' | 'keyTerms' | 'detailed';

/**
 * Runtime-only PDF rendering handles. Held in React state, NEVER persisted.
 * `doc` is a live pdfjs document; `pageItemRanges[i]` is the paragraph
 * item-index ranges for the (i+1)-th page (see `lib/pdf-items.ts`).
 */
export interface PdfRuntime {
  doc: import('pdfjs-dist/legacy/build/pdf.mjs').PDFDocumentProxy;
  pageItemRanges: ItemRange[][];
}

/**
 * Per-paper Canvas layout persistence (§8.3). Only node positions are stored;
 * node identities and structure are re-derived from Paper/notes/chat on every
 * Canvas open. If nothing is persisted, dagre lays out the graph.
 */
export interface CanvasLayout {
  nodes: { id: string; x: number; y: number }[];
}

export type CanvasNodeKind =
  | 'paper'
  | 'section'
  | 'note'      // margin notes + memory.whyItMatters + 3-line summary
  | 'linked'
  | 'chat';

export interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  /** Arbitrary per-kind payload: title, body, metadata. Rendered by the node component. */
  data: Record<string, unknown>;
  position?: { x: number; y: number };   // filled by applyDagreLayout or storage-hydrated
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}
