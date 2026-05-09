# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

Build a Chrome extension paper reader based on the existing prototype. The prototype (`docs/prototype/PaperFlow Reader.html`) is archived as the historical UI reference — the Chrome extension (`chrome-extension/`) is now the source of truth and has diverged from the prototype. See `docs/specs/2026-04-20-spec-chrome-extension.md` for the full extension spec.

## Directory Structure

```
PaperFlow-Design/
├── chrome-extension/       # The actual product — Vite-built MV3 extension (source of truth)
├── supabase/               # Postgres migrations + Edge Functions (auth, AI proxy, Stripe webhook)
├── docs/
│   ├── specs/              # Feature specs (e.g. 2026-04-20-spec-chrome-extension.md)
│   ├── plans/              # Implementation plans
│   ├── reviews/            # Code/design reviews
│   └── prototype/          # Archived no-bundler React prototype (UI reference, not built/shipped)
│       ├── PaperFlow Reader.html
│       ├── components/     # JSX components loaded via Babel standalone
│       └── styles/tokens.css
├── scripts/                # Build / worktree-init helpers
└── DESIGN.md               # Design decisions and rationale
```

## Document Language

## Running the archived prototype

The prototype under `docs/prototype/` is kept as a UI reference. It is **not** built or shipped — for current behaviour, run the extension. To open the prototype:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/docs/prototype/PaperFlow%20Reader.html
```

Do not open the HTML directly via `file://` — the browser will block cross-origin JSX script loads. Note that `docs/prototype/styles/tokens.css` has diverged from `chrome-extension/reader/styles/tokens.css` (the latter is authoritative).

## Chrome Extension build modes (dev vs prod)

Vite mode-loaded env files split which Supabase the bundle points at. **Default to `build:dev` for everything except release validation** — see policy below.

```bash
cd chrome-extension

# Local Supabase (default for dev / test / iteration)
npm run build:dev      # one-shot
npm run dev:local      # watch mode

# Hosted Supabase (only for release validation / pre-ship smoke)
npm run build          # one-shot
npm run dev            # watch mode
```

After every build, `chrome://extensions/` → PaperFlow → 🔄 reload.

### Policy

- **Daily development, unit / integration tests, refactor, debugging** → `build:dev` (local Supabase). Faster, safer, no risk of trashing production data, no quota spend.
- **Release validation only** → `build` (hosted). Use right before merging / shipping to confirm the production wiring still works end-to-end. Don't iterate on `build` — it's a verification gate, not a workflow.
- **Never** push `dist/` or test against hosted while developing core features. Hosted = customer-facing.

### Visible env indicator

Every dev build renders an orange **`DEV`** pill next to the `PaperFlow` logo in the reader top-bar (gated on `import.meta.env.MODE !== 'production'`, dead-code-eliminated in prod). Hover the pill for the full Supabase URL. Console also logs `[paperflow] supabase env: <URL> · <mode>` once at reader load. **If you don't see the DEV pill, your loaded extension is the hosted build** — re-run `npm run build:dev` and reload.

### Env files

| File | Status | Purpose |
|---|---|---|
| `chrome-extension/.env.local` | gitignored | Default config — currently hosted values + shared `PF_EVAL_*` |
| `chrome-extension/.env.development.local` | gitignored | Override for `--mode development`: `VITE_SUPABASE_URL=http://127.0.0.1:54321` + local demo anon key |

Vite load order: `.env` < `.env.local` < `.env.[mode]` < `.env.[mode].local` (later overrides earlier). `vite build` defaults to `mode=production`, `vite build --mode development` (= `npm run build:dev`) layers `.env.development.local` on top of `.env.local`.

### Local Supabase prerequisite

`build:dev` only works with a running local stack:

```bash
supabase start                                       # Postgres + Auth + Realtime
supabase functions serve --env-file ./supabase/.env  # Edge Functions
```

Without these, the extension built with `--mode development` will hang on auth, AI calls, sync — not a bug, just a missing backend.

