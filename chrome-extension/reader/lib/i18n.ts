// chrome-extension/reader/lib/i18n.ts
//
// 9-locale i18n with reactive `useT()` hook driven by `useSyncExternalStore`.
// Components import `useT` and call `const t = useT()` once at the top — all
// existing `t('xxx')` callsites are unchanged. Non-React callers (toast helpers,
// async event handlers) keep importing the global `t()`; it reads the latest
// `currentLocale` at call time.
//
// IMPORTANT: `useT()` triggers re-renders, but the returned `t` function
// identity is stable. Do NOT add `t` to a `useEffect` deps array — locale
// changes won't fire the effect (this is intentional, to avoid memo-deps
// thrash, but easy to misuse).

import { useSyncExternalStore } from 'react'

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru'
export type UiLocale = Locale  // back-compat alias

const messages: Record<Locale, Record<string, string>> = {
  'en': {
    // LoginModal
    'login.headline':           'Unlock 20 free AI trials',
    'login.subheadline':        '+ See the same Library / Highlights / Memory on every device',
    'login.google':             'Sign in with Google',
    'login.divider':            'or',
    'login.email.placeholder':  'Your email',
    'login.email.send':         'Send OTP',
    'login.email.resend':       'Resend ({n}s)',
    'login.otp.placeholder':    '6-digit code',
    'login.otp.verify':         'Verify',
    'login.otp.expired':        'Code expired or invalid',
    'login.error.rate_limit':  'Too many requests — please wait a minute and try again.',
    'login.error.invalid_email': 'That email format doesn\'t look right — please check and try again.',
    'login.error.network':     'Network error — check your connection and retry.',
    'login.otp.send-new':       'Send a new code',
    'login.otp.title':         'Enter verification code',
    'login.otp.sent_to':       'Code sent to {email}',
    'login.otp.spam_hint':     'Didn\'t get it? Check your spam / promotions folder.',
    'login.otp.back':          '← Back',
    'login.otp.resend.ready':  'Resend code',
    'login.otp.resend.wait':   'Resend in ({n}s)',
    'login.byok.hint':          'Already have an API key?',
    'login.byok.skip':          'Skip · use BYOK',

    // AccountMenu
    'account.header':                 'Settings',
    'account.signedout.primary':      'Sign in · Sync + 20 AI trials',
    'account.byok.configured':        'BYOK configured',
    'account.byok.notconfigured':     'Not configured',
    'account.tier.free':              'FREE',
    'account.tier.sync':              'SYNC',
    'account.tier.pro':               'PRO',
    'account.tier.ending':            '{tier} · ending {date}',
    'account.trial.progress':         'AI trials',
    'account.trial.remaining':        '{used} / {limit} · {remaining} left',
    'account.pro.monthly':            'AI this month',
    'account.sync.hint':              'AI via your BYOK · unlimited',
    'account.upgrade.pro':            '↑ Upgrade to Pro · $12/mo',
    'account.upgrade.proFromSync':    '↑ Step up to Pro · +$8/mo managed AI',
    'account.billing.manage':         'Manage billing',
    'account.byok.settings':          'BYOK settings',
    'account.switch':                 'Switch account',
    'account.signout':                'Sign out',
    'account.switch.confirm':         'This signs out the current account and clears local BYOK config and synced data cache',
    'account.switch.cancel':          'Cancel',
    // D10 globe icon row
    'account.language':               'Language',
    'account.language.aria':          'Open language settings',

    // UpgradePrompt
    'upgrade.label.freeTrialExhausted': 'Free quota exhausted',
    'upgrade.headline.trial':         'You used all 20 free AI trials',
    'upgrade.headline.monthly':       'You used this month\'s 30000 managed AI calls',
    'upgrade.headline.library':       'Library sync paused at the {limit}-paper free cap',
    'upgrade.subheadline':            'Pick a plan to keep using PaperFlow AI',
    'upgrade.free.name':              'Free',
    'upgrade.free.price':             '$0/mo',
    'upgrade.free.features':          'Cross-device sync ({limit} papers) · BYOK only',
    'upgrade.free.cta':               'Set up BYOK',
    'upgrade.sync.name':              'Sync',
    'upgrade.sync.price':             '$4/mo',
    'upgrade.sync.features':          'Cross-device sync · Unlimited Library · AI via BYOK',
    'upgrade.sync.cta':               'Choose Sync',
    'upgrade.pro.name':               'Pro',
    'upgrade.pro.price':              '$12/mo',
    'upgrade.pro.features':           'Cross-device sync · 30000/mo managed AI · BYOK too',
    'upgrade.pro.recommended':        'Recommended',
    'upgrade.pro.cta':                'Choose Pro',
    'upgrade.diff':                   'Managed AI: — (Sync) / 30000/mo (Pro)',
    'upgrade.byok':                   'Add an OpenAI key to keep using free',
    'upgrade.later':                  'Not now',

    // Trial hint
    'trial.hint':                     '{n} free trials left · add a key or upgrade',

    // QuotaChip
    'quota.free':                     'Free · {used}/{limit}',
    'quota.free.warn':                '⚠ Free · {used}/{limit}',
    'quota.free.critical':            'Free · 0 left',
    'quota.pro':                      'Pro · {used}/{limit}',
    'quota.sync':                     'Sync · BYOK',

    // Library Cap Banner
    'libraryCap.text':                'Library at {used} / {limit} (free cap)',
    'libraryCap.hint':                'Existing papers kept · upgrade to Sync or Pro to add more',
    'libraryCap.upgrade':             'Upgrade',

    // Library jump (Phase 27 — click-to-open from drawer)
    'library.jump.needsOriginalUrl':  'Open this paper from its original URL once to enable quick jump.',

    // Migration banner + toasts
    'migration.banner':               '☁ Syncing your library  {done} / {total} papers',
    'migration.banner.paused':        '⚠ Sync paused · click to retry',
    'migration.banner.preprompt':     'This may take a minute, please stay open',
    'migration.success':              'Synced · {papers} papers, {highlights} highlights now in the cloud · Sign in on another device to see them there',
    'migration.readonly.hint':        'Syncing · temporarily read-only',

    // M2 conflict modal
    'migration.conflict.title':       'Cloud library already has data',
    'migration.conflict.local':       'Local: {n} papers',
    'migration.conflict.cloud':       'Cloud: {n} papers',
    'migration.conflict.overlap':     'Overlap: {n} papers (in both)',
    'migration.conflict.merge':       '★ Merge (recommended) — keep both sides; overlap uses newest version',
    'migration.conflict.local_only':  'Use local only (overwrite cloud · drops {n} cloud papers)',
    'migration.conflict.cloud_only':  'Use cloud only (wipe local · drops {n} local papers)',

    // Churn modal
    'churn.headline':                 'Your Pro subscription has ended',
    'churn.body':                     'Your AI quota is back to the free tier (20 trials). To restore Pro, visit the Billing Portal.',
    'churn.restore':                  'Restore',
    'churn.later':                    'Not now',

    // Error toasts
    'error.500.byok':                 'Service glitched · retry or switch to BYOK',
    'error.500.nobyok':               'Service glitched · retry or add an OpenAI key',
    'error.429':                      'Too many requests, please retry in 1 minute',
    'error.403.sync':                 'Sync tier has no managed AI · use BYOK or upgrade to Pro',
    'error.auth':                     'Session expired, please sign in again',
    'error.timeout':                  'AI timed out (no response in 10s) · retry',

    // Options page
    'options.title':                  'PaperFlow Options',
    'options.intro':                  'Bring-your-own-key configuration. Any OpenAI-compatible endpoint works. Values are stored locally in chrome.storage.local and never leave this browser.',
    'options.byok.baseURL.label':     'Base URL',
    'options.byok.baseURL.hint':      'e.g. https://api.openai.com/v1',
    'options.byok.apiKey.label':      'API key',
    'options.byok.apiKey.hint':       'Treated as a secret; shown as dots.',
    'options.byok.model.label':       'Model',
    'options.byok.model.hint':        'e.g. gpt-4.1-mini, claude-3-5-sonnet (via proxy)',
    // Phase 15 D-A1 / D-D1 / D-F2: System Models section + locked-row UX +
    // post-migration toast. Six keys consumed by options/main.tsx (heading,
    // description, locked.badge, locked.upgrade-cta) and reader/components/
    // managed-models-migration-toast.tsx (toast.migrated, toast.view).
    'options.managed-models.heading':            'System Models',
    'options.managed-models.description':        'AI models managed by PaperFlow. Available models depend on your subscription tier.',
    'options.managed-models.locked.badge':       'Pro only',
    'options.managed-models.locked.upgrade-cta': 'Upgrade to Pro',
    'options.byok-configs.heading':            'BYOK Configs',
    'options.byok-configs.description':        'Save multiple BYOK configurations (OpenAI compatible / local LiteLLM) and switch between them at runtime.',
    'options.byok-configs.empty':              'No configurations yet. Click "+ New config" below to start.',
    'options.byok-configs.loading':            'Loading…',
    'options.byok-configs.active-suffix':      '· active',
    'options.byok-configs.btn.new':            '+ New config',
    'options.byok-configs.btn.edit':           'Edit',
    'options.byok-configs.btn.delete':         'Delete',
    'options.byok-configs.btn.save':           'Save',
    'options.byok-configs.btn.cancel':         'Cancel',
    'options.byok-configs.confirm.delete':     'Delete configuration "{name}"?',
    'options.byok-configs.field.preset.label': 'Preset',
    'options.byok-configs.field.preset.hint':  'Pick a preset to auto-fill baseURL / model (does not overwrite filled fields).',
    'options.byok-configs.field.name.label':   'Configuration name',
    'options.byok-configs.field.name.hint':    '1-32 characters, e.g. "Claude via LiteLLM" / "GPT-4o personal"',
    'options.byok-configs.field.baseURL.label':'Base URL',
    'options.byok-configs.field.baseURL.hint': 'OpenAI-compatible endpoint (https:// or http://localhost)',
    'options.byok-configs.field.apiKey.label': 'API key',
    'options.byok-configs.field.apiKey.hint':  'Stored locally only — never uploaded to Supabase',
    'options.byok-configs.field.model.label':  'Model',
    'options.byok-configs.field.model.hint':   'Model name',
    'options.byok-configs.error.name':         'Configuration name must be 1-32 characters: letters, digits, spaces, hyphens, underscores, dots.',
    'options.byok-configs.error.baseURL':      'Base URL must start with https:// or be http://localhost / http://127.0.0.1.',
    'options.byok-configs.error.model':        'Model is required.',
    'options.byok-configs.error.apiKey':       'API key is required.',
    'options.byok-configs.error.name-conflict':'Configuration name already exists. Pick a different name.',
    'options.byok-configs.set-active.aria':    'Set as active configuration',

    // Phase 13 — 顶栏 BYOK chip + popover (D-A / D-D / D-E)
    // (Phase 19 v1.4 hard cutover: 'topbar.byok-chip.no-active' DELETED — replaced by 'topbar.model-picker.chip.empty')
    'topbar.byok-chip.aria.active':                'Active model: {name}, {model}. Click to switch.',
    'topbar.byok-chip.aria.no-active':             'Set up BYOK to use AI',
    'topbar.byok-popover.heading':                 'MODEL',
    'topbar.byok-popover.banner.unreachable':      '{name} not responding — start the wrapper?',
    'topbar.byok-popover.banner.doc-link':         'View setup guide →',
    'topbar.byok-popover.empty':                   'No saved configs.',
    'topbar.byok-popover.btn.new':                 '+ New config',
    'topbar.byok-popover.btn.manage-all':          'Manage all →',
    'topbar.byok-popover.row.health.healthy':      'Healthy ({n} models)',
    'topbar.byok-popover.row.health.unreachable':  'Not responding',
    // Phase 19 v1.4: model-picker cluster (en)
    'topbar.model-picker.aria.menu':                  'Model picker',
    'topbar.model-picker.system.heading':             'SYSTEM MODELS',
    'topbar.model-picker.system.login-prompt':        'Sign in to unlock system models',
    'topbar.model-picker.system.locked-upgrade-cta':  'Upgrade to Pro',
    'topbar.model-picker.byok.heading':               'BYOK CONFIGS',
    'topbar.model-picker.byok.region-label':          'BYOK config list',
    'topbar.model-picker.byok.empty':                 'No saved configs',
    'topbar.model-picker.byok.signed-out-hint':       'Bring your own key — works without signing in',
    'topbar.model-picker.cta.new-config':             '+ New config',
    'topbar.model-picker.cta.manage':                 'Manage',
    'topbar.model-picker.chip.empty':                 '+ Select model',
    'topbar.model-picker.chip.signed-out':            '+ Sign in or BYOK',
    // ── Add to Library button (Phase 28) ───────────────────────────────────
    'topbar.add-to-library.add':                     'Add to Library',
    'topbar.add-to-library.added':                   'Added',
    'topbar.add-to-library.confirm-remove-title':    'Move out of library?',
    'topbar.add-to-library.confirm-remove-body':     'The paper will be removed from your library. Local annotations and cache are kept on this device — only the library entry is removed.',
    'topbar.add-to-library.confirm-remove-danger':   'Move out',
    'topbar.add-to-library.add-failed':              "Couldn't sync to your library, but it was saved locally.",
    // Phase 13 — Options page health chip i18n lift (replaces 12-08 hard-coded zh strings)
    'options.byok-configs.row.health.healthy':     'Healthy',
    'options.byok-configs.row.health.unreachable': 'Not responding',
    'options.byok-configs.row.health.checking':    'Checking…',
    'options.byok-configs.row.active-pill':        'Active',
    // Phase 16 D-E1 / D-E2 / D-E3: openai-compatible preset label + 6 template
    // helpText keys + 'Custom' chip label. Provider names (OpenAI / OpenRouter
    // / Together / Groq / DeepSeek) NOT translated (brand identity per D-E2).
    'options.byok-presets.openai-compatible.label':                'OpenAI compatible',
    'options.byok-presets.openai-compatible.chip.custom':          'Custom',
    'options.byok-presets.openai-compatible.helpText.openai':      'Direct OpenAI API. Bring your own sk-… key.',
    'options.byok-presets.openai-compatible.helpText.openrouter':  'Multi-model gateway. Use provider/model namespace.',
    'options.byok-presets.openai-compatible.helpText.together':    'Together AI inference. Llama / Mistral / Mixtral.',
    'options.byok-presets.openai-compatible.helpText.groq':        'Groq fast inference (Llama, Mixtral).',
    'options.byok-presets.openai-compatible.helpText.deepseek':    'DeepSeek API. Coding-tuned models.',
    'options.byok-presets.openai-compatible.helpText.custom':      'Any OpenAI-compatible endpoint.',

    'options.outputLang.label':       'Output language',
    'options.outputLang.hint':        'Language the model should respond in for summaries, selection actions, and chat.',
    'options.ui_language.label':      'Interface language',
    'options.ui_language.hint':       'UI language for the extension · changes apply instantly to all open tabs',
    'options.ui_language.auto':       'Auto · follow browser ({locale})',
    'options.save':                   'Save',
    'options.saving':                 'Saving…',
    'options.saved':                  '✓ Saved.',
    'options.loading':                'Loading…',

    // Output language picker — dynamic Auto label + 'detect' option (D17)
    'output.auto':                    'Auto · match UI ({ui})',
    'output.detect':                  'Detect from question',

    // Tabs (redesign 260424)
    'tabs.overview':                  'Overview',
    'tabs.note':                      'Note',
    'tabs.memory':                    'Memory',

    // Chat history
    'chat.history.title':             'CONVERSATIONS',
    'chat.history.empty':             'No conversations yet.',
    'chat.history.emptyHint':         'Try asking about this paper.',
    'chat.history.deleted':           'Deleted',
    'chat.session.titleFallback':     'Chat #{seq}',
    'chat.welcome.intro':             'I\'ve read the paper. Ask anything — I\'ll cite paragraphs inline.',
    'chat.suggest.mechanism.section': 'What\'s the core mechanism of §{section}?',
    'chat.suggest.mechanism.generic': 'What\'s the core mechanism?',
    'chat.suggest.priorWork':         'How does this compare to prior work?',
    'chat.suggest.fail':              'Where does it fail?',
    'chat.composer.placeholder':        'Ask about this paper…',
    'chat.composer.placeholder.pinned': 'Ask something specific, or press Enter…',

    // Note kinds
    'note.kinds.explain':             'Explain',
    'note.kinds.highlight':           'Highlight',
    'note.kinds.note':                'Note',
    'note.kinds.translate':           'Translate',

    // Note empty states
    'note.empty.explain':             'No explanations yet.',
    'note.empty.highlight':           'No highlights yet.',
    'note.empty.note':                'No notes yet.',
    'note.empty.translate':           'No translations yet.',

    // Note editor
    'note.editor.title':              'Note',
    'note.editor.placeholder':        'Write your note…',
    'note.editor.saveFailed':         'Save failed',

    // Delete toasts
    'delete.toast.session':           'Conversation deleted',
    'delete.toast.note':              'Note deleted',
    'delete.toast.highlight':         'Highlight deleted',
    'delete.toast.dismiss':           'Undo',

    // Highlight click popover
    'highlight.popover.remove':       'Remove highlight',
    'highlight.popover.aria':         'Highlight actions',

    // Shortcut migration toast
    'shortcut.toast.260424':          '⌘\\ now toggles the right panel (Outline retired).',

    // Actions
    'action.retry':                   'Retry',
    'action.cancel':                  'Cancel',
    'action.save':                    'Save',
    'action.saving':                  'Saving…',
    'action.viewSession':             'View session',
    'action.regenerate':              'Regenerate',

    // AI errors
    'error.aiFailed':                 'AI reply failed',
    'error.aiAborted':                'AI reply was interrupted',

    // Ghost rail
    'ghost.rail.label':               'Last visit: {n} notes · {h} highlights · {c} conversations',

    // Overview panel
    'overview.contributions.title':   'Core Contributions',
    'overview.keywords.title':        'Keywords',
    'overview.contents.title':        'Contents',
    'overview.contents.jumpHint':     'Jump to this section',
    'overview.info.title':            'Paper info',
    'overview.field.publishedAt':     'Published',
    'overview.field.authors':         'Authors',
    'overview.field.citations':       'Citations',
    'overview.field.field':           'Field',
    'overview.field.codeUrl':         'Code',
    'overview.unconfigured.title':    'Sign in or configure AI to enable summary.',
    'overview.unconfigured.cta':      'Open Options',
    // Phase 21 v1.4: summary.error.* SCREAMING_SNAKE migration (en)
    'summary.error.prefix':              'Summary failed:',
    'summary.error.byok-misconfigured':  'API config incomplete · please open Options.',
    'summary.error.QUOTA_EXCEEDED':      'Free quota exhausted.',
    'summary.error.TIER_NO_MANAGED_AI':  'Sync tier does not include managed AI · configure your API key or upgrade to Pro.',
    'summary.error.RATE_LIMITED':        'Too many requests · please retry in 1 minute.',
    'summary.error.UNAUTHENTICATED':     'Please sign in or configure your API key in Options.',
    'summary.error.SERVER_ERROR':        'Service temporarily unavailable · please retry.',
    'summary.error.TIMEOUT':             'AI request timed out · please retry.',
    'summary.error.UNKNOWN':             'AI error · please retry or open Options.',
    'summary.error.TIER_LOCKED':         'This model requires a higher tier · upgrade to access.',
    'summary.error.MODEL_NOT_FOUND':     'Selected model is unavailable · please choose another.',
  },

  'zh-CN': {
    'login.headline':           '解锁 20 次免费 AI 试用',
    'login.subheadline':        '+ 在所有设备看到相同的 Library / 高亮 / Memory',
    'login.google':             '用 Google 账号登录',
    'login.divider':            '或',
    'login.email.placeholder':  '你的邮箱',
    'login.email.send':         '发送 OTP',
    'login.email.resend':       '重新发送 ({n}s)',
    'login.otp.placeholder':    '6 位码',
    'login.otp.verify':         '验证',
    'login.otp.expired':        '验证码已过期或无效',
    'login.error.rate_limit':  '请求太频繁，请稍等一分钟后再试。',
    'login.error.invalid_email': '邮箱格式不正确，请检查后重试。',
    'login.error.network':     '网络错误，请检查网络连接后重试。',
    'login.otp.send-new':       '发送新的验证码',
    'login.otp.title':         '输入验证码',
    'login.otp.sent_to':       '验证码已发送至 {email}',
    'login.otp.spam_hint':     '没收到？检查垃圾邮件 / 推广邮件文件夹。',
    'login.otp.back':          '← 返回',
    'login.otp.resend.ready':  '重新发送',
    'login.otp.resend.wait':   '重新发送 ({n}s)',
    'login.byok.hint':          '已有 API key？',
    'login.byok.skip':          '跳过 · 使用 BYOK',

    'account.header':                 '设置',
    'account.signedout.primary':      '登录 · 同步 + 20 次 AI 试用',
    'account.byok.configured':        '已配置 BYOK',
    'account.byok.notconfigured':     '未配置',
    'account.tier.free':              'FREE',
    'account.tier.sync':              'SYNC',
    'account.tier.pro':               'PRO',
    'account.tier.ending':            '{tier} · 将于 {date} 到期',
    'account.trial.progress':         'AI 试用',
    'account.trial.remaining':        '{used} / {limit} · 剩 {remaining} 次',
    'account.pro.monthly':            '本月 AI',
    'account.sync.hint':              'AI 走你的 BYOK · 无限用',
    'account.upgrade.pro':            '↑ 升级到 Pro · $12/月',
    'account.upgrade.proFromSync':    '↑ 升到 Pro · +$8/月 托管 AI',
    'account.billing.manage':         '管理订阅',
    'account.byok.settings':          'BYOK 设置',
    'account.switch':                 '切换账号',
    'account.signout':                '登出',
    'account.switch.confirm':         '此操作会登出当前账号并清除本地 BYOK 配置和同步数据缓存',
    'account.switch.cancel':          '取消',
    'account.language':               '语言',
    'account.language.aria':          '打开语言设置',

    'upgrade.label.freeTrialExhausted': '免费额度已用完',
    'upgrade.headline.trial':         '你已用完 20 次免费 AI 试用',
    'upgrade.headline.monthly':       '你已用完本月 30000 次托管 AI',
    'upgrade.headline.library':       'Library 同步已达 {limit} 篇免费上限',
    'upgrade.subheadline':            '继续使用 PaperFlow AI，选一个适合你的方案',
    'upgrade.free.name':              'Free',
    'upgrade.free.price':             '$0/月',
    'upgrade.free.features':          '跨设备同步（{limit} 篇）· 仅 BYOK',
    'upgrade.free.cta':               '配置 BYOK',
    'upgrade.sync.name':              'Sync',
    'upgrade.sync.price':             '$4/月',
    'upgrade.sync.features':          '跨设备同步 · Library 不限 · AI 用 BYOK',
    'upgrade.sync.cta':               '选 Sync',
    'upgrade.pro.name':               'Pro',
    'upgrade.pro.price':              '$12/月',
    'upgrade.pro.features':           '跨设备同步 · 30000 次/月托管 AI · BYOK 照常',
    'upgrade.pro.recommended':        '推荐',
    'upgrade.pro.cta':                '选 Pro',
    'upgrade.diff':                   '托管 AI：— (Sync) / 30000 次/月 (Pro)',
    'upgrade.byok':                   '配一把 OpenAI key 继续免费用',
    'upgrade.later':                  '暂不升级',

    'trial.hint':                     '还剩 {n} 次免费试用 · 配一把 key 或 升级',

    'quota.free':                     'Free · {used}/{limit}',
    'quota.free.warn':                '⚠ Free · {used}/{limit}',
    'quota.free.critical':            'Free · 已用完',
    'quota.pro':                      'Pro · {used}/{limit}',
    'quota.sync':                     'Sync · BYOK',

    'libraryCap.text':                'Library 已到 {used} / {limit}（免费上限）',
    'libraryCap.hint':                '存量已保留 · 再加新论文需升级 Sync 或 Pro',
    'libraryCap.upgrade':             '升级',

    'library.jump.needsOriginalUrl':  '请先从论文的原始链接打开一次，才能从 Library 快速跳转。',

    'migration.banner':               '☁ 正在同步 {done} / {total} 篇论文',
    'migration.banner.paused':        '⚠ 同步已暂停 · 点击重试',
    'migration.banner.preprompt':     '可能需要一分钟，请保持打开',
    'migration.success':              '同步完成 · {papers} 篇论文、{highlights} 条高亮已上传 · 在其他设备登录即可看到',
    'migration.readonly.hint':        '同步中 · 暂时只读',

    'migration.conflict.title':       '检测到云端已有数据',
    'migration.conflict.local':       '本地：{n} 篇论文',
    'migration.conflict.cloud':       '云端：{n} 篇论文',
    'migration.conflict.overlap':     '重叠：{n} 篇（两边都有）',
    'migration.conflict.merge':       '★ 合并（推荐）— 两边都保留，重叠的用最新版本',
    'migration.conflict.local_only':  '只用本地（覆盖云端 · 会丢云端 {n} 篇）',
    'migration.conflict.cloud_only':  '只用云端（清除本地 · 会丢本地 {n} 篇）',

    'churn.headline':                 '你的 Pro 订阅已到期',
    'churn.body':                     '你的 AI 配额已回到免费层（20 次试用）。如果想恢复 Pro，可前往 Billing Portal。',
    'churn.restore':                  '恢复订阅',
    'churn.later':                    '暂不',

    'error.500.byok':                 '服务异常 · 重试 或 切到 BYOK',
    'error.500.nobyok':               '服务异常 · 重试 或 配 OpenAI key',
    'error.429':                      '请求频繁，请 1 分钟后重试',
    'error.403.sync':                 'Sync 档不含托管 AI · 请用 BYOK 或升级到 Pro',
    'error.auth':                     '登录已过期，请重新登录',
    'error.timeout':                  'AI 响应超时（10 秒无回应）· 请重试',

    'options.title':                  'PaperFlow 设置',
    'options.intro':                  'Bring-your-own-key 配置。任何 OpenAI 兼容端点均可。值仅保存于本机的 chrome.storage.local，从不离开此浏览器。',
    'options.byok.baseURL.label':     'Base URL',
    'options.byok.baseURL.hint':      '例：https://api.openai.com/v1',
    'options.byok.apiKey.label':     'API key',
    'options.byok.apiKey.hint':       '当作秘密处理，以圆点显示。',
    'options.byok.model.label':       '模型',
    'options.byok.model.hint':        '例：gpt-4.1-mini，claude-3-5-sonnet（经代理）',
    // Phase 15 D-A1 / D-D1 / D-F2: managed-models cluster (zh-CN).
    'options.managed-models.heading':            '系统模型',
    'options.managed-models.description':        'PaperFlow 提供的托管 AI 模型。可见模型取决于您的订阅套餐。',
    'options.managed-models.locked.badge':       '仅 Pro',
    'options.managed-models.locked.upgrade-cta': '升级到 Pro',
    'options.byok-configs.heading':            'BYOK 配置',
    'options.byok-configs.description':        '保存多个 BYOK 配置（OpenAI 兼容 / 本地 LiteLLM）并在运行时切换。',
    'options.byok-configs.empty':              '暂无配置。点击下方"+ 新建配置"开始。',
    'options.byok-configs.loading':            '加载中…',
    'options.byok-configs.active-suffix':      '· 当前',
    'options.byok-configs.btn.new':            '+ 新建配置',
    'options.byok-configs.btn.edit':           '编辑',
    'options.byok-configs.btn.delete':         '删除',
    'options.byok-configs.btn.save':           '保存',
    'options.byok-configs.btn.cancel':         '取消',
    'options.byok-configs.confirm.delete':     '删除配置 "{name}"？',
    'options.byok-configs.field.preset.label': '预设',
    'options.byok-configs.field.preset.hint':  '选择预设自动填充 baseURL / 模型（不会覆盖已填字段）。',
    'options.byok-configs.field.name.label':   '配置名称',
    'options.byok-configs.field.name.hint':    '1-32 字符，例："Claude via LiteLLM" / "GPT-4o 个人"',
    'options.byok-configs.field.baseURL.label':'Base URL',
    'options.byok-configs.field.baseURL.hint': 'OpenAI 兼容端点（https:// 或 http://localhost）',
    'options.byok-configs.field.apiKey.label': 'API key',
    'options.byok-configs.field.apiKey.hint':  '仅保存于本机——不会上传到 Supabase',
    'options.byok-configs.field.model.label':  '模型',
    'options.byok-configs.field.model.hint':   '模型名称',
    'options.byok-configs.error.name':         '配置名称须为 1-32 字符：字母、数字、空格、连字符、下划线、点号。',
    'options.byok-configs.error.baseURL':      'Base URL 必须以 https:// 开头，或为 http://localhost / http://127.0.0.1。',
    'options.byok-configs.error.model':        '模型为必填。',
    'options.byok-configs.error.apiKey':       'API key 为必填。',
    'options.byok-configs.error.name-conflict':'配置名称已存在，请换一个名称。',
    'options.byok-configs.set-active.aria':    '设为当前配置',

    // Phase 13 — 顶栏 BYOK chip + popover (D-A / D-D / D-E)
    // (Phase 19 v1.4 hard cutover: 'topbar.byok-chip.no-active' DELETED — replaced by 'topbar.model-picker.chip.empty')
    'topbar.byok-chip.aria.active':                '当前模型：{name}，{model}。点击切换。',
    'topbar.byok-chip.aria.no-active':             '配置 BYOK 以启用 AI',
    'topbar.byok-popover.heading':                 '模型',
    'topbar.byok-popover.banner.unreachable':      '{name} 未响应——启动 wrapper？',
    'topbar.byok-popover.banner.doc-link':         '查看启动文档 →',
    'topbar.byok-popover.empty':                   '还没有保存的配置。',
    'topbar.byok-popover.btn.new':                 '+ 新建配置',
    'topbar.byok-popover.btn.manage-all':          '管理全部 →',
    'topbar.byok-popover.row.health.healthy':      '已检测到（{n} 个模型）',
    'topbar.byok-popover.row.health.unreachable':  '未响应',
    // Phase 19 v1.4: model-picker cluster (zh-CN)
    'topbar.model-picker.aria.menu':                  '模型选择器',
    'topbar.model-picker.system.heading':             '系统模型',
    'topbar.model-picker.system.login-prompt':        '登录解锁系统模型',
    'topbar.model-picker.system.locked-upgrade-cta':  '升级 Pro',
    'topbar.model-picker.byok.heading':               'BYOK 配置',
    'topbar.model-picker.byok.region-label':          'BYOK 配置列表',
    'topbar.model-picker.byok.empty':                 '暂无配置',
    'topbar.model-picker.byok.signed-out-hint':       '自带 API 密钥，无需登录即可使用',
    'topbar.model-picker.cta.new-config':             '+ 新建配置',
    'topbar.model-picker.cta.manage':                 '管理',
    'topbar.model-picker.chip.empty':                 '+ 选择模型',
    'topbar.model-picker.chip.signed-out':            '+ 登录或 BYOK',
    // ── Add to Library button (Phase 28) ───────────────────────────────────
    'topbar.add-to-library.add':                     '加入文库',
    'topbar.add-to-library.added':                   '已加入',
    'topbar.add-to-library.confirm-remove-title':    '从文库移出？',
    'topbar.add-to-library.confirm-remove-body':     '该论文将从你的文库中移除。本地的标注、笔记与缓存仍保留在此设备上 —— 只是不再出现在文库列表中。',
    'topbar.add-to-library.confirm-remove-danger':   '移出',
    'topbar.add-to-library.add-failed':              '同步到云端文库失败，本地已保存。',
    'options.byok-configs.row.health.healthy':     '已检测到',
    'options.byok-configs.row.health.unreachable': '未响应',
    'options.byok-configs.row.health.checking':    '检测中…',
    'options.byok-configs.row.active-pill':        '当前使用',
    // Phase 16 D-E1 / D-E2 / D-E3 (zh-CN).
    'options.byok-presets.openai-compatible.label':                'OpenAI 兼容',
    'options.byok-presets.openai-compatible.chip.custom':          '自定义',
    'options.byok-presets.openai-compatible.helpText.openai':      '直连 OpenAI API。需要自带 sk-… key。',
    'options.byok-presets.openai-compatible.helpText.openrouter':  '多模型聚合网关。model 字段使用 provider/model 形式。',
    'options.byok-presets.openai-compatible.helpText.together':    'Together AI 推理服务。支持 Llama / Mistral / Mixtral 等开源模型。',
    'options.byok-presets.openai-compatible.helpText.groq':        'Groq 快速推理（Llama / Mixtral 等）。',
    'options.byok-presets.openai-compatible.helpText.deepseek':    'DeepSeek API。模型擅长代码任务。',
    'options.byok-presets.openai-compatible.helpText.custom':      '任意 OpenAI 兼容的 endpoint，需自填 baseURL 和 model。',

    'options.outputLang.label':       '输出语言',
    'options.outputLang.hint':        '模型在生成总结、选区动作和聊天时使用的语言。',
    'options.ui_language.label':      '界面语言',
    'options.ui_language.hint':       '扩展 UI 的显示语言 · 修改即时生效，所有打开的标签页同步',
    'options.ui_language.auto':       'Auto · 跟随浏览器（{locale}）',
    'options.save':                   '保存',
    'options.saving':                 '保存中…',
    'options.saved':                  '✓ 已保存',
    'options.loading':                '加载中…',

    'output.auto':                    'Auto · 跟随界面（{ui}）',
    'output.detect':                  '从问题语言判断',

    // Tabs (redesign 260424)
    'tabs.overview':                  '概览',
    'tabs.note':                      '笔记',
    'tabs.memory':                    '记忆',

    // Chat history
    'chat.history.title':             '对话历史',
    'chat.history.empty':             '还没有对话历史。',
    'chat.history.emptyHint':         '问问这篇论文试试。',
    'chat.history.deleted':           '已删除',
    'chat.session.titleFallback':     '对话 #{seq}',
    'chat.welcome.intro':             '论文我已经读完了，问什么都行——我会标注引用段落。',
    'chat.suggest.mechanism.section': '§{section} 的核心机制是什么？',
    'chat.suggest.mechanism.generic': '核心机制是什么？',
    'chat.suggest.priorWork':         '和已有工作有什么区别？',
    'chat.suggest.fail':              '它在哪些情况下失效？',
    'chat.composer.placeholder':        '对这篇论文提问…',
    'chat.composer.placeholder.pinned': '更具体地问一下，或直接按回车…',

    // Note kinds
    'note.kinds.explain':             '解释',
    'note.kinds.highlight':           '高亮',
    'note.kinds.note':                '笔记',
    'note.kinds.translate':           '翻译',

    // Note empty states
    'note.empty.explain':             '还没解释过任何段落。',
    'note.empty.highlight':           '还没高亮过文字。',
    'note.empty.note':                '还没写过笔记。',
    'note.empty.translate':           '还没翻译过段落。',

    // Note editor
    'note.editor.title':              '笔记',
    'note.editor.placeholder':        '写下你的笔记…',
    'note.editor.saveFailed':         '保存失败',

    // Delete toasts
    'delete.toast.session':           '已删除对话',
    'delete.toast.note':              '已删除笔记',
    'delete.toast.highlight':         '已删除高亮',
    'delete.toast.dismiss':           '撤销',

    // Highlight click popover
    'highlight.popover.remove':       '删除高亮',
    'highlight.popover.aria':         '高亮操作',

    // Shortcut migration toast
    'shortcut.toast.260424':          '⌘\\ 现在切换右侧面板（原 Outline 已下线）。',

    // Actions
    'action.retry':                   '重试',
    'action.cancel':                  '取消',
    'action.save':                    '保存',
    'action.saving':                  '保存中…',
    'action.viewSession':             '查看会话',
    'action.regenerate':              '重新生成',

    // AI errors
    'error.aiFailed':                 'AI 回复失败',
    'error.aiAborted':                'AI 回复被中断',

    // Ghost rail
    'ghost.rail.label':               '上次：{n} 条笔记 · {h} 处高亮 · {c} 个对话',

    // Overview panel
    'overview.contributions.title':   '核心贡献',
    'overview.keywords.title':        '关键词',
    'overview.contents.title':        '目录',
    'overview.contents.jumpHint':     '跳转到这一节',
    'overview.info.title':            '论文信息',
    'overview.field.publishedAt':     '发表于',
    'overview.field.authors':         '作者',
    'overview.field.citations':       '引用次数',
    'overview.field.field':           '研究领域',
    'overview.field.codeUrl':         '开放代码',
    'overview.unconfigured.title':    '登录或配置 AI 即可生成摘要。',
    'overview.unconfigured.cta':      '打开设置',
    // Phase 21 v1.4: summary.error.* SCREAMING_SNAKE migration (zh-CN)
    'summary.error.prefix':              '摘要生成失败：',
    'summary.error.byok-misconfigured':  'API 配置不完整 · 请打开设置。',
    'summary.error.QUOTA_EXCEEDED':      '已用完免费额度。',
    'summary.error.TIER_NO_MANAGED_AI':  'Sync 档不含托管 AI · 请配置 API Key 或升级到 Pro。',
    'summary.error.RATE_LIMITED':        '请求频繁 · 请 1 分钟后重试。',
    'summary.error.UNAUTHENTICATED':     '请先登录或在设置中配置 API Key。',
    'summary.error.SERVER_ERROR':        '服务暂时不可用 · 请重试。',
    'summary.error.TIMEOUT':             'AI 请求超时 · 请重试。',
    'summary.error.UNKNOWN':             'AI 调用失败 · 请重试或打开设置。',
    'summary.error.TIER_LOCKED':         '该模型需要更高档位 · 升级解锁。',
    'summary.error.MODEL_NOT_FOUND':     '所选模型不可用 · 请重新选择。',
  },

  'zh-TW': {
    'login.headline':           '解鎖 20 次免費 AI 試用',
    'login.subheadline':        '+ 在所有裝置看到相同的 Library / 標註 / Memory',
    'login.google':             '用 Google 帳號登入',
    'login.divider':            '或',
    'login.email.placeholder':  '你的電郵',
    'login.email.send':         '發送 OTP',
    'login.email.resend':       '重新發送 ({n}s)',
    'login.otp.placeholder':    '6 位碼',
    'login.otp.verify':         '驗證',
    'login.otp.expired':        '驗證碼已過期或無效',
    'login.error.rate_limit':  '請求過於頻繁，請稍等一分鐘後再試。',
    'login.error.invalid_email': '郵箱格式不正確，請檢查後重試。',
    'login.error.network':     '網路錯誤，請檢查網路連線後重試。',
    'login.otp.send-new':       '發送新的驗證碼',
    'login.otp.title':         '輸入驗證碼',
    'login.otp.sent_to':       '驗證碼已寄至 {email}',
    'login.otp.spam_hint':     '沒收到？檢查垃圾郵件 / 推廣郵件資料夾。',
    'login.otp.back':          '← 返回',
    'login.otp.resend.ready':  '重新發送',
    'login.otp.resend.wait':   '重新發送 ({n}s)',
    'login.byok.hint':          '已有 API key？',
    'login.byok.skip':          '略過 · 使用 BYOK',

    'account.header':                 '設定',
    'account.signedout.primary':      '登入 · 同步 + 20 次 AI 試用',
    'account.byok.configured':        '已設定 BYOK',
    'account.byok.notconfigured':     '尚未設定',
    'account.tier.free':              'FREE',
    'account.tier.sync':              'SYNC',
    'account.tier.pro':               'PRO',
    'account.tier.ending':            '{tier} · 將於 {date} 到期',
    'account.trial.progress':         'AI 試用',
    'account.trial.remaining':        '{used} / {limit} · 剩 {remaining} 次',
    'account.pro.monthly':            '本月 AI',
    'account.sync.hint':              'AI 走你的 BYOK · 不限次數',
    'account.upgrade.pro':            '↑ 升級至 Pro · $12/月',
    'account.upgrade.proFromSync':    '↑ 升至 Pro · +$8/月 託管 AI',
    'account.billing.manage':         '管理訂閱',
    'account.byok.settings':          'BYOK 設定',
    'account.switch':                 '切換帳號',
    'account.signout':                '登出',
    'account.switch.confirm':         '此動作會登出目前帳號並清除本地 BYOK 設定與已同步資料快取',
    'account.switch.cancel':          '取消',
    'account.language':               '語言',
    'account.language.aria':          '開啟語言設定',

    'upgrade.label.freeTrialExhausted': '免費額度已用完',
    'upgrade.headline.trial':         '你已用完 20 次免費 AI 試用',
    'upgrade.headline.monthly':       '你已用完本月 30000 次託管 AI',
    'upgrade.headline.library':       'Library 同步已達 {limit} 篇免費上限',
    'upgrade.subheadline':            '選一個方案，繼續使用 PaperFlow AI',
    'upgrade.free.name':              'Free',
    'upgrade.free.price':             '$0/月',
    'upgrade.free.features':          '跨裝置同步（{limit} 篇）· 僅 BYOK',
    'upgrade.free.cta':               '設定 BYOK',
    'upgrade.sync.name':              'Sync',
    'upgrade.sync.price':             '$4/月',
    'upgrade.sync.features':          '跨裝置同步 · Library 不限 · AI 走 BYOK',
    'upgrade.sync.cta':               '選 Sync',
    'upgrade.pro.name':               'Pro',
    'upgrade.pro.price':              '$12/月',
    'upgrade.pro.features':           '跨裝置同步 · 30000 次/月託管 AI · BYOK 照常',
    'upgrade.pro.recommended':        '推薦',
    'upgrade.pro.cta':                '選 Pro',
    'upgrade.diff':                   '託管 AI：— (Sync) / 30000 次/月 (Pro)',
    'upgrade.byok':                   '配一支 OpenAI key 繼續免費用',
    'upgrade.later':                  '暫不升級',

    'trial.hint':                     '還剩 {n} 次免費試用 · 配一支 key 或 升級',

    'quota.free':                     'Free · {used}/{limit}',
    'quota.free.warn':                '⚠ Free · {used}/{limit}',
    'quota.free.critical':            'Free · 已用完',
    'quota.pro':                      'Pro · {used}/{limit}',
    'quota.sync':                     'Sync · BYOK',

    'libraryCap.text':                'Library 已達 {used} / {limit}（免費上限）',
    'libraryCap.hint':                '現有論文保留 · 加新論文需升級 Sync 或 Pro',
    'libraryCap.upgrade':             '升級',

    'library.jump.needsOriginalUrl':  '請先從論文的原始連結打開一次，才能從 Library 快速跳轉。',

    'migration.banner':               '☁ 正在同步 {done} / {total} 篇論文',
    'migration.banner.paused':        '⚠ 同步已暫停 · 點擊重試',
    'migration.banner.preprompt':     '可能需要一分鐘，請保持開啟',
    'migration.success':              '同步完成 · {papers} 篇論文、{highlights} 條標註已上傳 · 在其他裝置登入即可看到',
    'migration.readonly.hint':        '同步中 · 暫時唯讀',

    'migration.conflict.title':       '偵測到雲端已有資料',
    'migration.conflict.local':       '本地：{n} 篇論文',
    'migration.conflict.cloud':       '雲端：{n} 篇論文',
    'migration.conflict.overlap':     '重疊：{n} 篇（兩邊都有）',
    'migration.conflict.merge':       '★ 合併（推薦）— 兩邊都保留，重疊用最新版本',
    'migration.conflict.local_only':  '只用本地（覆蓋雲端 · 會丟雲端 {n} 篇）',
    'migration.conflict.cloud_only':  '只用雲端（清除本地 · 會丟本地 {n} 篇）',

    'churn.headline':                 '你的 Pro 訂閱已到期',
    'churn.body':                     '你的 AI 配額已回到免費層（20 次試用）。若想恢復 Pro，可前往 Billing Portal。',
    'churn.restore':                  '恢復訂閱',
    'churn.later':                    '暫不',

    'error.500.byok':                 '服務異常 · 重試 或 切到 BYOK',
    'error.500.nobyok':               '服務異常 · 重試 或 配 OpenAI key',
    'error.timeout':                  'AI 回應逾時（10 秒無回應）· 請重試',
    'error.429':                      '請求過於頻繁，請 1 分鐘後重試',
    'error.403.sync':                 'Sync 方案不含託管 AI · 請用 BYOK 或升級至 Pro',
    'error.auth':                     '登入已過期，請重新登入',

    'options.title':                  'PaperFlow 設定',
    'options.intro':                  'Bring-your-own-key 設定。任何 OpenAI 相容端點皆可。值僅儲存於本機的 chrome.storage.local，從不離開此瀏覽器。',
    'options.byok.baseURL.label':     'Base URL',
    'options.byok.baseURL.hint':      '例：https://api.openai.com/v1',
    'options.byok.apiKey.label':      'API key',
    'options.byok.apiKey.hint':       '視為機密，以圓點顯示。',
    'options.byok.model.label':       '模型',
    'options.byok.model.hint':        '例：gpt-4.1-mini，claude-3-5-sonnet（經代理）',
    // Phase 15 D-A1 / D-D1 / D-F2: managed-models cluster (zh-TW).
    'options.managed-models.heading':            '系統模型',
    'options.managed-models.description':        'PaperFlow 提供的託管 AI 模型。可見模型取決於您的訂閱方案。',
    'options.managed-models.locked.badge':       '僅 Pro',
    'options.managed-models.locked.upgrade-cta': '升級到 Pro',
    'options.byok-configs.heading':            'BYOK 設定',
    'options.byok-configs.description':        '儲存多組 BYOK 設定（OpenAI 相容 / 本機 LiteLLM）並在執行時切換。',
    'options.byok-configs.empty':              '尚無設定。點擊下方「+ 新增設定」開始。',
    'options.byok-configs.loading':            '載入中…',
    'options.byok-configs.active-suffix':      '· 目前',
    'options.byok-configs.btn.new':            '+ 新增設定',
    'options.byok-configs.btn.edit':           '編輯',
    'options.byok-configs.btn.delete':         '刪除',
    'options.byok-configs.btn.save':           '儲存',
    'options.byok-configs.btn.cancel':         '取消',
    'options.byok-configs.confirm.delete':     '刪除設定「{name}」？',
    'options.byok-configs.field.preset.label': '預設組合',
    'options.byok-configs.field.preset.hint':  '選擇預設組合自動填入 baseURL / 模型（不會覆蓋已填欄位）。',
    'options.byok-configs.field.name.label':   '設定名稱',
    'options.byok-configs.field.name.hint':    '1-32 字元，例：「Claude via LiteLLM」/「GPT-4o 個人」',
    'options.byok-configs.field.baseURL.label':'Base URL',
    'options.byok-configs.field.baseURL.hint': 'OpenAI 相容端點（https:// 或 http://localhost）',
    'options.byok-configs.field.apiKey.label': 'API key',
    'options.byok-configs.field.apiKey.hint':  '僅儲存於本機——不會上傳到 Supabase',
    'options.byok-configs.field.model.label':  '模型',
    'options.byok-configs.field.model.hint':   '模型名稱',
    'options.byok-configs.error.name':         '設定名稱須為 1-32 字元：字母、數字、空格、連字符、底線、點號。',
    'options.byok-configs.error.baseURL':      'Base URL 須以 https:// 開頭，或為 http://localhost / http://127.0.0.1。',
    'options.byok-configs.error.model':        '模型為必填。',
    'options.byok-configs.error.apiKey':       'API key 為必填。',
    'options.byok-configs.error.name-conflict':'設定名稱已存在，請換一個名稱。',
    'options.byok-configs.set-active.aria':    '設為目前設定',

    // Phase 13 — 顶栏 BYOK chip + popover (D-A / D-D / D-E)
    // (Phase 19 v1.4 hard cutover: 'topbar.byok-chip.no-active' DELETED — replaced by 'topbar.model-picker.chip.empty')
    'topbar.byok-chip.aria.active':                '目前模型：{name}，{model}。點擊切換。',
    'topbar.byok-chip.aria.no-active':             '設定 BYOK 以啟用 AI',
    'topbar.byok-popover.heading':                 '模型',
    'topbar.byok-popover.banner.unreachable':      '{name} 無回應——啟動 wrapper？',
    'topbar.byok-popover.banner.doc-link':         '查看啟動文件 →',
    'topbar.byok-popover.empty':                   '尚無儲存的設定。',
    'topbar.byok-popover.btn.new':                 '+ 新增設定',
    'topbar.byok-popover.btn.manage-all':          '管理全部 →',
    'topbar.byok-popover.row.health.healthy':      '已偵測到（{n} 個模型）',
    'topbar.byok-popover.row.health.unreachable':  '無回應',
    // Phase 19 v1.4: model-picker cluster (zh-TW)
    'topbar.model-picker.aria.menu':                  '模型選擇器',
    'topbar.model-picker.system.heading':             '系統模型',
    'topbar.model-picker.system.login-prompt':        '登入解鎖系統模型',
    'topbar.model-picker.system.locked-upgrade-cta':  '升級 Pro',
    'topbar.model-picker.byok.heading':               'BYOK 設定',
    'topbar.model-picker.byok.region-label':          'BYOK 設定列表',
    'topbar.model-picker.byok.empty':                 '尚無設定',
    'topbar.model-picker.byok.signed-out-hint':       '自帶 API 金鑰，無需登入即可使用',
    'topbar.model-picker.cta.new-config':             '+ 新增設定',
    'topbar.model-picker.cta.manage':                 '管理',
    'topbar.model-picker.chip.empty':                 '+ 選擇模型',
    'topbar.model-picker.chip.signed-out':            '+ 登入或 BYOK',
    // ── Add to Library button (Phase 28) ───────────────────────────────────
    'topbar.add-to-library.add':                     '加入書庫',
    'topbar.add-to-library.added':                   '已加入',
    'topbar.add-to-library.confirm-remove-title':    '從書庫移出？',
    'topbar.add-to-library.confirm-remove-body':     '該論文將從你的書庫中移除。本地的標註、筆記與快取仍保留在此裝置上 —— 只是不再出現在書庫列表中。',
    'topbar.add-to-library.confirm-remove-danger':   '移出',
    'topbar.add-to-library.add-failed':              '同步到雲端書庫失敗，本地已儲存。',
    'options.byok-configs.row.health.healthy':     '已偵測到',
    'options.byok-configs.row.health.unreachable': '無回應',
    'options.byok-configs.row.health.checking':    '偵測中…',
    'options.byok-configs.row.active-pill':        '使用中',
    // Phase 16 D-E1 / D-E2 / D-E3 (zh-TW).
    'options.byok-presets.openai-compatible.label':                'OpenAI 相容',
    'options.byok-presets.openai-compatible.chip.custom':          '自訂',
    'options.byok-presets.openai-compatible.helpText.openai':      '直連 OpenAI API。需要自備 sk-… key。',
    'options.byok-presets.openai-compatible.helpText.openrouter':  '多模型聚合閘道。model 欄位使用 provider/model 形式。',
    'options.byok-presets.openai-compatible.helpText.together':    'Together AI 推理服務。支援 Llama / Mistral / Mixtral 等開源模型。',
    'options.byok-presets.openai-compatible.helpText.groq':        'Groq 快速推理（Llama / Mixtral 等）。',
    'options.byok-presets.openai-compatible.helpText.deepseek':    'DeepSeek API。模型擅長程式碼任務。',
    'options.byok-presets.openai-compatible.helpText.custom':      '任意 OpenAI 相容的 endpoint，需自填 baseURL 與 model。',

    'options.outputLang.label':       '輸出語言',
    'options.outputLang.hint':        '模型在生成摘要、選取動作與聊天時使用的語言。',
    'options.ui_language.label':      '介面語言',
    'options.ui_language.hint':       '擴充功能 UI 的顯示語言 · 即時生效，所有開啟的分頁同步',
    'options.ui_language.auto':       'Auto · 跟隨瀏覽器（{locale}）',
    'options.save':                   '儲存',
    'options.saving':                 '儲存中…',
    'options.saved':                  '✓ 已儲存',
    'options.loading':                '載入中…',

    'output.auto':                    'Auto · 跟隨介面（{ui}）',
    'output.detect':                  '依問題語言判斷',
    // Tabs (redesign 260424)
    'tabs.overview':                   '概覽',
    'tabs.note':                       '筆記',
    'tabs.memory':                     '記憶',

    // Chat history
    'chat.history.title':              '對話歷史',
    'chat.history.empty':              '還沒有對話歷史。',
    'chat.history.emptyHint':          '問問這篇論文試試。',
    'chat.history.deleted':            '已刪除',
    'chat.session.titleFallback':      '對話 #{seq}',
    'chat.welcome.intro':             '論文我已經讀完了，問什麼都行——我會標註引用段落。',
    'chat.suggest.mechanism.section': '§{section} 的核心機制是什麼？',
    'chat.suggest.mechanism.generic': '核心機制是什麼？',
    'chat.suggest.priorWork':         '和已有研究有什麼差別？',
    'chat.suggest.fail':              '它在哪些情況下失效？',
    'chat.composer.placeholder':        '對這篇論文提問…',
    'chat.composer.placeholder.pinned': '更具體地問一下，或直接按 Enter…',

    // Note kinds
    'note.kinds.explain':              '解釋',
    'note.kinds.highlight':            '標註',
    'note.kinds.note':                 '筆記',
    'note.kinds.translate':            '翻譯',

    // Note empty states
    'note.empty.explain':              '還沒解釋過任何段落。',
    'note.empty.highlight':            '還沒標註過文字。',
    'note.empty.note':                 '還沒寫過筆記。',
    'note.empty.translate':            '還沒翻譯過段落。',

    // Note editor
    'note.editor.title':               '筆記',
    'note.editor.placeholder':         '寫下你的筆記…',
    'note.editor.saveFailed':          '儲存失敗',

    // Delete toasts
    'delete.toast.session':            '已刪除對話',
    'delete.toast.note':               '已刪除筆記',
    'delete.toast.highlight':          '已刪除標註',
    'delete.toast.dismiss':            '撤銷',

    // Highlight click popover
    'highlight.popover.remove':        '刪除標註',
    'highlight.popover.aria':          '標註操作',

    // Shortcut migration toast
    'shortcut.toast.260424':           '⌘\\ 現在切換右側面板（原 Outline 已下線）。',

    // Actions
    'action.retry':                    '重試',
    'action.cancel':                   '取消',
    'action.save':                     '儲存',
    'action.saving':                   '儲存中…',
    'action.viewSession':             '檢視會話',
    'action.regenerate':              '重新生成',

    // AI errors
    'error.aiFailed':                  'AI 回覆失敗',
    'error.aiAborted':                 'AI 回覆被中斷',

    // Ghost rail
    'ghost.rail.label':                '上次：{n} 則筆記 · {h} 處標註 · {c} 個對話',

    // Overview panel
    'overview.contributions.title':    '核心貢獻',
    'overview.keywords.title':         '關鍵詞',
    'overview.contents.title':         '目錄',
    'overview.contents.jumpHint':      '跳轉到這一節',
    'overview.info.title':             '論文資訊',
    'overview.field.publishedAt':      '發表於',
    'overview.field.authors':          '作者',
    'overview.field.citations':        '引用次數',
    'overview.field.field':            '研究領域',
    'overview.field.codeUrl':          '開放程式碼',
    'overview.unconfigured.title':     '登入或設定 AI 即可產生摘要。',
    'overview.unconfigured.cta':       '開啟設定',
    // Phase 21 v1.4: summary.error.* SCREAMING_SNAKE migration (zh-TW)
    'summary.error.prefix':              '摘要生成失敗：',
    'summary.error.byok-misconfigured':  'API 設定不完整 · 請開啟設定。',
    'summary.error.QUOTA_EXCEEDED':      '已用完免費額度。',
    'summary.error.TIER_NO_MANAGED_AI':  'Sync 方案不含託管 AI · 請設定 API Key 或升級至 Pro。',
    'summary.error.RATE_LIMITED':        '請求過於頻繁 · 請 1 分鐘後重試。',
    'summary.error.UNAUTHENTICATED':     '請先登入或在設定中設定 API Key。',
    'summary.error.SERVER_ERROR':        '服務暫時無法使用 · 請重試。',
    'summary.error.TIMEOUT':             'AI 請求逾時 · 請重試。',
    'summary.error.UNKNOWN':             'AI 呼叫失敗 · 請重試或開啟設定。',
    'summary.error.TIER_LOCKED':         '此模型需要更高方案 · 升級解鎖。',
    'summary.error.MODEL_NOT_FOUND':     '所選模型無法使用 · 請另選其他。',
  },

  'ja': {
    'login.headline':           '無料 AI 試用 20 回をアンロック',
    'login.subheadline':        '+ すべての端末で同じ Library / ハイライト / Memory を表示',
    'login.google':             'Google アカウントでログイン',
    'login.divider':            'または',
    'login.email.placeholder':  'メールアドレス',
    'login.email.send':         'OTP を送信',
    'login.email.resend':       '再送 ({n}s)',
    'login.otp.placeholder':    '6 桁コード',
    'login.otp.verify':         '確認',
    'login.otp.expired':        'コードが期限切れまたは無効です',
    'login.error.rate_limit':  'リクエストが多すぎます。1分待ってから再試行してください。',
    'login.error.invalid_email': 'メール形式が正しくないようです。確認して再度お試しください。',
    'login.error.network':     'ネットワークエラー。接続を確認して再試行してください。',
    'login.otp.send-new':       '新しいコードを送信',
    'login.otp.title':         '確認コードを入力',
    'login.otp.sent_to':       '確認コードを {email} に送信しました',
    'login.otp.spam_hint':     '届かない場合は、迷惑メール / プロモーションフォルダをご確認ください。',
    'login.otp.back':          '← 戻る',
    'login.otp.resend.ready':  'コードを再送',
    'login.otp.resend.wait':   '再送 ({n}秒)',
    'login.byok.hint':          'すでに API key をお持ちですか？',
    'login.byok.skip':          'スキップ · BYOK を使う',

    'account.header':                 '設定',
    'account.signedout.primary':      'ログイン · 同期 + AI 試用 20 回',
    'account.byok.configured':        'BYOK 設定済み',
    'account.byok.notconfigured':     '未設定',
    'account.tier.free':              'FREE',
    'account.tier.sync':              'SYNC',
    'account.tier.pro':               'PRO',
    'account.tier.ending':            '{tier} · {date} に終了',
    'account.trial.progress':         'AI 試用',
    'account.trial.remaining':        '{used} / {limit} · 残り {remaining} 回',
    'account.pro.monthly':            '今月の AI',
    'account.sync.hint':              'AI は BYOK 経由 · 無制限',
    'account.upgrade.pro':            '↑ Pro へ · $12/月',
    'account.upgrade.proFromSync':    '↑ Pro へ昇格 · +$8/月 で AI',
    'account.billing.manage':         '請求管理',
    'account.byok.settings':          'BYOK 設定',
    'account.switch':                 'アカウント切替',
    'account.signout':                'ログアウト',
    'account.switch.confirm':         'この操作で現在のアカウントからログアウトし、ローカルの BYOK 設定と同期データキャッシュを削除します',
    'account.switch.cancel':          'キャンセル',
    'account.language':               '言語',
    'account.language.aria':          '言語設定を開く',

    'upgrade.label.freeTrialExhausted': '無料枠を使い切りました',
    'upgrade.headline.trial':         '無料 AI 試用 20 回を使い切りました',
    'upgrade.headline.monthly':       '今月の託管 AI 30000 回を使い切りました',
    'upgrade.headline.library':       'Library 同期が無料枠 {limit} 件に到達しました',
    'upgrade.subheadline':            'PaperFlow AI を続けるためにプランを選択してください',
    'upgrade.free.name':              'Free',
    'upgrade.free.price':             '$0/月',
    'upgrade.free.features':          '端末間同期（{limit} 件）· BYOK のみ',
    'upgrade.free.cta':               'BYOK を設定',
    'upgrade.sync.name':              'Sync',
    'upgrade.sync.price':             '$4/月',
    'upgrade.sync.features':          '端末間同期 · Library 無制限 · AI は BYOK',
    'upgrade.sync.cta':               'Sync を選ぶ',
    'upgrade.pro.name':               'Pro',
    'upgrade.pro.price':              '$12/月',
    'upgrade.pro.features':           '端末間同期 · 月 30000 回託管 AI · BYOK も',
    'upgrade.pro.recommended':        'おすすめ',
    'upgrade.pro.cta':                'Pro を選ぶ',
    'upgrade.diff':                   '託管 AI：— (Sync) / 月 30000 回 (Pro)',
    'upgrade.byok':                   'OpenAI key を設定して無料で継続',
    'upgrade.later':                  '今は不要',

    'trial.hint':                     '無料試用 残り {n} 回 · key 設定または アップグレード',

    'quota.free':                     'Free · {used}/{limit}',
    'quota.free.warn':                '⚠ Free · {used}/{limit}',
    'quota.free.critical':            'Free · 残り 0',
    'quota.pro':                      'Pro · {used}/{limit}',
    'quota.sync':                     'Sync · BYOK',

    'libraryCap.text':                'Library {used} / {limit}（無料枠）',
    'libraryCap.hint':                '既存の論文は保持 · さらに追加するには Sync か Pro へ',
    'libraryCap.upgrade':             'アップグレード',

    'library.jump.needsOriginalUrl':  '一度元のURLからこの論文を開くと、Libraryから素早く戻れます。',

    'migration.banner':               '☁ 同期中 {done} / {total} 件',
    'migration.banner.paused':        '⚠ 同期一時停止 · クリックで再試行',
    'migration.banner.preprompt':     '1 分ほどかかります、開いたままお待ちください',
    'migration.success':              '同期完了 · {papers} 件、{highlights} 件のハイライトをクラウドへ · 他の端末でログインして確認できます',
    'migration.readonly.hint':        '同期中 · 一時的に読み取り専用',

    'migration.conflict.title':       'クラウドに既存データがあります',
    'migration.conflict.local':       'ローカル：{n} 件',
    'migration.conflict.cloud':       'クラウド：{n} 件',
    'migration.conflict.overlap':     '重複：{n} 件（両方に存在）',
    'migration.conflict.merge':       '★ マージ（推奨）— 両方残し、重複は最新版を採用',
    'migration.conflict.local_only':  'ローカルのみ使用（クラウド上書き · {n} 件失われます）',
    'migration.conflict.cloud_only':  'クラウドのみ使用（ローカル消去 · {n} 件失われます）',

    'churn.headline':                 'Pro サブスクリプションが終了しました',
    'churn.body':                     'AI 枠は無料層（20 回）に戻りました。Pro を復元するには Billing Portal をご利用ください。',
    'churn.restore':                  '復元',
    'churn.later':                    '今は不要',

    'error.500.byok':                 'サービス異常 · 再試行または BYOK へ切替',
    'error.500.nobyok':               'サービス異常 · 再試行または OpenAI key を設定',
    'error.timeout':                  'AI のタイムアウト（10 秒間応答なし）· 再試行',
    'error.429':                      'リクエストが多すぎます、1 分後に再試行してください',
    'error.403.sync':                 'Sync には託管 AI が含まれません · BYOK か Pro へアップグレード',
    'error.auth':                     'セッションが期限切れです、再ログインしてください',

    'options.title':                  'PaperFlow オプション',
    'options.intro':                  'Bring-your-own-key の設定。任意の OpenAI 互換エンドポイントが使えます。値は本機の chrome.storage.local にのみ保存され、このブラウザの外には出ません。',
    'options.byok.baseURL.label':     'Base URL',
    'options.byok.baseURL.hint':      '例：https://api.openai.com/v1',
    'options.byok.apiKey.label':      'API key',
    'options.byok.apiKey.hint':       '機密として扱い、ドット表示されます。',
    'options.byok.model.label':       'モデル',
    'options.byok.model.hint':        '例：gpt-4.1-mini、claude-3-5-sonnet（プロキシ経由）',
    // Phase 15 D-A1 / D-D1 / D-F2: managed-models cluster (ja).
    'options.managed-models.heading':            'システムモデル',
    'options.managed-models.description':        'PaperFlow が管理する AI モデル。利用可能なモデルは契約プランに依存します。',
    'options.managed-models.locked.badge':       'Pro 専用',
    'options.managed-models.locked.upgrade-cta': 'Pro にアップグレード',
    'options.byok-configs.heading':            'BYOK 設定',
    'options.byok-configs.description':        '複数の BYOK 設定（OpenAI 互換 / ローカル LiteLLM）を保存し、実行時に切り替えできます。',
    'options.byok-configs.empty':              '設定がまだありません。下の「+ 新規設定」をクリックして開始してください。',
    'options.byok-configs.loading':            '読み込み中…',
    'options.byok-configs.active-suffix':      '· 現在',
    'options.byok-configs.btn.new':            '+ 新規設定',
    'options.byok-configs.btn.edit':           '編集',
    'options.byok-configs.btn.delete':         '削除',
    'options.byok-configs.btn.save':           '保存',
    'options.byok-configs.btn.cancel':         'キャンセル',
    'options.byok-configs.confirm.delete':     '設定「{name}」を削除しますか？',
    'options.byok-configs.field.preset.label': 'プリセット',
    'options.byok-configs.field.preset.hint':  'プリセットを選ぶと baseURL / モデルが自動入力されます（入力済みの欄は上書きしません）。',
    'options.byok-configs.field.name.label':   '設定名',
    'options.byok-configs.field.name.hint':    '1-32 文字、例：「Claude via LiteLLM」/「GPT-4o 個人」',
    'options.byok-configs.field.baseURL.label':'Base URL',
    'options.byok-configs.field.baseURL.hint': 'OpenAI 互換エンドポイント（https:// または http://localhost）',
    'options.byok-configs.field.apiKey.label': 'API key',
    'options.byok-configs.field.apiKey.hint':  '本機にのみ保存——Supabase へはアップロードされません',
    'options.byok-configs.field.model.label':  'モデル',
    'options.byok-configs.field.model.hint':   'モデル名',
    'options.byok-configs.error.name':         '設定名は 1-32 文字の英数字、空白、ハイフン、アンダースコア、ドットにしてください。',
    'options.byok-configs.error.baseURL':      'Base URL は https:// で始めるか、http://localhost / http://127.0.0.1 にしてください。',
    'options.byok-configs.error.model':        'モデルは必須です。',
    'options.byok-configs.error.apiKey':       'API key は必須です。',
    'options.byok-configs.error.name-conflict':'設定名がすでに存在します。別の名前を選んでください。',
    'options.byok-configs.set-active.aria':    '現在の設定にする',

    // Phase 13 — 顶栏 BYOK chip + popover (D-A / D-D / D-E)
    // (Phase 19 v1.4 hard cutover: 'topbar.byok-chip.no-active' DELETED — replaced by 'topbar.model-picker.chip.empty')
    'topbar.byok-chip.aria.active':                '現在のモデル：{name}、{model}。クリックして切り替え。',
    'topbar.byok-chip.aria.no-active':             'AI を使うには BYOK を設定してください',
    'topbar.byok-popover.heading':                 'モデル',
    'topbar.byok-popover.banner.unreachable':      '{name} が応答していません — wrapper を起動しますか？',
    'topbar.byok-popover.banner.doc-link':         'セットアップ手順を見る →',
    'topbar.byok-popover.empty':                   '保存された設定はありません。',
    'topbar.byok-popover.btn.new':                 '+ 新しい設定',
    'topbar.byok-popover.btn.manage-all':          'すべて管理 →',
    'topbar.byok-popover.row.health.healthy':      '正常 ({n} モデル)',
    'topbar.byok-popover.row.health.unreachable':  '応答なし',
    // Phase 19 v1.4: model-picker cluster (ja)
    'topbar.model-picker.aria.menu':                  'モデルピッカー',
    'topbar.model-picker.system.heading':             'システムモデル',
    'topbar.model-picker.system.login-prompt':        'ログインしてシステムモデルを解除',
    'topbar.model-picker.system.locked-upgrade-cta':  'Pro にアップグレード',
    'topbar.model-picker.byok.heading':               'BYOK 設定',
    'topbar.model-picker.byok.region-label':          'BYOK 設定リスト',
    'topbar.model-picker.byok.empty':                 '設定がありません',
    'topbar.model-picker.byok.signed-out-hint':       'API キー持ち込みで、ログイン不要',
    'topbar.model-picker.cta.new-config':             '+ 新しい設定',
    'topbar.model-picker.cta.manage':                 '管理',
    'topbar.model-picker.chip.empty':                 '+ モデルを選択',
    'topbar.model-picker.chip.signed-out':            '+ ログインか BYOK',
    // ── Add to Library button (Phase 28) ───────────────────────────────────
    'topbar.add-to-library.add':                     'ライブラリに追加',
    'topbar.add-to-library.added':                   '追加済み',
    'topbar.add-to-library.confirm-remove-title':    'ライブラリから外しますか？',
    'topbar.add-to-library.confirm-remove-body':     'この論文はライブラリから削除されます。ローカルのハイライト・ノート・キャッシュはこの端末に保持されます — ライブラリの登録だけが削除されます。',
    'topbar.add-to-library.confirm-remove-danger':   '外す',
    'topbar.add-to-library.add-failed':              'クラウドへの同期に失敗しましたが、ローカルには保存されました。',
    'options.byok-configs.row.health.healthy':     '正常',
    'options.byok-configs.row.health.unreachable': '応答なし',
    'options.byok-configs.row.health.checking':    '確認中…',
    'options.byok-configs.row.active-pill':        '使用中',
    // Phase 16 D-E1 / D-E2 / D-E3 (ja).
    'options.byok-presets.openai-compatible.label':                'OpenAI 互換',
    'options.byok-presets.openai-compatible.chip.custom':          'カスタム',
    'options.byok-presets.openai-compatible.helpText.openai':      'OpenAI API への直接接続。sk-… キーをご用意ください。',
    'options.byok-presets.openai-compatible.helpText.openrouter':  '複数モデルのゲートウェイ。model は provider/model 形式で指定します。',
    'options.byok-presets.openai-compatible.helpText.together':    'Together AI 推論サービス。Llama / Mistral / Mixtral 等のオープンモデルをサポート。',
    'options.byok-presets.openai-compatible.helpText.groq':        'Groq 高速推論（Llama / Mixtral など）。',
    'options.byok-presets.openai-compatible.helpText.deepseek':    'DeepSeek API。コード向けにチューニングされたモデル。',
    'options.byok-presets.openai-compatible.helpText.custom':      '任意の OpenAI 互換エンドポイント。baseURL と model はご自身で入力してください。',

    'options.outputLang.label':       '出力言語',
    'options.outputLang.hint':        'モデルが要約・選択アクション・チャットで使う言語。',
    'options.ui_language.label':      'UI 言語',
    'options.ui_language.hint':       '拡張機能 UI の表示言語 · 即時反映、開いているすべてのタブで同期',
    'options.ui_language.auto':       'Auto · ブラウザに合わせる（{locale}）',
    'options.save':                   '保存',
    'options.saving':                 '保存中…',
    'options.saved':                  '✓ 保存しました',
    'options.loading':                '読み込み中…',

    'output.auto':                    'Auto · UI に合わせる（{ui}）',
    'output.detect':                  '質問の言語から判定',
    // Tabs (redesign 260424)
    'tabs.overview':                   'Overview',
    'tabs.note':                       'Note',
    'tabs.memory':                     'Memory',

    // Chat history
    'chat.history.title':              'CONVERSATIONS',
    'chat.history.empty':              'No conversations yet.',
    'chat.history.emptyHint':          'Try asking about this paper.',
    'chat.history.deleted':            'Deleted',
    'chat.session.titleFallback':      'Chat #{seq}',
    'chat.welcome.intro':             '論文を読み終えました。何でも聞いてください—段落引用を添えます。',
    'chat.suggest.mechanism.section': '§{section} のコアメカニズムは？',
    'chat.suggest.mechanism.generic': 'コアメカニズムは？',
    'chat.suggest.priorWork':         '既存研究との違いは？',
    'chat.suggest.fail':              'どこで失敗しますか？',
    'chat.composer.placeholder':        'この論文について質問…',
    'chat.composer.placeholder.pinned': 'もっと具体的に、または Enter で送信…',

    // Note kinds
    'note.kinds.explain':              'Explain',
    'note.kinds.highlight':            'Highlight',
    'note.kinds.note':                 'Note',
    'note.kinds.translate':            'Translate',

    // Note empty states
    'note.empty.explain':              'No explanations yet.',
    'note.empty.highlight':            'No highlights yet.',
    'note.empty.note':                 'No notes yet.',
    'note.empty.translate':            'No translations yet.',

    // Note editor
    'note.editor.title':               'Note',
    'note.editor.placeholder':         'Write your note…',
    'note.editor.saveFailed':          'Save failed',

    // Delete toasts
    'delete.toast.session':            'Conversation deleted',
    'delete.toast.note':               'Note deleted',
    'delete.toast.highlight':          'Highlight deleted',
    'delete.toast.dismiss':            'Undo',

    // Highlight click popover
    'highlight.popover.remove':        'Remove highlight',
    'highlight.popover.aria':          'Highlight actions',

    // Shortcut migration toast
    'shortcut.toast.260424':           '⌘\\ now toggles the right panel (Outline retired).',

    // Actions
    'action.retry':                    'Retry',
    'action.cancel':                   'Cancel',
    'action.save':                     'Save',
    'action.saving':                   'Saving…',
    'action.viewSession':             'セッションを表示',
    'action.regenerate':              '再生成',

    // AI errors
    'error.aiFailed':                  'AI reply failed',
    'error.aiAborted':                 'AI reply was interrupted',

    // Ghost rail
    'ghost.rail.label':                'Last visit: {n} notes · {h} highlights · {c} conversations',

    // Overview panel
    'overview.contributions.title':    'Core Contributions',
    'overview.keywords.title':         'Keywords',
    'overview.contents.title':         'Contents',
    'overview.contents.jumpHint':      'Jump to this section',
    'overview.info.title':             'Paper info',
    'overview.field.publishedAt':      'Published',
    'overview.field.authors':          'Authors',
    'overview.field.citations':        'Citations',
    'overview.field.field':            'Field',
    'overview.field.codeUrl':          'Code',
    'overview.unconfigured.title':     'サインインまたは AI を設定してサマリーを有効化。',
    'overview.unconfigured.cta':       '設定を開く',
    // Phase 21 v1.4: summary.error.* SCREAMING_SNAKE migration (ja)
    'summary.error.prefix':              'サマリー生成失敗：',
    'summary.error.byok-misconfigured':  'API 設定が不完全です · 設定を開いてください。',
    'summary.error.QUOTA_EXCEEDED':      '無料枠を使い切りました。',
    'summary.error.TIER_NO_MANAGED_AI':  'Sync プランにはマネージド AI が含まれません · API Key を設定するか Pro にアップグレードしてください。',
    'summary.error.RATE_LIMITED':        'リクエストが多すぎます · 1 分後に再試行してください。',
    'summary.error.UNAUTHENTICATED':     'サインインするか、設定で API Key を設定してください。',
    'summary.error.SERVER_ERROR':        'サービスが一時的に利用できません · 再試行してください。',
    'summary.error.TIMEOUT':             'AI リクエストがタイムアウトしました · 再試行してください。',
    'summary.error.UNKNOWN':             'AI 呼び出しに失敗しました · 再試行するか設定を開いてください。',
    'summary.error.TIER_LOCKED':         'このモデルは上位プランが必要です · アップグレードしてください。',
    'summary.error.MODEL_NOT_FOUND':     '選択したモデルは利用できません · 別のモデルを選んでください。',
  },

  'ko': {
    'login.headline':           '무료 AI 시도 20회 잠금 해제',
    'login.subheadline':        '+ 모든 기기에서 같은 Library / 하이라이트 / Memory 보기',
    'login.google':             'Google 계정으로 로그인',
    'login.divider':            '또는',
    'login.email.placeholder':  '이메일',
    'login.email.send':         'OTP 전송',
    'login.email.resend':       '재전송 ({n}s)',
    'login.otp.placeholder':    '6자리 코드',
    'login.otp.verify':         '확인',
    'login.otp.expired':        '코드가 만료되었거나 유효하지 않습니다',
    'login.error.rate_limit':  '요청이 너무 많습니다. 1분 후 다시 시도하세요.',
    'login.error.invalid_email': '이메일 형식이 올바르지 않습니다. 확인 후 다시 시도하세요.',
    'login.error.network':     '네트워크 오류. 연결을 확인 후 다시 시도하세요.',
    'login.otp.send-new':       '새 코드 전송',
    'login.otp.title':         '인증 코드 입력',
    'login.otp.sent_to':       '{email}로 인증 코드를 보냈습니다',
    'login.otp.spam_hint':     '받지 못하셨나요? 스팸함 / 프로모션 폴더를 확인하세요.',
    'login.otp.back':          '← 뒤로',
    'login.otp.resend.ready':  '코드 재전송',
    'login.otp.resend.wait':   '재전송 ({n}초)',
    'login.byok.hint':          '이미 API key가 있나요?',
    'login.byok.skip':          '건너뛰기 · BYOK 사용',

    'account.header':                 '설정',
    'account.signedout.primary':      '로그인 · 동기화 + AI 시도 20회',
    'account.byok.configured':        'BYOK 설정됨',
    'account.byok.notconfigured':     '설정되지 않음',
    'account.tier.free':              'FREE',
    'account.tier.sync':              'SYNC',
    'account.tier.pro':               'PRO',
    'account.tier.ending':            '{tier} · {date} 만료',
    'account.trial.progress':         'AI 시도',
    'account.trial.remaining':        '{used} / {limit} · {remaining}회 남음',
    'account.pro.monthly':            '이번 달 AI',
    'account.sync.hint':              'AI는 BYOK 사용 · 무제한',
    'account.upgrade.pro':            '↑ Pro로 업그레이드 · $12/월',
    'account.upgrade.proFromSync':    '↑ Pro로 전환 · +$8/월 관리형 AI',
    'account.billing.manage':         '결제 관리',
    'account.byok.settings':          'BYOK 설정',
    'account.switch':                 '계정 전환',
    'account.signout':                '로그아웃',
    'account.switch.confirm':         '이 작업은 현재 계정에서 로그아웃하고 로컬 BYOK 설정과 동기화 데이터 캐시를 지웁니다',
    'account.switch.cancel':          '취소',
    'account.language':               '언어',
    'account.language.aria':          '언어 설정 열기',

    'upgrade.label.freeTrialExhausted': '무료 한도 소진',
    'upgrade.headline.trial':         '무료 AI 시도 20회를 모두 사용했습니다',
    'upgrade.headline.monthly':       '이번 달 관리형 AI 30000회를 모두 사용했습니다',
    'upgrade.headline.library':       'Library 동기화가 무료 한도 {limit}편에 도달했습니다',
    'upgrade.free.name':              'Free',
    'upgrade.free.price':             '$0/월',
    'upgrade.free.features':          '기기 간 동기화 ({limit}편) · BYOK 전용',
    'upgrade.free.cta':               'BYOK 설정',
    'upgrade.subheadline':            'PaperFlow AI를 계속 사용하려면 플랜을 선택하세요',
    'upgrade.sync.name':              'Sync',
    'upgrade.sync.price':             '$4/월',
    'upgrade.sync.features':          '기기 간 동기화 · Library 무제한 · AI는 BYOK',
    'upgrade.sync.cta':               'Sync 선택',
    'upgrade.pro.name':               'Pro',
    'upgrade.pro.price':              '$12/월',
    'upgrade.pro.features':           '기기 간 동기화 · 월 30000회 관리형 AI · BYOK도 가능',
    'upgrade.pro.recommended':        '추천',
    'upgrade.pro.cta':                'Pro 선택',
    'upgrade.diff':                   '관리형 AI: — (Sync) / 월 30000회 (Pro)',
    'upgrade.byok':                   'OpenAI key를 추가하면 무료로 계속',
    'upgrade.later':                  '나중에',

    'trial.hint':                     '무료 시도 {n}회 남음 · key 추가 또는 업그레이드',

    'quota.free':                     'Free · {used}/{limit}',
    'quota.free.warn':                '⚠ Free · {used}/{limit}',
    'quota.free.critical':            'Free · 0회 남음',
    'quota.pro':                      'Pro · {used}/{limit}',
    'quota.sync':                     'Sync · BYOK',

    'libraryCap.text':                'Library {used} / {limit} (무료 한도)',
    'libraryCap.hint':                '기존 논문 유지 · 더 추가하려면 Sync 또는 Pro로 업그레이드',
    'libraryCap.upgrade':             '업그레이드',

    'library.jump.needsOriginalUrl':  '원본 URL에서 이 논문을 한 번 열어야 Library에서 바로 이동할 수 있습니다.',

    'migration.banner':               '☁ 동기화 중 {done} / {total}편',
    'migration.banner.paused':        '⚠ 동기화 일시 중지 · 클릭하여 재시도',
    'migration.banner.preprompt':     '1분 정도 걸릴 수 있습니다, 열어 두세요',
    'migration.success':              '동기화 완료 · {papers}편, {highlights}개 하이라이트를 클라우드에 · 다른 기기에서 로그인해 확인',
    'migration.readonly.hint':        '동기화 중 · 일시적으로 읽기 전용',

    'migration.conflict.title':       '클라우드에 이미 데이터가 있습니다',
    'migration.conflict.local':       '로컬: {n}편',
    'migration.conflict.cloud':       '클라우드: {n}편',
    'migration.conflict.overlap':     '중복: {n}편 (양쪽 모두)',
    'migration.conflict.merge':       '★ 병합 (추천) — 양쪽 모두 유지, 중복은 최신 버전 사용',
    'migration.conflict.local_only':  '로컬만 사용 (클라우드 덮어쓰기 · 클라우드 {n}편 손실)',
    'migration.conflict.cloud_only':  '클라우드만 사용 (로컬 삭제 · 로컬 {n}편 손실)',

    'churn.headline':                 'Pro 구독이 종료되었습니다',
    'churn.body':                     'AI 한도가 무료 등급(20회 시도)으로 돌아갔습니다. Pro를 복원하려면 Billing Portal을 방문하세요.',
    'churn.restore':                  '복원',
    'churn.later':                    '나중에',

    'error.500.byok':                 '서비스 오류 · 재시도 또는 BYOK 전환',
    'error.500.nobyok':               '서비스 오류 · 재시도 또는 OpenAI key 추가',
    'error.timeout':                  'AI 응답 시간 초과(10초간 응답 없음) · 재시도',
    'error.429':                      '요청이 너무 많습니다, 1분 후 재시도하세요',
    'error.403.sync':                 'Sync 등급에는 관리형 AI가 없습니다 · BYOK 사용 또는 Pro로 업그레이드',
    'error.auth':                     '세션이 만료되었습니다, 다시 로그인하세요',

    'options.title':                  'PaperFlow 옵션',
    'options.intro':                  'Bring-your-own-key 설정. OpenAI 호환 엔드포인트면 모두 사용 가능. 값은 chrome.storage.local에만 저장되며 이 브라우저를 떠나지 않습니다.',
    'options.byok.baseURL.label':     'Base URL',
    'options.byok.baseURL.hint':      '예: https://api.openai.com/v1',
    'options.byok.apiKey.label':      'API key',
    'options.byok.apiKey.hint':       '비밀로 처리, 점으로 표시됩니다.',
    'options.byok.model.label':       '모델',
    'options.byok.model.hint':        '예: gpt-4.1-mini, claude-3-5-sonnet (프록시 경유)',
    // Phase 15 D-A1 / D-D1 / D-F2: managed-models cluster (ko).
    'options.managed-models.heading':            '시스템 모델',
    'options.managed-models.description':        'PaperFlow가 관리하는 AI 모델입니다. 표시되는 모델은 구독 등급에 따라 다릅니다.',
    'options.managed-models.locked.badge':       'Pro 전용',
    'options.managed-models.locked.upgrade-cta': 'Pro로 업그레이드',
    'options.byok-configs.heading':            'BYOK 구성',
    'options.byok-configs.description':        '여러 BYOK 구성(OpenAI 호환 / 로컬 LiteLLM)을 저장하고 실행 중에 전환할 수 있습니다.',
    'options.byok-configs.empty':              '아직 구성이 없습니다. 아래 "+ 새 구성"을 눌러 시작하세요.',
    'options.byok-configs.loading':            '불러오는 중…',
    'options.byok-configs.active-suffix':      '· 현재',
    'options.byok-configs.btn.new':            '+ 새 구성',
    'options.byok-configs.btn.edit':           '편집',
    'options.byok-configs.btn.delete':         '삭제',
    'options.byok-configs.btn.save':           '저장',
    'options.byok-configs.btn.cancel':         '취소',
    'options.byok-configs.confirm.delete':     '구성 "{name}"을(를) 삭제하시겠습니까?',
    'options.byok-configs.field.preset.label': '프리셋',
    'options.byok-configs.field.preset.hint':  '프리셋을 선택하면 baseURL / 모델이 자동 입력됩니다(채워진 항목은 덮어쓰지 않습니다).',
    'options.byok-configs.field.name.label':   '구성 이름',
    'options.byok-configs.field.name.hint':    '1-32자, 예: "Claude via LiteLLM" / "GPT-4o 개인"',
    'options.byok-configs.field.baseURL.label':'Base URL',
    'options.byok-configs.field.baseURL.hint': 'OpenAI 호환 엔드포인트(https:// 또는 http://localhost)',
    'options.byok-configs.field.apiKey.label': 'API key',
    'options.byok-configs.field.apiKey.hint':  '로컬에만 저장되며 Supabase로 업로드되지 않습니다',
    'options.byok-configs.field.model.label':  '모델',
    'options.byok-configs.field.model.hint':   '모델 이름',
    'options.byok-configs.error.name':         '구성 이름은 1-32자(글자, 숫자, 공백, 하이픈, 밑줄, 점)이어야 합니다.',
    'options.byok-configs.error.baseURL':      'Base URL은 https://로 시작하거나 http://localhost / http://127.0.0.1이어야 합니다.',
    'options.byok-configs.error.model':        '모델은 필수입니다.',
    'options.byok-configs.error.apiKey':       'API key는 필수입니다.',
    'options.byok-configs.error.name-conflict':'구성 이름이 이미 존재합니다. 다른 이름을 선택하세요.',
    'options.byok-configs.set-active.aria':    '현재 구성으로 설정',

    // Phase 13 — 顶栏 BYOK chip + popover (D-A / D-D / D-E)
    // (Phase 19 v1.4 hard cutover: 'topbar.byok-chip.no-active' DELETED — replaced by 'topbar.model-picker.chip.empty')
    'topbar.byok-chip.aria.active':                '현재 모델: {name}, {model}. 클릭하여 전환.',
    'topbar.byok-chip.aria.no-active':             'AI 사용을 위해 BYOK를 설정하세요',
    'topbar.byok-popover.heading':                 '모델',
    'topbar.byok-popover.banner.unreachable':      '{name} 응답 없음 — wrapper를 시작할까요?',
    'topbar.byok-popover.banner.doc-link':         '설치 가이드 보기 →',
    'topbar.byok-popover.empty':                   '저장된 구성이 없습니다.',
    'topbar.byok-popover.btn.new':                 '+ 새 구성',
    'topbar.byok-popover.btn.manage-all':          '모두 관리 →',
    'topbar.byok-popover.row.health.healthy':      '정상 ({n}개 모델)',
    'topbar.byok-popover.row.health.unreachable':  '응답 없음',
    // Phase 19 v1.4: model-picker cluster (ko)
    'topbar.model-picker.aria.menu':                  '모델 선택기',
    'topbar.model-picker.system.heading':             '시스템 모델',
    'topbar.model-picker.system.login-prompt':        '로그인하여 시스템 모델 잠금 해제',
    'topbar.model-picker.system.locked-upgrade-cta':  'Pro 업그레이드',
    'topbar.model-picker.byok.heading':               'BYOK 구성',
    'topbar.model-picker.byok.region-label':          'BYOK 구성 목록',
    'topbar.model-picker.byok.empty':                 '저장된 구성 없음',
    'topbar.model-picker.byok.signed-out-hint':       '자체 API 키로 로그인 없이 사용',
    'topbar.model-picker.cta.new-config':             '+ 새 구성',
    'topbar.model-picker.cta.manage':                 '관리',
    'topbar.model-picker.chip.empty':                 '+ 모델 선택',
    'topbar.model-picker.chip.signed-out':            '+ 로그인 또는 BYOK',
    // ── Add to Library button (Phase 28) ───────────────────────────────────
    'topbar.add-to-library.add':                     '라이브러리에 추가',
    'topbar.add-to-library.added':                   '추가됨',
    'topbar.add-to-library.confirm-remove-title':    '라이브러리에서 제외하시겠습니까?',
    'topbar.add-to-library.confirm-remove-body':     '이 논문은 라이브러리에서 제거됩니다. 로컬에 저장된 하이라이트, 노트, 캐시는 이 기기에 그대로 유지됩니다 — 라이브러리 항목만 제거됩니다.',
    'topbar.add-to-library.confirm-remove-danger':   '제외',
    'topbar.add-to-library.add-failed':              '클라우드 라이브러리에 동기화하지 못했지만 로컬에 저장되었습니다.',
    'options.byok-configs.row.health.healthy':     '정상',
    'options.byok-configs.row.health.unreachable': '응답 없음',
    'options.byok-configs.row.health.checking':    '확인 중…',
    'options.byok-configs.row.active-pill':        '사용 중',
    // Phase 16 D-E1 / D-E2 / D-E3 (ko).
    'options.byok-presets.openai-compatible.label':                'OpenAI 호환',
    'options.byok-presets.openai-compatible.chip.custom':          '사용자 정의',
    'options.byok-presets.openai-compatible.helpText.openai':      'OpenAI API에 직접 연결. 자체 sk-… 키가 필요합니다.',
    'options.byok-presets.openai-compatible.helpText.openrouter':  '다중 모델 게이트웨이. model 필드는 provider/model 형식을 사용합니다.',
    'options.byok-presets.openai-compatible.helpText.together':    'Together AI 추론 서비스. Llama / Mistral / Mixtral 등 오픈 모델 지원.',
    'options.byok-presets.openai-compatible.helpText.groq':        'Groq 고속 추론 (Llama / Mixtral 등).',
    'options.byok-presets.openai-compatible.helpText.deepseek':    'DeepSeek API. 코드 작업에 특화된 모델.',
    'options.byok-presets.openai-compatible.helpText.custom':      '임의의 OpenAI 호환 엔드포인트. baseURL과 model을 직접 입력하세요.',

    'options.outputLang.label':       '출력 언어',
    'options.outputLang.hint':        '모델이 요약, 선택 동작, 채팅에서 사용할 언어.',
    'options.ui_language.label':      'UI 언어',
    'options.ui_language.hint':       '확장 프로그램 UI 표시 언어 · 즉시 적용, 열린 모든 탭 동기화',
    'options.ui_language.auto':       'Auto · 브라우저 따라가기 ({locale})',
    'options.save':                   '저장',
    'options.saving':                 '저장 중…',
    'options.saved':                  '✓ 저장됨',
    'options.loading':                '로드 중…',

    'output.auto':                    'Auto · UI 따라가기 ({ui})',
    'output.detect':                  '질문 언어로 감지',
    // Tabs (redesign 260424)
    'tabs.overview':                   'Overview',
    'tabs.note':                       'Note',
    'tabs.memory':                     'Memory',

    // Chat history
    'chat.history.title':              'CONVERSATIONS',
    'chat.history.empty':              'No conversations yet.',
    'chat.history.emptyHint':          'Try asking about this paper.',
    'chat.history.deleted':            'Deleted',
    'chat.session.titleFallback':      'Chat #{seq}',
    'chat.welcome.intro':             '논문을 다 읽었습니다. 무엇이든 물어보세요—단락 인용을 함께 표시하겠습니다.',
    'chat.suggest.mechanism.section': '§{section}의 핵심 메커니즘은?',
    'chat.suggest.mechanism.generic': '핵심 메커니즘은?',
    'chat.suggest.priorWork':         '기존 연구와 어떻게 다른가요?',
    'chat.suggest.fail':              '어디서 실패하나요?',
    'chat.composer.placeholder':        '이 논문에 대해 질문…',
    'chat.composer.placeholder.pinned': '더 구체적으로 묻거나 Enter로 전송…',

    // Note kinds
    'note.kinds.explain':              'Explain',
    'note.kinds.highlight':            'Highlight',
    'note.kinds.note':                 'Note',
    'note.kinds.translate':            'Translate',

    // Note empty states
    'note.empty.explain':              'No explanations yet.',
    'note.empty.highlight':            'No highlights yet.',
    'note.empty.note':                 'No notes yet.',
    'note.empty.translate':            'No translations yet.',

    // Note editor
    'note.editor.title':               'Note',
    'note.editor.placeholder':         'Write your note…',
    'note.editor.saveFailed':          'Save failed',

    // Delete toasts
    'delete.toast.session':            'Conversation deleted',
    'delete.toast.note':               'Note deleted',
    'delete.toast.highlight':          'Highlight deleted',
    'delete.toast.dismiss':            'Undo',

    // Highlight click popover
    'highlight.popover.remove':        'Remove highlight',
    'highlight.popover.aria':          'Highlight actions',

    // Shortcut migration toast
    'shortcut.toast.260424':           '⌘\\ now toggles the right panel (Outline retired).',

    // Actions
    'action.retry':                    'Retry',
    'action.cancel':                   'Cancel',
    'action.save':                     'Save',
    'action.saving':                   'Saving…',
    'action.viewSession':             '세션 보기',
    'action.regenerate':              '재생성',

    // AI errors
    'error.aiFailed':                  'AI reply failed',
    'error.aiAborted':                 'AI reply was interrupted',

    // Ghost rail
    'ghost.rail.label':                'Last visit: {n} notes · {h} highlights · {c} conversations',

    // Overview panel
    'overview.contributions.title':    'Core Contributions',
    'overview.keywords.title':         'Keywords',
    'overview.contents.title':         'Contents',
    'overview.contents.jumpHint':      'Jump to this section',
    'overview.info.title':             'Paper info',
    'overview.field.publishedAt':      'Published',
    'overview.field.authors':          'Authors',
    'overview.field.citations':        'Citations',
    'overview.field.field':            'Field',
    'overview.field.codeUrl':          'Code',
    'overview.unconfigured.title':     '로그인하거나 AI를 설정하여 요약을 활성화하세요.',
    'overview.unconfigured.cta':       '설정 열기',
    // Phase 21 v1.4: summary.error.* SCREAMING_SNAKE migration (ko)
    'summary.error.prefix':              '요약 생성 실패:',
    'summary.error.byok-misconfigured':  'API 설정이 완전하지 않습니다 · 옵션을 여세요.',
    'summary.error.QUOTA_EXCEEDED':      '무료 할당량을 모두 사용했습니다.',
    'summary.error.TIER_NO_MANAGED_AI':  'Sync 등급에는 관리형 AI가 포함되지 않습니다 · API Key를 설정하거나 Pro로 업그레이드하세요.',
    'summary.error.RATE_LIMITED':        '요청이 너무 많습니다 · 1분 후 다시 시도하세요.',
    'summary.error.UNAUTHENTICATED':     '로그인하거나 옵션에서 API Key를 설정하세요.',
    'summary.error.SERVER_ERROR':        '서비스가 일시적으로 사용할 수 없습니다 · 다시 시도하세요.',
    'summary.error.TIMEOUT':             'AI 요청이 시간 초과되었습니다 · 다시 시도하세요.',
    'summary.error.UNKNOWN':             'AI 호출 실패 · 다시 시도하거나 옵션을 여세요.',
    'summary.error.TIER_LOCKED':         '이 모델은 더 높은 등급이 필요합니다 · 업그레이드하여 사용하세요.',
    'summary.error.MODEL_NOT_FOUND':     '선택한 모델을 사용할 수 없습니다 · 다른 모델을 선택하세요.',
  },

  'fr': {
    'login.headline':           'Débloquer 20 essais AI gratuits',
    'login.subheadline':        '+ Voir la même Library / surlignages / Memory sur tous les appareils',
    'login.google':             'Se connecter avec Google',
    'login.divider':            'ou',
    'login.email.placeholder':  'Votre e-mail',
    'login.email.send':         'Envoyer OTP',
    'login.email.resend':       'Renvoyer ({n}s)',
    'login.otp.placeholder':    'Code à 6 chiffres',
    'login.otp.verify':         'Vérifier',
    'login.otp.expired':        'Code expiré ou invalide',
    'login.error.rate_limit':  'Trop de tentatives — patientez une minute et réessayez.',
    'login.error.invalid_email': 'Le format d\'email semble incorrect — vérifiez et réessayez.',
    'login.error.network':     'Erreur réseau — vérifiez votre connexion et réessayez.',
    'login.otp.send-new':       'Envoyer un nouveau code',
    'login.otp.title':         'Entrer le code de vérification',
    'login.otp.sent_to':       'Code envoyé à {email}',
    'login.otp.spam_hint':     'Pas reçu ? Vérifiez votre dossier spam / promotions.',
    'login.otp.back':          '← Retour',
    'login.otp.resend.ready':  'Renvoyer le code',
    'login.otp.resend.wait':   'Renvoyer dans ({n}s)',
    'login.byok.hint':          'Vous avez déjà une API key ?',
    'login.byok.skip':          'Passer · utiliser BYOK',

    'account.header':                 'Paramètres',
    'account.signedout.primary':      'Se connecter · Sync + 20 essais AI',
    'account.byok.configured':        'BYOK configuré',
    'account.byok.notconfigured':     'Non configuré',
    'account.tier.free':              'FREE',
    'account.tier.sync':              'SYNC',
    'account.tier.pro':               'PRO',
    'account.tier.ending':            '{tier} · fin le {date}',
    'account.trial.progress':         'Essais AI',
    'account.trial.remaining':        '{used} / {limit} · {remaining} restants',
    'account.pro.monthly':            'AI ce mois-ci',
    'account.sync.hint':              'AI via votre BYOK · illimité',
    'account.upgrade.pro':            '↑ Passer à Pro · 12 $/mois',
    'account.upgrade.proFromSync':    '↑ Passer à Pro · +8 $/mois AI géré',
    'account.billing.manage':         'Facturation',
    'account.byok.settings':          'Paramètres BYOK',
    'account.switch':                 'Changer compte',
    'account.signout':                'Déconnexion',
    'account.switch.confirm':         'Cette action déconnecte le compte actuel et efface la config BYOK locale et le cache des données synchronisées',
    'account.switch.cancel':          'Annuler',
    'account.language':               'Langue',
    'account.language.aria':          'Ouvrir les paramètres de langue',

    'upgrade.label.freeTrialExhausted': 'Quota gratuit épuisé',
    'upgrade.headline.trial':         'Vous avez utilisé les 20 essais AI gratuits',
    'upgrade.headline.monthly':       'Vous avez utilisé les 30000 appels AI gérés du mois',
    'upgrade.headline.library':       'Sync Library a atteint la limite gratuite de {limit} papiers',
    'upgrade.free.name':              'Free',
    'upgrade.free.price':             '0 $/mois',
    'upgrade.free.features':          'Sync multi-appareil ({limit} papiers) · BYOK uniquement',
    'upgrade.free.cta':               'Configurer BYOK',
    'upgrade.subheadline':            'Choisissez un plan pour continuer avec PaperFlow AI',
    'upgrade.sync.name':              'Sync',
    'upgrade.sync.price':             '4 $/mois',
    'upgrade.sync.features':          'Sync multi-appareil · Library illimitée · AI via BYOK',
    'upgrade.sync.cta':               'Choisir Sync',
    'upgrade.pro.name':               'Pro',
    'upgrade.pro.price':              '12 $/mois',
    'upgrade.pro.features':           'Sync multi-appareil · 30000/mois AI géré · BYOK aussi',
    'upgrade.pro.recommended':        'Recommandé',
    'upgrade.pro.cta':                'Choisir Pro',
    'upgrade.diff':                   'AI géré : — (Sync) / 30000/mois (Pro)',
    'upgrade.byok':                   'Ajouter une OpenAI key pour rester gratuit',
    'upgrade.later':                  'Plus tard',

    'trial.hint':                     '{n} essais gratuits restants · ajouter une key ou upgrader',

    'quota.free':                     'Free · {used}/{limit}',
    'quota.free.warn':                '⚠ Free · {used}/{limit}',
    'quota.free.critical':            'Free · 0 restant',
    'quota.pro':                      'Pro · {used}/{limit}',
    'quota.sync':                     'Sync · BYOK',

    'libraryCap.text':                'Library à {used} / {limit} (limite gratuite)',
    'libraryCap.hint':                'Papiers existants conservés · upgradez à Sync ou Pro pour ajouter',
    'libraryCap.upgrade':             'Upgrader',

    'library.jump.needsOriginalUrl':  'Ouvrez cet article une fois depuis son URL d\'origine pour activer le saut rapide.',

    'migration.banner':               '☁ Synchronisation {done} / {total} papiers',
    'migration.banner.paused':        '⚠ Sync en pause · cliquer pour réessayer',
    'migration.banner.preprompt':     'Cela peut prendre une minute, restez ouvert',
    'migration.success':              'Synchronisé · {papers} papiers, {highlights} surlignages dans le cloud · Connectez-vous sur un autre appareil pour les voir',
    'migration.readonly.hint':        'Synchronisation · lecture seule temporaire',

    'migration.conflict.title':       'La Library cloud contient déjà des données',
    'migration.conflict.local':       'Local : {n} papiers',
    'migration.conflict.cloud':       'Cloud : {n} papiers',
    'migration.conflict.overlap':     'Recouvrement : {n} papiers (dans les deux)',
    'migration.conflict.merge':       '★ Fusionner (recommandé) — garder les deux ; doublons en version la plus récente',
    'migration.conflict.local_only':  'Garder local uniquement (écrase cloud · perd {n} papiers cloud)',
    'migration.conflict.cloud_only':  'Garder cloud uniquement (efface local · perd {n} papiers locaux)',

    'churn.headline':                 'Votre abonnement Pro a pris fin',
    'churn.body':                     'Votre quota AI est revenu au tier gratuit (20 essais). Pour restaurer Pro, visitez le Billing Portal.',
    'churn.restore':                  'Restaurer',
    'churn.later':                    'Plus tard',

    'error.500.byok':                 'Service en erreur · réessayer ou passer en BYOK',
    'error.500.nobyok':               'Service en erreur · réessayer ou ajouter une OpenAI key',
    'error.timeout':                  'AI a expiré (pas de réponse en 10 s) · réessayer',
    'error.429':                      'Trop de requêtes, réessayer dans 1 minute',
    'error.403.sync':                 'Le tier Sync n\'inclut pas l\'AI géré · utilisez BYOK ou upgradez à Pro',
    'error.auth':                     'Session expirée, veuillez vous reconnecter',

    'options.title':                  'Options PaperFlow',
    'options.intro':                  'Configuration Bring-your-own-key. Tout endpoint compatible OpenAI fonctionne. Les valeurs sont stockées localement dans chrome.storage.local et ne quittent jamais ce navigateur.',
    'options.byok.baseURL.label':     'Base URL',
    'options.byok.baseURL.hint':      'ex. https://api.openai.com/v1',
    'options.byok.apiKey.label':      'API key',
    'options.byok.apiKey.hint':       'Traitée comme un secret, affichée en points.',
    'options.byok.model.label':       'Modèle',
    'options.byok.model.hint':        'ex. gpt-4.1-mini, claude-3-5-sonnet (via proxy)',
    // Phase 15 D-A1 / D-D1 / D-F2: managed-models cluster (fr).
    'options.managed-models.heading':            'Modèles système',
    'options.managed-models.description':        'Modèles d\'IA gérés par PaperFlow. Les modèles disponibles dépendent de votre abonnement.',
    'options.managed-models.locked.badge':       'Pro uniquement',
    'options.managed-models.locked.upgrade-cta': 'Passer à Pro',
    'options.byok-configs.heading':            'Configurations BYOK',
    'options.byok-configs.description':        'Enregistrez plusieurs configurations BYOK (compatible OpenAI / LiteLLM local) et basculez entre elles à l\'exécution.',
    'options.byok-configs.empty':              'Aucune configuration. Cliquez sur « + Nouvelle configuration » ci-dessous pour commencer.',
    'options.byok-configs.loading':            'Chargement…',
    'options.byok-configs.active-suffix':      '· active',
    'options.byok-configs.btn.new':            '+ Nouvelle configuration',
    'options.byok-configs.btn.edit':           'Modifier',
    'options.byok-configs.btn.delete':         'Supprimer',
    'options.byok-configs.btn.save':           'Enregistrer',
    'options.byok-configs.btn.cancel':         'Annuler',
    'options.byok-configs.confirm.delete':     'Supprimer la configuration « {name} » ?',
    'options.byok-configs.field.preset.label': 'Préréglage',
    'options.byok-configs.field.preset.hint':  'Choisissez un préréglage pour pré-remplir baseURL / modèle (n\'écrase pas les champs déjà saisis).',
    'options.byok-configs.field.name.label':   'Nom de la configuration',
    'options.byok-configs.field.name.hint':    '1-32 caractères, ex. « Claude via LiteLLM » / « GPT-4o personnel »',
    'options.byok-configs.field.baseURL.label':'Base URL',
    'options.byok-configs.field.baseURL.hint': 'Endpoint compatible OpenAI (https:// ou http://localhost)',
    'options.byok-configs.field.apiKey.label': 'API key',
    'options.byok-configs.field.apiKey.hint':  'Stockée localement uniquement — jamais envoyée à Supabase',
    'options.byok-configs.field.model.label':  'Modèle',
    'options.byok-configs.field.model.hint':   'Nom du modèle',
    'options.byok-configs.error.name':         'Le nom doit faire 1-32 caractères : lettres, chiffres, espaces, tirets, traits de soulignement, points.',
    'options.byok-configs.error.baseURL':      'Base URL doit commencer par https:// ou être http://localhost / http://127.0.0.1.',
    'options.byok-configs.error.model':        'Modèle requis.',
    'options.byok-configs.error.apiKey':       'API key requise.',
    'options.byok-configs.error.name-conflict':'Ce nom de configuration existe déjà. Choisissez un autre nom.',
    'options.byok-configs.set-active.aria':    'Définir comme configuration active',

    // Phase 13 — 顶栏 BYOK chip + popover (D-A / D-D / D-E)
    // (Phase 19 v1.4 hard cutover: 'topbar.byok-chip.no-active' DELETED — replaced by 'topbar.model-picker.chip.empty')
    'topbar.byok-chip.aria.active':                'Modèle actif : {name}, {model}. Cliquer pour changer.',
    'topbar.byok-chip.aria.no-active':             'Configurer BYOK pour utiliser l\'IA',
    'topbar.byok-popover.heading':                 'MODÈLE',
    'topbar.byok-popover.banner.unreachable':      '{name} ne répond pas — démarrer le wrapper ?',
    'topbar.byok-popover.banner.doc-link':         'Voir le guide d\'installation →',
    'topbar.byok-popover.empty':                   'Aucune configuration enregistrée.',
    'topbar.byok-popover.btn.new':                 '+ Nouvelle configuration',
    'topbar.byok-popover.btn.manage-all':          'Tout gérer →',
    'topbar.byok-popover.row.health.healthy':      'Sain ({n} modèles)',
    'topbar.byok-popover.row.health.unreachable':  'Ne répond pas',
    // Phase 19 v1.4: model-picker cluster (fr)
    'topbar.model-picker.aria.menu':                  'Sélecteur de modèle',
    'topbar.model-picker.system.heading':             'MODÈLES SYSTÈME',
    'topbar.model-picker.system.login-prompt':        'Connectez-vous pour débloquer',
    'topbar.model-picker.system.locked-upgrade-cta':  'Passer à Pro',
    'topbar.model-picker.byok.heading':               'CONFIGS BYOK',
    'topbar.model-picker.byok.region-label':          'Liste des configurations BYOK',
    'topbar.model-picker.byok.empty':                 'Aucune configuration',
    'topbar.model-picker.byok.signed-out-hint':       'Apportez votre clé — fonctionne sans connexion',
    'topbar.model-picker.cta.new-config':             '+ Nouvelle configuration',
    'topbar.model-picker.cta.manage':                 'Gérer',
    'topbar.model-picker.chip.empty':                 '+ Choisir modèle',
    'topbar.model-picker.chip.signed-out':            '+ Connexion / BYOK',
    // ── Add to Library button (Phase 28) ───────────────────────────────────
    'topbar.add-to-library.add':                     'Ajouter à la bibliothèque',
    'topbar.add-to-library.added':                   'Ajouté',
    'topbar.add-to-library.confirm-remove-title':    'Retirer de la bibliothèque ?',
    'topbar.add-to-library.confirm-remove-body':     "Cet article sera retiré de votre bibliothèque. Les annotations, notes et le cache local restent sur cet appareil — seule l'entrée de la bibliothèque est supprimée.",
    'topbar.add-to-library.confirm-remove-danger':   'Retirer',
    'topbar.add-to-library.add-failed':              "Échec de la synchronisation avec votre bibliothèque, mais l'enregistrement local a réussi.",
    'options.byok-configs.row.health.healthy':     'Sain',
    'options.byok-configs.row.health.unreachable': 'Ne répond pas',
    'options.byok-configs.row.health.checking':    'Vérification…',
    'options.byok-configs.row.active-pill':        'Actif',
    // Phase 16 D-E1 / D-E2 / D-E3 (fr).
    'options.byok-presets.openai-compatible.label':                'Compatible OpenAI',
    'options.byok-presets.openai-compatible.chip.custom':          'Personnalisé',
    'options.byok-presets.openai-compatible.helpText.openai':      'API OpenAI direct. Apportez votre propre clé sk-….',
    'options.byok-presets.openai-compatible.helpText.openrouter':  'Passerelle multi-modèles. Utilisez le format provider/model.',
    'options.byok-presets.openai-compatible.helpText.together':    'Inférence Together AI. Llama / Mistral / Mixtral.',
    'options.byok-presets.openai-compatible.helpText.groq':        'Inférence rapide Groq (Llama, Mixtral).',
    'options.byok-presets.openai-compatible.helpText.deepseek':    'API DeepSeek. Modèles optimisés pour le code.',
    'options.byok-presets.openai-compatible.helpText.custom':      'Tout endpoint compatible OpenAI. Saisissez baseURL et model vous-même.',

    'options.outputLang.label':       'Langue de sortie',
    'options.outputLang.hint':        'Langue dans laquelle le modèle répond pour résumés, actions de sélection et chat.',
    'options.ui_language.label':      'Langue de l\'interface',
    'options.ui_language.hint':       'Langue d\'affichage de l\'extension · changements appliqués instantanément à tous les onglets',
    'options.ui_language.auto':       'Auto · suivre le navigateur ({locale})',
    'options.save':                   'OK',
    'options.saving':                 'En cours…',
    'options.saved':                  '✓ Enregistré',
    'options.loading':                'Chargement…',

    'output.auto':                    'Auto · suivre l\'interface ({ui})',
    'output.detect':                  'Détecter selon la question',
    // Tabs (redesign 260424)
    'tabs.overview':                   'Overview',
    'tabs.note':                       'Note',
    'tabs.memory':                     'Memory',

    // Chat history
    'chat.history.title':              'CONVERSATIONS',
    'chat.history.empty':              'No conversations yet.',
    'chat.history.emptyHint':          'Try asking about this paper.',
    'chat.history.deleted':            'Deleted',
    'chat.session.titleFallback':      'Chat #{seq}',
    'chat.welcome.intro':             'J\'ai lu l\'article. Demandez n\'importe quoi — je citerai les paragraphes en ligne.',
    'chat.suggest.mechanism.section': 'Quel est le mécanisme principal de §{section} ?',
    'chat.suggest.mechanism.generic': 'Quel est le mécanisme principal ?',
    'chat.suggest.priorWork':         'Comment se compare-t-il aux travaux antérieurs ?',
    'chat.suggest.fail':              'Où échoue-t-il ?',
    'chat.composer.placeholder':        'Posez une question sur cet article…',
    'chat.composer.placeholder.pinned': 'Posez une question précise, ou appuyez sur Entrée…',

    // Note kinds
    'note.kinds.explain':              'Explain',
    'note.kinds.highlight':            'Highlight',
    'note.kinds.note':                 'Note',
    'note.kinds.translate':            'Translate',

    // Note empty states
    'note.empty.explain':              'No explanations yet.',
    'note.empty.highlight':            'No highlights yet.',
    'note.empty.note':                 'No notes yet.',
    'note.empty.translate':            'No translations yet.',

    // Note editor
    'note.editor.title':               'Note',
    'note.editor.placeholder':         'Write your note…',
    'note.editor.saveFailed':          'Save failed',

    // Delete toasts
    'delete.toast.session':            'Conversation deleted',
    'delete.toast.note':               'Note deleted',
    'delete.toast.highlight':          'Highlight deleted',
    'delete.toast.dismiss':            'Undo',

    // Highlight click popover
    'highlight.popover.remove':        'Remove highlight',
    'highlight.popover.aria':          'Highlight actions',

    // Shortcut migration toast
    'shortcut.toast.260424':           '⌘\\ now toggles the right panel (Outline retired).',

    // Actions
    'action.retry':                    'Retry',
    'action.cancel':                   'Cancel',
    'action.save':                     'Save',
    'action.saving':                   'Saving…',
    'action.viewSession':             'Voir la session',
    'action.regenerate':              'Régénérer',

    // AI errors
    'error.aiFailed':                  'AI reply failed',
    'error.aiAborted':                 'AI reply was interrupted',

    // Ghost rail
    'ghost.rail.label':                'Last visit: {n} notes · {h} highlights · {c} conversations',

    // Overview panel
    'overview.contributions.title':    'Core Contributions',
    'overview.keywords.title':         'Keywords',
    'overview.contents.title':         'Contents',
    'overview.contents.jumpHint':      'Jump to this section',
    'overview.info.title':             'Paper info',
    'overview.field.publishedAt':      'Published',
    'overview.field.authors':          'Authors',
    'overview.field.citations':        'Citations',
    'overview.field.field':            'Field',
    'overview.field.codeUrl':          'Code',
    'overview.unconfigured.title':     'Connectez-vous ou configurez l\'IA pour activer le résumé.',
    'overview.unconfigured.cta':       'Ouvrir les Options',
    // Phase 21 v1.4: summary.error.* SCREAMING_SNAKE migration (fr)
    'summary.error.prefix':              'Échec du résumé :',
    'summary.error.byok-misconfigured':  'Configuration API incomplète · ouvrez les Options.',
    'summary.error.QUOTA_EXCEEDED':      'Quota gratuit épuisé.',
    'summary.error.TIER_NO_MANAGED_AI':  'L\'offre Sync n\'inclut pas l\'IA gérée · configurez votre clé API ou passez à Pro.',
    'summary.error.RATE_LIMITED':        'Trop de requêtes · réessayez dans 1 minute.',
    'summary.error.UNAUTHENTICATED':     'Connectez-vous ou configurez votre clé API dans les Options.',
    'summary.error.SERVER_ERROR':        'Service temporairement indisponible · réessayez.',
    'summary.error.TIMEOUT':             'Délai de la requête AI dépassé · réessayez.',
    'summary.error.UNKNOWN':             'Erreur AI · réessayez ou ouvrez les Options.',
    'summary.error.TIER_LOCKED':         'Ce modèle nécessite une offre supérieure · passez à Pro pour y accéder.',
    'summary.error.MODEL_NOT_FOUND':     'Modèle sélectionné indisponible · veuillez en choisir un autre.',
  },

  'de': {
    'login.headline':           '20 kostenlose AI-Versuche freischalten',
    'login.subheadline':        '+ Gleiche Library / Markierungen / Memory auf allen Geräten',
    'login.google':             'Mit Google anmelden',
    'login.divider':            'oder',
    'login.email.placeholder':  'Deine E-Mail',
    'login.email.send':         'OTP senden',
    'login.email.resend':       'Erneut ({n}s)',
    'login.otp.placeholder':    '6-stelliger Code',
    'login.otp.verify':         'Prüfen',
    'login.otp.expired':        'Code abgelaufen oder ungültig',
    'login.error.rate_limit':  'Zu viele Anfragen — bitte warte eine Minute und versuche es erneut.',
    'login.error.invalid_email': 'Das E-Mail-Format scheint nicht korrekt zu sein — bitte prüfen.',
    'login.error.network':     'Netzwerkfehler — Verbindung prüfen und erneut versuchen.',
    'login.otp.send-new':       'Neuen Code senden',
    'login.otp.title':         'Bestätigungscode eingeben',
    'login.otp.sent_to':       'Code gesendet an {email}',
    'login.otp.spam_hint':     'Nicht erhalten? Prüfe Spam- / Werbeordner.',
    'login.otp.back':          '← Zurück',
    'login.otp.resend.ready':  'Code erneut senden',
    'login.otp.resend.wait':   'Erneut senden in ({n}s)',
    'login.byok.hint':          'Hast du schon einen API key?',
    'login.byok.skip':          'Überspringen · BYOK',

    'account.header':                 'Einstellungen',
    'account.signedout.primary':      'Anmelden · Sync + 20 AI-Versuche',
    'account.byok.configured':        'BYOK eingerichtet',
    'account.byok.notconfigured':     'Nicht eingerichtet',
    'account.tier.free':              'FREE',
    'account.tier.sync':              'SYNC',
    'account.tier.pro':               'PRO',
    'account.tier.ending':            '{tier} · endet am {date}',
    'account.trial.progress':         'AI-Versuche',
    'account.trial.remaining':        '{used} / {limit} · {remaining} übrig',
    'account.pro.monthly':            'AI diesen Monat',
    'account.sync.hint':              'AI über BYOK · unbegrenzt',
    'account.upgrade.pro':            '↑ Zu Pro · 12 $/Monat',
    'account.upgrade.proFromSync':    '↑ Zu Pro · +8 $/Monat AI',
    'account.billing.manage':         'Abrechnung',
    'account.byok.settings':          'BYOK-Einst.',
    'account.switch':                 'Wechseln',
    'account.signout':                'Abmelden',
    'account.switch.confirm':         'Diese Aktion meldet das aktuelle Konto ab und löscht die lokale BYOK-Konfiguration sowie den Cache synchronisierter Daten',
    'account.switch.cancel':          'Abbrechen',
    'account.language':               'Sprache',
    'account.language.aria':          'Spracheinstellungen öffnen',

    'upgrade.label.freeTrialExhausted': 'Gratis-Kontingent verbraucht',
    'upgrade.headline.trial':         'Du hast alle 20 kostenlosen AI-Versuche verbraucht',
    'upgrade.headline.monthly':       'Du hast die 30000 verwalteten AI-Aufrufe diesen Monat verbraucht',
    'upgrade.headline.library':       'Library-Sync hat das Gratis-Limit von {limit} Papern erreicht',
    'upgrade.free.name':              'Free',
    'upgrade.free.price':             '0 $/Monat',
    'upgrade.free.features':          'Geräte-Sync ({limit} Paper) · nur BYOK',
    'upgrade.free.cta':               'BYOK einrichten',
    'upgrade.subheadline':            'Wähle einen Plan, um PaperFlow AI weiter zu nutzen',
    'upgrade.sync.name':              'Sync',
    'upgrade.sync.price':             '4 $/Monat',
    'upgrade.sync.features':          'Geräte-Sync · Library unbegrenzt · AI über BYOK',
    'upgrade.sync.cta':               'Sync wählen',
    'upgrade.pro.name':               'Pro',
    'upgrade.pro.price':              '12 $/Monat',
    'upgrade.pro.features':           'Geräte-Sync · 30000/Monat AI · BYOK auch',
    'upgrade.pro.recommended':        'Empfohlen',
    'upgrade.pro.cta':                'Pro wählen',
    'upgrade.diff':                   'AI: — (Sync) / 30000/Monat (Pro)',
    'upgrade.byok':                   'OpenAI key hinzufügen, um gratis weiter zu nutzen',
    'upgrade.later':                  'Später',

    'trial.hint':                     '{n} Gratis-Versuche übrig · key oder Upgrade',

    'quota.free':                     'Free · {used}/{limit}',
    'quota.free.warn':                '⚠ Free · {used}/{limit}',
    'quota.free.critical':            'Free · 0 übrig',
    'quota.pro':                      'Pro · {used}/{limit}',
    'quota.sync':                     'Sync · BYOK',

    'libraryCap.text':                'Library bei {used} / {limit} (Gratis-Limit)',
    'libraryCap.hint':                'Bestehende Paper bleiben · Upgrade auf Sync oder Pro für mehr',
    'libraryCap.upgrade':             'Upgrade',

    'library.jump.needsOriginalUrl':  'Öffne dieses Paper einmal von seiner Original-URL, um den schnellen Sprung zu aktivieren.',

    'migration.banner':               '☁ Sync läuft {done} / {total} Paper',
    'migration.banner.paused':        '⚠ Sync pausiert · klicken zum Wiederholen',
    'migration.banner.preprompt':     'Kann eine Minute dauern, bitte geöffnet lassen',
    'migration.success':              'Synchronisiert · {papers} Paper, {highlights} Markierungen in der Cloud · Auf einem anderen Gerät anmelden, um sie zu sehen',
    'migration.readonly.hint':        'Sync läuft · vorübergehend nur lesen',

    'migration.conflict.title':       'Cloud-Library hat bereits Daten',
    'migration.conflict.local':       'Lokal: {n} Paper',
    'migration.conflict.cloud':       'Cloud: {n} Paper',
    'migration.conflict.overlap':     'Überschneidung: {n} Paper (beide Seiten)',
    'migration.conflict.merge':       '★ Zusammenführen (empfohlen) — beides behalten; bei Dubletten neueste Version',
    'migration.conflict.local_only':  'Nur lokal (überschreibt Cloud · {n} Cloud-Paper verloren)',
    'migration.conflict.cloud_only':  'Nur Cloud (löscht Lokal · {n} lokale Paper verloren)',

    'churn.headline':                 'Dein Pro-Abo ist beendet',
    'churn.body':                     'Dein AI-Kontingent ist auf den Gratis-Tier (20 Versuche) zurückgesetzt. Um Pro wiederherzustellen, besuche das Billing Portal.',
    'churn.restore':                  'Wiederherstellen',
    'churn.later':                    'Später',

    'error.500.byok':                 'Dienstfehler · Wiederholen oder zu BYOK wechseln',
    'error.500.nobyok':               'Dienstfehler · Wiederholen oder OpenAI key hinzufügen',
    'error.timeout':                  'AI-Timeout (keine Antwort in 10 s) · erneut versuchen',
    'error.429':                      'Zu viele Anfragen, in 1 Minute wiederholen',
    'error.403.sync':                 'Sync-Tier enthält kein AI · BYOK nutzen oder Pro upgraden',
    'error.auth':                     'Sitzung abgelaufen, bitte neu anmelden',

    'options.title':                  'PaperFlow Optionen',
    'options.intro':                  'Bring-your-own-key Konfiguration. Jeder OpenAI-kompatible Endpunkt funktioniert. Werte werden lokal in chrome.storage.local gespeichert und verlassen diesen Browser nie.',
    'options.byok.baseURL.label':     'Base URL',
    'options.byok.baseURL.hint':      'z.B. https://api.openai.com/v1',
    'options.byok.apiKey.label':      'API key',
    'options.byok.apiKey.hint':       'Als Secret behandelt, als Punkte angezeigt.',
    'options.byok.model.label':       'Modell',
    'options.byok.model.hint':        'z.B. gpt-4.1-mini, claude-3-5-sonnet (via Proxy)',
    // Phase 15 D-A1 / D-D1 / D-F2: Systemmodelle cluster.
    'options.managed-models.heading':            'Systemmodelle',
    'options.managed-models.description':        'Von PaperFlow verwaltete KI-Modelle. Verfügbare Modelle hängen von deinem Abonnement ab.',
    'options.managed-models.locked.badge':       'Nur Pro',
    'options.managed-models.locked.upgrade-cta': 'Auf Pro upgraden',
    'options.byok-configs.heading':            'BYOK-Konfigurationen',
    'options.byok-configs.description':        'Speichere mehrere BYOK-Konfigurationen (OpenAI-kompatibel / lokales LiteLLM) und wechsle zur Laufzeit zwischen ihnen.',
    'options.byok-configs.empty':              'Noch keine Konfigurationen. Klicke unten auf „+ Neue Konfiguration", um zu beginnen.',
    'options.byok-configs.loading':            'Lädt…',
    'options.byok-configs.active-suffix':      '· aktiv',
    'options.byok-configs.btn.new':            '+ Neue Konfiguration',
    'options.byok-configs.btn.edit':           'Bearbeiten',
    'options.byok-configs.btn.delete':         'Löschen',
    'options.byok-configs.btn.save':           'Speichern',
    'options.byok-configs.btn.cancel':         'Abbrechen',
    'options.byok-configs.confirm.delete':     'Konfiguration „{name}" löschen?',
    'options.byok-configs.field.preset.label': 'Voreinstellung',
    'options.byok-configs.field.preset.hint':  'Wähle eine Voreinstellung, um baseURL / Modell automatisch auszufüllen (überschreibt keine ausgefüllten Felder).',
    'options.byok-configs.field.name.label':   'Konfigurationsname',
    'options.byok-configs.field.name.hint':    '1-32 Zeichen, z.B. „Claude via LiteLLM" / „GPT-4o persönlich"',
    'options.byok-configs.field.baseURL.label':'Base URL',
    'options.byok-configs.field.baseURL.hint': 'OpenAI-kompatibler Endpunkt (https:// oder http://localhost)',
    'options.byok-configs.field.apiKey.label': 'API key',
    'options.byok-configs.field.apiKey.hint':  'Nur lokal gespeichert — wird nie an Supabase hochgeladen',
    'options.byok-configs.field.model.label':  'Modell',
    'options.byok-configs.field.model.hint':   'Modellname',
    'options.byok-configs.error.name':         'Der Name muss 1-32 Zeichen lang sein: Buchstaben, Ziffern, Leerzeichen, Bindestriche, Unterstriche, Punkte.',
    'options.byok-configs.error.baseURL':      'Base URL muss mit https:// beginnen oder http://localhost / http://127.0.0.1 sein.',
    'options.byok-configs.error.model':        'Modell ist erforderlich.',
    'options.byok-configs.error.apiKey':       'API key ist erforderlich.',
    'options.byok-configs.error.name-conflict':'Konfigurationsname existiert bereits. Wähle einen anderen Namen.',
    'options.byok-configs.set-active.aria':    'Als aktive Konfiguration festlegen',

    // Phase 13 — 顶栏 BYOK chip + popover (D-A / D-D / D-E)
    // (Phase 19 v1.4 hard cutover: 'topbar.byok-chip.no-active' DELETED — replaced by 'topbar.model-picker.chip.empty')
    'topbar.byok-chip.aria.active':                'Aktives Modell: {name}, {model}. Klicken zum Wechseln.',
    'topbar.byok-chip.aria.no-active':             'BYOK einrichten, um KI zu nutzen',
    'topbar.byok-popover.heading':                 'MODELL',
    'topbar.byok-popover.banner.unreachable':      '{name} antwortet nicht — Wrapper starten?',
    'topbar.byok-popover.banner.doc-link':         'Setup-Anleitung anzeigen →',
    'topbar.byok-popover.empty':                   'Keine gespeicherten Konfigurationen.',
    'topbar.byok-popover.btn.new':                 '+ Neue Konfiguration',
    'topbar.byok-popover.btn.manage-all':          'Alle verwalten →',
    'topbar.byok-popover.row.health.healthy':      'Gesund ({n} Modelle)',
    'topbar.byok-popover.row.health.unreachable':  'Antwortet nicht',
    // Phase 19 v1.4: model-picker cluster (de)
    'topbar.model-picker.aria.menu':                  'Modellauswahl',
    'topbar.model-picker.system.heading':             'SYSTEMMODELLE',
    'topbar.model-picker.system.login-prompt':        'Anmelden zum Entsperren',
    'topbar.model-picker.system.locked-upgrade-cta':  'Auf Pro upgraden',
    'topbar.model-picker.byok.heading':               'BYOK-KONFIGS',
    'topbar.model-picker.byok.region-label':          'BYOK-Konfigurationsliste',
    'topbar.model-picker.byok.empty':                 'Keine Konfigurationen',
    'topbar.model-picker.byok.signed-out-hint':       'Eigener Schlüssel — ohne Anmeldung',
    'topbar.model-picker.cta.new-config':             '+ Neue Konfiguration',
    'topbar.model-picker.cta.manage':                 'Verwalten',
    'topbar.model-picker.chip.empty':                 '+ Modell wählen',
    'topbar.model-picker.chip.signed-out':            '+ Anmelden / BYOK',
    // ── Add to Library button (Phase 28) ───────────────────────────────────
    'topbar.add-to-library.add':                     'Zur Bibliothek hinzufügen',
    'topbar.add-to-library.added':                   'Hinzugefügt',
    'topbar.add-to-library.confirm-remove-title':    'Aus Bibliothek entfernen?',
    'topbar.add-to-library.confirm-remove-body':     'Diese Arbeit wird aus deiner Bibliothek entfernt. Lokale Anmerkungen, Notizen und Cache bleiben auf diesem Gerät erhalten — nur der Bibliothekseintrag wird entfernt.',
    'topbar.add-to-library.confirm-remove-danger':   'Entfernen',
    'topbar.add-to-library.add-failed':              'Synchronisation mit deiner Bibliothek fehlgeschlagen, lokal gespeichert.',
    'options.byok-configs.row.health.healthy':     'Gesund',
    'options.byok-configs.row.health.unreachable': 'Antwortet nicht',
    'options.byok-configs.row.health.checking':    'Wird geprüft…',
    'options.byok-configs.row.active-pill':        'Aktiv',
    // Phase 16 D-E1 / D-E2 / D-E3 (de).
    'options.byok-presets.openai-compatible.label':                'OpenAI-kompatibel',
    'options.byok-presets.openai-compatible.chip.custom':          'Benutzerdefiniert',
    'options.byok-presets.openai-compatible.helpText.openai':      'Direkter OpenAI-API-Zugriff. Eigenen sk-…-Schlüssel verwenden.',
    'options.byok-presets.openai-compatible.helpText.openrouter':  'Multi-Modell-Gateway. Verwende das Format provider/model.',
    'options.byok-presets.openai-compatible.helpText.together':    'Together AI Inferenz. Llama / Mistral / Mixtral.',
    'options.byok-presets.openai-compatible.helpText.groq':        'Groq schnelle Inferenz (Llama, Mixtral).',
    'options.byok-presets.openai-compatible.helpText.deepseek':    'DeepSeek API. Auf Code-Aufgaben getunte Modelle.',
    'options.byok-presets.openai-compatible.helpText.custom':      'Beliebiger OpenAI-kompatibler Endpunkt. baseURL und model selbst eingeben.',

    'options.outputLang.label':       'Ausgabesprache',
    'options.outputLang.hint':        'Sprache, in der das Modell für Zusammenfassungen, Auswahl-Aktionen und Chat antwortet.',
    'options.ui_language.label':      'UI-Sprache',
    'options.ui_language.hint':       'Anzeigesprache der Extension · sofort wirksam, alle offenen Tabs synchron',
    'options.ui_language.auto':       'Auto · Browser folgen ({locale})',
    'options.save':                   'OK',
    'options.saving':                 'Speichert…',
    'options.saved':                  '✓ Gespeichert',
    'options.loading':                'Lädt…',

    'output.auto':                    'Auto · UI folgen ({ui})',
    'output.detect':                  'Aus Frage erkennen',
    // Tabs (redesign 260424)
    'tabs.overview':                   'Overview',
    'tabs.note':                       'Note',
    'tabs.memory':                     'Memory',

    // Chat history
    'chat.history.title':              'CONVERSATIONS',
    'chat.history.empty':              'No conversations yet.',
    'chat.history.emptyHint':          'Try asking about this paper.',
    'chat.history.deleted':            'Deleted',
    'chat.session.titleFallback':      'Chat #{seq}',
    'chat.welcome.intro':             'Ich habe das Paper gelesen. Frag mich alles — ich zitiere Absätze inline.',
    'chat.suggest.mechanism.section': 'Was ist der Kernmechanismus von §{section}?',
    'chat.suggest.mechanism.generic': 'Was ist der Kernmechanismus?',
    'chat.suggest.priorWork':         'Wie ist der Vergleich zu vorheriger Arbeit?',
    'chat.suggest.fail':              'Wo versagt es?',
    'chat.composer.placeholder':        'Frage zu diesem Paper stellen…',
    'chat.composer.placeholder.pinned': 'Stelle eine konkrete Frage oder drücke Enter…',

    // Note kinds
    'note.kinds.explain':              'Explain',
    'note.kinds.highlight':            'Highlight',
    'note.kinds.note':                 'Note',
    'note.kinds.translate':            'Translate',

    // Note empty states
    'note.empty.explain':              'No explanations yet.',
    'note.empty.highlight':            'No highlights yet.',
    'note.empty.note':                 'No notes yet.',
    'note.empty.translate':            'No translations yet.',

    // Note editor
    'note.editor.title':               'Note',
    'note.editor.placeholder':         'Write your note…',
    'note.editor.saveFailed':          'Save failed',

    // Delete toasts
    'delete.toast.session':            'Conversation deleted',
    'delete.toast.note':               'Note deleted',
    'delete.toast.highlight':          'Highlight deleted',
    'delete.toast.dismiss':            'Undo',

    // Highlight click popover
    'highlight.popover.remove':        'Remove highlight',
    'highlight.popover.aria':          'Highlight actions',

    // Shortcut migration toast
    'shortcut.toast.260424':           '⌘\\ now toggles the right panel (Outline retired).',

    // Actions
    'action.retry':                    'Retry',
    'action.cancel':                   'Cancel',
    'action.save':                     'Save',
    'action.saving':                   'Saving…',
    'action.viewSession':             'Sitzung anzeigen',
    'action.regenerate':              'Neu generieren',

    // AI errors
    'error.aiFailed':                  'AI reply failed',
    'error.aiAborted':                 'AI reply was interrupted',

    // Ghost rail
    'ghost.rail.label':                'Last visit: {n} notes · {h} highlights · {c} conversations',

    // Overview panel
    'overview.contributions.title':    'Core Contributions',
    'overview.keywords.title':         'Keywords',
    'overview.contents.title':         'Contents',
    'overview.contents.jumpHint':      'Jump to this section',
    'overview.info.title':             'Paper info',
    'overview.field.publishedAt':      'Published',
    'overview.field.authors':          'Authors',
    'overview.field.citations':        'Citations',
    'overview.field.field':            'Field',
    'overview.field.codeUrl':          'Code',
    'overview.unconfigured.title':     'Anmelden oder KI konfigurieren, um die Zusammenfassung zu aktivieren.',
    'overview.unconfigured.cta':       'Optionen öffnen',
    // Phase 21 v1.4: summary.error.* SCREAMING_SNAKE migration (de)
    'summary.error.prefix':              'Zusammenfassung fehlgeschlagen:',
    'summary.error.byok-misconfigured':  'API-Konfiguration unvollständig · bitte die Optionen öffnen.',
    'summary.error.QUOTA_EXCEEDED':      'Kostenloses Kontingent aufgebraucht.',
    'summary.error.TIER_NO_MANAGED_AI':  'Der Sync-Tarif enthält keine verwaltete KI · API-Schlüssel konfigurieren oder auf Pro upgraden.',
    'summary.error.RATE_LIMITED':        'Zu viele Anfragen · bitte in 1 Minute erneut versuchen.',
    'summary.error.UNAUTHENTICATED':     'Bitte anmelden oder den API-Schlüssel in den Optionen konfigurieren.',
    'summary.error.SERVER_ERROR':        'Dienst vorübergehend nicht verfügbar · bitte erneut versuchen.',
    'summary.error.TIMEOUT':             'KI-Anfrage zeitüberschritten · bitte erneut versuchen.',
    'summary.error.UNKNOWN':             'KI-Fehler · bitte erneut versuchen oder Optionen öffnen.',
    'summary.error.TIER_LOCKED':         'Dieses Modell erfordert einen höheren Tarif · auf Pro upgraden.',
    'summary.error.MODEL_NOT_FOUND':     'Ausgewähltes Modell nicht verfügbar · bitte ein anderes wählen.',
  },

  'es': {
    'login.headline':           'Desbloquear 20 pruebas AI gratuitas',
    'login.subheadline':        '+ Ver la misma Library / resaltados / Memory en todos los dispositivos',
    'login.google':             'Iniciar sesión con Google',
    'login.divider':            'o',
    'login.email.placeholder':  'Tu correo',
    'login.email.send':         'Enviar OTP',
    'login.email.resend':       'Reenviar ({n}s)',
    'login.otp.placeholder':    'Código 6 dígitos',
    'login.otp.verify':         'Verificar',
    'login.otp.expired':        'Código caducado o inválido',
    'login.error.rate_limit':  'Demasiadas solicitudes — espera un minuto e inténtalo de nuevo.',
    'login.error.invalid_email': 'El formato del correo no parece correcto — verifícalo e inténtalo.',
    'login.error.network':     'Error de red — comprueba tu conexión e inténtalo de nuevo.',
    'login.otp.send-new':       'Enviar nuevo código',
    'login.otp.title':         'Ingresar código de verificación',
    'login.otp.sent_to':       'Código enviado a {email}',
    'login.otp.spam_hint':     '¿No lo recibiste? Revisa tu carpeta de spam / promociones.',
    'login.otp.back':          '← Atrás',
    'login.otp.resend.ready':  'Reenviar código',
    'login.otp.resend.wait':   'Reenviar en ({n}s)',
    'login.byok.hint':          '¿Ya tienes una API key?',
    'login.byok.skip':          'Omitir · usar BYOK',

    'account.header':                 'Ajustes',
    'account.signedout.primary':      'Iniciar sesión · Sync + 20 pruebas AI',
    'account.byok.configured':        'BYOK configurado',
    'account.byok.notconfigured':     'No configurado',
    'account.tier.free':              'FREE',
    'account.tier.sync':              'SYNC',
    'account.tier.pro':               'PRO',
    'account.tier.ending':            '{tier} · finaliza el {date}',
    'account.trial.progress':         'Pruebas AI',
    'account.trial.remaining':        '{used} / {limit} · {remaining} restantes',
    'account.pro.monthly':            'AI este mes',
    'account.sync.hint':              'AI vía tu BYOK · ilimitado',
    'account.upgrade.pro':            '↑ Pasar a Pro · 12 $/mes',
    'account.upgrade.proFromSync':    '↑ Subir a Pro · +8 $/mes AI gestionado',
    'account.billing.manage':         'Facturación',
    'account.byok.settings':          'Ajustes BYOK',
    'account.switch':                 'Cambiar',
    'account.signout':                'Salir',
    'account.switch.confirm':         'Esta acción cierra la sesión actual y borra la configuración BYOK local y la caché de datos sincronizados',
    'account.switch.cancel':          'Cancelar',
    'account.language':               'Idioma',
    'account.language.aria':          'Abrir ajustes de idioma',

    'upgrade.label.freeTrialExhausted': 'Cuota gratuita agotada',
    'upgrade.headline.trial':         'Has usado las 20 pruebas AI gratuitas',
    'upgrade.headline.monthly':       'Has usado las 30000 llamadas AI gestionadas del mes',
    'upgrade.headline.library':       'Sync de Library alcanzó el límite gratuito de {limit} papers',
    'upgrade.free.name':              'Free',
    'upgrade.free.price':             '0 $/mes',
    'upgrade.free.features':          'Sync entre dispositivos ({limit} papers) · solo BYOK',
    'upgrade.free.cta':               'Configurar BYOK',
    'upgrade.subheadline':            'Elige un plan para seguir con PaperFlow AI',
    'upgrade.sync.name':              'Sync',
    'upgrade.sync.price':             '4 $/mes',
    'upgrade.sync.features':          'Sync entre dispositivos · Library ilimitada · AI vía BYOK',
    'upgrade.sync.cta':               'Elegir Sync',
    'upgrade.pro.name':               'Pro',
    'upgrade.pro.price':              '12 $/mes',
    'upgrade.pro.features':           'Sync entre dispositivos · 30000/mes AI gestionado · BYOK también',
    'upgrade.pro.recommended':        'Recomendado',
    'upgrade.pro.cta':                'Elegir Pro',
    'upgrade.diff':                   'AI gestionado: — (Sync) / 30000/mes (Pro)',
    'upgrade.byok':                   'Añade una OpenAI key para seguir gratis',
    'upgrade.later':                  'Después',

    'trial.hint':                     '{n} pruebas gratis restantes · añade una key o upgrade',

    'quota.free':                     'Free · {used}/{limit}',
    'quota.free.warn':                '⚠ Free · {used}/{limit}',
    'quota.free.critical':            'Free · 0 restantes',
    'quota.pro':                      'Pro · {used}/{limit}',
    'quota.sync':                     'Sync · BYOK',

    'libraryCap.text':                'Library en {used} / {limit} (límite gratis)',
    'libraryCap.hint':                'Papers existentes se mantienen · upgrade a Sync o Pro para añadir más',
    'libraryCap.upgrade':             'Upgrade',

    'library.jump.needsOriginalUrl':  'Abre este artículo una vez desde su URL original para habilitar el salto rápido.',

    'migration.banner':               '☁ Sincronizando {done} / {total} papers',
    'migration.banner.paused':        '⚠ Sync en pausa · clic para reintentar',
    'migration.banner.preprompt':     'Puede tardar un minuto, mantén abierto',
    'migration.success':              'Sincronizado · {papers} papers, {highlights} resaltados en la nube · Inicia sesión en otro dispositivo para verlos',
    'migration.readonly.hint':        'Sincronizando · solo lectura temporal',

    'migration.conflict.title':       'La Library en la nube ya tiene datos',
    'migration.conflict.local':       'Local: {n} papers',
    'migration.conflict.cloud':       'Nube: {n} papers',
    'migration.conflict.overlap':     'Solapamiento: {n} papers (en ambos)',
    'migration.conflict.merge':       '★ Combinar (recomendado) — mantener ambos; solapamiento usa la versión más nueva',
    'migration.conflict.local_only':  'Solo local (sobrescribe nube · pierde {n} papers de la nube)',
    'migration.conflict.cloud_only':  'Solo nube (borra local · pierde {n} papers locales)',

    'churn.headline':                 'Tu suscripción Pro ha terminado',
    'churn.body':                     'Tu cuota AI ha vuelto al tier gratuito (20 pruebas). Para restaurar Pro, visita el Billing Portal.',
    'churn.restore':                  'Restaurar',
    'churn.later':                    'Después',

    'error.500.byok':                 'Servicio con error · reintenta o cambia a BYOK',
    'error.500.nobyok':               'Servicio con error · reintenta o añade una OpenAI key',
    'error.timeout':                  'AI agotó tiempo (sin respuesta en 10 s) · reintentar',
    'error.429':                      'Demasiadas solicitudes, reintenta en 1 minuto',
    'error.403.sync':                 'El tier Sync no incluye AI gestionado · usa BYOK o sube a Pro',
    'error.auth':                     'Sesión expirada, inicia sesión de nuevo',

    'options.title':                  'Opciones PaperFlow',
    'options.intro':                  'Configuración Bring-your-own-key. Cualquier endpoint compatible con OpenAI funciona. Los valores se almacenan localmente en chrome.storage.local y nunca salen de este navegador.',
    'options.byok.baseURL.label':     'Base URL',
    'options.byok.baseURL.hint':      'p.ej. https://api.openai.com/v1',
    'options.byok.apiKey.label':      'API key',
    'options.byok.apiKey.hint':       'Tratada como secreto, mostrada como puntos.',
    'options.byok.model.label':       'Modelo',
    'options.byok.model.hint':        'p.ej. gpt-4.1-mini, claude-3-5-sonnet (vía proxy)',
    // Phase 15 D-A1 / D-D1 / D-F2: Modelos del sistema cluster.
    'options.managed-models.heading':            'Modelos del sistema',
    'options.managed-models.description':        'Modelos de IA gestionados por PaperFlow. Los modelos disponibles dependen de tu plan.',
    'options.managed-models.locked.badge':       'Solo Pro',
    'options.managed-models.locked.upgrade-cta': 'Actualizar a Pro',
    'options.byok-configs.heading':            'Configuraciones BYOK',
    'options.byok-configs.description':        'Guarda varias configuraciones BYOK (compatible con OpenAI / LiteLLM local) y cambia entre ellas en tiempo de ejecución.',
    'options.byok-configs.empty':              'Aún no hay configuraciones. Haz clic en "+ Nueva configuración" abajo para empezar.',
    'options.byok-configs.loading':            'Cargando…',
    'options.byok-configs.active-suffix':      '· activa',
    'options.byok-configs.btn.new':            '+ Nueva configuración',
    'options.byok-configs.btn.edit':           'Editar',
    'options.byok-configs.btn.delete':         'Eliminar',
    'options.byok-configs.btn.save':           'Guardar',
    'options.byok-configs.btn.cancel':         'Cancelar',
    'options.byok-configs.confirm.delete':     '¿Eliminar la configuración "{name}"?',
    'options.byok-configs.field.preset.label': 'Preajuste',
    'options.byok-configs.field.preset.hint':  'Elige un preajuste para autocompletar baseURL / modelo (no sobrescribe los campos rellenados).',
    'options.byok-configs.field.name.label':   'Nombre de la configuración',
    'options.byok-configs.field.name.hint':    '1-32 caracteres, p.ej. "Claude via LiteLLM" / "GPT-4o personal"',
    'options.byok-configs.field.baseURL.label':'Base URL',
    'options.byok-configs.field.baseURL.hint': 'Endpoint compatible con OpenAI (https:// o http://localhost)',
    'options.byok-configs.field.apiKey.label': 'API key',
    'options.byok-configs.field.apiKey.hint':  'Almacenada solo localmente — nunca sube a Supabase',
    'options.byok-configs.field.model.label':  'Modelo',
    'options.byok-configs.field.model.hint':   'Nombre del modelo',
    'options.byok-configs.error.name':         'El nombre debe tener 1-32 caracteres: letras, dígitos, espacios, guiones, guiones bajos, puntos.',
    'options.byok-configs.error.baseURL':      'Base URL debe empezar con https:// o ser http://localhost / http://127.0.0.1.',
    'options.byok-configs.error.model':        'Modelo requerido.',
    'options.byok-configs.error.apiKey':       'API key requerida.',
    'options.byok-configs.error.name-conflict':'El nombre de la configuración ya existe. Elige otro nombre.',
    'options.byok-configs.set-active.aria':    'Establecer como configuración activa',

    // Phase 13 — 顶栏 BYOK chip + popover (D-A / D-D / D-E)
    // (Phase 19 v1.4 hard cutover: 'topbar.byok-chip.no-active' DELETED — replaced by 'topbar.model-picker.chip.empty')
    'topbar.byok-chip.aria.active':                'Modelo activo: {name}, {model}. Clic para cambiar.',
    'topbar.byok-chip.aria.no-active':             'Configurar BYOK para usar IA',
    'topbar.byok-popover.heading':                 'MODELO',
    'topbar.byok-popover.banner.unreachable':      '{name} no responde — ¿iniciar el wrapper?',
    'topbar.byok-popover.banner.doc-link':         'Ver guía de instalación →',
    'topbar.byok-popover.empty':                   'No hay configuraciones guardadas.',
    'topbar.byok-popover.btn.new':                 '+ Nueva configuración',
    'topbar.byok-popover.btn.manage-all':          'Administrar todo →',
    'topbar.byok-popover.row.health.healthy':      'Saludable ({n} modelos)',
    'topbar.byok-popover.row.health.unreachable':  'No responde',
    // Phase 19 v1.4: model-picker cluster (es)
    'topbar.model-picker.aria.menu':                  'Selector de modelo',
    'topbar.model-picker.system.heading':             'MODELOS DEL SISTEMA',
    'topbar.model-picker.system.login-prompt':        'Inicia sesión para desbloquear',
    'topbar.model-picker.system.locked-upgrade-cta':  'Mejorar a Pro',
    'topbar.model-picker.byok.heading':               'CONFIGS BYOK',
    'topbar.model-picker.byok.region-label':          'Lista de configuraciones BYOK',
    'topbar.model-picker.byok.empty':                 'Sin configuraciones',
    'topbar.model-picker.byok.signed-out-hint':       'Trae tu clave — sin iniciar sesión',
    'topbar.model-picker.cta.new-config':             '+ Nueva configuración',
    'topbar.model-picker.cta.manage':                 'Gestionar',
    'topbar.model-picker.chip.empty':                 '+ Elegir modelo',
    'topbar.model-picker.chip.signed-out':            '+ Sesión / BYOK',
    // ── Add to Library button (Phase 28) ───────────────────────────────────
    'topbar.add-to-library.add':                     'Añadir a la biblioteca',
    'topbar.add-to-library.added':                   'Añadido',
    'topbar.add-to-library.confirm-remove-title':    '¿Quitar de la biblioteca?',
    'topbar.add-to-library.confirm-remove-body':     'Este artículo se eliminará de tu biblioteca. Las anotaciones, notas y la caché local se conservan en este dispositivo — solo se elimina la entrada de la biblioteca.',
    'topbar.add-to-library.confirm-remove-danger':   'Quitar',
    'topbar.add-to-library.add-failed':              'No se pudo sincronizar con tu biblioteca, pero se guardó localmente.',
    'options.byok-configs.row.health.healthy':     'Saludable',
    'options.byok-configs.row.health.unreachable': 'No responde',
    'options.byok-configs.row.health.checking':    'Comprobando…',
    'options.byok-configs.row.active-pill':        'Activo',
    // Phase 16 D-E1 / D-E2 / D-E3 (es).
    'options.byok-presets.openai-compatible.label':                'Compatible con OpenAI',
    'options.byok-presets.openai-compatible.chip.custom':          'Personalizado',
    'options.byok-presets.openai-compatible.helpText.openai':      'API OpenAI directa. Use su propia clave sk-….',
    'options.byok-presets.openai-compatible.helpText.openrouter':  'Pasarela multi-modelo. Use el formato provider/model.',
    'options.byok-presets.openai-compatible.helpText.together':    'Inferencia Together AI. Llama / Mistral / Mixtral.',
    'options.byok-presets.openai-compatible.helpText.groq':        'Inferencia rápida Groq (Llama, Mixtral).',
    'options.byok-presets.openai-compatible.helpText.deepseek':    'API DeepSeek. Modelos optimizados para código.',
    'options.byok-presets.openai-compatible.helpText.custom':      'Cualquier endpoint compatible con OpenAI. Rellene baseURL y model.',

    'options.outputLang.label':       'Idioma de salida',
    'options.outputLang.hint':        'Idioma en el que el modelo responde para resúmenes, acciones de selección y chat.',
    'options.ui_language.label':      'Idioma de la UI',
    'options.ui_language.hint':       'Idioma de visualización de la extensión · cambios al instante, todas las pestañas sincronizadas',
    'options.ui_language.auto':       'Auto · seguir el navegador ({locale})',
    'options.save':                   'OK',
    'options.saving':                 'Guardando…',
    'options.saved':                  '✓ Guardado',
    'options.loading':                'Cargando…',

    'output.auto':                    'Auto · seguir la UI ({ui})',
    'output.detect':                  'Detectar por la pregunta',
    // Tabs (redesign 260424)
    'tabs.overview':                   'Overview',
    'tabs.note':                       'Note',
    'tabs.memory':                     'Memory',

    // Chat history
    'chat.history.title':              'CONVERSATIONS',
    'chat.history.empty':              'No conversations yet.',
    'chat.history.emptyHint':          'Try asking about this paper.',
    'chat.history.deleted':            'Deleted',
    'chat.session.titleFallback':      'Chat #{seq}',
    'chat.welcome.intro':             'He leído el artículo. Pregunta lo que quieras — citaré los párrafos en línea.',
    'chat.suggest.mechanism.section': '¿Cuál es el mecanismo central de §{section}?',
    'chat.suggest.mechanism.generic': '¿Cuál es el mecanismo central?',
    'chat.suggest.priorWork':         '¿Cómo se compara con trabajos previos?',
    'chat.suggest.fail':              '¿Dónde falla?',
    'chat.composer.placeholder':        'Pregunta sobre este artículo…',
    'chat.composer.placeholder.pinned': 'Pregunta algo específico, o pulsa Enter…',

    // Note kinds
    'note.kinds.explain':              'Explain',
    'note.kinds.highlight':            'Highlight',
    'note.kinds.note':                 'Note',
    'note.kinds.translate':            'Translate',

    // Note empty states
    'note.empty.explain':              'No explanations yet.',
    'note.empty.highlight':            'No highlights yet.',
    'note.empty.note':                 'No notes yet.',
    'note.empty.translate':            'No translations yet.',

    // Note editor
    'note.editor.title':               'Note',
    'note.editor.placeholder':         'Write your note…',
    'note.editor.saveFailed':          'Save failed',

    // Delete toasts
    'delete.toast.session':            'Conversation deleted',
    'delete.toast.note':               'Note deleted',
    'delete.toast.highlight':          'Highlight deleted',
    'delete.toast.dismiss':            'Undo',

    // Highlight click popover
    'highlight.popover.remove':        'Remove highlight',
    'highlight.popover.aria':          'Highlight actions',

    // Shortcut migration toast
    'shortcut.toast.260424':           '⌘\\ now toggles the right panel (Outline retired).',

    // Actions
    'action.retry':                    'Retry',
    'action.cancel':                   'Cancel',
    'action.save':                     'Save',
    'action.saving':                   'Saving…',
    'action.viewSession':             'Ver sesión',
    'action.regenerate':              'Regenerar',

    // AI errors
    'error.aiFailed':                  'AI reply failed',
    'error.aiAborted':                 'AI reply was interrupted',

    // Ghost rail
    'ghost.rail.label':                'Last visit: {n} notes · {h} highlights · {c} conversations',

    // Overview panel
    'overview.contributions.title':    'Core Contributions',
    'overview.keywords.title':         'Keywords',
    'overview.contents.title':         'Contents',
    'overview.contents.jumpHint':      'Jump to this section',
    'overview.info.title':             'Paper info',
    'overview.field.publishedAt':      'Published',
    'overview.field.authors':          'Authors',
    'overview.field.citations':        'Citations',
    'overview.field.field':            'Field',
    'overview.field.codeUrl':          'Code',
    'overview.unconfigured.title':     'Inicia sesión o configura la IA para activar el resumen.',
    'overview.unconfigured.cta':       'Abrir Opciones',
    // Phase 21 v1.4: summary.error.* SCREAMING_SNAKE migration (es)
    'summary.error.prefix':              'Resumen fallido:',
    'summary.error.byok-misconfigured':  'Configuración de API incompleta · abre las Opciones.',
    'summary.error.QUOTA_EXCEEDED':      'Cuota gratuita agotada.',
    'summary.error.TIER_NO_MANAGED_AI':  'El plan Sync no incluye IA gestionada · configura tu clave API o actualiza a Pro.',
    'summary.error.RATE_LIMITED':        'Demasiadas solicitudes · vuelve a intentarlo en 1 minuto.',
    'summary.error.UNAUTHENTICATED':     'Inicia sesión o configura tu clave API en las Opciones.',
    'summary.error.SERVER_ERROR':        'Servicio temporalmente no disponible · vuelve a intentarlo.',
    'summary.error.TIMEOUT':             'Solicitud de IA agotada · vuelve a intentarlo.',
    'summary.error.UNKNOWN':             'Error de IA · vuelve a intentarlo o abre las Opciones.',
    'summary.error.TIER_LOCKED':         'Este modelo requiere un plan superior · actualiza para acceder.',
    'summary.error.MODEL_NOT_FOUND':     'Modelo seleccionado no disponible · elige otro.',
  },

  'ru': {
    'login.headline':           'Откройте 20 бесплатных AI-попыток',
    'login.subheadline':        '+ Одинаковая Library / выделения / Memory на всех устройствах',
    'login.google':             'Войти через Google',
    'login.divider':            'или',
    'login.email.placeholder':  'Ваш e-mail',
    'login.email.send':         'Отправить OTP',
    'login.email.resend':       'Повторно ({n}s)',
    'login.otp.placeholder':    '6-значный код',
    'login.otp.verify':         'Проверить',
    'login.otp.expired':        'Код истёк или недействителен',
    'login.error.rate_limit':  'Слишком много запросов — подождите минуту и повторите.',
    'login.error.invalid_email': 'Похоже, формат email некорректен — проверьте и повторите.',
    'login.error.network':     'Сетевая ошибка — проверьте соединение и повторите.',
    'login.otp.send-new':       'Отправить новый код',
    'login.otp.title':         'Введите код подтверждения',
    'login.otp.sent_to':       'Код отправлен на {email}',
    'login.otp.spam_hint':     'Не получили? Проверьте папку «Спам» / «Промоакции».',
    'login.otp.back':          '← Назад',
    'login.otp.resend.ready':  'Отправить код повторно',
    'login.otp.resend.wait':   'Повторно через ({n}с)',
    'login.byok.hint':          'Уже есть API key?',
    'login.byok.skip':          'Пропустить · BYOK',

    'account.header':                 'Настройки',
    'account.signedout.primary':      'Войти · Sync + 20 AI-попыток',
    'account.byok.configured':        'BYOK настроен',
    'account.byok.notconfigured':     'Не настроен',
    'account.tier.free':              'FREE',
    'account.tier.sync':              'SYNC',
    'account.tier.pro':               'PRO',
    'account.tier.ending':            '{tier} · окончание {date}',
    'account.trial.progress':         'AI-попытки',
    'account.trial.remaining':        '{used} / {limit} · осталось {remaining}',
    'account.pro.monthly':            'AI в этом месяце',
    'account.sync.hint':              'AI через BYOK · без лимита',
    'account.upgrade.pro':            '↑ Перейти на Pro · 12 $/мес',
    'account.upgrade.proFromSync':    '↑ На Pro · +8 $/мес управляемый AI',
    'account.billing.manage':         'Биллинг',
    'account.byok.settings':          'Настройки BYOK',
    'account.switch':                 'Сменить',
    'account.signout':                'Выйти',
    'account.switch.confirm':         'Это действие выйдет из текущего аккаунта и очистит локальную BYOK-конфигурацию и кэш синхронизированных данных',
    'account.switch.cancel':          'Отмена',
    'account.language':               'Язык',
    'account.language.aria':          'Открыть настройки языка',

    'upgrade.label.freeTrialExhausted': 'Бесплатная квота исчерпана',
    'upgrade.headline.trial':         'Вы использовали все 20 бесплатных AI-попыток',
    'upgrade.headline.monthly':       'Вы использовали 30000 управляемых AI-вызовов в этом месяце',
    'upgrade.headline.library':       'Sync Library достиг бесплатного лимита {limit} статей',
    'upgrade.free.name':              'Free',
    'upgrade.free.price':             '0 $/мес',
    'upgrade.free.features':          'Синхронизация устройств ({limit} статей) · только BYOK',
    'upgrade.free.cta':               'Настроить BYOK',
    'upgrade.subheadline':            'Выберите план, чтобы продолжить с PaperFlow AI',
    'upgrade.sync.name':              'Sync',
    'upgrade.sync.price':             '4 $/мес',
    'upgrade.sync.features':          'Синхронизация устройств · Library без лимита · AI через BYOK',
    'upgrade.sync.cta':               'Выбрать Sync',
    'upgrade.pro.name':               'Pro',
    'upgrade.pro.price':              '12 $/мес',
    'upgrade.pro.features':           'Синхронизация · 30000/мес управляемый AI · BYOK тоже',
    'upgrade.pro.recommended':        'Рекомендуется',
    'upgrade.pro.cta':                'Выбрать Pro',
    'upgrade.diff':                   'Управляемый AI: — (Sync) / 30000/мес (Pro)',
    'upgrade.byok':                   'Добавьте OpenAI key, чтобы продолжать бесплатно',
    'upgrade.later':                  'Позже',

    'trial.hint':                     'Осталось {n} бесплатных попыток · key или upgrade',

    'quota.free':                     'Free · {used}/{limit}',
    'quota.free.warn':                '⚠ Free · {used}/{limit}',
    'quota.free.critical':            'Free · 0 осталось',
    'quota.pro':                      'Pro · {used}/{limit}',
    'quota.sync':                     'Sync · BYOK',

    'libraryCap.text':                'Library {used} / {limit} (бесплатный лимит)',
    'libraryCap.hint':                'Существующие статьи сохранены · upgrade на Sync или Pro для добавления',
    'libraryCap.upgrade':             'Upgrade',

    'library.jump.needsOriginalUrl':  'Откройте эту статью один раз по исходной ссылке, чтобы включить быстрый переход из Library.',

    'migration.banner':               '☁ Синхронизация {done} / {total} статей',
    'migration.banner.paused':        '⚠ Sync приостановлен · нажмите для повтора',
    'migration.banner.preprompt':     'Может занять минуту, не закрывайте',
    'migration.success':              'Синхронизировано · {papers} статей, {highlights} выделений в облаке · Войдите на другом устройстве, чтобы их увидеть',
    'migration.readonly.hint':        'Синхронизация · временно только чтение',

    'migration.conflict.title':       'Library в облаке уже содержит данные',
    'migration.conflict.local':       'Локально: {n} статей',
    'migration.conflict.cloud':       'Облако: {n} статей',
    'migration.conflict.overlap':     'Пересечение: {n} статей (в обоих)',
    'migration.conflict.merge':       '★ Объединить (рекомендуется) — сохранить обе стороны; пересечения по новой версии',
    'migration.conflict.local_only':  'Только локально (перезапишет облако · потеряете {n} облачных статей)',
    'migration.conflict.cloud_only':  'Только облако (сотрёт локально · потеряете {n} локальных статей)',

    'churn.headline':                 'Ваша подписка Pro закончилась',
    'churn.body':                     'Ваша AI-квота вернулась к бесплатному уровню (20 попыток). Чтобы восстановить Pro, посетите Billing Portal.',
    'churn.restore':                  'Восстановить',
    'churn.later':                    'Позже',

    'error.500.byok':                 'Сбой сервиса · повторить или переключить на BYOK',
    'error.500.nobyok':               'Сбой сервиса · повторить или добавить OpenAI key',
    'error.timeout':                  'ИИ превысил время ожидания (нет ответа за 10 с) · повторить',
    'error.429':                      'Слишком много запросов, повторите через 1 минуту',
    'error.403.sync':                 'Уровень Sync не включает управляемый AI · используйте BYOK или upgrade на Pro',
    'error.auth':                     'Сессия истекла, войдите снова',

    'options.title':                  'Опции PaperFlow',
    'options.intro':                  'Конфигурация Bring-your-own-key. Подойдёт любая OpenAI-совместимая точка. Значения хранятся локально в chrome.storage.local и никогда не покидают этот браузер.',
    'options.byok.baseURL.label':     'Base URL',
    'options.byok.baseURL.hint':      'напр. https://api.openai.com/v1',
    'options.byok.apiKey.label':      'API key',
    'options.byok.apiKey.hint':       'Считается секретом, отображается точками.',
    'options.byok.model.label':       'Модель',
    'options.byok.model.hint':        'напр. gpt-4.1-mini, claude-3-5-sonnet (через прокси)',
    // Phase 15 D-A1 / D-D1 / D-F2: Системные модели cluster.
    'options.managed-models.heading':            'Системные модели',
    'options.managed-models.description':        'ИИ-модели, управляемые PaperFlow. Доступные модели зависят от вашей подписки.',
    'options.managed-models.locked.badge':       'Только Pro',
    'options.managed-models.locked.upgrade-cta': 'Перейти на Pro',
    'options.byok-configs.heading':            'Конфигурации BYOK',
    'options.byok-configs.description':        'Сохраните несколько конфигураций BYOK (совместимо с OpenAI / локальный LiteLLM) и переключайтесь между ними во время работы.',
    'options.byok-configs.empty':              'Конфигураций пока нет. Нажмите «+ Новая конфигурация» ниже, чтобы начать.',
    'options.byok-configs.loading':            'Загрузка…',
    'options.byok-configs.active-suffix':      '· активна',
    'options.byok-configs.btn.new':            '+ Новая конфигурация',
    'options.byok-configs.btn.edit':           'Изменить',
    'options.byok-configs.btn.delete':         'Удалить',
    'options.byok-configs.btn.save':           'Сохранить',
    'options.byok-configs.btn.cancel':         'Отмена',
    'options.byok-configs.confirm.delete':     'Удалить конфигурацию «{name}»?',
    'options.byok-configs.field.preset.label': 'Предустановка',
    'options.byok-configs.field.preset.hint':  'Выберите предустановку для автозаполнения baseURL / модели (заполненные поля не перезаписываются).',
    'options.byok-configs.field.name.label':   'Имя конфигурации',
    'options.byok-configs.field.name.hint':    '1-32 символа, напр. «Claude via LiteLLM» / «GPT-4o личная»',
    'options.byok-configs.field.baseURL.label':'Base URL',
    'options.byok-configs.field.baseURL.hint': 'OpenAI-совместимая точка (https:// или http://localhost)',
    'options.byok-configs.field.apiKey.label': 'API key',
    'options.byok-configs.field.apiKey.hint':  'Хранится только локально — никогда не загружается в Supabase',
    'options.byok-configs.field.model.label':  'Модель',
    'options.byok-configs.field.model.hint':   'Имя модели',
    'options.byok-configs.error.name':         'Имя конфигурации должно быть 1-32 символа: буквы, цифры, пробелы, дефисы, подчёркивания, точки.',
    'options.byok-configs.error.baseURL':      'Base URL должен начинаться с https:// или быть http://localhost / http://127.0.0.1.',
    'options.byok-configs.error.model':        'Модель обязательна.',
    'options.byok-configs.error.apiKey':       'API key обязателен.',
    'options.byok-configs.error.name-conflict':'Имя конфигурации уже существует. Выберите другое имя.',
    'options.byok-configs.set-active.aria':    'Сделать активной конфигурацией',

    // Phase 13 — 顶栏 BYOK chip + popover (D-A / D-D / D-E)
    // (Phase 19 v1.4 hard cutover: 'topbar.byok-chip.no-active' DELETED — replaced by 'topbar.model-picker.chip.empty')
    'topbar.byok-chip.aria.active':                'Активная модель: {name}, {model}. Нажмите для переключения.',
    'topbar.byok-chip.aria.no-active':             'Настройте BYOK для использования ИИ',
    'topbar.byok-popover.heading':                 'МОДЕЛЬ',
    'topbar.byok-popover.banner.unreachable':      '{name} не отвечает — запустить wrapper?',
    'topbar.byok-popover.banner.doc-link':         'Открыть руководство →',
    'topbar.byok-popover.empty':                   'Нет сохранённых конфигураций.',
    'topbar.byok-popover.btn.new':                 '+ Новая конфигурация',
    'topbar.byok-popover.btn.manage-all':          'Управлять всеми →',
    'topbar.byok-popover.row.health.healthy':      'Работает ({n} моделей)',
    'topbar.byok-popover.row.health.unreachable':  'Не отвечает',
    // Phase 19 v1.4: model-picker cluster (ru)
    'topbar.model-picker.aria.menu':                  'Выбор модели',
    'topbar.model-picker.system.heading':             'СИСТЕМНЫЕ МОДЕЛИ',
    'topbar.model-picker.system.login-prompt':        'Войдите для разблокировки',
    'topbar.model-picker.system.locked-upgrade-cta':  'Перейти на Pro',
    'topbar.model-picker.byok.heading':               'КОНФИГИ BYOK',
    'topbar.model-picker.byok.region-label':          'Список конфигураций BYOK',
    'topbar.model-picker.byok.empty':                 'Нет конфигураций',
    'topbar.model-picker.byok.signed-out-hint':       'Свой ключ — без входа',
    'topbar.model-picker.cta.new-config':             '+ Новая конфигурация',
    'topbar.model-picker.cta.manage':                 'Управление',
    'topbar.model-picker.chip.empty':                 '+ Выбрать модель',
    'topbar.model-picker.chip.signed-out':            '+ Вход / BYOK',
    // ── Add to Library button (Phase 28) ───────────────────────────────────
    'topbar.add-to-library.add':                     'Добавить в библиотеку',
    'topbar.add-to-library.added':                   'Добавлено',
    'topbar.add-to-library.confirm-remove-title':    'Убрать из библиотеки?',
    'topbar.add-to-library.confirm-remove-body':     'Эта статья будет удалена из вашей библиотеки. Локальные выделения, заметки и кэш остаются на этом устройстве — удаляется только запись из библиотеки.',
    'topbar.add-to-library.confirm-remove-danger':   'Убрать',
    'topbar.add-to-library.add-failed':              'Не удалось синхронизировать с библиотекой, но сохранено локально.',
    'options.byok-configs.row.health.healthy':     'Работает',
    'options.byok-configs.row.health.unreachable': 'Не отвечает',
    'options.byok-configs.row.health.checking':    'Проверка…',
    'options.byok-configs.row.active-pill':        'Активна',
    // Phase 16 D-E1 / D-E2 / D-E3 (ru).
    'options.byok-presets.openai-compatible.label':                'Совместимо с OpenAI',
    'options.byok-presets.openai-compatible.chip.custom':          'Произвольно',
    'options.byok-presets.openai-compatible.helpText.openai':      'Прямой OpenAI API. Используйте свой ключ sk-….',
    'options.byok-presets.openai-compatible.helpText.openrouter':  'Шлюз для нескольких моделей. Используйте формат provider/model.',
    'options.byok-presets.openai-compatible.helpText.together':    'Инференс Together AI. Llama / Mistral / Mixtral.',
    'options.byok-presets.openai-compatible.helpText.groq':        'Быстрый инференс Groq (Llama, Mixtral).',
    'options.byok-presets.openai-compatible.helpText.deepseek':    'API DeepSeek. Модели, настроенные на задачи кодирования.',
    'options.byok-presets.openai-compatible.helpText.custom':      'Любой OpenAI-совместимый endpoint. Заполните baseURL и model вручную.',

    'options.outputLang.label':       'Язык вывода',
    'options.outputLang.hint':        'Язык, на котором модель отвечает для резюме, действий выделения и чата.',
    'options.ui_language.label':      'Язык интерфейса',
    'options.ui_language.hint':       'Язык отображения расширения · применяется мгновенно, все вкладки синхронны',
    'options.ui_language.auto':       'Auto · по браузеру ({locale})',
    'options.save':                   'OK',
    'options.saving':                 'Сохр.…',
    'options.saved':                  '✓ Сохр.',
    'options.loading':                'Загрузка…',

    'output.auto':                    'Auto · по UI ({ui})',
    'output.detect':                  'По языку вопроса',
    // Tabs (redesign 260424)
    'tabs.overview':                   'Overview',
    'tabs.note':                       'Note',
    'tabs.memory':                     'Memory',

    // Chat history
    'chat.history.title':              'CONVERSATIONS',
    'chat.history.empty':              'No conversations yet.',
    'chat.history.emptyHint':          'Try asking about this paper.',
    'chat.history.deleted':            'Deleted',
    'chat.session.titleFallback':      'Chat #{seq}',
    'chat.welcome.intro':             'Я прочитал статью. Спрашивайте что угодно — буду цитировать абзацы.',
    'chat.suggest.mechanism.section': 'Каков основной механизм §{section}?',
    'chat.suggest.mechanism.generic': 'Каков основной механизм?',
    'chat.suggest.priorWork':         'Чем отличается от предыдущих работ?',
    'chat.suggest.fail':              'В чём не работает?',
    'chat.composer.placeholder':        'Задайте вопрос о статье…',
    'chat.composer.placeholder.pinned': 'Спросите что-то конкретное или нажмите Enter…',

    // Note kinds
    'note.kinds.explain':              'Explain',
    'note.kinds.highlight':            'Highlight',
    'note.kinds.note':                 'Note',
    'note.kinds.translate':            'Translate',

    // Note empty states
    'note.empty.explain':              'No explanations yet.',
    'note.empty.highlight':            'No highlights yet.',
    'note.empty.note':                 'No notes yet.',
    'note.empty.translate':            'No translations yet.',

    // Note editor
    'note.editor.title':               'Note',
    'note.editor.placeholder':         'Write your note…',
    'note.editor.saveFailed':          'Save failed',

    // Delete toasts
    'delete.toast.session':            'Conversation deleted',
    'delete.toast.note':               'Note deleted',
    'delete.toast.highlight':          'Highlight deleted',
    'delete.toast.dismiss':            'Undo',

    // Highlight click popover
    'highlight.popover.remove':        'Remove highlight',
    'highlight.popover.aria':          'Highlight actions',

    // Shortcut migration toast
    'shortcut.toast.260424':           '⌘\\ now toggles the right panel (Outline retired).',

    // Actions
    'action.retry':                    'Retry',
    'action.cancel':                   'Cancel',
    'action.save':                     'Save',
    'action.saving':                   'Saving…',
    'action.viewSession':             'Просмотреть сессию',
    'action.regenerate':              'Перегенерировать',

    // AI errors
    'error.aiFailed':                  'AI reply failed',
    'error.aiAborted':                 'AI reply was interrupted',

    // Ghost rail
    'ghost.rail.label':                'Last visit: {n} notes · {h} highlights · {c} conversations',

    // Overview panel
    'overview.contributions.title':    'Core Contributions',
    'overview.keywords.title':         'Keywords',
    'overview.contents.title':         'Contents',
    'overview.contents.jumpHint':      'Jump to this section',
    'overview.info.title':             'Paper info',
    'overview.field.publishedAt':      'Published',
    'overview.field.authors':          'Authors',
    'overview.field.citations':        'Citations',
    'overview.field.field':            'Field',
    'overview.field.codeUrl':          'Code',
    'overview.unconfigured.title':     'Войдите или настройте ИИ, чтобы включить сводку.',
    'overview.unconfigured.cta':       'Открыть настройки',
    // Phase 21 v1.4: summary.error.* SCREAMING_SNAKE migration (ru)
    'summary.error.prefix':              'Ошибка создания сводки:',
    'summary.error.byok-misconfigured':  'Конфигурация API неполная · откройте настройки.',
    'summary.error.QUOTA_EXCEEDED':      'Бесплатный лимит исчерпан.',
    'summary.error.TIER_NO_MANAGED_AI':  'Тариф Sync не включает управляемый ИИ · настройте API-ключ или перейдите на Pro.',
    'summary.error.RATE_LIMITED':        'Слишком много запросов · повторите через 1 минуту.',
    'summary.error.UNAUTHENTICATED':     'Войдите или настройте API-ключ в настройках.',
    'summary.error.SERVER_ERROR':        'Сервис временно недоступен · повторите попытку.',
    'summary.error.TIMEOUT':             'Время ожидания запроса ИИ истекло · повторите попытку.',
    'summary.error.UNKNOWN':             'Ошибка ИИ · повторите попытку или откройте настройки.',
    'summary.error.TIER_LOCKED':         'Эта модель требует более высокий тариф · повысьте уровень для доступа.',
    'summary.error.MODEL_NOT_FOUND':     'Выбранная модель недоступна · выберите другую.',
  },
}

