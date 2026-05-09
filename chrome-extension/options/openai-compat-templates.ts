// Phase 16 D-B1 / D-B2 / D-B3: openai-compatible template chip data + pure
// handler. Lives in its own module so unit tests (byok-template-chip.test.ts)
// can import without dragging the OptionsApp tree (which transitively pulls
// supabase init at module load).
//
// IMPORTANT: applyTemplatePure NEVER touches apiKey (D-B2). Custom (id 'custom')
// is reset semantics — empty baseURL + empty model (D-B3). The 5 commercial
// templates carry verbatim baseURL + recommended model from CONTEXT D-B1.
//
// Imported by:
// - chrome-extension/options/main.tsx (OptionsApp render + applyTemplate handler)
// - chrome-extension/tests/byok-template-chip.test.ts (acid tests)

export type OpenAICompatTemplate = {
  id: 'openai' | 'openrouter' | 'together' | 'groq' | 'deepseek' | 'custom';
  // D-E2: provider name (5 not translated; 'Custom' chip renders via i18n
  // 'options.byok-presets.openai-compatible.chip.custom' inside main.tsx).
  label: string;
  // D-B3: '' for custom (reset semantics).
  baseURL: string;
  model: string;
  // i18n key per D-E3.
  helpTextKey: string;
};

// D-B1: 6 entries in declared order — OpenAI / OpenRouter / Together / Groq /
// DeepSeek / Custom. Verbatim baseURL + model values from CONTEXT D-B1.
export const OPENAI_COMPAT_TEMPLATES: ReadonlyArray<OpenAICompatTemplate> = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    helpTextKey: 'options.byok-presets.openai-compatible.helpText.openai',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4-5',
    helpTextKey: 'options.byok-presets.openai-compatible.helpText.openrouter',
  },
  {
    id: 'together',
    label: 'Together',
    baseURL: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    helpTextKey: 'options.byok-presets.openai-compatible.helpText.together',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    helpTextKey: 'options.byok-presets.openai-compatible.helpText.groq',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    helpTextKey: 'options.byok-presets.openai-compatible.helpText.deepseek',
  },
  {
    id: 'custom',
    label: '', // Custom chip label resolves via i18n in main.tsx
    baseURL: '', // D-B3 reset
    model: '', // D-B3 reset
    helpTextKey: 'options.byok-presets.openai-compatible.helpText.custom',
  },
];

/**
 * Phase 16 D-B2 invariant + D-B3 Custom reset:
 *
 * Returns the next editing-row state after a chip click. baseURL + model are
 * always overwritten with the template's values (chip is explicit user intent;
 * UNLIKE the dropdown's applyPreset NIT-3 fill-empty-only semantics). apiKey
 * is NEVER touched — caller's apiKey is returned unchanged so a mid-edit user
 * who pasted a key does not lose it.
 *
 * For Custom (id='custom'), baseURL='' and model='' implement D-B3 reset.
 */
export function applyTemplatePure(
  current: { baseURL: string; model: string; apiKey: string },
  tpl: OpenAICompatTemplate,
): { baseURL: string; model: string; apiKey: string } {
  return {
    baseURL: tpl.baseURL,
    model: tpl.model,
    apiKey: current.apiKey, // D-B2: untouched
  };
}
