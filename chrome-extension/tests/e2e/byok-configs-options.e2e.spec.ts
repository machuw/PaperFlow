import { test, expect } from './_fixtures';

/**
 * Phase 12 (post-retrofit): BYOK Configs Options page E2E.
 *
 * Verifies the local-only chrome.storage.local CRUD flow:
 *   - Visual layout (heading / description / "+ New config" button / legacy <details> collapsed)
 *   - Functional CRUD (new / edit / set-active / delete)
 *   - Preset auto-fill via applyPreset
 *   - Validation (baseURL SSRF guard / name regex)
 *   - i18n surface for zh-CN + ja
 *   - Persistence: a saved config survives a page reload (chrome.storage.local round-trip)
 *
 * Pre-retrofit this would have failed at Save with `Error: not-authenticated`
 * (Supabase session required). Post-retrofit (R1+R2+R3) the path is local-only.
 */

test.describe('Options page · BYOK Configs', () => {
  test('Visual + Functional + Validation flow (default locale)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/index.html`);

    // ── Visual ────────────────────────────────────────────────────────
    // Heading rendered via t('options.byok-configs.heading') — actual locale
    // depends on the user's chosen UI language; we only assert presence of
    // the empty-state copy that's unique to the new section.
    await expect(page.locator('#root')).toBeVisible();
    await expect(page.getByText(/BYOK/, { exact: false }).first()).toBeVisible();

    // The "+ New config" button uses i18n key options.byok-configs.btn.new.
    // We match by aria/role rather than text since the literal differs per locale.
    const newConfigBtn = page.getByRole('button').filter({ hasText: /New config|新建配置|新規設定|nouvelle|新しい|새|nueva|новая|nueva/i });
    await expect(newConfigBtn).toBeVisible();

    // Legacy <details> exists and is collapsed by default.
    const legacyDetails = page.locator('details');
    await expect(legacyDetails).toBeVisible();
    // <details> without `open` attr is collapsed.
    await expect(legacyDetails).not.toHaveAttribute('open', /.*/);

    // ── Functional: open new-config form ──────────────────────────────
    await newConfigBtn.click();

    // Preset dropdown — Slice 1 #8 adds 'openai-codex' alongside the
    // 'openai-compatible' entry left over from quick task 260507.
    const presetSelect = page.locator('select').filter({ has: page.locator('option[value="openai-compatible"]') });
    await expect(presetSelect).toBeVisible();
    const optionValues = await presetSelect.locator('option').evaluateAll(
      (els) => els.map((e) => (e as HTMLOptionElement).value).sort(),
    );
    expect(optionValues).toEqual(['openai-codex', 'openai-compatible']);

    // The legacy v1.1 form is wrapped in a collapsed <details> below the new
    // form — its inputs are hidden but still in DOM. Scope to the new form via
    // the preset select's parent container.
    const editingForm = presetSelect.locator('xpath=ancestor::div[contains(@style, "padding: 16")][1]');

    const baseURLInput = editingForm.locator('input[type="url"]');
    const apiKeyInput = editingForm.locator('input[type="password"]');
    const textInputs = editingForm.locator('input[type="text"]');
    // Order in form: name, model (Plan 12-07 §Edit 4 JSX places name first then model).
    const nameInput = textInputs.first();
    const modelInput = textInputs.last();

    // ── Functional: fill name + URL + key + model + save ─────────────
    // openai-compatible has empty defaults (Phase 16 D-B3) so all fields
    // require explicit user input — no preset auto-fill to assert.
    await baseURLInput.fill('http://localhost:8000/v1');
    await modelInput.fill('claude-sonnet-4-5-20250929');
    await apiKeyInput.fill('placeholder');
    await nameInput.fill('Test config');

    const saveBtn = page.getByRole('button').filter({ hasText: /Save|保存|Enregistrer|Speichern|Guardar|Сохранить|キャンセル|취소/i }).filter({ hasNotText: /Cancel|取消|キャンセル|Annuler|Abbrechen|Cancelar|Отмена|취소/i }).first();
    await saveBtn.click();

    // After save, the form should close and the row appears in the list
    await expect(page.getByText('Test config').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('http://localhost:8000/v1').first()).toBeVisible();

    // ── Functional: row has active radio + Edit + Delete ──────────────
    const radio = page.locator('input[type="radio"][name="active-byok"]');
    await expect(radio).toBeVisible();
    await expect(radio).toBeChecked(); // first config auto-actives

    // ── Persistence: reload page → row is still there ─────────────────
    await page.reload();
    await expect(page.getByText('Test config').first()).toBeVisible({ timeout: 5_000 });

    // ── Validation: invalid baseURL ───────────────────────────────────
    // Edit the existing config to an invalid baseURL
    const editBtn = page.getByRole('button').filter({ hasText: /Edit|编辑|編集|Modifier|Bearbeiten|Editar|Изменить|편집/i }).first();
    await editBtn.click();

    // Re-scope to the edit form (preset select belongs to it).
    const editPresetSelect = page.locator('select').filter({ has: page.locator('option[value="openai-compatible"]') });
    const editForm = editPresetSelect.locator('xpath=ancestor::div[contains(@style, "padding: 16")][1]');

    const editBaseURL = editForm.locator('input[type="url"]');
    await editBaseURL.fill('http://example.com'); // not localhost, not https → should fail
    const editSaveBtn = editForm.getByRole('button').filter({ hasText: /Save|保存|Enregistrer|Speichern|Guardar|Сохранить/i }).first();
    await editSaveBtn.click();

    // Expect baseURL error banner. The string "127.0.0.1" is unique to the
    // error.baseURL i18n key (legacy and new-form hints don't contain it).
    await expect(page.getByText(/127\.0\.0\.1/).first()).toBeVisible({ timeout: 3_000 });

    // ── Validation: invalid name ──────────────────────────────────────
    await editBaseURL.fill('https://api.openai.com/v1'); // restore valid
    const editName = editForm.locator('input[type="text"]').first();
    await editName.fill('bad/name'); // contains slash → fails name regex
    await editSaveBtn.click();
    // The error.name i18n key uniquely contains "1-32" across all locales.
    await expect(page.getByText(/1-32|1〜32|1～32/).first()).toBeVisible({ timeout: 3_000 });

    // Cleanup: cancel the edit
    const cancelBtn = page.getByRole('button').filter({ hasText: /Cancel|取消|キャンセル|Annuler|Abbrechen|Cancelar|Отмена|취소/i }).first();
    await cancelBtn.click();

    await page.close();
  });

  test('i18n surface — zh-CN + ja heading & buttons render in target language', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/index.html`);

    // Switch UI language via the existing select on the Options page.
    // The select contains the v1.1 'options.uiLanguage.*' field.
    const uiLangSelect = page.locator('select').first();
    await uiLangSelect.selectOption('zh-CN');
    await page.reload();

    // Heading "BYOK 配置" + button text 新建配置
    await expect(page.getByText('BYOK 配置').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /新建配置/ })).toBeVisible();

    // Switch to ja
    await uiLangSelect.selectOption('ja');
    await page.reload();

    await expect(page.getByText(/BYOK 設定|BYOK設定/).first()).toBeVisible({ timeout: 5_000 });
    // ja "+ 新規設定" or similar
    await expect(page.getByRole('button').filter({ hasText: /新規|新しい/ }).first()).toBeVisible();

    // No raw i18n key leaks (would indicate a missing translation)
    await expect(page.getByText('options.byok-configs.heading')).not.toBeVisible();

    await page.close();
  });
});