## Working in a fresh git worktree

If you are operating inside a `git worktree add`-created worktree (e.g. spawned with `isolation: "worktree"`), `chrome-extension/node_modules/` will be empty — `node_modules` is gitignored and is NOT shared between worktrees. Two ways to bootstrap:

**Manual** — run once per fresh worktree:

```bash
bash scripts/worktree-init.sh   # runs npm ci inside chrome-extension/
```

**Automatic via git hook** — point git at the repo's tracked `.githooks/`:

```bash
git config core.hooksPath .githooks   # one-time per clone
```

Then `git worktree add ...` triggers `.githooks/post-checkout`, which calls `scripts/worktree-init.sh` automatically when it detects an empty `node_modules`. Idempotent — safe to re-run; skipped on normal `git checkout` in an already-bootstrapped tree.

## Releasing the extension (zip + load unpacked)

公司内部 / 朋友试用的发版流程。同事拿到 zip 后通过 `chrome://extensions/` → 开发者模式 → "Load unpacked" 安装。**不走 Chrome Web Store**，也不走 `.crx` 自托管（MV3 下非 Web Store 的 .crx 默认会被禁用，除非配 enterprise policy，对内部小团队不划算）。

```bash
cd chrome-extension
npm run bump patch      # 0.1.0 → 0.1.1（也可用 minor / major / 显式 x.y.z）
npm run release         # → chrome-extension/paperflow-v{version}.zip
git push && git push v{version}
```

### `npm run bump <patch|minor|major|x.y.z>` (`scripts/bump.mjs`)

- 同步 `manifest.json` + `package.json` 的 `version` 字段
- `git commit manifest.json package.json -m "chore: bump version to v{version}"`（pathspec 形式，**不会**把其他未提交改动一起带进去）
- 打 tag `v{version}`
- 两文件版本若已不同步、或当前不是合法 semver、或参数非法 → 退出
- 不在 git 仓库时跳过 commit/tag，只改文件

### `npm run release` (`scripts/release.sh`)

- 强制 `rm -rf dist`，然后 `npm run build`（生产模式，hosted Supabase）
- `manifest.json` 与 `package.json` 版本不一致 → 退出
- `dist/assets/` 里 grep 到本地 Supabase URL `127.0.0.1:54321` → 退出（说明是 `build:dev` 输出）
- `dist/manifest.json` 或 `dist/icons/` 缺失 → 退出
- zip `dist/` → `paperflow-v{version}.zip`（已 gitignored，**不要**提交 artifact）

### 安装步骤（发给同事的话术）

1. 解压 `paperflow-v{version}.zip`
2. 打开 `chrome://extensions/`
3. 右上角开"开发者模式 / Developer mode"
4. 点"加载已解压的扩展程序 / Load unpacked"，选解压后的文件夹

Chrome 启动时会有黄条警告 "disable developer mode extensions" — 这是非 Web Store 安装的正常提示，可关掉。

### Artifact 托管

zip 文件不进 git。挂到内网共享 / GitHub Release / S3 / 公司云盘等地方让同事下载。tag 推上去后可以用 GitHub Release UI 把 zip 附加到对应 tag 上。

## 双仓策略：私有开发 + 公开镜像

仓库分两边：

| 仓 | 用途 | 包含 |
|---|---|---|
| **`machuw/PaperFlow-Design`**（私有，本地 origin） | 全保真开发 | 所有内容，包括 `.planning/`、`.superpowers/`、内部 runbook、真实 Supabase ref |
| **`machuw/PaperFlow`**（公开） | 开源镜像 | 仅 tracked code + docs/、scripts/，已 scrub 真实 ref |

公开仓是 snapshot 镜像 —— 每次 sync 一个 commit，**不带历史**、不带内部规划文档。私有仓继续走 PR-per-phase 流程；公开仓只在你想发布时手动同步。

```bash
# 私有仓有新进展、想公开时
bash scripts/sync-public.sh             # 真同步
bash scripts/sync-public.sh --dry-run   # 看 diff 不 push
```

