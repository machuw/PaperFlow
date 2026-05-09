// Phase 16 D-B1 / D-B2 / D-B3: template chip pure handler tests.
//
// Acid test for D-B2: chip click NEVER touches apiKey field. Acid test for
// D-B3: Custom chip is reset (baseURL='' / model=''), not 'no-op'. 6 entries
// must be in declared order — OPENAI_COMPAT_TEMPLATES is the data contract
// the chip JSX in options/main.tsx renders against.
//
// Imports applyTemplatePure (a pure-function extraction of the React handler;
// PATTERNS.md Section 7.4) — the React handler in OptionsApp delegates to
// this so unit testing does not need React Testing Library.
//
// Module path: chrome-extension/options/openai-compat-templates.ts (split
// from options/main.tsx so the test does not drag in the OptionsApp tree
// and its supabase init side effects).

import { describe, it, expect } from 'vitest';
import {
  OPENAI_COMPAT_TEMPLATES,
  applyTemplatePure,
} from '../options/openai-compat-templates';

describe('Phase 16 OPENAI_COMPAT_TEMPLATES (D-B1)', () => {
  it('contains exactly 6 entries in declared order (D-B1)', () => {
    expect(OPENAI_COMPAT_TEMPLATES.map((t) => t.id)).toEqual([
      'openai',
      'openrouter',
      'together',
      'groq',
      'deepseek',
      'custom',
    ]);
  });

  it('OpenAI template baseURL + model match D-B1 verbatim', () => {
    const tpl = OPENAI_COMPAT_TEMPLATES.find((x) => x.id === 'openai')!;
    expect(tpl.baseURL).toBe('https://api.openai.com/v1');
    expect(tpl.model).toBe('gpt-4o');
  });

  it('OpenRouter template baseURL + model match D-B1 verbatim', () => {
    const tpl = OPENAI_COMPAT_TEMPLATES.find((x) => x.id === 'openrouter')!;
    expect(tpl.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(tpl.model).toBe('anthropic/claude-sonnet-4-5');
  });

  it('Together template baseURL + model match D-B1 verbatim', () => {
    const tpl = OPENAI_COMPAT_TEMPLATES.find((x) => x.id === 'together')!;
    expect(tpl.baseURL).toBe('https://api.together.xyz/v1');
    expect(tpl.model).toBe('meta-llama/Llama-3.3-70B-Instruct-Turbo');
  });

  it('Groq template baseURL + model match D-B1 verbatim', () => {
    const tpl = OPENAI_COMPAT_TEMPLATES.find((x) => x.id === 'groq')!;
    expect(tpl.baseURL).toBe('https://api.groq.com/openai/v1');
    expect(tpl.model).toBe('llama-3.3-70b-versatile');
  });

  it('DeepSeek template baseURL + model match D-B1 verbatim', () => {
    const tpl = OPENAI_COMPAT_TEMPLATES.find((x) => x.id === 'deepseek')!;
    expect(tpl.baseURL).toBe('https://api.deepseek.com/v1');
    expect(tpl.model).toBe('deepseek-chat');
  });

  it('Custom template has empty baseURL + model (D-B3 reset semantics)', () => {
    const tpl = OPENAI_COMPAT_TEMPLATES.find((x) => x.id === 'custom')!;
    expect(tpl.baseURL).toBe('');
    expect(tpl.model).toBe('');
  });

  it('all 6 helpTextKeys are unique', () => {
    const keys = OPENAI_COMPAT_TEMPLATES.map((t) => t.helpTextKey);
    expect(new Set(keys).size).toBe(6);
  });

  it('helpTextKey strings are namespaced under options.byok-presets.openai-compatible.helpText', () => {
    for (const tpl of OPENAI_COMPAT_TEMPLATES) {
      expect(tpl.helpTextKey).toMatch(
        /^options\.byok-presets\.openai-compatible\.helpText\./,
      );
    }
  });
});

describe('Phase 16 applyTemplatePure (D-B2 + D-B3)', () => {
  it('chip click sets baseURL + model but does NOT touch apiKey (D-B2 OpenAI)', () => {
    const initial = { baseURL: '', model: '', apiKey: 'sk-existing-user-key' };
    const tpl = OPENAI_COMPAT_TEMPLATES.find((x) => x.id === 'openai')!;
    const result = applyTemplatePure(initial, tpl);
    expect(result.baseURL).toBe('https://api.openai.com/v1');
    expect(result.model).toBe('gpt-4o');
    expect(result.apiKey).toBe('sk-existing-user-key'); // D-B2 invariant
  });

  it('Custom chip resets baseURL + model to empty, apiKey preserved (D-B3)', () => {
    const initial = {
      baseURL: 'https://other.example.com',
      model: 'foo',
      apiKey: 'sk-x',
    };
    const tpl = OPENAI_COMPAT_TEMPLATES.find((x) => x.id === 'custom')!;
    const result = applyTemplatePure(initial, tpl);
    expect(result.baseURL).toBe('');
    expect(result.model).toBe('');
    expect(result.apiKey).toBe('sk-x'); // D-B2 invariant holds for Custom too
  });

  it('apiKey invariant holds for ALL 6 templates (D-B2 universal)', () => {
    for (const tpl of OPENAI_COMPAT_TEMPLATES) {
      const result = applyTemplatePure(
        { baseURL: '', model: '', apiKey: 'sk-x' },
        tpl,
      );
      expect(result.apiKey).toBe('sk-x');
    }
  });

  it('overwrites pre-existing baseURL + model on each chip click (chip is explicit user intent, NOT fill-empty-only)', () => {
    // Distinguishes chip semantics from dropdown applyPreset NIT-3 fill-empty-only.
    // A chip click EXPLICITLY says 'switch to this template' — overwrite even if
    // baseURL/model already non-empty.
    const initial = {
      baseURL: 'https://stale.example.com/v1',
      model: 'stale-model',
      apiKey: 'sk-keep-me',
    };
    const tpl = OPENAI_COMPAT_TEMPLATES.find((x) => x.id === 'groq')!;
    const result = applyTemplatePure(initial, tpl);
    expect(result.baseURL).toBe('https://api.groq.com/openai/v1');
    expect(result.model).toBe('llama-3.3-70b-versatile');
    expect(result.apiKey).toBe('sk-keep-me');
  });
});
