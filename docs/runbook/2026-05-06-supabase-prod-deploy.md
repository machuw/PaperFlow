# 托管 Supabase 生产部署 runbook

**生成日期**: 2026-05-06
**首次部署项目**: PaperFlow（ref `<ref>`，US-East-1）
**适用场景**: 把本地 Supabase 切换到托管，或在新的 Supabase 项目上从零部署 PaperFlow 后端
**预计耗时**: 顺利 30-45 分钟；首次踩坑 1.5-2 小时

> 本 runbook 由 2026-05-06 的实战部署回放凝练而成。今天踩了 4 个非平凡坑：GFW 对 Docker bundle 的拦截、PG 直连 IPv6-only、CHANNEL-02 verification 假阳性、长 prompt 的 TTFT timeout。**每一节都标注了「假如不踩这个坑会发生什么」**，方便下次扫一眼判断是否相关。

---

## 0. 准备清单（10 分钟）

| 项 | 说明 |
|---|---|
| Supabase 账号 + 新项目 | https://supabase.com/dashboard → New project；记录 region / database 密码 / project ref（`abcdefg...` 14 字符） |
| Stripe 账号 | https://dashboard.stripe.com → 确认是 Test mode（左上角橙色 "TESTDATA"），不需要 live |
| Google OAuth Client（如要登录） | https://console.cloud.google.com/apis/credentials → OAuth 2.0 Client ID（Web application） |
| newapi 上游凭证 | 你 newapi 控制台的 baseURL + API key + 至少一个 fast model（推荐 Haiku 4.5） |
| Supabase CLI | `brew install supabase/tap/supabase`，验证 `supabase --version` ≥ 2.90 |

**强制安全前置**：检查 `supabase/.gitignore` 包含 `.env.production`：

```bash
git check-ignore -v supabase/.env.production
# 没输出 = NOT ignored = 危险，立刻修
```

如果未 ignored，先编辑 `supabase/.gitignore` 加：

```
.env.production
.env.*.production
backups/
```

---

## 1. Link 本地 repo 到托管项目

```bash
supabase login                                        # 一次性，浏览器授权
supabase link --project-ref <你的-project-ref>        # 写入 supabase/.temp/project-ref
cat supabase/.temp/project-ref                        # 验证：应输出 ref
```

**注意**：CLI 2.90 没有 `supabase status --linked` flag。验证 link 用：

```bash
supabase projects list      # 行首 "●" 标记当前 linked
supabase db diff            # 能跑 = link OK；no project ref = 没 link
```

---

## 2. 推 migrations（关键坑：网络代理 → 5432 fake-ip）

### 直连 5432 的问题

托管 Supabase 直连数据库（端口 5432）默认**只支持 IPv6**。若你机器：
- 在中国 + 走 Clash/Surge/Mihomo + 启用 fake-ip → DNS 被改写成 `198.18.x.x`，连不上
- 没 IPv6 出口 → 直接 timeout

**症状**：

```
$ supabase db push
pg_dump: error: connection to server at "db.<ref>.supabase.co" (198.18.3.2),
port 5432 failed: server closed the connection unexpectedly
```

**确诊**（5 秒）：

```bash
nslookup db.<ref>.supabase.co
```

返回 `198.18.x.x` → 代理 fake-ip。

### 修法：用 Session Pooler URL（IPv4 + 不同域名）

到 Dashboard 顶部点 **Connect** 按钮（带闪电图标）→ **Session pooler** tab → 复制连接串：

```
postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-X-us-east-1.pooler.supabase.com:5432/postgres
```

`X` 是机房编号（PaperFlow 是 `aws-1-us-east-1`，不同项目可能 `aws-0-`）。**端口必须 5432，不要 6543**——6543 是 transaction pooler，不支持 prepared statements，migrations 不能用。

存进 macOS Keychain 一劳永逸：

```bash
security add-generic-password -U -a paperflow -s paperflow-db-url \
  -w 'postgresql://postgres.<ref>:<密码>@aws-1-us-east-1.pooler.supabase.com:5432/postgres'

# 用：
export PAPERFLOW_DB_URL=$(security find-generic-password -a paperflow -s paperflow-db-url -w)
```

> Keychain 里已有同名条目时报 "specified item already exists"，加 `-U` flag 即可（update if exists, create if not）。

### Push migrations

```bash
supabase migration list --db-url "$PAPERFLOW_DB_URL"
# 期望：所有 LOCAL 行 REMOTE 列空 = 待推送

supabase db push --db-url "$PAPERFLOW_DB_URL"
# CLI 会列出文件 + 询问 y/N 确认
```

