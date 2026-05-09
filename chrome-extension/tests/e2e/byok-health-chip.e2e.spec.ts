import { test, expect } from './_fixtures';
import { createServer, type Server } from 'node:http';

/**
 * Phase 12 SC #1 (live): chip latency.
 *
 * Spawns a stub HTTP server on localhost that mimics claude-code-openai-wrapper's
 * `/v1/models` response (200 with a `data` array). The on-save probe in
 * options/main.tsx fetches that endpoint, populates `byokHealthCache`, and
 * the row's <HealthChip> flips to green within DV-1's worst case (~3.2s).
 *
 * Roadmap SC #1 target: chip appears within 1s. We assert ≤ 5s to absorb
 * extension/page boot variance; the actual fetch path is single-shot 200
 * (no retry), so observed latency is dominated by React render + chrome.storage
 * onChanged broadcast.
 *
 * Pre-12-08 (no health check): chip never appeared.
 * Post-12-08 + retrofit: chip appears reliably; Phase 13 (13-05) updated for
 * Plan 13-04 D-E i18n lift — chip text now reads `'Healthy (N models)'` (en)
 * or `'已检测到（N 个模型）'` (zh-CN) via t('topbar.byok-popover.row.health.healthy').
 */

const STUB_PORT = 8999; // avoid the actual wrapper port :8000 to keep tests isolated
const STUB_BASE_URL = `http://localhost:${STUB_PORT}/v1`;

let stubServer: Server | undefined;

test.beforeAll(async () => {
  stubServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'claude-sonnet-4-5-20250929', object: 'model', created: 0, owned_by: 'stub' },
          { id: 'claude-opus-4-5-20250929', object: 'model', created: 0, owned_by: 'stub' },
          { id: 'claude-haiku-4-5-20250929', object: 'model', created: 0, owned_by: 'stub' },
        ],
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => stubServer!.listen(STUB_PORT, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  if (stubServer) {
    await new Promise<void>((resolve, reject) => stubServer!.close((err) => err ? reject(err) : resolve()));
  }
});

test.describe('Options page · BYOK health chip (live SC #1)', () => {
  test('Saving a localhost config triggers an on-save probe; chip flips to "healthy" within latency budget', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/index.html`);

    // Open new-config form
    const newConfigBtn = page.getByRole('button').filter({ hasText: /New config|新建配置|新規設定|nouvelle|新しい|새|nueva|новая/i });
    await newConfigBtn.click();

    const presetSelect = page.locator('select').filter({ has: page.locator('option[value="openai-compatible"]') });
    const editingForm = presetSelect.locator('xpath=ancestor::div[contains(@style, "padding: 16")][1]');

    // Quick task 260507: only openai-compatible preset remains; defaults are
    // empty (Phase 16 D-B3) so we fill baseURL/apiKey/model explicitly.
    const baseURLInput = editingForm.locator('input[type="url"]');
    await baseURLInput.fill(STUB_BASE_URL);

    const apiKeyInput = editingForm.locator('input[type="password"]');
    await apiKeyInput.fill('placeholder');

    const textInputs = editingForm.locator('input[type="text"]');
    const nameInput = textInputs.first();
    const modelInput = textInputs.last();
    await modelInput.fill('claude-sonnet-4-5-20250929');
    await nameInput.fill('Stub local');

    const saveStartTs = Date.now();
    const saveBtn = editingForm.getByRole('button').filter({ hasText: /Save|保存|Enregistrer|Speichern|Guardar|Сохранить/i }).first();
    await saveBtn.click();

    // First assertion — Save returned, row appears (proves D-C1 "save not blocked by probe")
    await expect(page.getByText('Stub local').first()).toBeVisible({ timeout: 2_000 });
    const saveLatency = Date.now() - saveStartTs;
    console.log(`[chip e2e] save → row visible: ${saveLatency}ms`);

    // Second assertion — green chip text appears with model count (3 models from stub).
    // Phase 13 (13-05): updated for 13-04 i18n lift — matches the new
    // 'Healthy (N models)' (en) and '已检测到（N 个模型）' (zh-CN) variants
    // produced by t('topbar.byok-popover.row.health.healthy', { n }).
    const probeStartTs = Date.now();
    const chipLocator = page.getByText(/Healthy\s*\(\s*\d+\s*models?\s*\)|已检测到（\d+ 个模型）|已偵測到（\d+ 個模型）|正常 \(\d+ モデル\)|정상 \(\d+개 모델\)/i).first();
    await expect(chipLocator).toBeVisible({ timeout: 5_000 });
    const probeLatency = Date.now() - probeStartTs;
    const totalLatency = Date.now() - saveStartTs;
    console.log(`[chip e2e] save → chip visible: ${totalLatency}ms (probe-only ${probeLatency}ms)`);

    // SC #1 target ≤ 1s after save; allow up to 5s in CI to absorb React render +
    // chrome.storage broadcast variance. Single-shot stub success means no retry,
    // so this should typically be well under 1s.
    expect(totalLatency).toBeLessThan(5_000);

    await page.close();
  });

  test('Unreachable localhost shows yellow "未响应" chip after retry path (~3.2s budget)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/index.html`);

    const newConfigBtn = page.getByRole('button').filter({ hasText: /New config|新建配置|新規設定|nouvelle|新しい|새|nueva|новая/i });
    await newConfigBtn.click();

    const presetSelect = page.locator('select').filter({ has: page.locator('option[value="openai-compatible"]') });
    const editingForm = presetSelect.locator('xpath=ancestor::div[contains(@style, "padding: 16")][1]');

    // Port 9 is the historical "discard protocol" — never listened to in practice.
    // Both 1500ms fetch attempts will fail (ECONNREFUSED), exercising the retry path.
    const baseURLInput = editingForm.locator('input[type="url"]');
    await baseURLInput.fill('http://localhost:9');

    const apiKeyInput = editingForm.locator('input[type="password"]');
    await apiKeyInput.fill('placeholder');

    const textInputs = editingForm.locator('input[type="text"]');
    const nameInput = textInputs.first();
    const modelInput = textInputs.last();
    await modelInput.fill('claude-sonnet-4-5-20250929');
    await nameInput.fill('Unreachable test');

    const saveBtn = editingForm.getByRole('button').filter({ hasText: /Save|保存|Enregistrer|Speichern|Guardar|Сохранить/i }).first();
    await saveBtn.click();

    // After both attempts fail (~3.2s worst case), the chip shows "Not responding"
    // (en) / "未响应" (zh-CN) / equivalent.
    // Phase 13 (13-05): updated for 13-04 i18n lift — matches the new
    // t('topbar.byok-popover.row.health.unreachable') values across all 9 locales.
    const unreachableChip = page.getByText(/Not responding|未响应|未響應|応答なし|응답 없음|Ne répond pas|Antwortet nicht|No responde|Не отвечает/i).first();
    await expect(unreachableChip).toBeVisible({ timeout: 7_000 });

    await page.close();
  });
});
