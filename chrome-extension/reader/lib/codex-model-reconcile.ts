// chrome-extension/reader/lib/codex-model-reconcile.ts
//
// Slice 3 #25 / ADR-0002 §决策点 5 — when the discovery fetch returns a model
// list that no longer contains the active BYOK config's stored model
// (OpenAI removed it, tier downgrade, etc.), auto-reset the model to
// availableModels[0] and dispatch a one-shot action toast informing the
// user. Discovery is best-effort, so this function MUST never throw.

import { getActiveBYOKConfig, updateBYOKConfig } from './byok-configs';
import { isCodexBaseURL } from './byok-presets';
import { showToast } from './toast-helpers';
import { t } from './i18n';

export async function reconcileActiveCodexModel(newModels: string[]): Promise<void> {
  // Defensive: caller (refreshAvailableModels) guarantees a non-empty list
  // via the [CODEX_DEFAULT_MODEL] fallback, but if anyone ever calls this
  // with [] directly we must NOT overwrite cfg.model with undefined.
  if (newModels.length === 0) return;
  const active = await getActiveBYOKConfig();
  if (!active) return;
  if (!isCodexBaseURL(active.base_url)) return;
  if (newModels.includes(active.model)) return;

  const oldModel = active.model;
  const newModel = newModels[0];
  await updateBYOKConfig(active.id, { model: newModel });

  showToast({
    message: t('codex-error.model-switched', { old: oldModel, new: newModel }),
    action: {
      label: t('codex-error.open-options'),
      handler: () => {
        try { chrome.runtime.openOptionsPage?.(); } catch { /* no-op */ }
      },
    },
    timeoutMs: 8000,
  });
}
