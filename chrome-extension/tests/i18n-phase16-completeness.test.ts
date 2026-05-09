// Phase 16 i18n completeness static guard.
// Mirrors chrome-extension/tests/i18n-phase15-completeness.test.ts:1-52.
// Asserts the 8 new Phase 16 keys × 9 locales = 72 entries all resolve
// via the public `t()` API + the verbatim D-E1 (label) and D-E2 (chip.custom)
// translation values are wired correctly + Phase 12 cleanup follow-up: the
// existing `options.byok-configs.description` strings no longer mention the
// retired anthropic-via-proxy preset.
//
// Per memory `feedback_test_infra.md`: lives under `chrome-extension/tests/`
// (not a per-subdir test project). Pure-JS via the public i18n API — no
// fs reads of the source, no DOM, no Playwright.

import { describe, it, expect } from 'vitest';
import { setLocale, t, type UiLocale } from '../reader/lib/i18n';

const LOCALES: UiLocale[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];

const PHASE_16_KEYS = [
  'options.byok-presets.openai-compatible.label',
  'options.byok-presets.openai-compatible.chip.custom',
  'options.byok-presets.openai-compatible.helpText.openai',
  'options.byok-presets.openai-compatible.helpText.openrouter',
  'options.byok-presets.openai-compatible.helpText.together',
  'options.byok-presets.openai-compatible.helpText.groq',
  'options.byok-presets.openai-compatible.helpText.deepseek',
  'options.byok-presets.openai-compatible.helpText.custom',
] as const;

describe('Phase 16 i18n completeness', () => {
  describe('8 new Phase 16 keys × 9 locales = 72 non-empty values', () => {
    for (const locale of LOCALES) {
      for (const key of PHASE_16_KEYS) {
        it(`${locale} → ${key} resolves to non-empty string`, async () => {
          await setLocale(locale);
          const v = t(key);
          expect(typeof v).toBe('string');
          expect(v.length).toBeGreaterThan(0);
          // Negative: must not echo the raw key (would indicate missing translation)
          expect(v).not.toBe(key);
        });
      }
    }
  });

  // D-E1 verbatim: label translations locked to the values planner provided
  // in CONTEXT D-E1.
  describe('D-E1: label translation values verbatim', () => {
    const labels: Record<UiLocale, string> = {
      en: 'OpenAI compatible',
      'zh-CN': 'OpenAI 兼容',
      'zh-TW': 'OpenAI 相容',
      ja: 'OpenAI 互換',
      ko: 'OpenAI 호환',
      fr: 'Compatible OpenAI',
      de: 'OpenAI-kompatibel',
      es: 'Compatible con OpenAI',
      ru: 'Совместимо с OpenAI',
    };
    for (const [locale, expected] of Object.entries(labels)) {
      it(`${locale} → label === '${expected}' (D-E1 verbatim)`, async () => {
        await setLocale(locale as UiLocale);
        expect(t('options.byok-presets.openai-compatible.label')).toBe(expected);
      });
    }
  });

  // D-E2 verbatim: 'Custom' chip translations locked to CONTEXT D-E2 values.
  describe('D-E2: chip.custom translation values verbatim', () => {
    const customLabels: Record<UiLocale, string> = {
      en: 'Custom',
      'zh-CN': '自定义',
      'zh-TW': '自訂',
      ja: 'カスタム',
      ko: '사용자 정의',
      fr: 'Personnalisé',
      de: 'Benutzerdefiniert',
      es: 'Personalizado',
      ru: 'Произвольно',
    };
    for (const [locale, expected] of Object.entries(customLabels)) {
      it(`${locale} → chip.custom === '${expected}' (D-E2 verbatim)`, async () => {
        await setLocale(locale as UiLocale);
        expect(t('options.byok-presets.openai-compatible.chip.custom')).toBe(expected);
      });
    }
  });

  // Phase 12 cleanup follow-up: options.byok-configs.description must no
  // longer mention the retired anthropic-via-proxy preset (Phase 15 deleted
  // the preset itself but forgot to update these descriptions). Phase 16
  // also folds the OpenAI / OpenRouter / custom enumeration into the new
  // 'OpenAI compatible' label, but the strict guard here is anthropic-only —
  // anything else is allowed.
  describe('Phase 12 cleanup: description no longer mentions anthropic-via-proxy', () => {
    const FORBIDDEN_FRAGMENTS = [
      'anthropic-via-proxy',
      'anthropic via proxy',
      'anthropic 经代理',
      'anthropic 經代理',
      'anthropic プロキシ',
      'anthropic 프록시',
      'anthropic vía proxy',
      'anthropic via proxy',
      'anthropic via proxy',
      'anthropic через прокси',
    ];
    for (const locale of LOCALES) {
      it(`${locale} → options.byok-configs.description has no anthropic-via-proxy fragment`, async () => {
        await setLocale(locale);
        const desc = t('options.byok-configs.description').toLowerCase();
        for (const fragment of FORBIDDEN_FRAGMENTS) {
          expect(desc).not.toContain(fragment.toLowerCase());
        }
      });
    }
  });
});