// ---- Locale detection ----

// [Phase 22 I18N-04] mapToSupportedLocale: extracted from inline mapping at
// 2613-2619 to be shared across detection chain steps. Module-private
// helper (no export). Returns null when raw doesn't fold to any of the 9
// supported locales — caller decides fallback. D-04 frozen: never widens
// beyond the 9-locale Locale union.
//
// Security: this function is the whitelist gate per T-22-01. OS-controlled
// BCP-47 strings from chrome.i18n.getUILanguage() / navigator.language can
// only fold to one of the 9 known Locale literals or null. No injection
// path into messages map or storage.
function mapToSupportedLocale(raw: string | undefined): Locale | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.includes('hant')) return 'zh-TW'
  if (lower.startsWith('zh')) return 'zh-CN'
  const base = lower.split('-')[0]
  const known: Record<string, Locale> = {
    en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es', ru: 'ru',
  }
  return known[base] ?? null
}

// [Phase 22 I18N-04] detectInitialLocale: 3-step fallback chain.
//   Step 1: navigator.language (page accept-language)
//   Step 2: chrome.i18n.getUILanguage() (OS / Chrome UI lang) — extension
//           page only; defensive guard handles jsdom + service worker
//           edge cases (Pitfall 1).
//   Step 3: 'en' hard fallback.
//
// Sync contract preserved (D13): callable at module-load before first
// React render. Outer try/catch returns 'en' on any throw at any step.
export function detectInitialLocale(): Locale {
  try {
    // Step 1: navigator.language
    const navLang = typeof navigator !== 'undefined' ? navigator.language : undefined
    const fromNav = mapToSupportedLocale(navLang)
    if (fromNav) return fromNav

    // Step 2: chrome.i18n.getUILanguage() — OS / Chrome UI lang.
    // Defensive guard: jsdom test env + MV3 service worker context lack
    // chrome.i18n; mirror the existing chrome.storage.local guard idiom.
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
      const uiLang = chrome.i18n.getUILanguage()
      const fromUi = mapToSupportedLocale(uiLang)
      if (fromUi) return fromUi
    }

    // Step 3: hard fallback
    return 'en'
  } catch {
    return 'en'
  }
}