> 跳过 `supabase db dump` 备份对**新建空项目**意义不大——dump 出来只有 Supabase 自带 auth/storage 系统 schema，托管端可恢复。

成功后再 `supabase migration list --db-url "$PAPERFLOW_DB_URL"`，期望 LOCAL 与 REMOTE 列全部对齐（时间戳一致）。

> **migration 编号跳号**：本项目 `001..006, 008..013` 跳了 007（历史回滚痕迹）。Supabase CLI 不要求连续，按文件名字典序执行即可。

---

## 3. 推 Edge Function secrets（不是 .env 文件）

⚠️ **托管运行时不读 `supabase/.env`**，必须 `supabase secrets set`：

### 创建 .env.production

`cp supabase/.env.example supabase/.env.production` 然后填**生产值**（区别于本地开发的 `.env`）。最少需要：

```
NEWAPI_BASE_URL=...           # 你的 newapi
NEWAPI_API_KEY=sk-newapi-...
OPENAI_BASE_URL=...           # 通常等于 NEWAPI_BASE_URL（让 OpenAI fallback 也走 newapi）
OPENAI_API_KEY=sk-newapi-...
OPENAI_MODEL=claude-opus-4-7  # 或你的默认重型 model
OPENAI_MODEL_FAST=claude-haiku-4-5-20251001  # ← v1.4 hotfix 加的，chat/explain 用
UPGRADE_URL=https://你的域名/pricing  # 占位也 OK
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...  # 仅 Google 登录
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
```

Stripe 的 4 个变量（SECRET / PRICE_SYNC / PRICE_PRO / WEBHOOK_SECRET）**可以暂时不填**——只要不部署 Stripe 函数，缺失无害。

### 推送

```bash
supabase secrets set --env-file ./supabase/.env.production
supabase secrets list  # 验证：digest 列有 hash 值（永远不显示明文，正常）
```

`SUPABASE_SERVICE_ROLE_KEY` **不要手动设**——托管运行时自动注入。

---

## 4. 部署 Edge Functions（关键坑：GFW + Docker bundle）

### Docker bundle 的问题

默认 `supabase functions deploy <name>` 在本地 Docker 容器里 bundle TypeScript（拉 `supabase/edge-runtime` 镜像），bundle 时从 `esm.sh` 抓 `@supabase/supabase-js` 等依赖。**Docker 容器不继承宿主机代理**——你 Clash 跑得好好的，容器里照样直连。

**症状**：

```
$ supabase functions deploy ai-proxy
Bundling Function: ai-proxy
v1.73.13: Pulling from supabase/edge-runtime
... (镜像拉取成功)
Error: failed to create the graph
Caused by:
    Import 'https://esm.sh/@supabase/supabase-js@2' failed: 522 <unknown status code>
```

`522` = Cloudflare 到源站连不上，本质是 GFW 干扰 esm.sh。

### 修法：`--use-api` flag

让 Supabase 后端在云端 bundle，跳过本地 Docker：

```bash
supabase functions deploy ai-proxy --use-api
```

云端在美国，esm.sh 通畅。**默认在脚本里写死这个 flag**（见 `scripts/deploy-supabase.sh`）。

### 部署清单

PaperFlow 当前共 8 个 Edge Functions，按功能分组：

| 函数 | 跳过条件 | 特殊 flag |
|---|---|---|
| `ai-proxy` | 必部署 | — |
| `agent-run` | 必部署（v1.2 agent） | — |
| `managed-models` | 必部署 | — |
| `delete-library` / `delete-topic` | 必部署 | — |
| `create-checkout-session` | Stripe 未配可跳 | — |
| `create-portal-session` | Stripe 未配可跳 | — |
| `stripe-webhook` | Stripe 未配可跳 | `--no-verify-jwt`（HMAC 鉴权，不走 JWT） |

⚠️ `stripe-webhook` 必须加 `--no-verify-jwt`——`config.toml` 里的 `verify_jwt = false` 只对本地生效，部署仍需显式 flag。

**推荐用 deploy 脚本一键搞定**：

```bash
bash scripts/deploy-supabase.sh                # 5 个非 Stripe 函数
bash scripts/deploy-supabase.sh --with-stripe  # 接 Stripe 后跑这个
```

脚本特性：幂等、pre-flight 检查 `.env.production` gitignore 合规、自动加 `--use-api`、部署后 curl sanity check（每个函数应返回 401）。

