/**
 * Phase 28 i18n completeness static guard.
 * Mirrors chrome-extension/tests/i18n-phase19-completeness.test.ts 1:1 in structure.
 * Asserts the 6 new Phase 28 keys × 9 locales = 54 entries all resolve via
 * the public t() API + the confirm-remove-body length sanity gate per D-04
 * (must convey: paper leaves library / local annotations kept / only library entry removed)
 * + namespace absence guard (no orphan `library.add.*` introduced).
 *
 * Per memory feedback_test_infra.md: lives under chrome-extension/tests/.
 * Pure-JS via the public i18n API — no fs reads of the source, no DOM, no Playwright.
 *
 * RED → GREEN: this file MUST be written BEFORE the i18n.ts cluster is added.
 * Initial run: completeness it() blocks fail (missing keys echo raw key). After Task 2
 * adds the keys, all 64 it-blocks pass.
 *
 * Total it() count: 6 keys × 9 locales (54) + 9 confirm-remove-body length sanity + 1 namespace absence = 64.
 */

import { describe, it, expect } from 'vitest';
import { setLocale, t, type UiLocale } from '../reader/lib/i18n';

const LOCALES: UiLocale[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];

const PHASE_28_KEYS = [
  // ── Add to Library button (Phase 28) ────────────────────────────────────
  'topbar.add-to-library.add',                 // Add-state button label
  'topbar.add-to-library.added',               // Added-state button label
  'topbar.add-to-library.confirm-remove-title', // Confirm modal title
  'topbar.add-to-library.confirm-remove-body',  // Confirm modal body (D-04 reassurance contract)
  'topbar.add-to-library.confirm-remove-danger', // Confirm modal danger button
  'topbar.add-to-library.add-failed',           // Best-effort toast on enqueue failure (D-08)
] as const;

describe('Phase 28 i18n completeness (64 it-blocks total)', () => {
  describe('6 new Phase 28 keys × 9 locales = 54 non-empty values', () => {
    for (const locale of LOCALES) {
      for (const key of PHASE_28_KEYS) {
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

  // D-04 body-text reassurance contract: each locale's confirm-remove-body must
  // convey three points: (1) paper leaves library, (2) local annotations/cache kept,
  // (3) only library entry removed. Length floor > 30 chars rules out one-liners
  // that silently drop the reassurance. Not a substitute for human review of
  // zh-CN/en (lead translations), but a cheap catch-early gate.
  describe('confirm-remove-body conveys local-data preservation across 9 locales', () => {
    for (const locale of LOCALES) {
      it(`${locale} → confirm-remove-body length > 30`, async () => {
        await setLocale(locale);
        const v = t('topbar.add-to-library.confirm-remove-body');
        expect(v.length).toBeGreaterThan(30);  // rule out one-liners that omit D-04 reassurance
      });
    }
  });

  // Namespace absence guard: Phase 28 hard-cutover uses `topbar.add-to-library.*`.
  // If someone mistakenly introduces `library.add.*` keys, this guard catches it.
  // A missing key echoes the raw key back (t() fallback), so this confirms the
  // old namespace was NOT introduced.
  it('legacy namespace `library.add.*` not introduced (Phase 28 hard-cutover into topbar.* cluster)', () => {
    // Picking up the wrong namespace would echo raw key — that's what we assert:
    expect(t('library.add.add')).toBe('library.add.add');
  });
});