// Synchronous bootstrap — first paint never sees `undefined`.
let currentLocale: Locale = detectInitialLocale()

// ---- Reactivity ----

const subscribers = new Set<() => void>()
function notify() {
  // D9: keep <html lang> in sync so screen readers, :lang() CSS, and browser
  // spell-check use the right dictionary.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = currentLocale
  }
  // D18: subscriber error isolation — one buggy callback must not starve others.
  subscribers.forEach((cb) => {
    try { cb() } catch (e) { console.warn('[i18n] subscriber failed', e) }
  })
}

// ---- Async reconciliation + en-US migration ----

void (async () => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  try {
    const stored = await chrome.storage.local.get('config_uiLanguage')
    const raw = stored.config_uiLanguage as string | undefined

    // One-time migration from the old 'en-US' code (D2).
    if (raw === 'en-US') {
      await chrome.storage.local.set({ config_uiLanguage: 'en' })
      if (currentLocale !== 'en') { currentLocale = 'en'; notify() }
      return
    }
    // Returning user with an explicit choice — adopt it if different.
    if (raw && raw in messages && raw !== currentLocale) {
      currentLocale = raw as Locale
      notify()
    }
    // Otherwise: no stored value (new user) or unknown value — keep detection.
  } catch {
    // Storage read failed — keep detected locale.
  }
})()

