import { useEffect, useRef, useState } from 'react';
import { I } from './icons';
import type { Paper, ReaderVariant } from '../types';
import { supabase } from '../lib/supabase';
import { subscribeSubscriptions } from '../lib/subscriptions-sync';
import { getConfig } from '../lib/storage';
import { clearLogoutKeys } from '../lib/logout-cleanup';
import { t, useT, getLocale } from '../lib/i18n';
import { OUTPUT_LANGUAGES } from '../lib/ai';
import { runAgentDevDemo } from '../lib/agent-client';
import { LoginModal } from './login-modal';
import { QuotaChip } from './quota-chip';
import { BYOKChip } from './byok-chip';
import { ConfirmModal } from './confirm-modal';
import '../styles/account-menu.css';
import type { Session } from '@supabase/supabase-js';

interface Props {
  paper: Paper;
  variant: ReaderVariant;
  setVariant: (v: ReaderVariant) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;

  chatOpen?: boolean;
  workspaceOpen: boolean;
  onToggleChat?: () => void;
  onToggleWorkspace: () => void;

  onOpenLibrary: () => void;
  isInLibrary: boolean;
  onAddToLibrary: () => void | Promise<void>;
  onRemoveFromLibrary: () => void | Promise<void>;
  onOpenCmdK: () => void;
  onOpenTweaks: () => void;

  activeSectionId: string | null;
  pageLabel: string;
}

