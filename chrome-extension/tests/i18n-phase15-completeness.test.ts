// Phase 15 i18n completeness static guard.
// Mirrors chrome-extension/tests/i18n-phase13-completeness.test.ts:1-69.
// Asserts the 6 new Phase 15 keys × 9 locales = 54 entries all resolve
// via the public `t()` API. Future regressions (e.g. a key deleted from
// one locale) caught here before downstream Plan 15-04 Task 2 ships UI
// AND Task 2.5 ships the toast that consumes the toast.migrated/.view keys.
//
// Per memory `feedback_test_infra.md`: lives under `chrome-extension/tests/`
// (not a per-subdir test project). Pure-JS via the public i18n API — no
// fs reads of the source, no DOM, no Playwright.

import { describe, it, expect } from 'vitest';
import { setLocale, t, type UiLocale } from '../reader/lib/i18n';

const LOCALES: UiLocale[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];

// 2026-05-07: dropped the two `options.managed-models.toast.*` keys after
// the migration toast was removed (Anthropic-via-proxy preset migration is
// silent now). Shape kept at 4 keys × 9 locales = 36 non-empty values.
const PHASE_15_KEYS = [
  'options.managed-models.heading',
  'options.managed-models.description',
  'options.managed-models.locked.badge',
  'options.managed-models.locked.upgrade-cta',
] as const;

describe('Phase 15 i18n completeness', () => {
  describe('4 Phase 15 keys × 9 locales = 36 non-empty values', () => {
    for (const locale of LOCALES) {
      for (const key of PHASE_15_KEYS) {
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
});
