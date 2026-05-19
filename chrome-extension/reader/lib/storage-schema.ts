// chrome-extension/reader/lib/storage-schema.ts

import type { LibraryCatalogEntry, TopicCatalogEntry } from '../types';

/**
 * Typed wrapper over chrome.storage.local for account-adjacent keys.
 *
 * The pre-existing `storage.ts` wrapper governs `paper:{key}:*` keys
 * (parsed, highlights, memory, notes, chat, canvas, summary:v*) and
 * global `library` / `config` / `library:lock` / `pf-tweaks`.
 *
 * This file covers only the NEW keys introduced by the login feature
 * — session, split BYOK config (apikey local, prefs cloud-mirrored),
 * offline queue, migration state, and v1 modal-dismiss flags.
 *
 * Phase 12 (multi-config BYOK) adds: config_apikeys (D-A2 per-config
 * apiKey map, LOCAL ONLY), config_active_byok_config_id (D-D2 cached
 * active id), 'migrationState:byok-configs-v12' (D-A3 idempotency
 * flag), and byokHealthCache (D-C1/D-C2 health probe cache; MED-5
 * cross-AI review fix).
 *
 * Phase 15 (managed-models tier-gated) adds: config_active_managed_model_id
 * (D-E1 active managed selection, '' = none), managedModelsCache (D-C3 GET
 * /managed-models response cache), and two migrationState flags
 * (managed-models-v13 + managed-models-v13-toast-shown) for the boot-time
 * anthropic-via-proxy retirement migration.
 *
 * Phase 16 (openai-compatible preset collapse) adds: 1 migrationState key
 * (openai-compat-v16) for the boot-time openai/openrouter/custom →
 * openai-compatible preset id rewrite migration. No active-id key (id rename
 * only, no new routing surface). No toast key (D-D2 — silent migration since
 * user-visible UI change is purely a dropdown row count, owned by Plan 16-02).
 *
 * Phase 17 (retire v1.1 single-config BYOK fallback) DELETES: config_apikey
 * + config_prefs (backward-compat read paths from v1.1 are now gone — all
 * read sites flow through Phase 12 multi-config; options/main.tsx save()
 * refactored to drop the last v1.1 write). ADDS: 1 migrationState key
 * (byok-v11-retire-v17) for the boot-time retire pass. No toast counterpart
 * (D-C2 — internal cleanup; mirrors Phase 16 D-D2).
 *
 * Quick task 260506-8ov adds: `debug:chatTelemetry` (boolean) — opt-in flag for
 * `[pf-chat-telemetry]` per-chat-request console logs in production builds.
 * DEV builds always log; in prod, `chrome.storage.local.set({'debug:chatTelemetry': true})`
 * enables emission until the next extension reload (cached at first read).
 */

export type PendingDelete =
  | { id: string; kind: 'library'; deletedEntry: LibraryCatalogEntry; affectedRows: Array<{ id: string; prev: { libraryId?: string | null } }>; commitAt: number; ts: number }
  | { id: string; kind: 'topic';   deletedEntry: TopicCatalogEntry;   affectedRows: Array<{ id: string; prev: { topicIds?: string[] } }>;       commitAt: number; ts: number };