export function TopBar(props: Props) {
  const { paper, variant, theme, chatOpen, workspaceOpen, pageLabel } = props;
  useT(); // subscribe to locale changes for t() calls below

  // WorkspacePanel now renders in all variants per CONTEXT D3 (in-flow for
  // summary/classic, absolute-positioned overlay for canvas).
  const workspaceDisabled = false;

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeInFlight, setRemoveInFlight] = useState(false);

  return (
    <>
    <div style={{
      height: 42, flexShrink: 0,
      background: 'var(--paper)',
      borderBottom: '0.5px solid var(--rule)',
      display: 'flex', alignItems: 'center', padding: '0 8px', gap: 2,
    }}>
      <IconToggle
        title="Toggle AI workspace"
        active={workspaceOpen && !workspaceDisabled}
        disabled={workspaceDisabled}
        onClick={props.onToggleWorkspace}
      ><I.Sparkle size={14} /></IconToggle>

      <a
        href="https://paperflow.pages.dev"
        target="_blank"
        rel="noopener noreferrer"
        title="Open PaperFlow homepage"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px 2px 4px',
          color: 'inherit', textDecoration: 'none',
          borderRadius: 5,
          transition: 'background 120ms',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-deep)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <img
          src={chrome.runtime.getURL('icons/icon.svg')}
          alt="PaperFlow"
          width={20}
          height={20}
          style={{ display: 'block' }}
        />
        <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: '-0.01em' }}>PaperFlow</span>
        {import.meta.env.MODE !== 'production' && (
          <span
            title={`${import.meta.env.MODE} build · ${import.meta.env.VITE_SUPABASE_URL}`}
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: '#fff',
              background: '#d97706',
              padding: '1px 5px',
              borderRadius: 3,
              letterSpacing: '0.06em',
            }}
          >DEV</span>
        )}
      </a>

      <div style={{ width: 0.5, height: 18, background: 'var(--rule)', margin: '0 4px' }} />

      <button
        onClick={props.onOpenLibrary}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px', borderRadius: 5,
          fontSize: 12, color: 'var(--ink-soft)',
          transition: 'background 120ms',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-deep)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <I.Library size={13} stroke={1.4} /> Library
      </button>

      <button
        onClick={() => {
          if (props.isInLibrary) {
            setConfirmRemove(true);
          } else {
            void props.onAddToLibrary();
          }
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px', borderRadius: 5,
          fontSize: 12, color: 'var(--ink-soft)',
          transition: 'background 120ms',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-deep)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        {props.isInLibrary
          ? <><I.Check size={13} stroke={1.4} /> {t('topbar.add-to-library.added')}</>
          : <><I.Plus size={13} stroke={1.4} /> {t('topbar.add-to-library.add')}</>}
      </button>

      {/* Breadcrumb */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 8, minWidth: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 12px',
          background: 'var(--paper-soft)',
          border: '0.5px solid var(--rule)',
          borderRadius: 999,
          maxWidth: 520, minWidth: 0,
        }}>
          <I.Book size={12} stroke={1.4} style={{ color: 'var(--ink-faded)', flexShrink: 0 }} />
          <span style={{
            fontSize: 12, color: 'var(--ink-soft)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          }}>{paper.title}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--ink-ghost)', flexShrink: 0,
          }}>{pageLabel}</span>
        </div>
      </div>

      <IconButton title="Command (⌘K)" onClick={props.onOpenCmdK}>
        <I.Command size={14} />
      </IconButton>

      <VariantSwitcher variant={variant} setVariant={props.setVariant} />

      <IconButton title="Toggle theme" onClick={props.toggleTheme}>
        {theme === 'dark' ? <I.Sun size={14} /> : <I.Moon size={14} />}
      </IconButton>

      {/* Tweaks button hidden 2026-05-06 (per user smoke pass — minimal removal,
          A=just hide button per Option A). TweaksPanel state + render preserved
          in main.tsx for future re-enablement; onOpenTweaks prop kept intact
          (becomes unused but reversible). */}

      {typeof window !== 'undefined' && localStorage.getItem('pf_debug_agent') === '1' && (
        <IconButton title="Run agent (debug)" onClick={() => { void runAgentDevDemo() }}>
          <I.Memory size={14} />
        </IconButton>
      )}

      <IconToggle
        title="Toggle chat panel"
        aria-label="Toggle chat panel"
        active={!!chatOpen}
        disabled={false}
        onClick={props.onToggleChat ?? (() => {})}
      ><I.Chat size={15} /></IconToggle>

      <div style={{ width: 0.5, height: 18, background: 'var(--rule)', margin: '0 4px' }} />

      <QuotaChip
        onOpenMenu={() => window.dispatchEvent(new CustomEvent('open-account-menu'))}
      />

      <BYOKChip />

      <AccountMenu />
    </div>
    <ConfirmModal
      open={confirmRemove}
      title={t('topbar.add-to-library.confirm-remove-title')}
      body={t('topbar.add-to-library.confirm-remove-body')}
      dangerLabel={t('topbar.add-to-library.confirm-remove-danger')}
      inFlight={removeInFlight}
      onConfirm={async () => {
        setRemoveInFlight(true);
        try {
          await props.onRemoveFromLibrary();
          setConfirmRemove(false);
        } finally {
          setRemoveInFlight(false);
        }
      }}
      onCancel={() => setConfirmRemove(false)}
    />
    </>
  );
}

/**
 * Gear-icon dropdown at the far right · spec §10.2 + §14.5 + §14.7.7.1 + §15.1.
 *
 * Renders 4 distinct UIs based on (session, subscriptions.tier):
 *   - loggedOut      → primary sign-in CTA + BYOK status
 *   - free (logged)  → email + trial progress + upgrade links
 *   - sync           → email + "AI 走 BYOK" hint + upgrade-to-pro link
 *   - pro            → email + monthly AI progress + billing portal
 *
 * Logout clears:
 *   - supabase session (signOut)
 *   - config_apikey, config_prefs (prevents Alice→Bob key leak)
 *   - config_apikeys (Phase 12: per-config apiKey map; one removeItem zeroes all of them)
 *   - config_active_byok_config_id, migrationState:byok-configs-v12 (Phase 12 cache + flag)
 *   - byokHealthCache (Phase 12 D-C1: health probe cache; MED-5 cross-AI review)
 *   - sync:queue (prevents Alice's queued writes being submitted as Bob)
 *   - migrationState, paperIdMap, churnModalSeen, libraryCapBannerDismissed
 *   - paper:* local mirrors EXCEPT :parsed and :summary:* (regenerable caches)
 *
 * Switch-account is a two-step confirm then logout-then-login.
 */
