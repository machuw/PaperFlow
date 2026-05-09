import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { trapFocus } from '../lib/focus-trap';
import { t, useT } from '../lib/i18n';
import '../styles/login-modal.css';

type Step = 'email' | 'otp';

/**
 * Map common supabase-auth SDK errors to localized, user-friendly text.
 * The SDK returns English message strings — many users (esp. zh) have
 * trouble parsing "Email rate limit exceeded" or "For security purposes,
 * you can only request this after 60 seconds" out of context. Pattern-match
 * the few high-frequency cases and fall back to the raw message otherwise.
 *
 * v1.0.x SMTP-todo Step 2.D: surface technical errors as user-friendly
 * messages so rate-limit / invalid-email failures are actionable.
 */
function mapAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('rate limit') || m.includes('for security purposes')) {
    return t('login.error.rate_limit');
  }
  if (m.includes('invalid email') || m.includes('invalid format') || m.includes('unable to validate email')) {
    return t('login.error.invalid_email');
  }
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to')) {
    return t('login.error.network');
  }
  return raw;
}

/**
 * LoginModal — soft-gate sign-in (spec §6.2, §6.3, §10.1, §14.1.1.1).
 *
 * Two paths:
 *   1. Google OAuth via chrome.identity.launchWebAuthFlow + Supabase
 *      signInWithOAuth (skipBrowserRedirect: true) — we own the window.
 *   2. Magic Link OTP via signInWithOtp / verifyOtp with a 60s resend
 *      cooldown (spec §14.2.2.2). Two-step UI: 'email' view collects the
 *      address, 'otp' view collects the code with explicit resend + back.
 *
 * Success in either path writes the session through the chromeStorage
 * adapter (Task B3) and calls onClose(). BYOK-only users skip via the
 * escape link at the bottom of the email step.
 */
