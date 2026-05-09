import { getConfig } from './storage';
import { t } from './i18n';

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
 * Dispatch a toast event. The reader root (main.tsx) listens for these
 * events and renders the toast UI. Until that listener is wired (deferred
 * follow-up), this is a no-op visually — but the helper is callable now
 * so undo affordances can be wired through their normal data flow.
 */
export function showToast(config: ToastConfig): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastConfig>('pf-show-toast', { detail: config }));
}