type SubRow = {
  tier: 'free' | 'sync' | 'pro'
  cancel_at_period_end: boolean
  current_period_end: string | null
}

function AccountMenu() {
  // D9: subscribe to locale changes — when setLocale fires (Options or another
  // tab), AccountMenu and all its children (TierBadge / TrialProgress / etc.)
  // re-render with the latest translations. Return value unused; the module-
  // level `t` reads currentLocale fresh at every call.
  useT();

  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [sub, setSub] = useState<SubRow | null>(null);
  const [trialUsed, setTrialUsed] = useState(0);
  const [proMonthlyUsed, setProMonthlyUsed] = useState(0);
  const [byokConfigured, setByokConfigured] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Load initial session + listen for auth state changes (login / logout).
  // Auto-closing the LoginModal on any new session is defense-in-depth against
  // the caller's own close path getting swallowed (e.g. chrome.identity
  // launchWebAuthFlow promise not resolving after the OAuth popup redirects
  // back in certain PKCE edge cases — the auth event still fires cleanly).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      if (s) setShowLogin(false);
    });
    return () => { listener.subscription.unsubscribe(); };
  }, []);

  // Load tier + usage + byok state when menu opens.
  useEffect(() => {
    if (!open) return;
    void (async () => {
      // Phase 13: Phase 12+13 multi-config writes new keys (not config_apikey).
      // Use getConfig() so AccountMenu BYOK badge sees both paths.
      const cfg = await getConfig();
      setByokConfigured(!!cfg?.apiKey);
      if (!session) return;
      const { data: s } = await supabase.from('subscriptions').select('*').maybeSingle();
      setSub(s as SubRow | null);
      const period = s?.tier === 'pro'
        ? new Date().toISOString().slice(0, 7)
        : 'lifetime-trial';
      const { data: u } = await supabase
        .from('ai_usage')
        .select('used')
        .eq('period', period)
        .maybeSingle();
      if (s?.tier === 'pro') setProMonthlyUsed(u?.used ?? 0);
      else setTrialUsed(u?.used ?? 0);
    })();
  }, [open, session]);

  // Realtime: refresh tier + usage when the subscriptions row updates
  // server-side (e.g. Stripe webhook promotes user to Pro). Supplements the
  // [open, session] effect so the user doesn't have to re-open the menu.
  useEffect(() => {
    if (!session) return;
    const channel = subscribeSubscriptions((newSub) => {
      setSub(newSub as SubRow);
      void (async () => {
        const period = newSub.tier === 'pro'
          ? new Date().toISOString().slice(0, 7)
          : 'lifetime-trial';
        const { data: u } = await supabase
          .from('ai_usage')
          .select('used')
          .eq('period', period)
          .maybeSingle();
        if (newSub.tier === 'pro') setProMonthlyUsed(u?.used ?? 0);
        else setTrialUsed(u?.used ?? 0);
      })();
    });
    return () => { void supabase.removeChannel(channel); };
  }, [session]);

  // Close on any click outside the anchor/dropdown subtree.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // QuotaChip (and any other future trigger) opens this menu via a custom
  // event — the chip lives outside this component and can't touch `open`
  // directly.
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener('open-account-menu', h);
    return () => window.removeEventListener('open-account-menu', h);
  }, []);

  async function doLogout() {
    await supabase.auth.signOut();
    await clearLogoutKeys();
    setOpen(false);
    setSub(null);
    setTrialUsed(0);
    setProMonthlyUsed(0);
  }

  async function doSwitchAccount() {
    setShowSwitchConfirm(false);
    await doLogout();
    setShowLogin(true);
  }

  async function openBillingPortal() {
    const { data, error } = await supabase.functions.invoke('create-portal-session');
    if (!error && data?.url) chrome.tabs.create({ url: data.url });
    setOpen(false);
  }

  function openUpgradePrompt() {
    window.dispatchEvent(
      new CustomEvent('open-upgrade-prompt', { detail: { trigger: 'trial' } }),
    );
    setOpen(false);
  }

  const loggedOut = !session;
  const tier = sub?.tier ?? 'free';
  const isPending = !!sub?.cancel_at_period_end;

  return (
    <div ref={anchorRef} className="account-menu-anchor">
      <IconButton
        title={t('account.header')}
        onClick={() => setOpen(!open)}
      >
        <I.User size={14} />
      </IconButton>

      {open && (
        <div className="account-menu-panel" role="menu">
          <div className="account-menu-label">{t('account.header')}</div>

          {/* D10 globe-icon row — discoverability hook visible in BOTH logged-out
              and logged-in states. Native locale name on the right gives users
              who can't read the surrounding labels a clear "this is where to go". */}
          <button
            type="button"
            className="account-menu-language-row"
            onClick={() => {
              setOpen(false);
              // 1A (eng review): window.open(getURL+#hash) gives the new tab a
              // hash that's already in place at mount, so options/main.tsx can
              // scrollIntoView+focus on its #language Field. Fallback to
              // openOptionsPage when popups are blocked (no hash, but at least
              // lands on the page).
              const url = chrome.runtime.getURL('options/index.html#language');
              const opened = window.open(url);
              if (!opened && chrome.runtime?.openOptionsPage) {
                chrome.runtime.openOptionsPage();
              }
            }}
            aria-label={t('account.language.aria')}
          >
            <I.Globe size={14} />
            <span className="account-menu-language-label">{t('account.language')}</span>
            <span className="account-menu-language-current">
              {OUTPUT_LANGUAGES.find((l) => l.code === getLocale())?.label}
            </span>
          </button>

          {loggedOut ? (
            <>
              <button
                className="account-menu-primary-cta"
                onClick={() => { setOpen(false); setShowLogin(true); }}
              >
                {t('account.signedout.primary')}
              </button>
              <div className="account-menu-byok-status">
                <span
                  className="account-menu-dot"
                  style={{ background: byokConfigured ? 'var(--forest)' : 'var(--foxglove)' }}
                />
                <span>
                  {byokConfigured ? t('account.byok.configured') : t('account.byok.notconfigured')}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="account-menu-user-header">
                <div className="account-menu-avatar">
                  {session?.user?.email?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="account-menu-user-meta">
                  <div className="account-menu-email">{session?.user?.email}</div>
                  <TierBadge
                    tier={tier}
                    isPending={isPending}
                    periodEnd={sub?.current_period_end}
                  />
                </div>
              </div>

              {tier === 'free' && <TrialProgress used={trialUsed} limit={20} />}
              {tier === 'sync' && (
                <div className="account-menu-hint">{t('account.sync.hint')}</div>
              )}
              {tier === 'pro' && <ProMonthlyProgress used={proMonthlyUsed} limit={30000} />}

              {isPending && sub?.current_period_end && (
                <a
                  className="account-menu-restore"
                  onClick={openBillingPortal}
                  role="button"
                  tabIndex={0}
                >
                  {t('account.tier.ending', {
                    tier: tier.toUpperCase(),
                    date: sub.current_period_end.slice(0, 10),
                  })}
                </a>
              )}

              <div className="account-menu-actions">
                {tier === 'free' && (
                  <a onClick={openUpgradePrompt} className="account-menu-upgrade" role="button" tabIndex={0}>
                    {t('account.upgrade.pro')}
                  </a>
                )}
                {tier === 'sync' && (
                  <a onClick={openUpgradePrompt} className="account-menu-upgrade" role="button" tabIndex={0}>
                    {t('account.upgrade.proFromSync')}
                  </a>
                )}
                {(tier === 'pro' || tier === 'sync') && (
                  <a onClick={openBillingPortal} role="button" tabIndex={0}>
                    <I.CreditCard size={12} /> {t('account.billing.manage')}
                  </a>
                )}
                <a
                  onClick={() => { setOpen(false); setShowSwitchConfirm(true); }}
                  role="button" tabIndex={0}
                >
                  <I.SwitchAccount size={12} /> {t('account.switch')}
                </a>
                <a onClick={doLogout} role="button" tabIndex={0}>
                  <I.LogOut size={12} /> {t('account.signout')}
                </a>
              </div>
            </>
          )}
        </div>
      )}

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}

      {showSwitchConfirm && (
        <SwitchAccountConfirm
          onConfirm={doSwitchAccount}
          onCancel={() => setShowSwitchConfirm(false)}
        />
      )}
    </div>
  );
}

