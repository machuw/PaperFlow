// chrome-extension/options/codex-login-panel.tsx
//
// Slice 1 #8 — BYOK config inline UI for the "openai-codex" preset.
// Renders one of three states:
//   1. Unauthenticated → "Login with ChatGPT" button + onboarding link
//   2. Login in progress → user_code display + cancel button
//   3. Authenticated → "Logged in as <email>" + logout button
//
// All credentials live in `codex_auth_tokens` + `codex_auth_user` (typed
// in storage-schema.ts). This panel never touches the BYOK config's
// apiKey field — Codex auth is global, separate from any BYOK row.

import { useEffect, useState } from 'react';
import {
  CodexReloginRequiredError,
  loginPoll,
  loginStart,
  logout as codexLogout,
  type LoginStartResult,
} from '../reader/lib/codex-auth';
import { getItem } from '../reader/lib/storage-schema';
import { t } from '../reader/lib/i18n';

interface LoginInProgress {
  userCode: string;
  cancel: () => void;
}

export function CodexLoginPanel() {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [loginInFlight, setLoginInFlight] = useState<LoginInProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Hydrate on mount + subscribe to storage changes so login/logout from
  // elsewhere (e.g. PaperFlow account logout via clearLogoutKeys) reflects
  // here without a remount.
  useEffect(() => {
    let mounted = true;
    void getItem('codex_auth_user').then((u) => {
      if (mounted) setUser(u ?? null);
    });
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const handler = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local' || !changes.codex_auth_user) return;
      setUser((changes.codex_auth_user.newValue as { email: string } | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(handler);
    };
  }, []);

  const handleLogin = async () => {
    setError(null);
    setShowOnboarding(false);
    let start: LoginStartResult;
    try {
      start = await loginStart();
    } catch (e) {
      setError(t('options.byok-codex.error.startFailed'));
      return;
    }
    const controller = new AbortController();
    setLoginInFlight({
      userCode: start.userCode,
      cancel: () => controller.abort(),
    });
    try {
      await loginPoll(start, controller.signal);
      // codex_auth_user storage listener flips `user` to authenticated state.
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // User cancelled — no error message, just clean up.
      } else if (e instanceof CodexReloginRequiredError) {
        // Should not happen during initial login, but defensive.
        setError(t('options.byok-codex.error.reloginRequired'));
      } else {
        // Most failures during device flow with this client_id come down to
        // the user not having enabled the ChatGPT account-side opt-in
        // setting; surface the onboarding modal explaining what to do.
        setShowOnboarding(true);
      }
    } finally {
      setLoginInFlight(null);
    }
  };

  const handleLogout = async () => {
    await codexLogout();
    // codex_auth_user storage listener will null-out `user`.
  };

  // Slice 5 #14: the outer Field shell in options/main.tsx provides the
  // section label + spacing. CodexLoginPanel renders only the state-driven
  // controls inline so the row visually aligns with apiKey/baseURL/model
  // rows in other BYOK presets.
  return (
    <div>
      {/* State 3: authenticated */}
      {user && !loginInFlight && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>
            {t('options.byok-codex.loggedIn.label', { email: user.email })}
          </span>
          <button
            onClick={handleLogout}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              background: 'transparent',
              color: 'var(--foxglove)',
              border: '0.5px solid var(--foxglove)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t('options.byok-codex.logout.btn')}
          </button>
        </div>
      )}

      {/* State 1: unauthenticated, no login in progress */}
      {!user && !loginInFlight && (
        <div>
          <button
            onClick={handleLogin}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: 0,
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {t('options.byok-codex.login.btn')}
          </button>
          <p
            style={{
              fontSize: 'var(--t-xs)',
              color: 'var(--ink-faded)',
              marginTop: 8,
              marginBottom: 0,
            }}
          >
            {t('options.byok-codex.login.helpText')}
          </p>
        </div>
      )}

      {/* State 2: login in progress (waiting for user to confirm in browser) */}
      {loginInFlight && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--ink)', marginTop: 0, marginBottom: 8 }}>
            {t('options.byok-codex.login.pending.instructions')}
          </p>
          <div
            style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 22,
              letterSpacing: '0.08em',
              padding: '8px 14px',
              background: 'var(--paper)',
              border: '0.5px solid var(--rule)',
              borderRadius: 4,
              display: 'inline-block',
              marginBottom: 8,
              userSelect: 'all',
            }}
          >
            {loginInFlight.userCode}
          </div>
          <div>
            <button
              onClick={loginInFlight.cancel}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                background: 'transparent',
                color: 'var(--ink)',
                border: '0.5px solid var(--rule)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {t('options.byok-codex.login.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          style={{
            marginTop: 8,
            padding: '6px 10px',
            background: 'color-mix(in oklch, var(--foxglove) 10%, transparent)',
            border: '0.5px solid var(--foxglove)',
            borderRadius: 4,
            color: 'var(--foxglove)',
            fontSize: 12,
          }}
        >
          {error}
        </p>
      )}

      {showOnboarding && <OnboardingModal onDismiss={() => setShowOnboarding(false)} />}
    </div>
  );
}

function OnboardingModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480,
          padding: 24,
          background: 'var(--paper)',
          border: '0.5px solid var(--rule)',
          borderRadius: 8,
          color: 'var(--ink)',
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: 16 }}>
          {t('options.byok-codex.onboarding.title')}
        </h3>
        <p style={{ fontSize: 13, lineHeight: 1.5 }}>
          {t('options.byok-codex.onboarding.body')}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <a
            href="https://chatgpt.com/#settings/Security"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: 'var(--ink)',
              color: 'var(--paper)',
              textDecoration: 'none',
              borderRadius: 4,
            }}
          >
            {t('options.byok-codex.onboarding.openSettings')}
          </a>
          <button
            onClick={onDismiss}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: 'transparent',
              color: 'var(--ink)',
              border: '0.5px solid var(--rule)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t('options.byok-codex.onboarding.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
