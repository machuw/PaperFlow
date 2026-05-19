// chrome-extension/reader/lib/byok-presets.ts
//
// Phase 12 PROVIDER-01: BYOK preset registry. D-B1 baseURL defaults +
// D-B2 model defaults + D-B3 LiteLLM placeholder apiKey.
//
// Phase 15 D-F4 hard cutover: the proxied-Claude preset was removed —
// managed Claude is now served by the Phase 15 system-models section,
// not via BYOK.
//
// Phase 16 D-A1 hard cutover: openai/openrouter/custom collapsed into
// a single 'openai-compatible' entry. Defaults are empty strings — users
// fill via the 6 template chips (OpenAI / OpenRouter / Together / Groq /
// DeepSeek / Custom) added in Plan 16-02 or by hand.
//
// Quick task 260507 hard cutover: local-litellm removed entirely —
// claude-code-openai-wrapper is no longer a supported BYOK path. The
// only remaining preset is openai-compatible. Existing rows persisted
// with `preset='local-litellm'` are silently rewritten to
// 'openai-compatible' by migrateLocalLitellmRemoval at boot, preserving
// baseURL/model/apiKey verbatim. Supersedes deferred Phase 25 (RENAME).
//
// applyPreset(id, current) only fills EMPTY fields — never silently
// overwrites user-edited values (Pattern Mapper risk note for Plan 07,
// NIT-3 invariant carried forward through Phase 16 + quick task 260507).
//
// Pure-data + pure-function module.

export type BYOKPresetId = 'openai-compatible' | 'openai-codex';

// Slice 1 #8 — sentinel baseURL for the openai-codex preset. ai.ts /
// storage.ts / overview.ts / options/main.tsx all key on this constant to
// detect that a BYOK row is a codex-auth config (credentials in OAuth
// tokens, not user-supplied apiKey). Extracted to a single source of truth
// per PR #10 review so future renames flip in lockstep.
export const CODEX_SENTINEL_BASEURL = 'chatgpt://codex';

export function isCodexBaseURL(baseURL: string | null | undefined): boolean {
  return baseURL === CODEX_SENTINEL_BASEURL;
}

export interface BYOKPreset {
  id: BYOKPresetId;
  label: string;
  defaultBaseURL: string;
  defaultModel: string;

  // NIT-3: Empty apiKeyPlaceholder means user must supply — applyPreset
  // never auto-fills apiKey from a placeholder. Quick task 260507 removed
  // the only preset that carried a non-empty placeholder (local-litellm),
  // so apiKey is now always user-supplied.
  apiKeyPlaceholder: string;

  helpText: string;
}

export const BYOK_PRESETS: ReadonlyArray<BYOKPreset> = [
  {
    // Phase 16 D-A1: collapses openai / openrouter / custom into one entry.
    // The Options UI renders the i18n label via t('options.byok-presets.
    // openai-compatible.label') (Plan 16-02 D-E1); the literal here is a
    // fallback for any non-i18n consumer.
    id: 'openai-compatible',
    label: 'OpenAI compatible',
    // D-B3: empty defaults — user fills via Plan 16-02 6 template chips
    // (OpenAI / OpenRouter / Together / Groq / DeepSeek / Custom) or by hand.
    defaultBaseURL: '',
    defaultModel: '',
    apiKeyPlaceholder: '',
    helpText: 'Any OpenAI-compatible endpoint.',
  },
  {
    // Slice 1 #8 — OpenAI Codex (ChatGPT Subscription). Sentinel base_url
    // `chatgpt://codex` is detected by ai.ts to route through codex-stream
    // (Slice 2 #9), bypassing the apiKey/baseURL/model fields entirely.
    // Credentials come from device-flow OAuth handled by codex-auth.ts;
    // apiKey field is unused (preset UI hides it).
    id: 'openai-codex',
    label: 'OpenAI Codex (ChatGPT Subscription)',
    defaultBaseURL: CODEX_SENTINEL_BASEURL,
    defaultModel: 'gpt-5.2',
    apiKeyPlaceholder: '',
    helpText: 'Sign in with your ChatGPT account. Uses your subscription quota.',
  },
];

export function applyPreset(
  id: BYOKPresetId,
  current: { baseURL: string; model: string; apiKey: string },
): { baseURL: string; model: string; apiKey: string } {
  const preset = BYOK_PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`unknown BYOK preset: ${id}`);
  }

  // Only fill empty fields — Pattern Mapper risk for Plan 07: do NOT overwrite
  // user-edited values silently. Empty string is the explicit "fill me" signal.
  // NIT-3: an empty preset.apiKeyPlaceholder leaves current.apiKey as-is even
  // if it's empty — applyPreset will not invent an apiKey value.
  // Phase 16 D-B3: openai-compatible has all-empty defaults, so applying it
  // to any current state is a no-op (current is preserved verbatim).
  return {
    baseURL: current.baseURL || preset.defaultBaseURL,
    model: current.model || preset.defaultModel,
    apiKey: current.apiKey || preset.apiKeyPlaceholder,
  };
}