`scripts/sync-public.sh` 的过滤规则（仅 tracked 文件、已自动排除 `.env*`/`dist.pem`/`node_modules`/`paperflow-v*.zip`/`AGENTS.md`/`.agents/` 等所有 gitignored 内容）：

- 排除目录：`.planning/`、`.superpowers/`
- 文本替换：真实 Supabase project ref → `<ref>` 占位符
- 安全网：commit 前 grep 校验 leak pattern，命中即 abort

镜像 checkout 在 `.public-mirror/`（gitignored，可随时删，下次 sync 会重 clone）。

如果以后增加新的敏感模式（比如换了真实 ref、加了新 Stripe price ID），改 `scripts/sync-public.sh` 顶部的 `SUPABASE_REF` / `LEAK_PATTERNS` 即可。

## Architecture (archived prototype, `docs/prototype/`)

The prototype is a **no-bundler React prototype** using Babel standalone for in-browser JSX transpilation. All components are loaded as `<script type="text/babel">` tags in `docs/prototype/PaperFlow Reader.html`. It is kept for UI reference only — the Chrome extension under `chrome-extension/` has diverged and is the source of truth.

**Component load order matters** — each file exposes its component on `window.*` and the next file may depend on it. The order in the HTML is the dependency order.

### Three layout variants (controlled by `variant` state in `viewer-app.jsx`)

- **focus** — paper + margin notes column; AI results anchor to their source paragraph
- **classic** — paper + right-side `WorkspacePanel` drawer
- **canvas** — full-screen `CanvasView`, replaces the reader entirely

### Data flow

`window.PAPER` (set in `paper-data.jsx`) is the single source of truth — a static mock paper object passed as props throughout. There is no real backend; AI responses are hardcoded in `generateBody()` in `viewer-app.jsx`.

### Design tokens

All colors, typography, spacing, and shadows live in `docs/prototype/styles/tokens.css` as CSS custom properties (the extension has its own copy at `chrome-extension/reader/styles/tokens.css`, which is authoritative and has diverged). Light/dark theme is toggled via `data-theme` attribute on `<html>`. The warm paper aesthetic uses `--paper`, `--ink`, `--walnut`, `--foxglove`, `--forest`, `--sky` as the accent palette.

### Key interaction patterns

- Text selection → `SelectionToolbar` floats → action (E/S/T/H keys or click) → `runAction()` in `viewer-app.jsx`
- In **focus** variant, results render as `MarginNote` components anchored to source paragraph via `data-pid` DOM lookup
- In **classic** variant, results render inside `WorkspacePanel`
- `⌘K` opens command palette (`CmdK` overlay), `⌘\` toggles outline, `⌘L` opens library drawer
- Tweaks (font, page width, grain, margins) persist to `localStorage` under `pf-tweaks`

## Coding Guidelines

### Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If something is unclear, stop and ask.

### Simplicity First
- Minimum code that solves the problem. Nothing speculative.
- No abstractions for single-use code, no unrequested flexibility.
- If you write 200 lines and it could be 50, rewrite it.

### Surgical Changes
- Touch only what you must. Don't improve adjacent code.
- Match existing style. Mention unrelated dead code — don't delete it.
- Every changed line should trace directly to the user's request.

### Goal-Driven Execution
- Define verifiable success criteria before implementing.
- For multi-step tasks, state a brief plan with a verify step for each.

## Documentation

All generated docs go under `docs/`, organized by type:

| Type | Directory | Naming |
|------|-----------|--------|
| Specs | `docs/specs/` | `{YYYY-MM-DD}-spec-{feature-slug}.md` |
| Plans | `docs/plans/` | `{YYYY-MM-DD}-plan-{feature-slug}.md` |
| Reviews | `docs/reviews/` | `{YYYY-MM-DD}-review-{feature-slug}.md` |

## Testing

E2E 测试统一用 **Playwright CLI**（`npx playwright test`），不要使用 Playwright MCP（`mcp__...__playwright__*`）工具。CLI 跑出来的 spec 是可入库、可在 CI 跑、可 diff、可复现的持久化产物；MCP 只是当前会话内的一次性浏览器操作，留不下产物，且每次重跑都要消耗对话上下文。

新的 E2E 用例放进 `chrome-extension/tests/e2e/`。只在需要单次手动探索（截一张图、确认某个具体页面状态）且明显不值得写成持久化用例时，才考虑 MCP。

### SPEC §8 / 验收 / 手测 checklist —— 默认自动跑

收尾阶段的 acceptance / smoke checklist（典型例子：SPEC §8 多项验收、Phase D 手测列表）**默认用 `playwright-cli` skill 自动跑完**，不要把它当成"用户的活"打包推给对方。验证完整闭环（chrome.storage seed → 触发 UI → 断言结果）只需要几分钟。

执行套路（已在 Phase 27 D2 验证）：

```bash
# 1) 干净 dev build（incremental 经常跳过 reader 当 tsx mtime 早于 dist）
cd chrome-extension && rm -rf dist node_modules/.vite && npm run build:dev

