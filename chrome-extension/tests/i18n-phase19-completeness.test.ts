/**
 * Phase 19 i18n completeness static guard.
 * Mirrors chrome-extension/tests/i18n-phase16-completeness.test.ts (117 LOC).
 * Asserts the 12 new Phase 19 keys × 9 locales = 108 entries all resolve via
 * the public t() API + the verbatim D-B6 (CTA labels) translation values are
 * wired correctly + the legacy 'topbar.byok-chip.no-active' key is removed
 * across all 9 locales (hard cutover invariant per CONTEXT pre-launch).
 *
 * Per memory feedback_test_infra.md: lives under chrome-extension/tests/.
 * Pure-JS via the public i18n API — no fs reads of the source, no DOM, no Playwright.
 *
 * RED → GREEN: this file MUST be written BEFORE the i18n.ts cluster is added.
 * Initial run: most it() blocks fail (missing keys echo raw key). After Task 2
 * adds the keys + deletes the legacy key, all blocks pass.
 *
 * Total it() count: 12 keys × 9 locales (108) + 9 D-B6 cta.new-config verbatim
 * + 9 D-B6 cta.manage verbatim + 9 chip char-count + 9 hard-cutover absence = 144.
 */

import { describe, it, expect } from 'vitest';
import { setLocale, t, type UiLocale } from '../reader/lib/i18n';

const LOCALES: UiLocale[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];

const PHASE_19_KEYS = [
  // ── ARIA labels ────────────────────────────────────────────────
  'topbar.model-picker.aria.menu',
  // ── System models section ──────────────────────────────────────
  'topbar.model-picker.system.heading',
  'topbar.model-picker.system.login-prompt',                  // D-B7.1
  'topbar.model-picker.system.locked-upgrade-cta',            // PICKER-07
  // ── BYOK configs section ───────────────────────────────────────
  'topbar.model-picker.byok.heading',
  'topbar.model-picker.byok.region-label',                    // D-B3.2 a11y
  'topbar.model-picker.byok.empty',                           // signed-in 0-config
  'topbar.model-picker.byok.signed-out-hint',                 // signed-out
  // ── Bottom CTA grid ────────────────────────────────────────────
  'topbar.model-picker.cta.new-config',                       // D-B6
  'topbar.model-picker.cta.manage',                           // D-B6
  // ── Chip 4-fork (PICKER-04) — replaces topbar.byok-chip.no-active
  'topbar.model-picker.chip.empty',                           // signed-in 0-config / signed-out
  'topbar.model-picker.chip.signed-out',                      // explicit signed-out (forward-looking; today aliased to chip.empty by component)
] as const;

describe('Phase 19 i18n completeness', () => {
  describe('12 new Phase 19 keys × 9 locales = 108 non-empty values', () => {
    for (const locale of LOCALES) {
      for (const key of PHASE_19_KEYS) {
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

  // D-B6 verbatim: bottom CTA new-config labels locked per-locale.
  describe('D-B6 verbatim: cta.new-config translation values locked', () => {
    const newConfigLabels: Record<UiLocale, string> = {
      'en':    '+ New config',
      'zh-CN': '+ 新建配置',
      'zh-TW': '+ 新增設定',
      'ja':    '+ 新しい設定',
      'ko':    '+ 새 구성',
      'fr':    '+ Nouvelle configuration',
      'de':    '+ Neue Konfiguration',
      'es':    '+ Nueva configuración',
      'ru':    '+ Новая конфигурация',
    };
    for (const [locale, expected] of Object.entries(newConfigLabels)) {
      it(`${locale} → cta.new-config === '${expected}' (D-B6 verbatim)`, async () => {
        await setLocale(locale as UiLocale);
        expect(t('topbar.model-picker.cta.new-config')).toBe(expected);
      });
    }
  });

  // D-B6 verbatim: bottom CTA manage labels locked per-locale.
  describe('D-B6 verbatim: cta.manage translation values locked', () => {
    const manageLabels: Record<UiLocale, string> = {
      'en':    'Manage',
      'zh-CN': '管理',
      'zh-TW': '管理',
      'ja':    '管理',
      'ko':    '관리',
      'fr':    'Gérer',
      'de':    'Verwalten',
      'es':    'Gestionar',
      'ru':    'Управление',
    };
    for (const [locale, expected] of Object.entries(manageLabels)) {
      it(`${locale} → cta.manage === '${expected}' (D-B6 verbatim)`, async () => {
        await setLocale(locale as UiLocale);
        expect(t('topbar.model-picker.cta.manage')).toBe(expected);
      });
    }
  });

  // PICKER-05 chip text fits ~220px width — rough char-count heuristic.
  // 220px / ~12px sans char ≈ 18 chars; CSS ellipsis is the actual safety net.
  // T-19-04 mitigation: catches Russian / German overflow risk early.
  describe('PICKER-05: chip.empty stays under ~18 chars in all 9 locales', () => {
    for (const locale of LOCALES) {
      it(`${locale} chip.empty length ≤ 18`, async () => {
        await setLocale(locale);
        const v = t('topbar.model-picker.chip.empty');
        expect(v.length).toBeLessThanOrEqual(18);
      });
    }
  });

  // Hard cutover invariant: 'topbar.byok-chip.no-active' is REMOVED across
  // all 9 locales. Pre-launch invariant — no alias map. Post-cutover the
  // resolver returns the raw key (since dict lookup falls through to ?? key).
  describe('Hard cutover: topbar.byok-chip.no-active removed in all 9 locales', () => {
    for (const locale of LOCALES) {
      it(`${locale} → topbar.byok-chip.no-active echoes raw key (or empty) post-cutover`, async () => {
        await setLocale(locale);
        const v = t('topbar.byok-chip.no-active');
        // Either the resolver returns the raw key (i18n.ts t() does this via ?? fallback)
        // OR an empty string. Either way it MUST NOT be a plausible UI string.
        const echoed = v === 'topbar.byok-chip.no-active';
        const empty = v === '';
        expect(echoed || empty).toBe(true);
      });
    }
  });
});