export type StorageSchema = {
  session:                      unknown        // Supabase session object
  config_outputLanguage:        string         // 'auto' | 'detect' | 'en' | 'zh-CN' | … (see OUTPUT_LANGUAGES)
  config_uiLanguage:            'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru'

  // Phase 12 D-A2: per-config apiKey map. LOCAL ONLY (D-02 invariant — never
  // synced to Supabase). Phase 17: the singular v1.1 `config_apikey` key has
  // been retired and removed from the schema (boot-time retire migration in
  // byok-configs.ts physically removes it from chrome.storage.local).
  config_apikeys:               Record<string, string>  // { [configId]: apiKey }

  // Phase 12 Retrofit Plan 12-R1: BYOK config rows are LOCAL ONLY per user
  // feedback (memory: feedback_byok_local_only.md). Cross-device sync covers
  // only papers/library/annotations/chat — never BYOK configs.
  config_byok_configs:          Array<{
                                  id: string
                                  user_id: string
                                  name: string
                                  base_url: string
                                  model: string
                                  is_active: boolean
                                  created_at: string
                                  updated_at: string
                                }>

  // Phase 12 D-D2: cached active config id so agent-client.ts avoids a
  // Supabase RTT inside runAgent(). Refreshed by Realtime subscription
  // (Plan 03 subscribeByokConfigs).
  config_active_byok_config_id: string | null

  // Phase 12 D-A3 idempotency flag. 'done' means the v1.1 -> multi-config
  // boot-time migration has already executed and must not re-run.
  'migrationState:byok-configs-v12': 'idle' | 'in-progress' | 'done' | undefined

  // Phase 12 D-C1/D-C2 health-check cache (MED-5 cross-AI review fix).
  // Plan 08 writes the last-known health probe per configId so a reload
  // renders the chip without re-probing. Typed here so both Plan 08
  // setters and the logout cleaner go through getItem/setItem.
  byokHealthCache:              Record<string, { ts: number; healthy: boolean; modelCount?: number; reason?: string }> | undefined

  // Phase 15 D-E1: cached active managed model id. Empty string = no managed
  // selection — BYOK or fallback path takes over (D-E2 callAI precedence).
  // Architecturally separate from `config_active_byok_config_id` per D-A2:
  // BYOK is local-only credentials; managed is cloud-billed quota — no shared
  // discriminator.
  config_active_managed_model_id: string

  // Phase 15 D-C3: GET /managed-models response cache (TTL 1h via wall-clock
  // ts comparison; D-C3 entries (a)/(b)/(c) refresh on Options mount + login +
  // subscriptions Realtime). Schema mirrors managed-models/index.ts response
  // body shape — `locked` is computed server-side from user.tier vs min_tier.
  managedModelsCache: {
    ts: number
    models: Array<{
      id: string
      display_name: string
      min_tier: 'free' | 'sync' | 'pro'
      locked: boolean
      provider: string
      upstream_model: string
    }>
  } | undefined

  // Phase 15 D-F1 boot-time migration idempotency flag. 'done' means the
  // anthropic-via-proxy → managed-model migration has already executed.
  'migrationState:managed-models-v13': 'idle' | 'in-progress' | 'done' | undefined

  // Phase 15 D-F2 one-time migration toast dismiss flag. Set after the toast
  // is shown so it never re-surfaces.
  'migrationState:managed-models-v13-toast-shown': 'done' | undefined

  // Phase 16 D-D1 boot-time idempotency flag for the openai/openrouter/custom
  // preset-id collapse to 'openai-compatible'. 'done' means migration ran;
  // no toast counterpart (D-D2 — internal id rename only, not user-visible).
  'migrationState:openai-compat-v16': 'idle' | 'in-progress' | 'done' | undefined

  // Phase 17 D-A1 boot-time retire migration flag for the v1.1 single-config
  // fallback retire pass. Separate from 'migrationState:byok-configs-v12' so
  // the two passes (Phase 12 R1+R2 forward migration + Phase 17 retire) can
  // be audited independently. After this flag = 'done', config_apikey +
  // config_prefs are physically removed from chrome.storage.local and all
  // v1.1 read paths are gone (D-B4 grep invariant).
  'migrationState:byok-v11-retire-v17': 'idle' | 'in-progress' | 'done' | undefined

  // Quick task 260507 boot-time idempotency flag for the local-litellm
  // preset removal. 'done' means any preset='local-litellm' rows were
  // rewritten to preset='openai-compatible' (baseURL/model/apiKey
  // preserved). Mirrors Phase 16 openai-compat-v16 idiom; non-blocking,
  // silent. Supersedes deferred Phase 25 (RENAME).
  'migrationState:byok-local-litellm-removal': 'idle' | 'in-progress' | 'done' | undefined

  // Quick task 260506-8ov — production opt-in flag for `[pf-chat-telemetry]`
  // per-chat-request console logs. DEV builds always log; in prod, set this
  // to true to enable emission until the next extension reload.
  'debug:chatTelemetry': boolean | undefined

  'sync:queue':                 Array<
                                  | { kind?: undefined; table: string; op: 'upsert' | 'delete'; row: any; ts: number }
                                  | { kind: 'rpc'; fn: 'delete-library' | 'delete-topic'; args: any; ts: number }
                                >
  migrationState:               'idle' | 'in-progress' | 'done' | 'paused'
  paperIdMap:                   Record<string, string>  // paper_key → papers.id for M1 resume
  churnModalSeen:               boolean
  libraryCapBannerDismissed:    number | null  // timestamp, or null to reset
  'library:lock':               boolean
  'schemaMigrationVersion:260424:dropAbstract':       1 | undefined
  'schemaMigrationVersion:260501:cleanupLegacyChat':  1 | undefined
  'shortcutToastSeen:260424':                         1 | undefined
  'actionCardHintSeen:260424':                        1 | undefined
  'pf:libraries':               LibraryCatalogEntry[]
  'pf:topics':                  TopicCatalogEntry[]
  'pf:lock:lib-catalog':        boolean
  'pf:lock:topic-catalog':      boolean
  'pf:librariesIntroSeen':      boolean
  'pf:libraryV2Migrated':       boolean
  'pf:lib:pendingDeletes':      PendingDelete[]

  // Codex BYOK Slice 1 (#8). OpenAI Codex (ChatGPT Subscription) OAuth tokens —
  // LOCAL ONLY per feedback_byok_local_only.md; never synced. Tokens come from
  // OAuth Device Code Flow against auth.openai.com (Codex CLI client_id).
  // expires_at is unix ms, computed from the /oauth/token response's expires_in
  // claim at issue time. token_type is always 'bearer'.
  codex_auth_tokens: {
    access_token:  string
    refresh_token: string
    id_token?:     string
    expires_at:    number
    token_type:    'bearer'
  } | undefined

  // Cached user identity (decoded from id_token claims at login) for UI
  // display without re-decoding the JWT per render.
  codex_auth_user: { email: string } | undefined
}
export type StorageKey = keyof StorageSchema

export async function getItem<K extends StorageKey>(k: K): Promise<StorageSchema[K] | null> {
  const r = await chrome.storage.local.get(k)
  return (r[k] as StorageSchema[K]) ?? null
}

export async function setItem<K extends StorageKey>(k: K, v: StorageSchema[K]): Promise<void> {
  await chrome.storage.local.set({ [k]: v })
}

export async function removeItem<K extends StorageKey>(k: K): Promise<void> {
  await chrome.storage.local.remove(k)
}

/**
 * Per-paper Canvas agent-injected node list (Phase 11 Plan 05 writeCanvas tool).
 *
 * Stored separately from `paper:{pk}:canvas` (the user-saved layout positions
 * managed by `getCanvasLayout`/`setCanvasLayout`) so the agent's append-only
 * writes do not collide with drag-stop persistence.
 *
 * P1 follow-up: `doLogout` in components/top-bar.tsx already blanket-clears
 * `paper:*` keys (except `:parsed` and `:summary:*`), so this key is naturally
 * cleared on logout — but the suffix `:canvas:agentNodes` should be cross-checked
 * with the logout regexp before milestone close.
 */
export const paperCanvasAgentNodesKey = (pk: string): `paper:${string}:canvas:agentNodes` =>
  `paper:${pk}:canvas:agentNodes` as const