# 2) 起带扩展的 chromium（CDP 9333 + 持久 profile + auto load extension）
nohup node scripts/pf-launch.cjs > /tmp/pf-launch.log 2>&1 &

# 3) attach playwright-cli + 打开 reader
npx --no-install playwright-cli attach --cdp=http://localhost:9333
npx --no-install playwright-cli goto "chrome-extension://<id>/reader/index.html?e2e=fake-paper"

# 4) seed 状态 + 跑场景
npx --no-install playwright-cli eval "(async () => { await chrome.storage.local.set({...}); })()"
npx --no-install playwright-cli press "Meta+l"
npx --no-install playwright-cli click eXX
npx --no-install playwright-cli tab-list   # 验证多 tab 行为
npx --no-install playwright-cli --raw eval "document.querySelector(...)"  # 断言 hydration
```

注意点：

- **每次开测前确认 build mode**：`playwright-cli console | grep "supabase env"` 应该看到 `http://127.0.0.1:54321 · development`。看到 `production` 就是 dist 没重建对，回 step 1。
- **改动 reader 源码后必须 `rm -rf dist node_modules/.vite` 强制重建**，再 kill + relaunch chromium。Vite incremental 经常假装重建（"1 modules transformed" 只编译了 `inject.js`，reader bundle 没动）。
- **toast / 异步 UI 时序敏感**：toast 默认 2.6s auto-dismiss + drawer overlay 可能遮挡。读取 toast 文本要在 click 后 < 1s 内，必要时先 `press Escape` 关 drawer。
- **复用 `chrome-extension/scripts/pf-launch.cjs`**（Phase 27 引入的 debug helper），不要每次现写 launch 脚本。
- **不能因为"需要真实网络 / 真实论文"就跳过自动化**——绝大多数验收项可以靠 `chrome.storage.local` seed + 缓存 fallback 路径完整覆盖（`#paperKey=<key>` 入口走纯缓存渲染，零网络）。

发现 bug 直接顺手 patch + commit 一条 fix（Phase 27 D2 顺路捕获 + 修了 `toast.tsx` 长期 latent 的 `action!` 谎报 bug）。

## Auth + Sync (Supabase + Stripe)

User login, cross-device sync, 3-tier subscriptions (Free/Sync/Pro), managed AI proxy, and BYOK live behind a Supabase backend. Full spec: `docs/specs/2026-04-24-spec-user-login.md`. Implementation plan: `docs/plans/2026-04-24-plan-user-login.md`.

### Local dev stack

```bash
# Boot Postgres + Auth + Realtime + Edge runtime locally
supabase start
# Status, dashboard URLs, test keys
supabase status
```

Supabase Studio → `http://127.0.0.1:54323` · Mailpit (magic-link inbox) → `http://127.0.0.1:54324`.

