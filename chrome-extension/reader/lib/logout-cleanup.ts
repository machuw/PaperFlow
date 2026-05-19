// chrome-extension/reader/lib/logout-cleanup.ts

import { removeItem } from './storage-schema';

/**
 * Clear all local state that could leak between accounts on logout.
 * §15.1 + §14.7.7.1: prevents cross-account data leaks when users
 * switch accounts on a shared device.
 *
 * Phase 12 (D-A2 / D-A3 / D-D2): also clears the multi-config BYOK
 * apiKey map (config_apikeys), the cached active config id, the
 * v1.1->v1.2 migration idempotency flag, and the health-probe cache
 * (MED-5 cross-AI review). T-12-02-01 mitigation lives here.
 *
 * Phase 15 (D-E1 / D-C3 / D-F1 / D-F2): also clears the active managed-model
 * id, the GET /managed-models response cache, and the two managed-models
 * migration idempotency flags so anthropic-via-proxy retirement state does
 * not leak across accounts on a shared device.
 *
 * Phase 16 (D-D4): also clears the openai-compat-v16 migration idempotency
 * flag so preset-id collapse state does not leak across accounts on a
 * shared device.
 *
 * Phase 17 (D-A1, D-E2): retire-v17 migration physically removes config_apikey
 * + config_prefs from chrome.storage.local on first boot post-Phase 17. logout
 * therefore no longer clears those two keys (they are guaranteed absent).
 * The retire flag itself is cleared on logout to prevent stuck state on
 * shared devices (mirror Phase 16 D-D4 idiom).
 *
 * Intentionally NOT cleared (device-local UI state, not account-bound):
 *   pf:librariesIntroSeen, pf:libraryV2Migrated
 */
export async function clearLogoutKeys(): Promise<void> {
  await removeItem('codex_auth_tokens');                  // Slice 1 #8: OAuth tokens for Codex BYOK preset
  await removeItem('codex_auth_user');                    // Slice 1 #8: cached ChatGPT user identity (orphan prevention)
  await removeItem('config_apikeys');                     // Phase 12 D-A2: multi-config apiKey map
  await removeItem('config_byok_configs');                // Phase 12 R1: local-only BYOK config rows (per user feedback feedback_byok_local_only.md)
  await removeItem('config_active_byok_config_id');       // Phase 12 D-D2: cached active config id
  await removeItem('migrationState:byok-configs-v12');    // Phase 12 D-A3: migration idempotency flag
  await removeItem('byokHealthCache');                    // Phase 12 D-C1/D-C2: health probe cache (MED-5 cross-AI review)
  await removeItem('config_active_managed_model_id');                  // Phase 15 D-E1: active managed model id
  await removeItem('managedModelsCache');                              // Phase 15 D-C3: GET /managed-models cache
  await removeItem('migrationState:managed-models-v13');               // Phase 15 D-F1: migration idempotency flag
  await removeItem('migrationState:managed-models-v13-toast-shown');   // Phase 15 D-F2: migration toast dismiss flag
  await removeItem('migrationState:openai-compat-v16');                // Phase 16 D-D1: preset-id collapse migration flag
  await removeItem('migrationState:byok-v11-retire-v17');              // Phase 17 D-A1: retire migration flag
  await removeItem('sync:queue');
  await removeItem('migrationState');
  await removeItem('paperIdMap');
  await removeItem('churnModalSeen');
  await removeItem('libraryCapBannerDismissed');
  await removeItem('shortcutToastSeen:260424');
  await removeItem('actionCardHintSeen:260424');
  await removeItem('pf:lib:pendingDeletes');
  // Clear cloud-sourced local mirrors (paper:* except parsed caches and
  // summary caches, which are regenerable and safe to keep across sessions).
  const all = await chrome.storage.local.get(null);
  const toRemove = Object.keys(all).filter(
    (k) =>
      k.startsWith('paper:') &&
      !k.endsWith(':parsed') &&
      !k.includes(':summary:'),
  );
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}