---

## 5. Stripe 配置（可跳，等需要付费时再做）

跳过的代价：用户卡在 Free tier，Pro / Sync 升级按钮报错（其它功能正常）。

接 Stripe 时回到本节：

1. Test mode 创 2 个 Product（Sync $4/月、Pro $12/月），拷各自 Price ID
2. `supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_SYNC=price_... STRIPE_PRICE_PRO=price_... STRIPE_WEBHOOK_SECRET=whsec_PLACEHOLDER`
3. `bash scripts/deploy-supabase.sh --with-stripe` 部署 3 个 Stripe 函数
4. Stripe Dashboard → Webhooks → Add endpoint → URL `https://<ref>.supabase.co/functions/v1/stripe-webhook`，订阅 `checkout.session.completed` / `customer.subscription.updated` / `customer.subscription.deleted` 三事件
5. 回填 `STRIPE_WEBHOOK_SECRET=whsec_<Stripe 给的真值>` 并 push secrets

---

## 6. Google OAuth（如要支持 Google 登录）

### 给现有 OAuth Client 加托管 callback

到 https://console.cloud.google.com/apis/credentials → 找你的 OAuth 2.0 Client → **Authorized redirect URIs** → **+ ADD URI**：

```
https://<ref>.supabase.co/auth/v1/callback
```

**保留**已有的 `http://127.0.0.1:54321/auth/v1/callback`（本地开发还要用）。

### Supabase Dashboard 启用 Google provider

https://supabase.com/dashboard/project/<ref>/auth/providers → Google → Enable，粘贴 Client ID + Secret。

### URL allowlist

https://supabase.com/dashboard/project/<ref>/auth/url-configuration → Redirect URLs → 加：

```
https://*.chromiumapp.org/**
```

> Chrome 扩展 ID 不稳定（manifest 没有 `key` 字段时每次加载都变）。wildcard 让任意 chromiumapp.org 子域都被认可。**上 Web Store 之前**应给 manifest 加 `key` 字段锁定 ID 后改成精确 URL（更安全）。

### 验证（不依赖扩展）

```bash
curl -i "https://<ref>.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fabcdef.chromiumapp.org%2F"
```

期望：`HTTP/2 302` + `location: https://accounts.google.com/o/oauth2/v2/auth?client_id=xxx&...`。

错误码对照：

- 400 + `provider not enabled` → Dashboard 启用没 Save 成功，重做
- 400 + `redirect_to not allowed` → URL allowlist 漏掉了 `*.chromiumapp.org/**`

---

## 7. 切换 Chrome 扩展指向托管

### 拿 anon key

https://supabase.com/dashboard/project/<ref>/settings/api-keys（新版 Dashboard 路径，不在 `/database/settings`）。

复制 **anon / public** 那行（`eyJ...` JWT 形态）。**不要**复制 service_role（那个是机密）。

> anon key 是公开的，可以放 `.env.local`，可以 inline 进 bundle——RLS 强制每个 query 必须带用户 JWT 才能读写自己数据，没 JWT 时 anon key 只能调 unauthenticated endpoint。

### 改 `chrome-extension/.env.local`

```bash
# 备份当前（万一切回本地开发）
cp chrome-extension/.env.local chrome-extension/.env.local.bak-$(date +%Y%m%d)

# 改前 2 行（VITE_*），其余保留
sed -i '' \
  -e "1s|.*|VITE_SUPABASE_URL=https://<ref>.supabase.co|" \
  -e "2s|.*|VITE_SUPABASE_ANON_KEY=<新 anon key>|" \
  chrome-extension/.env.local

head -2 chrome-extension/.env.local  # 验证
```

⚠️ Vite **build 时 inline** `VITE_*` 进 bundle——改 `.env.local` 必须 `npm run build` 才生效，运行时改无效。

### Build + 验证

```bash
cd chrome-extension && npm run build && cd ..

# 关键验证：bundle 里有生产 URL，无本地 URL 残留
grep -l '<ref>' chrome-extension/dist/assets/*.js  # 期望命中 3 个 chunk
grep -c '127.0.0.1:54321' chrome-extension/dist/assets/*.js | grep -v ':0$'  # 期望全 0
```

### 加载到 Chrome

`chrome://extensions/` → 开发者模式 → **加载已解压的扩展程序** → 选 `chrome-extension/dist/`。

如已装过，点卡片上 **🔄 重新加载**。

---