export function LoginModal({ onClose }: { onClose: () => void }) {
  useT();  // re-render on locale change
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const googleBtnRef = useRef<HTMLButtonElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // a11y: first focus on Google button (spec §14.6.6.2). After step changes,
  // refocus the primary input of the active step.
  useEffect(() => {
    if (step === 'email') {
      // On mount focus Google (preserves §14.6.6.2); on later returns to email
      // step focus the email input (user came back to edit).
      if (email) emailInputRef.current?.focus();
      else googleBtnRef.current?.focus();
    } else {
      otpInputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // a11y: Tab-wrap focus trap inside the modal (Task F3).
  useEffect(() => {
    if (!panelRef.current) return;
    return trapFocus(panelRef.current);
  }, []);

  // Resend cooldown tick (60 → 0). Shared across both steps so going Back
  // does not reset the timer.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Escape closes the entire modal (NOT step back).
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function handleGoogle() {
    setSubmitting(true);
    setError('');
    try {
      const redirectTo = chrome.identity.getRedirectURL();
      const { data } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (!data.url) {
        throw new Error('Supabase did not return an OAuth URL');
      }
      const callbackUrl = await chrome.identity.launchWebAuthFlow({
        url: data.url,
        interactive: true,
      });
      if (!callbackUrl) {
        throw new Error('OAuth flow returned no callback URL');
      }
      const cb = new URL(callbackUrl);
      // Supabase JS v2.4+ defaults to PKCE — callback carries `?code=...` in the
      // query and the SDK holds the PKCE verifier in chrome.storage. Exchange the
      // code via the SDK, which also persists the session for us.
      const code = cb.searchParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
      } else {
        // Implicit-flow fallback: `#access_token=...&refresh_token=...`
        const hash = new URLSearchParams(cb.hash.slice(1));
        const access_token = hash.get('access_token');
        const refresh_token = hash.get('refresh_token');
        if (!access_token || !refresh_token) {
          const err = cb.searchParams.get('error_description')
                   ?? hash.get('error_description')
                   ?? 'OAuth callback missing both code and tokens';
          throw new Error(err);
        }
        await supabase.auth.setSession({ access_token, refresh_token });
      }
      // BYOK prefs pull is wired centrally in main.tsx onAuthStateChange.
      onClose();
    } catch (e: unknown) {
      setError(mapAuthError(e instanceof Error ? e.message : 'Google sign-in failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendOtp() {
    if (!email || cooldown > 0) return;
    setSubmitting(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setSubmitting(false);
    if (err) {
      setError(mapAuthError(err.message));
      return;
    }
    setCooldown(60);
    if (step !== 'otp') setStep('otp');
  }

  async function handleVerifyOtp() {
    if (otp.length < 6) return;
    setSubmitting(true);
    setError('');
    const { error: err } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    });
    if (err) {
      setSubmitting(false);
      setError(t('login.otp.expired'));
      setOtp('');
      return;
    }
    // BYOK prefs pull is wired centrally in main.tsx onAuthStateChange.
    onClose();
  }

  function handleBack() {
    setStep('email');
    setOtp('');
    setError('');
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-title"
      className="login-modal-backdrop"
      onClick={onClose}
    >
      <div ref={panelRef} className="login-modal-panel" onClick={(e) => e.stopPropagation()}>

        {step === 'email' ? (
          <>
            <div className="login-modal-label">SIGN IN</div>
            <h2 id="login-title" className="login-modal-headline">{t('login.headline')}</h2>
            <p className="login-modal-subhead">{t('login.subheadline')}</p>

            <button
              ref={googleBtnRef}
              onClick={handleGoogle}
              disabled={submitting}
              aria-label={t('login.google')}
              className="login-modal-google"
            >
              {t('login.google')}
            </button>

            <div className="login-modal-divider">{t('login.divider')}</div>

            <div className="login-modal-email-row">
              <input
                ref={emailInputRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.email.placeholder')}
                aria-label={t('login.email.placeholder')}
                disabled={submitting}
                className="login-modal-input"
              />
              <button
                onClick={handleSendOtp}
                disabled={submitting || cooldown > 0 || !email}
                className="login-modal-send-btn"
              >
                {cooldown > 0 ? t('login.email.resend', { n: cooldown }) : t('login.email.send')}
              </button>
            </div>

            {error && <div className="login-modal-error" role="alert">{error}</div>}

            <div className="login-modal-byok-escape">
              <span>{t('login.byok.hint')}</span>
              <a onClick={onClose} role="button" tabIndex={0} className="login-modal-skip">
                {t('login.byok.skip')}
              </a>
            </div>
          </>
        ) : (
          <>
            <a
              onClick={handleBack}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBack(); } }}
              className="login-modal-back"
            >
              {t('login.otp.back')}
            </a>

            <div className="login-modal-label">SIGN IN</div>
            <h2 id="login-title" className="login-modal-headline">{t('login.otp.title')}</h2>
            <p className="login-modal-subhead">{t('login.otp.sent_to', { email })}</p>
            <p className="login-modal-spam-hint">{t('login.otp.spam_hint')}</p>

            <div className="login-modal-otp-row">
              <input
                ref={otpInputRef}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder={t('login.otp.placeholder')}
                aria-label={t('login.otp.placeholder')}
                disabled={submitting}
                className="login-modal-input"
              />
              <button
                onClick={handleVerifyOtp}
                disabled={submitting || otp.length < 6}
                className="login-modal-verify-btn"
              >
                {t('login.otp.verify')}
              </button>
            </div>

            <button
              onClick={handleSendOtp}
              disabled={submitting || cooldown > 0}
              className="login-modal-resend-btn"
            >
              {cooldown > 0
                ? t('login.otp.resend.wait', { n: cooldown })
                : t('login.otp.resend.ready')}
            </button>

            {error && <div className="login-modal-error" role="alert">{error}</div>}
          </>
        )}

      </div>
    </div>
  );
}