function TierBadge({
  tier,
  isPending,
  periodEnd,
}: {
  tier: 'free' | 'sync' | 'pro'
  isPending: boolean
  periodEnd: string | null | undefined
}) {
  const cls =
    tier === 'pro'  ? 'account-menu-badge account-menu-badge-pro' :
    tier === 'sync' ? 'account-menu-badge account-menu-badge-sync' :
                      'account-menu-badge account-menu-badge-free';
  const label =
    isPending && periodEnd
      ? t('account.tier.ending', { tier: tier.toUpperCase(), date: periodEnd.slice(0, 10) })
      : t(`account.tier.${tier}`);
  return <span className={cls}>{label}</span>;
}

function TrialProgress({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  const remaining = Math.max(0, limit - used);
  return (
    <div className="account-menu-progress-block">
      <div className="account-menu-progress-labels">
        <span>{t('account.trial.progress')}</span>
        <span>{t('account.trial.remaining', { used, limit, remaining })}</span>
      </div>
      <div className="account-menu-progress-bar">
        <div className="account-menu-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ProMonthlyProgress({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div className="account-menu-progress-block">
      <div className="account-menu-progress-labels">
        <span>{t('account.pro.monthly')}</span>
        <span><b>{used} / {limit}</b></span>
      </div>
      <div className="account-menu-progress-bar account-menu-progress-bar-pro">
        <div
          className="account-menu-progress-fill account-menu-progress-fill-pro"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SwitchAccountConfirm({
  onConfirm,
  onCancel,
}: { onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="account-menu-confirm-backdrop"
      onClick={onCancel}
    >
      <div className="account-menu-confirm-panel" onClick={(e) => e.stopPropagation()}>
        <p className="account-menu-confirm-body">{t('account.switch.confirm')}</p>
        <div className="account-menu-confirm-actions">
          <button onClick={onCancel} className="account-menu-confirm-cancel">
            {t('account.switch.cancel')}
          </button>
          <button onClick={onConfirm} className="account-menu-confirm-primary">
            {t('account.switch')}
          </button>
        </div>
      </div>
    </div>
  );
}

function VariantSwitcher({
  variant, setVariant,
}: { variant: ReaderVariant; setVariant: (v: ReaderVariant) => void }) {
  // Canvas entry hidden — code path retained but no UI surface (260427).
  const opts: Array<{ id: ReaderVariant; label: string; icon: 'Book' | 'Grid' | 'Layers' }> = [
    { id: 'classic', label: 'Classic', icon: 'Grid' },
    { id: 'summary', label: 'Summary', icon: 'Book' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: 'var(--paper-soft)',
      border: '0.5px solid var(--rule)',
      borderRadius: 5, padding: 2, margin: '0 4px',
    }}>
      {opts.map((o) => {
        const Ico = I[o.icon];
        const active = variant === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setVariant(o.id)}
            title={`${o.label} layout`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 3, fontSize: 11,
              color: active ? 'var(--ink)' : 'var(--ink-faded)',
              background: active ? 'var(--paper)' : 'transparent',
              boxShadow: active ? 'var(--shadow-1)' : 'none',
              transition: 'all 120ms', fontWeight: active ? 600 : 400,
            }}
          >
            <Ico size={11} stroke={1.5} /> {o.label}
          </button>
        );
      })}
    </div>
  );
}

function IconButton({
  title, onClick, children,
}: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon-btn" title={title} onClick={onClick}>{children}</button>
  );
}

function IconToggle({
  title, active, disabled, onClick, children,
}: { title: string; active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="icon-btn"
      title={title}
      onClick={disabled ? undefined : onClick}
      style={{
        color: disabled ? 'var(--ink-ghost)' : active ? 'var(--ink)' : undefined,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >{children}</button>
  );
}