## 8. 端到端冒烟（5 分钟）

### 监控 dashboard

预先开两个 tab：

- https://supabase.com/dashboard/project/<ref>/auth/users — 看新注册用户
- https://supabase.com/dashboard/project/<ref>/functions/ai-proxy/logs — 看 AI 调用

### 用户流程

1. 浏览器访问任意 arXiv：`https://arxiv.org/abs/<某论文>`
2. 扩展应接管，渲染 PaperFlow Reader UI（左侧 outline + 右侧论文）
3. 顶栏右上头像 → **Sign in with Google** → 弹 popup → 选账号 → 应回到登录态
4. 选段论文文字 → SelectionToolbar 点 **E** (explain) → 5-10s 出 AI 流式回复

### 期望

- Auth Users tab 多一行（你的 google email）
- ai-proxy logs 出现 POST 200 + 流式 chunks（chunks=N）
- Table Editor → ai_usage_log 多一行（user_id + tier='free' + tokens）

---

## 已知踩坑速查（按出现概率排序）

### 坑 1：Docker bundle 522（GFW）

**症状**：`supabase functions deploy` 卡在 `failed to create the graph` + `Import 'https://esm.sh/...' failed: 522`

**修法**：所有 deploy 加 `--use-api`，或直接用 `bash scripts/deploy-supabase.sh`

### 坑 2：5432 fake-ip 拦截

**症状**：`supabase db push` / `migration list` 报 `connection to db.<ref>... (198.18.x.x) failed`

**修法**：换 Session pooler URL（端口仍 5432，但域名是 `aws-X-us-east-1.pooler.supabase.com`），加 `--db-url "$PAPERFLOW_DB_URL"`

### 坑 3：CHANNEL-02 白屏（v1.4 hotfix `9dcd5f9` 修复）

**症状**：Google OAuth 登录后 reader 白屏，DevTools console 报 `cannot add 'postgres_changes' callbacks for realtime:subscriptions-sync after 'subscribe()'`

**根因**：`subscriptions-sync.ts` 用硬编码 channel 名，两个 caller（top-bar AccountMenu + use-managed-models Effect）抢同一 channel；supabase-realtime-js 第二次 `.on()` 抛错

**修法**：每次调用唯一 channel 名（commit `9dcd5f9` 已修）。详见 `.planning/phases/18-data-layer-gates/FOLLOW-UP-ISSUE-CHANNEL-02.md`

### 坑 4：chat / explain inactivity timeout（v1.4 hotfix `1f49ed8` 修复）

**症状**：Reader 中 chat / explain 调用 10 秒 0 chunk 然后超时（kind=chat / kind=explain）；但 curl 短 prompt 直连 ai-proxy 秒回

**根因**：
1. 默认 OPENAI_MODEL = claude-opus-4-7（重型）
2. chat prompt 把整篇论文 + memory + history 全塞进 system message（5-15K tokens）
3. Opus 经 newapi → Bedrock TTFT 偶尔 >10s
4. 客户端 watchdog 10s 太紧

**修法**：
- 服务端 `OPENAI_MODEL_FAST` env + `FAST_KINDS = {chat, explain}` 路由（commit `1f49ed8`）
- 客户端 INACTIVITY_TIMEOUT_MS 10s → 30s
- 长期方案：seed `.planning/seeds/v15-ai-request-optimization.md`（chat prompt RAG 减肥 + 完整 per-kind model registry）

### 坑 5：Dashboard URL 改版

**症状**：教程指向的 `/database/settings` 没 anon key，`/auth/providers/...` 找不到

**修法**：用顶栏 **Connect** 按钮（带闪电图标）；anon key 在 `/settings/api-keys`（新版） 而不是 `/database/settings`（旧版）

### 坑 6：`.env.production` 未 gitignored

**症状**：`git status` 看到 `?? supabase/.env.production`，可能被 `git add .` 误提交

**修法**：`supabase/.gitignore` 必须有 `.env.production`（注意不是 `.env.*.local` 那条 pattern——它要求 `.local` 结尾）。Deploy script 已经在 pre-flight 检查这一项，未 ignored 直接 abort。

---

## 重新部署 / 增量更新流程

部署完成后，日后改后端只需：

