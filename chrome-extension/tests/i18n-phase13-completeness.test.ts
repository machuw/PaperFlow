// Phase 13 Plan 01 — i18n completeness static guard.
//
// Asserts the 9-locale rewrite of `account.header` (D-C1) and the 15 new
// Phase 13 keys × 9 locales (D-E) all resolve via the public `t()` API.
// Future regressions (e.g. someone deletes a key from one locale) are
// caught here before downstream plans 13-02 / 13-03 / 13-04 ship.
//
// Per memory `feedback_test_infra.md`: lives under `chrome-extension/tests/`
// (not a per-subdir test project). Pure-JS via the public i18n API — no
// fs reads of the source, no DOM, no Playwright.

import { describe, it, expect } from 'vitest';
import { setLocale, t, type UiLocale } from '../reader/lib/i18n';

const LOCALES: UiLocale[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];

const PHASE_13_KEYS = [
  // 'topbar.byok-chip.no-active' — retired in Phase 19 hard cutover (I18N-01);
  //   replaced by 'topbar.model-picker.chip.empty'. See i18n-phase19-completeness.test.ts.
  'topbar.byok-chip.aria.active',
  'topbar.byok-chip.aria.no-active',
  'topbar.byok-popover.heading',
  'topbar.byok-popover.banner.unreachable',
  'topbar.byok-popover.banner.doc-link',
  'topbar.byok-popover.empty',
  'topbar.byok-popover.btn.new',
  'topbar.byok-popover.btn.manage-all',
  'topbar.byok-popover.row.health.healthy',
  'topbar.byok-popover.row.health.unreachable',
  'options.byok-configs.row.health.healthy',
  'options.byok-configs.row.health.unreachable',
  'options.byok-configs.row.health.checking',
  'options.byok-configs.row.active-pill',
] as const;

describe('Phase 13 i18n completeness', () => {
  describe('account.header rewrite (D-C1)', () => {
    const expected: Record<UiLocale, string> = {
      'en':    'Settings',
      'zh-CN': '设置',
      'zh-TW': '設定',
      'ja':    '設定',
      'ko':    '설정',
      'fr':    'Paramètres',
      'de':    'Einstellungen',
      'es':    'Ajustes',
      'ru':    'Настройки',
    };
    for (const locale of LOCALES) {
      it(`${locale}: account.header = ${expected[locale]}`, async () => {
        await setLocale(locale);
        expect(t('account.header')).toBe(expected[locale]);
      });
    }
  });

  describe('15 new Phase 13 keys × 9 locales = 135 non-empty values', () => {
    for (const locale of LOCALES) {
      for (const key of PHASE_13_KEYS) {
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

  describe('placeholder interpolation', () => {
    it('topbar.byok-popover.banner.unreachable interpolates {name}', async () => {
      await setLocale('en');
      const v = t('topbar.byok-popover.banner.unreachable', { name: 'My Local' });
      expect(v).toContain('My Local');
      expect(v).not.toContain('{name}');
    });

    it('topbar.byok-chip.aria.active interpolates {name} and {model}', async () => {
      await setLocale('en');
      const v = t('topbar.byok-chip.aria.active', { name: 'Foo', model: 'gpt-4o' });
      expect(v).toContain('Foo');
      expect(v).toContain('gpt-4o');
      expect(v).not.toContain('{name}');
      expect(v).not.toContain('{model}');
    });

    it('topbar.byok-popover.row.health.healthy interpolates {n}', async () => {
      await setLocale('en');
      const v = t('topbar.byok-popover.row.health.healthy', { n: 6 });
      expect(v).toContain('6');
      expect(v).not.toContain('{n}');
    });
  });
});
