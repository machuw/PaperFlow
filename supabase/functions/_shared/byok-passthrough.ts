// supabase/functions/_shared/byok-passthrough.ts
//
// CONTEXT.md D-02 trust-boundary chokepoint. This is the ONE place in the
// codebase allowed to read the BYOK apiKey out of the inbound request.
//
// Invariants enforced by `chrome-extension/tests/byok-leak-grep.test.ts`:
//   1. The token `byokApiKey` must NEVER appear as an argument to any
//      console call, observability SDK call, background-task scheduler,
//      or any Postgres `.from(...).insert(...)` / `.update(...)` payload
//      anywhere in `supabase/functions/`.
//   2. The BYOK apiKey value must NEVER be exported from this module,
//      returned from `buildProvider`, or assigned to a module-scope binding.
//   3. The provider instance MUST be constructed inside `buildProvider`
//      per request — never module-scoped — to prevent cross-request leak
//      via captured closure.
//
// Header naming (AI-SPEC §3 Pitfall 6): the Supabase Edge gateway claims
// `Authorization: Bearer <jwt>` for its own JWT auth BEFORE this handler
// sees the request. The BYOK apiKey must therefore arrive on a custom
// header — `X-BYOK-Authorization` — to avoid silent stripping or 401s.

// Pinned via the agent-run import map (supabase/functions/agent-run/deno.json):
// @ai-sdk/openai-compatible@1.0.36 — V2-spec compatible with ai@5. Bumping to
// 2.x silently fails at runtime with AI_UnsupportedModelVersionError because
// 2.x ships LanguageModelV3 and ai@5 only accepts V2.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

export type BuildProviderArgs = {
  /** The inbound `Request` whose headers carry `X-BYOK-Authorization`. */
  req: Request
  /** Request body (already parsed by the caller). */
  body: { baseURL?: string; model?: string }
}

export type BuildProviderResult = {
  /** The provider closure. Pass `provider(modelName)` into `streamText({ model })`. */
  provider: ReturnType<typeof createOpenAICompatible>
  /** Resolved model name string for `provider(modelName)`. */
  modelName: string
  /** True if the request supplied a BYOK apiKey on `X-BYOK-Authorization`. */
  isBYOK: boolean
}

/**
 * Construct the OpenAI-compatible provider for one `/agent-run` request.
 *
 * BYOK path: reads `X-BYOK-Authorization` header (with optional `Bearer ` prefix),
 * forwards verbatim to `createOpenAICompatible({ apiKey, baseURL })`. The apiKey
 * lives only in the captured closure of the returned provider; once the request
 * handler returns, the closure is unreachable and eligible for GC.
 *
 * Managed path: when no BYOK header is present, falls back to the v1.1
 * ai-proxy environment variables (`OPENAI_API_KEY` / `OPENAI_BASE_URL` /
 * `OPENAI_MODEL`).
 */
export function buildProvider({ req, body }: BuildProviderArgs): BuildProviderResult {
  const rawHeader = req.headers.get('x-byok-authorization')
  // Allow either `Bearer <key>` or bare `<key>`; strip optional prefix only.
  const byokApiKey = rawHeader ? (rawHeader.replace(/^Bearer\s+/i, '').trim() || null) : null
  const isBYOK = byokApiKey !== null

  if (isBYOK) {
    // The apiKey is captured here and ONLY here. The returned `provider`
    // closure holds a reference; nothing else in this module touches it.
    const provider = createOpenAICompatible({
      name: 'byok-passthrough',
      apiKey: byokApiKey!,
      baseURL: body.baseURL ?? 'https://api.openai.com/v1',
    })
    const modelName = body.model ?? 'gpt-4o-mini'
    return { provider, modelName, isBYOK: true }
  }

  const managedKey = Deno.env.get('OPENAI_API_KEY')
  const managedBaseURL = Deno.env.get('OPENAI_BASE_URL')
  const managedModel = Deno.env.get('OPENAI_MODEL')
  if (!managedKey || !managedBaseURL || !managedModel) {
    // Configuration error — surface to the caller without including any
    // values; maintains the discipline that keeps the grep rule narrow.
    throw new Error('managed-provider-misconfigured')
  }

  const provider = createOpenAICompatible({
    name: 'managed',
    apiKey: managedKey,
    baseURL: managedBaseURL,
  })
  return { provider, modelName: managedModel, isBYOK: false }
}