// Cross-tab sync (D9). Listener calls notify() so all open surfaces re-render.
// [Phase 22 D-07] Adds newValue===undefined branch handling another tab's
// setLocale('auto') (which calls chrome.storage.local.remove(...)).
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.config_uiLanguage) return
    const v = changes.config_uiLanguage.newValue

    // Existing branch — another tab adopted explicit locale.
    if (typeof v === 'string' && v in messages && v !== currentLocale) {
      currentLocale = v as Locale
      notify()
      return
    }

    // [Phase 22 D-07] another tab triggered 'auto' → key removed.
    if (v === undefined) {
      const detected = detectInitialLocale()
      if (detected !== currentLocale) {
        currentLocale = detected
        notify()
      }
    }
  })
}

// Module-load notify (D9 / 1D): make <html lang> match the synchronous detect
// before the first React render. subscribers Set is empty here — only the
// document.lang side-effect fires.
notify()

// ---- Public API ----

export function getLocale(): Locale { return currentLocale }

// [Phase 22 D-05 + D-06] setLocale signature widens to Locale | 'auto'.
// Locale path: existing behavior unchanged (write storage + notify).
// 'auto' path: removeItem + re-detect + notify, all in same tick.
//
// Pitfall 5 mitigation (RESEARCH Q#1): always notify() on 'auto' branch
// even when detect lands on currentLocale, because Options dropdown's
// 'auto' selected state is keyed off storage absence (storedUi ===
// undefined), not currentLocale. The Options page's own onChanged
// listener for config_uiLanguage will receive newValue===undefined and
// call setStoredUi(undefined) → dropdown re-renders with 'auto' selected.
export async function setLocale(l: Locale | 'auto'): Promise<void> {
  if (l === 'auto') {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        await chrome.storage.local.remove('config_uiLanguage')
      } catch (e) {
        console.warn('[i18n] setLocale auto removeItem failed', e)
      }
    }
    const detected = detectInitialLocale()
    if (detected !== currentLocale) currentLocale = detected
    notify()  // always notify — see Pitfall 5 mitigation note above
    return
  }

  // l ∈ Locale — existing path unchanged.
  if (l === currentLocale) return
  currentLocale = l
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ config_uiLanguage: l })
    } catch (e) {
      console.warn('[i18n] setLocale storage write failed', e)
    }
  }
  notify()
}

/**
 * React hook: subscribes the calling component to locale changes.
 * Returns the global `t` function unchanged (identity stable across re-renders).
 *
 * NOTE: do NOT add the returned `t` to a useEffect deps array — its identity
 * never changes, so locale changes won't re-fire the effect. If you need to
 * react to locale specifically, watch `getLocale()` via your own subscription.
 */
export function useT(): typeof t {
  useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => { subscribers.delete(cb) }
    },
    () => currentLocale,
    () => currentLocale,  // server snapshot — not used in MV3, but required for SSR safety
  )
  return t
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  let msg = messages[currentLocale][key] ?? messages['en'][key] ?? messages['zh-CN'][key] ?? key
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  return msg
}

// Test-only: expose internals for unit tests. NOT part of the public API.
export const __testing = { messages, subscribers }