| 改动 | 命令 |
|---|---|
| 改 secret（不改代码） | `supabase secrets set NAME=value`，函数 cold-restart 后生效 |
| 改 Edge Function 代码 | `bash scripts/deploy-supabase.sh --functions-only` |
| 加新 migration | `supabase db push --db-url "$PAPERFLOW_DB_URL"` |
| 改 `.env.local`（扩展） | `cd chrome-extension && npm run build`，Chrome reload extension |
| 接 Stripe | `bash scripts/deploy-supabase.sh --with-stripe`，然后 Stripe Dashboard 注册 webhook，回填 `STRIPE_WEBHOOK_SECRET` |
| 加快 model 切换 | 改 `OPENAI_MODEL_FAST` secret 即可，无需重新部署函数 |

## 扩展环境快速切换（local ↔ 托管）

利用 Vite mode-loading：`.env.[mode].local` 在对应 mode 下覆盖 `.env.local`。

**前置**：`chrome-extension/.env.development.local` 已经创建，里面只有：

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJhbGci...（Supabase 本地 demo JWT）
```

`.env.local` 保持托管值作为默认。两个文件都被 `.env.*.local` pattern 覆盖。

**切换命令**：

| 想要的环境 | 命令 | inline 进 bundle 的 URL |
|---|---|---|
| 托管（默认） | `npm run build` | `https://<ref>.supabase.co` |
| 本地 Supabase | `npm run build:dev` | `http://127.0.0.1:54321` |
| watch 模式（托管）| `npm run dev` | 同上 |
| watch 模式（本地）| `npm run dev:local` | 同上 |

build 完毕一定要 `chrome://extensions/` → 找 PaperFlow → 🔄 重新加载，否则 Chrome 还跑旧 bundle。

**判断当前 build 指向哪**：

```bash
grep -l '<ref>' chrome-extension/dist/assets/*.js > /dev/null && echo "→ 托管" || echo "→ 本地"
```

或扩展任意 `chrome-extension://` 页面的 DevTools Console：

```js
import.meta.env.VITE_SUPABASE_URL
```

> Vite 的 mode 顺序：`.env` < `.env.local` < `.env.[mode]` < `.env.[mode].local`，later override earlier。`vite build` 默认 mode=production，所以 `npm run build` 等价 `vite build --mode production`，只读 `.env.local` 和 `.env.production.local`（如果有）。`build:dev` 把 mode 切到 development，于是 `.env.development.local` 生效。

---

## 安全 checklist（部署完成必做）

- [ ] `supabase/.gitignore` 包含 `.env.production` + `backups/`（`git check-ignore -v supabase/.env.production` 命中）
- [ ] 数据库密码不在任何聊天历史 / commit / 日志里（轮换：Dashboard → Database → Reset password；Keychain 用 `-U` 更新）
- [ ] anon key 可以公开；service_role key 永远不放客户端
- [ ] Stripe webhook 部署用了 `--no-verify-jwt`（验证：Dashboard → Edge Functions → stripe-webhook → 配置 → JWT 应禁用）
- [ ] Google OAuth callback 同时配了本地 `127.0.0.1:54321` 和托管 `<ref>.supabase.co`，切换环境不需要每次改
- [ ] `supabase/.env.production` 仅本机存在，不出现在 backup / share 渠道

---

## 关键文件指引

- `scripts/deploy-supabase.sh` — 一键部署脚本（pre-flight + secrets + 5 函数 + sanity check）
- `supabase/.env.production` — 生产 secrets 源头（gitignored）
- `supabase/migrations/` — schema 演进剧本（CLI 按字典序执行）
- `supabase/functions/_shared/` — 共享代码：auth.ts / responses.ts / clients.ts / managed-models.ts
- `chrome-extension/.env.local` — 扩展指向哪个 Supabase（VITE_* 字段被 Vite inline 进 bundle）
- `.planning/seeds/v15-ai-request-optimization.md` — chat 优化 seed
- `.planning/seeds/v16-usage-telemetry.md` — usage telemetry seed
- `.planning/phases/18-data-layer-gates/FOLLOW-UP-ISSUE-CHANNEL-02.md` — Realtime 反模式 escalation

## 相关 commit（v1.4 部署期 hotfix）

- `0ea20c5` — `chore: add Supabase prod deploy script + gitignore .env.production/backups`
- `9dcd5f9` — `fix(subscriptions-sync): unique channel name per call (CHANNEL-02 hotfix)`
- `1f49ed8` — `fix(ai): per-kind fast model + 30s inactivity timeout (deploy hotfix)`
- `ff81c54` — `docs(seed): plant v1.6+ usage telemetry seed`
- `fa271b6` — `docs(seed): plant v1.5+ AI request optimization seed`