### Env var loading

- `chrome-extension/.env.local` — copy from `chrome-extension/.env.local.example`. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only. Build-time inlined by Vite.
- `supabase/.env` — copy from `supabase/.env.example`. Edge Function secrets: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `UPGRADE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_SYNC`, `STRIPE_PRICE_PRO`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_RETURN_URL`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`.
- Integration tests (`chrome-extension/tests/integration/`) read local Supabase URLs from `supabase/.env.local-devnote.md` via `readFileSync`.
- `stripe-webhook` is explicitly `verify_jwt = false` in `supabase/config.toml` — Stripe signature is verified in the function body.

### Edge Functions

```
supabase/functions/
├── _shared/           # auth.ts / responses.ts / clients.ts — imported by every function
├── ai-proxy/          # managed AI streaming (rate-limit → quota → OpenAI SSE passthrough)
├── create-checkout-session/   # Stripe Checkout session (tier = sync|pro)
├── stripe-webhook/    # HMAC-verified 3-event handler (checkout.session.completed, subscription.updated/deleted)
└── create-portal-session/     # Stripe Billing Portal session
```

Serve one locally + tail logs:

```bash
supabase functions serve ai-proxy --env-file ./supabase/.env
# or all at once
supabase functions serve --env-file ./supabase/.env
```

Deploy to hosted Supabase:

```bash
supabase functions deploy ai-proxy
supabase functions deploy stripe-webhook --no-verify-jwt   # webhook must skip gateway auth
```

### Stripe webhook local testing

```bash
# Forward hosted webhooks to local edge runtime
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
# In another shell, trigger a test event
stripe trigger checkout.session.completed
```

The webhook upserts `subscriptions` on checkout.completed and `cancel_at_period_end` + `canceled_at` on subscription.updated/deleted.

### Database migrations + RPCs

- Tables + RLS + realtime + triggers + RPCs live in `supabase/migrations/00{1..5}_*.sql`.
- Never write `subscriptions.tier` directly from the client — all tier transitions flow through Stripe → webhook → service-role write.
- `increment_ai_usage()` and `rate_limit_check(p_max_count, p_window_sec)` are `security definer` RPCs; client calls them with its own JWT.

### Client architecture (Phase A-F)

- `chrome-extension/reader/lib/supabase.ts` — shared Supabase client with `chrome.storage.local` session adapter (MV3-safe).
- `chrome-extension/reader/lib/storage-schema.ts` — typed keys for session, BYOK config, sync queue, migration state, modal dismiss flags.
- `chrome-extension/reader/lib/ai.ts` — `callAI(messages, kind, onChunk)` routes BYOK (has `config_apikey`) vs managed proxy. Throws `ProxyError` with codes `quota-exhausted | sync-no-managed-ai | rate-limited | unauthenticated | server-error | unknown`.
- `chrome-extension/reader/lib/migration.ts` — one-time login migration (push local → cloud) with conflict detection + 3-choice merge (merge | local | cloud).
- `chrome-extension/reader/lib/sync-queue.ts` — offline-write queue, drains on online / SW startup.
- `chrome-extension/reader/lib/byok-sync.ts` — cloud-sync `baseURL + model` (apiKey stays local-only).
- `chrome-extension/reader/lib/subscriptions-sync.ts` — realtime listener for tier changes (AccountMenu auto-refresh).

### Logout semantics

`doLogout` in `components/top-bar.tsx` clears: `config_apikey`, `config_apikeys` (Phase 12 D-A2), `config_active_byok_config_id` (Phase 12 D-D2), `migrationState:byok-configs-v12` (Phase 12 D-A3), `byokHealthCache` (Phase 12 D-C1 — MED-5 cross-AI review), `config_prefs`, `sync:queue`, `migrationState`, `paperIdMap`, `churnModalSeen`, `libraryCapBannerDismissed`, and all `paper:*` keys except `:parsed` and `:summary:*` (regenerable, safe to keep).
