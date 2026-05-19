import { getConfig } from './storage';
import { t } from './i18n';
import { CodexReloginRequiredError } from './codex-auth';
import { CodexApiSurfaceChangedError, CodexNetworkError } from './codex-stream';

export async function adaptiveServerErrorToast(): Promise<string> {
  // Phase 13: getConfig() reads new active multi-config row first.
  const cfg = await getConfig();
  return cfg?.apiKey ? t('error.500.byok') : t('error.500.nobyok');
}

export interface ToastConfig {
  message: string;
  action?: { label: string; handler: () => void | Promise<void> };
  timeoutMs?: number;
}

/**
 * Dispatch a toast event. The reader root mounts a `ToastHost` (see
 * `components/toast.tsx`) that listens for `pf-show-toast` CustomEvents and
 * renders the toast UI with optional action button.
 */
export function showToast(config: ToastConfig): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastConfig>('pf-show-toast', { detail: config }));
}

/**
 * Slice 3 #12: surface Codex-specific errors via the toast channel. Returns
 * true if the error was a known Codex failure (so the caller can skip its
 * own error path) and false otherwise (caller continues with the existing
 * error UI). The toast action button opens the Options page so users can
 * re-login or switch BYOK providers without leaving their reading flow.
 */
export function surfaceCodexError(err: unknown): boolean {
  const openOptions = () => {
    try { chrome.runtime.openOptionsPage?.(); } catch { /* no-op */ }
  };
  if (err instanceof CodexReloginRequiredError) {
    showToast({
      message: t('codex-error.relogin'),
      action: { label: t('codex-error.open-options'), handler: openOptions },
      timeoutMs: 8000,
    });
    return true;
  }
  if (err instanceof CodexApiSurfaceChangedError) {
    showToast({
      message: t('codex-error.api-changed'),
      action: { label: t('codex-error.open-options'), handler: openOptions },
      timeoutMs: 8000,
    });
    return true;
  }
  // PR #15 review fix: classify offline / DNS / TLS failures as a network
  // error with a distinct "check connection" message — different remediation
  // from "switch BYOK provider" or "re-login".
  if (err instanceof CodexNetworkError) {
    showToast({
      message: t('codex-error.network'),
      timeoutMs: 6000,
    });
    return true;
  }
  return false;
}
