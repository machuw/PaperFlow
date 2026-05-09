# PaperFlow · User Login + Cross-Device Sync + Paid Tiers — Spec

Date: 2026-04-24

---

## 1. 产品目标

在现有的 PaperFlow Chrome 扩展之上增加用户账号体系，以支撑两个独立能力：

1. **跨设备同步** —— 用户在多台设备 / 多个浏览器登录同一账号时，Library、高亮、Memory、Notes、Chat、Canvas 自动共享一份云端真相
2. **付费分层** —— Free / Sync / Pro 三档订阅，为独立开发者建立可持续的商业模式

登录本身是**软门槛**（不强制）：未登录用户可继续以纯本地 + BYOK 方式使用扩展所有功能（保留现有 spec 的无后端路径）。

本 spec 在 [2026-04-20-spec-chrome-extension.md](./2026-04-20-spec-chrome-extension.md) 之上叠加，不替换。

---

## 2. 定价模型（Model T · "试吃" 一次性）

| 档位 | 月费 | 跨设备同步 | Library 上限 | 托管 AI | BYOK |
|------|------|-----------|-------------|---------|------|
| **Free**（登录后） | $0 | ✓（限 16 篇） | 本地不限 / 云端同步 16 篇 | **一次性 20 次试吃** | 无限 |
| **Sync** | $4 | ✓（不限） | 不限 | — | 无限 |
| **Pro** | $12 | ✓（不限） | 不限 | **300 次 / 月**（月度重置） | 无限 |
| **未登录** | — | ✗ | 本地不限 | ✗ | 无限（现状） |

**关键产品叙事**：
- BYOK 永远免费、永远无限 —— 所有档位都可继续用自己的 OpenAI key，扩展完全不触及托管 AI 代理
- 无 key 新用户登录即可拿 20 次"试吃"，救 onboarding 漏斗；用完按 Model T 进入升级转化
- Sync 档卖"同步基础设施"，Pro 档加卖"托管 AI 额度"
- Stripe 作为 Merchant of Record（v1 不接 Lemonsqueezy 之类的代扣税）

---

## 3. 数据分层

### 3.1 上云（Supabase）—— 6 组 key

| chrome.storage.local key | Supabase 表 | 说明 |
|--|--|--|
| `library` | `papers` | 论文列表元数据 |
| `paper:{key}:highlights` | `highlights` | 高亮 |
| `paper:{key}:notes` | `margin_notes` | AI margin notes |
| `paper:{key}:memory` | `memory` | 用户笔记 |
| `paper:{key}:chat` | `chat` | 每篇对话历史 |
| `paper:{key}:canvas` | `canvas` | Canvas 节点布局 |

### 3.2 留本地

| key | 理由 |
|--|--|
| `config`（BYOK: apiKey/baseURL/model） | 敏感凭据，业界惯例从不同步；用户在每台设备重新填一次 |
| `paper:{key}:parsed` | outline + paragraphs 缓存，随时可从 arXiv / PDF 重算 |
| `paper:{key}:summary:v*` | AI 摘要缓存，可重算 |
| `library:lock` | 本机并发互斥 mutex |
| `session`（Supabase token） | 账号凭据 |
| `sync:queue` | 离线写入队列（§11） |
| `migrationState` | 首次登录迁移状态（§7） |

### 3.3 走 `chrome.storage.sync`（Chrome 内置同步）

| key | 理由 |
|--|--|
| `pf-tweaks` | font / width / grain / margins 等 UI 偏好。100KB 足够，登录与否都工作，白捡"跨 Chrome 设备同步" |

---

## 4. 系统架构

### 4.1 三层分布

```
┌─────────────────────────────── 用户设备 ──────────────────────────────┐
│  Chrome 扩展：                                                         │
│    reader/    ← 现有 UI + LoginModal / AccountMenu / UpgradePrompt    │
│              /  QuotaChip / LibraryCapBanner                          │
│    sw.js     ← background service worker（session refresh + realtime）│
│    supabase-js SDK                                                    │
│    chrome.storage.local（🟢 镜像 + 🔴 本地私有）                       │
│    chrome.storage.sync（🟡 tweaks）                                    │
└───────────────────────────────────────────────────────────────────────┘
                                │ HTTPS (JWT)
                                ▼
┌─────────────────── Supabase（云端托管 · 本地 Docker 开发） ────────────┐
│  Auth：Google OAuth · Magic Link OTP                                   │
│  Postgres + RLS：papers / highlights / margin_notes / memory / chat /  │
│                  canvas / subscriptions / ai_usage / ai_usage_log      │
│  Realtime：6 张用户数据表 + subscriptions                              │
│  Edge Functions：/ai-proxy · /stripe-webhook · /create-checkout-       │
│                  session · /create-portal-session                      │
└───────────────────────────────────────────────────────────────────────┘
                                │                  │
                                ▼                  ▼
                          OpenAI API          Stripe
```

### 4.2 部署

**混合模式**：
- **开发期**：`supabase start` → Docker 本地 stack（$0、离线可用）
- **生产**：Supabase Cloud（Free 起步 → $25/月 Pro，上线前升级）
- `supabase db push` 把本地 migrations 同步到云端
- 扩展代码同一份 SDK 代码，切换只改 URL + anon key

### 4.3 BYOK vs 托管 AI 路径（不变量）

```
用户触发 AI 操作
  ├── config.apiKey 存在 → 走 reader/lib/ai.ts 直路径，调用户自己的 OpenAI
  └── config.apiKey 不存在
        ├── 已登录 → POST /functions/v1/ai-proxy（走 Edge Function，扣配额）
        └── 未登录 → 弹 LoginModal（软门槛）
```

**后端挂掉 BYOK 用户零影响** —— 这是托管 AI 架构最重要的保险。

---

## 5. 数据模型（Postgres · Supabase）

### 5.1 9 张表的 DDL

```sql
-- 用户内容（6 张，全部加 RLS）
create table papers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  paper_key     text not null,                    -- arxiv id 或 urlHash
  title         text, authors text[], venue text, pages int,
  role          text, topic text, judgment text,
  added_at      timestamptz not null default now(),
  last_read     timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, paper_key)
);
create index on papers (user_id, last_read desc);

create table highlights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  paper_id      uuid not null references papers on delete cascade,
  paragraph_id  text not null,
  text          text not null,
  color         text not null default 'yellow',
  created_at    timestamptz not null default now()
);
create index on highlights (user_id, paper_id);

create table margin_notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  paper_id      uuid not null references papers on delete cascade,
  paragraph_id  text not null,
  kind          text not null check (kind in ('explain','summarize','translate','ask')),
  source        text not null,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index on margin_notes (user_id, paper_id);

create table memory (
  paper_id         uuid primary key references papers on delete cascade,
  user_id          uuid not null references auth.users on delete cascade,
  why_it_matters   text default '',
  role             text default '',
  judgment         text default '',
  linked           jsonb default '[]',
  next_actions     jsonb default '[]',
  updated_at       timestamptz not null default now()
);
create index on memory (user_id);

create table chat (
  paper_id    uuid primary key references papers on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  turns       jsonb not null default '[]',
  updated_at  timestamptz not null default now()
);

create table canvas (
  paper_id    uuid primary key references papers on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  nodes       jsonb not null default '[]',
  updated_at  timestamptz not null default now()
);

-- 计费 + 配额（3 张）
create table subscriptions (
  user_id             uuid primary key references auth.users on delete cascade,
  tier                text not null default 'free'
                        check (tier in ('free','sync','pro')),
  stripe_customer_id  text,
  stripe_subscription_id text,
  current_period_end  timestamptz,
  cancel_at_period_end boolean not null default false,  -- §9.3 处理 cancel_at_period_end=true
  canceled_at         timestamptz,                       -- 取消请求的时间戳
  updated_at          timestamptz not null default now()
);

-- BYOK 非敏感偏好（仅 baseURL + model），跨设备自动回填
-- apiKey 不在这里 —— apiKey 永远本地 (§3.2)
create table byok_prefs (
  user_id     uuid primary key references auth.users on delete cascade,
  base_url    text,     -- e.g. 'https://api.openai.com/v1'
  model       text,     -- e.g. 'gpt-4o-mini'
  updated_at  timestamptz not null default now()
);

create table ai_usage (
  user_id     uuid not null references auth.users on delete cascade,
  period      text not null,                      -- 'lifetime-trial' 或 'YYYY-MM'
  used        int not null default 0,
  primary key (user_id, period)
);

create table ai_usage_log (  -- 审计 / 成本监控，用户不可读
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  kind            text not null,
  tier_at_call    text not null,
  prompt_tokens   int,
  output_tokens   int,
  model           text,
  created_at      timestamptz not null default now()
);
create index on ai_usage_log (user_id, created_at desc);
```

### 5.2 RLS Policies

```sql
-- 每张用户内容表复用同一 policy（7 张：papers + highlights + margin_notes + memory + chat + canvas + subscriptions）
alter table <t> enable row level security;
create policy "own rows" on <t>
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ai_usage：客户端读自己的，但只有 service_role 能写
alter table ai_usage enable row level security;
create policy "read own usage" on ai_usage
  for select using (user_id = auth.uid());
-- 无 insert/update policy → 客户端写不动，只有 service_role 能改

-- ai_usage_log 全拒绝客户端（仅 service_role）
alter table ai_usage_log enable row level security;
-- 无 policy = 默认拒绝所有角色（service_role 天然绕过）
```

### 5.3 Realtime Publication

```sql
alter publication supabase_realtime add table
  papers, highlights, margin_notes, memory, chat, canvas, subscriptions, byok_prefs;
-- 不放 ai_usage / ai_usage_log（客户端无需实时）
-- byok_prefs 加入 realtime —— 设备 A 改 baseURL/model 后，设备 B 立刻回填
```

### 5.4 Triggers

- `updated_at` 自动更新：`papers` / `memory` / `chat` / `canvas` / `subscriptions` 各加 `BEFORE UPDATE` trigger 设 `updated_at = now()`
- Auth 新用户 hook：`auth.users` INSERT 后 → 自动插 `subscriptions(user_id, tier='free')`（用 Supabase 的 `on_auth_user_created` 标准路径）

### 5.5 原子配额扣减 Postgres 函数

**关键安全约束**：函数 `security definer` + 所有身份 / 配额参数都在函数内部从 `auth.uid()` 和 `subscriptions` 表推导，**不接受来自调用方的 user_id / limit 参数**。否则任何持有 JWT 的用户都可以伪造 p_user 和 p_limit 绕过配额。

```sql
create or replace function increment_ai_usage()
returns int
language plpgsql security definer as $$
declare
  v_uid    uuid := auth.uid();
  v_tier   text;
  v_period text;
  v_limit  int;
  v_used   int;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  select tier into v_tier from subscriptions where user_id = v_uid;
  if v_tier is null then v_tier := 'free'; end if;

  if v_tier = 'sync' then
    raise exception 'sync tier has no managed ai';
  end if;

  v_period := case when v_tier = 'pro'
              then to_char(now() at time zone 'utc', 'YYYY-MM')
              else 'lifetime-trial' end;
  v_limit  := case when v_tier = 'pro' then 300 else 20 end;

  insert into ai_usage (user_id, period, used)
  values (v_uid, v_period, 0)
  on conflict (user_id, period) do nothing;

  select used into v_used from ai_usage
  where user_id = v_uid and period = v_period
  for update;  -- 行锁

  if v_used >= v_limit then
    return -1;
  end if;

  update ai_usage set used = used + 1
  where user_id = v_uid and period = v_period;

  return v_used + 1;
end $$;

-- 只允许 authenticated 角色调用（不允许 anon）
revoke all on function increment_ai_usage() from public;
grant  execute on function increment_ai_usage() to authenticated;
```

`FOR UPDATE` 行锁保证并发双 tab 不会越 limit。函数返回值：`-1` 表示超限；`>= 1` 表示扣减后的新 `used` 值。

---

## 6. Auth + Session 管理

### 6.1 LoginModal 触发点（软门槛）

**会弹**：
- 未登录用户点 E/S/T/Ask（仅在未配 BYOK 时）
- 未登录用户点 AccountMenu

**不弹**：
- 扩展首次打开
- 已配 BYOK 用户按 E（走直路径）
- 本地功能（高亮 H / Tweaks / Outline）
- 已登录 Free 用户超过 20 次 → 变 UpgradePrompt（不是 Login）

### 6.2 Google OAuth · `launchWebAuthFlow` 实现

```ts
async function signInWithGoogle() {
  const redirectTo = chrome.identity.getRedirectURL()
  // → https://<extension-id>.chromiumapp.org/

  const { data } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  })

  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: data.url,
    interactive: true,
  })

  const hash = new URLSearchParams(new URL(callbackUrl).hash.slice(1))
  await supabase.auth.setSession({
    access_token: hash.get('access_token')!,
    refresh_token: hash.get('refresh_token')!,
  })
}
```

**manifest.json 改动**：
```json
{
  "permissions": ["storage", "declarativeNetRequest", "identity", "alarms"],
  "oauth2": {
    "client_id": "<Google Cloud OAuth client id>",
    "scopes": ["openid", "email", "profile"]
  }
}
```

Supabase 控制台 → Auth → Providers → Google 填同一个 client id + secret。

### 6.3 Magic Link OTP

```ts
// Step 1
await supabase.auth.signInWithOtp({
  email: userEmail,
  options: { shouldCreateUser: true },
})

// Step 2
await supabase.auth.verifyOtp({
  email: userEmail,
  token: userTypedCode,
  type: 'email',
})
```

UI 在 Step 1 成功后切换到 "请输入邮箱中收到的 6 位码" 状态。

### 6.4 Session 存储 · 自定义 chrome.storage adapter

```ts
// reader/lib/supabase.ts
const chromeStorage = {
  getItem:    async (k: string) => (await chrome.storage.local.get(k))[k] ?? null,
  setItem:    async (k: string, v: string) => chrome.storage.local.set({ [k]: v }),
  removeItem: async (k: string) => chrome.storage.local.remove(k),
}

export const supabase = createClient(URL, ANON_KEY, {
  auth: {
    storage: chromeStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,  // launchWebAuthFlow 已手动处理
  },
})
```

### 6.5 跨 context 共享（reader ↔ sw.js）

- 物理层：`chrome.storage.local` 对两端都可见 → 免广播
- 通知层：`supabase.auth.onAuthStateChange` 两端都挂
- Token refresh：sw.js 注册 `chrome.alarms`（每 30 min 唤醒调 `supabase.auth.getSession()`）

### 6.6 登出

```ts
await supabase.auth.signOut()
// + 手动清理 chrome.storage.local：
//   🟢 云端来源的本地数据（6 表本地副本） → 全部清除
//   🔴 parsed / summary 缓存 → 清除
//   🔴 BYOK config → 保留（和账号无关）
// 云端数据不动，再次登录自动拉回
```

---

## 7. 数据迁移（首次登录）

### 7.1 状态机

```
[Login 成功]
  │
  ▼
查询云端：SELECT COUNT(*) FROM papers
  │
  ├─ cloud = 0
  │   ├─ local = 0  → 完成（新账号新设备）
  │   └─ local > 0  → M1 静默上传
  │
  └─ cloud > 0
      ├─ local = 0  → 纯拉云端（正常异地登录）
      └─ local > 0  → M2 冲突弹窗
```

### 7.2 M1 · 静默上传

```ts
async function pushLocalToCloud() {
  setMigrationState('in-progress')
  showBanner('Syncing your library to cloud...')

  const localLibrary = await readLocalLibrary()
  const paperIdMap = new Map<string, string>()

  // Step 1: papers（其他表依赖它的 id）
  for (const batch of chunk(localLibrary, 50)) {
    const { data } = await supabase.from('papers')
      .upsert(batch.map(p => ({ ...p, user_id: me })),
              { onConflict: 'user_id,paper_key' })
      .select('id, paper_key')
    data.forEach(r => paperIdMap.set(r.paper_key, r.id))
  }

  // Step 2: per-paper 附属数据
  for (const [paperKey, paperId] of paperIdMap) {
    for (const [storageKey, table] of [
      [`paper:${paperKey}:highlights`, 'highlights'],
      [`paper:${paperKey}:notes`,      'margin_notes'],
      [`paper:${paperKey}:memory`,     'memory'],
      [`paper:${paperKey}:chat`,       'chat'],
      [`paper:${paperKey}:canvas`,     'canvas'],
    ]) {
      const local = (await chrome.storage.local.get(storageKey))[storageKey]
      if (local) {
        await supabase.from(table).upsert(
          transform(local, { paper_id: paperId, user_id: me })
        )
      }
    }
  }

  setMigrationState('done')
  clearBanner()
  showToast('Synced')
}
```

### 7.3 M2 · 冲突弹窗 + 合并

三选项弹窗：
- **★ 合并**（默认） —— 两边保留，重叠按表合并规则
- 只用本地（覆盖云端）— 警告
- 只用云端（清除本地）— 警告

合并规则：

| 表 | 合并单位 | 冲突判定 |
|--|--|--|
| papers | per `paper_key` | `last_read` 更新者胜 |
| highlights | per `id` | 直接合集（uuid 不会真冲突） |
| margin_notes | per `id` | 直接合集 |
| memory | per `paper_id` | `updated_at` 新者胜 |
| chat | per `paper_id` | `turns` 数组合并（按 timestamp 去重） |
| canvas | per `paper_id` | `updated_at` 新者胜 |

### 7.4 Free 档 16 篇上限（Option B：限同步、不限本地）

- 上限常量：`FREE_LIBRARY_CAP = 16`（`reader/lib/constants.ts`）
- **已有数据豁免**：迁移过程本身不撞 16 篇上限；migrate 完即使 `papers.count > 16` 也不删
- 若 `papers.count >= 16`：LibraryDrawer 顶部显示 Cap Banner（§10.5）
- 用户之后加**新**论文：本地照常写入；`enqueueLibraryRowSync` 检测到 Free + 云端已满 + paper 不在云端 → 跳过 enqueue（云端不增长，本地不限）
- 已经在云端的 paper 后续更新（`last_read` / `role` / `judgment`）继续同步
- v1 不在 DB 层加 trigger，cap 检查在 `enqueueLibraryRowSync` 用 `select count(*) head` + `select paper_key`

### 7.5 异常路径

- **断网续传**：`migrationState = 'in-progress'` → 下次启动检测到后从 `paperIdMap` 续跑（`paperIdMap` 也进 chrome.storage.local）
- **batch 失败**：upsert 幂等，重试无副作用；UI banner 提示 "Migration paused · retry"
- **迁移中用户写入**：Banner 显示期间 SelectionToolbar 的 H / AI 生成按钮 disable（只读）
- **切账号 v1 不支持**：要求先登出（确认清本地）再登新账号

### 7.6 原子性

- batch 内全成全败（单次 HTTP = Postgres 隐式 transaction）
- batch 间独立提交 + 幂等重试
- **本地数据永不先清**：直到 `migrationState = 'done'`

---

## 8. `/ai-proxy` Edge Function

### 8.1 扩展侧路由

```ts
// reader/lib/ai.ts
async function callAI(messages: Message[], kind: AIKind) {
  const byok = await getConfig()
  if (byok.apiKey) {
    return streamOpenAI(byok, messages)  // BYOK 优先，永不走 Edge Function
  }
  const session = await supabase.auth.getSession()
  if (!session) {
    openLoginModal()
    return
  }
  return streamThroughProxy(session, messages, kind)
}
```

### 8.2 协议

```
POST https://<project>.supabase.co/functions/v1/ai-proxy
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "kind":     "explain" | "summarize" | "translate" | "ask",
  "messages": [...],
  "stream":   true
}

---- 响应 ----
200  text/event-stream（OpenAI SSE 透传）
401  missing/invalid JWT
402  { "tier":"free","used":20,"limit":20,"upgrade_url":"..." }
403  { "reason":"sync-tier-no-managed-ai" }
500  { "error":"openai-failed" }
```

### 8.3 Edge Function 实现（Deno）

Edge Function 把"是否允许 + 扣配额"完全下放给 `increment_ai_usage()`（§5.5）—— tier / period / limit 均由 DB 函数根据 `auth.uid()` 查 subscriptions 推导，Edge Function 代码里不再传这些参数，避免把信任点放在 JWT 调用方。

```ts
// supabase/functions/ai-proxy/index.ts
Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization')
  if (!auth) return new Response('Unauthorized', { status: 401 })

  // 用户的 JWT 透传进 supabase client —— RPC 里 auth.uid() 就是这个用户
  const supa = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: auth } },
  })
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // 原子扣减 —— 所有逻辑在 DB 函数里（§5.5）
  // 返回值：-1 = 超限；>= 1 = 扣减后的新 used 值
  // 抛 'sync tier has no managed ai' 异常 = Sync 档
  let newUsed: number
  try {
    const { data, error } = await supa.rpc('increment_ai_usage')
    if (error) {
      if (error.message.includes('sync tier')) {
        return json({ reason: 'sync-tier-no-managed-ai' }, 403)
      }
      throw error
    }
    newUsed = data as number
  } catch (e) {
    return json({ error: 'quota-check-failed' }, 500)
  }

  if (newUsed === -1) {
    // 读 tier 仅为了构造 402 payload
    const { data: sub } = await supa.from('subscriptions')
      .select('tier').eq('user_id', user.id).single()
    const limit = sub?.tier === 'pro' ? 300 : 20
    return json({ tier: sub?.tier ?? 'free', used: limit, limit,
                  upgrade_url: UPGRADE_URL }, 402)
  }

  const body = await req.json()
  const oaResp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,    // v1 统一 gpt-4o-mini
      messages: body.messages,
      stream: true,
    }),
  })

  EdgeRuntime.waitUntil(logUsage(supa, user.id, body.kind))

  return new Response(oaResp.body, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
})
```

### 8.4 扩展侧响应处理

```ts
switch (resp.status) {
  case 200: renderStream(resp.body); break
  case 402: openUpgradePrompt(await resp.json()); break
  case 403: openToast('Sync 档不含托管 AI · 请用 BYOK 或升级到 Pro'); break
  case 401: clearSession(); openLoginModal(); break
  case 500: openToast('Service glitched · retry or switch to BYOK'); break
}
```

### 8.5 成本监控（`ai_usage_log`）

- 每次调用异步 `EdgeRuntime.waitUntil(logUsage(...))` 不阻塞响应
- token 数取自 OpenAI 响应最后一个 SSE chunk 的 `usage` 字段
- 后台运营查询：`SELECT tier, sum(prompt_tokens+output_tokens), count(*) FROM ai_usage_log GROUP BY tier, date_trunc('day', created_at);`
- RLS 默认拒绝客户端，仅 service_role 写入

### 8.6 Env Vars

```
OPENAI_API_KEY    =sk-...
OPENAI_BASE_URL   =https://api.openai.com/v1
OPENAI_MODEL      =gpt-4o-mini
UPGRADE_URL       =https://paperflow.app/pricing
```

---

## 9. Stripe 订阅

### 9.1 Stripe 一次性配置

| 配置 | 值 |
|--|--|
| Product 1 | PaperFlow Sync |
| Price 1 | $4/月 recurring `price_sync_monthly` |
| Product 2 | PaperFlow Pro |
| Price 2 | $12/月 recurring `price_pro_monthly` |
| Webhook endpoint | `https://<project>.supabase.co/functions/v1/stripe-webhook` |
| Webhook events | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` |

### 9.2 Checkout 流程

```
用户 → UpgradePrompt → 选 Sync / Pro
  → 扩展 POST /create-checkout-session { tier }
  → Edge Function 调 stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: user.id,   // ← webhook 靠它对账户
      metadata: { tier },             // ← 'sync' | 'pro'，webhook 从这里取
      line_items: [{ price: priceId, quantity: 1 }],
      success_url, cancel_url,
    })
  → 返回 { url }
  → 扩展 chrome.tabs.create({ url })
  → 用户完成支付
  → Stripe POST /stripe-webhook (async)
  → Webhook UPSERT subscriptions（service_role 绕 RLS）
  → 扩展 Realtime 推送 → AccountMenu 自动刷新
```

### 9.3 Webhook handler

```ts
// supabase/functions/stripe-webhook/index.ts
Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')!
  const rawBody = await req.text()
  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET)
  } catch { return new Response('bad sig', { status: 400 }) }

  const supa = createClient(SB_URL, SERVICE_ROLE)

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object
      // tier 从 session.metadata 取（在 create 时 set）
      // —— line_items 默认不展开，无法从这里推断 tier
      const tier = s.metadata?.tier as 'sync' | 'pro'
      // expires_at 是 session 过期（~24h），不是订阅周期末
      // —— 必须 retrieve 订阅对象拿 current_period_end
      const sub = await stripe.subscriptions.retrieve(s.subscription as string)
      await supa.from('subscriptions').upsert({
        user_id: s.client_reference_id,
        tier,
        stripe_customer_id: s.customer,
        stripe_subscription_id: s.subscription,
        current_period_end: new Date(sub.current_period_end * 1000),
      })
      break
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object
      await supa.from('subscriptions').update({
        current_period_end: new Date(sub.current_period_end * 1000),
      }).eq('stripe_subscription_id', sub.id)
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object
      await supa.from('subscriptions').update({
        tier: 'free',
        stripe_subscription_id: null,
        current_period_end: null,
      }).eq('stripe_subscription_id', sub.id)
      break
    }
  }
  return new Response('ok', { status: 200 })
})
```

### 9.4 安全 + 幂等

- **签名验证必做**：`stripe.webhooks.constructEvent` + `STRIPE_WEBHOOK_SECRET`
- **天然幂等**：UPSERT by user_id，重放无副作用
- **Service role 写**：webhook 不带用户 JWT，绕 RLS 才能写 subscriptions
- **Stripe 重试 3 天**：对 5xx 响应会自动重试

### 9.5 Billing Portal

```ts
async function openBillingPortal() {
  const { data } = await supabase.functions.invoke('create-portal-session')
  chrome.tabs.create({ url: data.url })
}

// Edge Function create-portal-session：
const { data: sub } = await supa.from('subscriptions')
  .select('stripe_customer_id').eq('user_id', user.id).single()

const session = await stripe.billingPortal.sessions.create({
  customer: sub.stripe_customer_id,
  return_url: 'https://paperflow.app/billing',
})
return json({ url: session.url })
```

Portal 由 Stripe 托管：改卡、看 invoice、切 Sync↔Pro、取消订阅。扩展侧 0 行 UI 代码。

### 9.6 Env Vars（补充）

```
STRIPE_SECRET_KEY         =sk_live_...
STRIPE_WEBHOOK_SECRET     =whsec_...
STRIPE_PRICE_SYNC         =price_...
STRIPE_PRICE_PRO          =price_...
SUPABASE_SERVICE_ROLE_KEY =eyJ...
```

---

## 10. UI 触点

### 10.1 LoginModal

- 浮层 ~450×auto · 圆角 + 软阴影
- 结构：headline（"解锁 20 次免费 AI 试用 + 跨设备同步"） → Google 按钮 → "或" 分隔 → 邮箱 + "发送 OTP" 按钮 → 底部 "跳过 · 使用 BYOK"
- Email 提交后区域变成 6 位 OTP 输入框 + "验证"
- 关闭：ESC / 点 backdrop / 点 "跳过"（无显式 X，强调软门槛）

### 10.2 AccountMenu（4 状态）

**未登录**：
- "登录 · 同步 + 20 次 AI 试用" 主按钮
- BYOK 状态条（沿用现有显示）

**Free 登录**：
- 用户头像 + email + `FREE` 徽章
- AI 试用进度条 `12 / 20 · 剩 8 次`
- "↑ 升级到 Pro · $12/月"
- "⚙ BYOK 设置" / "↩ 登出"

**Sync 登录**：
- `SYNC` 徽章（sky 色）
- 文案："AI 走你的 BYOK · 无限用"
- "↑ 升到 Pro · +$8/月 托管 AI"
- "💳 管理订阅 (Portal)" / "↩ 登出"

**Pro 登录**：
- `PRO` 徽章（forest 色）
- 月度进度条 `本月 245 / 300`
- "💳 管理订阅" / "⚙ BYOK 设置" / "↩ 登出"

### 10.3 UpgradePrompt

- 浮层 ~560×auto
- 触发：20/20 试吃用尽 / 300/300 月用尽 / Library 尝试第 31 篇
- 两卡并列：
  - Sync $4 — 跨设备同步 + Library 不限 + BYOK
  - Pro $12 — 跨设备同步 + **300 次/月托管 AI** + BYOK（右上"推荐"徽章，walnut 色描边）
- 底部：`配一把 OpenAI key 继续免费用` | `暂不升级`

### 10.4 QuotaChip

- top-bar 里 AccountMenu **左侧**的小药丸
- 5 种色态：
  - `Free · 12/20` walnut（normal）
  - `⚠ Free · 18/20` 浅橘（60-90%）
  - `Free · 0 left` 浅红（>= 100%）
  - `Pro · 245/300` forest
  - `Sync · BYOK` sky
- 隐藏条件：未登录 且 BYOK 已配（纯 BYOK 流无配额概念）
- 随 `ai_usage` realtime 自动刷新
- 点击展开 AccountMenu，配额段高亮

### 10.5 Library Cap Banner

- LibraryDrawer 顶部
- 触发：Free 档 + `papers.count >= FREE_LIBRARY_CAP`（当前 16）
- 浅橘背景 + 左侧 3px 色条 + "Library at 16 / 16 (free) · 存量已保留 · 再加新论文不再同步到云端 · 升级解除"
- 右侧 "升级" 按钮 → UpgradePrompt（trigger='library'）
- 用户 dismiss 后会在 enqueueLibraryRowSync 下一次因 cap 跳过同步时被复活

### 10.6 组件位置 + 文件结构

```
top-bar.tsx（改造）:
  [outline] [variant] [theme] [tweaks] [ai toggle]
  ────────────────── [QuotaChip] [AccountMenu ▼]
                          ↑ 新              ↑ 改造

reader/components/
  ├── login-modal.tsx           ← 新
  ├── upgrade-prompt.tsx        ← 新
  ├── quota-chip.tsx            ← 新（可内联在 top-bar.tsx）
  └── library-cap-banner.tsx    ← 新（挂 LibraryDrawer 顶）

reader/lib/
  ├── supabase.ts               ← 新（client + chromeStorage adapter）
  ├── sync-queue.ts             ← 新（离线写入队列）
  ├── migration.ts              ← 新（M1 + M2）
  ├── ai.ts                     ← 改造（加 /ai-proxy 路径）
  └── storage.ts                ← 改造（双写层 · 本地 + Supabase）

background/sw.js                ← 改造（realtime 订阅 + alarms refresh）

supabase/migrations/001_init.sql         ← 新（9 表 + RLS + realtime + triggers + RPC）
supabase/functions/ai-proxy/index.ts     ← 新
supabase/functions/stripe-webhook/index.ts     ← 新
supabase/functions/create-checkout-session/index.ts   ← 新
supabase/functions/create-portal-session/index.ts     ← 新
```

视觉语言保持：全套用 `styles/tokens.css` 现有色板 + 字体，不引入新字体、色彩、打破"暖纸质感"总调。

---

## 11. 错误处理 · 离线 · 测试

### 11.1 失败矩阵

| 故障 | 扩展表现 | 用户动作 |
|--|--|--|
| Supabase 全挂 | BYOK 继续；新数据入 offline queue；LoginModal 提示 "服务暂不可用" | 读 / 高亮继续 |
| OpenAI 5xx | `/ai-proxy` 返回 500 → toast "Service glitched · retry" | 重试 / 切 BYOK |
| Session 过期 | SDK autoRefresh；失败 → 401 → 弹 LoginModal | 重新登录 |
| 网络丢失 | `navigator.onLine=false` → 写入入队 | 无操作，上线自动同步 |
| Stripe webhook 丢 | Stripe 3 天重试；UI 暂旧 tier | 等 / 手动 `refresh-tier` |
| 付款失败 | v1 被动（Stripe + 邮箱通知 + 到期降 free） | 去 Billing Portal 改卡 |
| 迁移中断 | `migrationState='in-progress'` 续跑 | 无感 |
| 并发双 tab AI 越 limit | Postgres 行锁保证；第二请求收 402 | 无感或升级 |

### 11.2 离线写入队列

```ts
// reader/lib/sync-queue.ts
type PendingOp = { table: string; op: 'upsert'|'delete'; row: any; ts: number }
const KEY = 'sync:queue'

async function enqueue(op: PendingOp) {
  const q = (await chrome.storage.local.get(KEY))[KEY] ?? []
  q.push(op)
  await chrome.storage.local.set({ [KEY]: q })
}

async function drain() {
  if (!navigator.onLine) return
  const q = (await chrome.storage.local.get(KEY))[KEY] ?? []
  for (const op of q) {
    try {
      if (op.op === 'upsert')  await supabase.from(op.table).upsert(op.row)
      if (op.op === 'delete')  await supabase.from(op.table).delete().eq('id', op.row.id)
    } catch { return }  // 失败保留队列
  }
  await chrome.storage.local.remove(KEY)
}

window.addEventListener('online', drain)
// 额外触发：扩展启动、登录成功后
```

**写操作统一经 `syncWrite()` wrapper**：online 直写 Supabase + 本地；offline 写本地 + 入队。**读永远先读本地（乐观）**。队列按顺序保留，upsert 幂等。

### 11.3 测试矩阵

| 层 | 工具 | 覆盖什么 |
|--|--|--|
| 单元 | vitest（已有） | `chromeStorage` adapter、migration transform、quota 边界、sync-queue |
| DB 集成 | `supabase start` 本地 + vitest | RLS（跨 user 隔离）、`increment_ai_usage` 并发、migration 幂等 |
| Stripe 集成 | `stripe listen` + 测试卡 4242 | webhook 签名、3 事件的 tier 变化 |
| AI 集成 | OpenAI mock fixtures | `/ai-proxy` 各 status、流式 pipe、配额扣减 |
| E2E / 手动 | Chrome + 本地 Supabase | 登录→迁移→AI 试用→升 Pro→管理订阅 |

---

## 12. v1 Scope

### 12.1 ✅ v1 交付

- Google OAuth（`launchWebAuthFlow`）
- Magic Link OTP
- 9 表 Schema + RLS + Realtime publication
- 6 key 上云 / 4 key 留本地 / tweaks 走 `chrome.storage.sync`
- Migration M1 自动 + M2 冲突弹窗
- `/ai-proxy` Edge Function（原子扣配额 + OpenAI 流式）
- Stripe Checkout + Webhook + Billing Portal
- LoginModal / AccountMenu（4 态） / UpgradePrompt / QuotaChip / LibraryCapBanner
- 离线写入队列
- Realtime 订阅 6 用户数据表 + subscriptions
- Free 30 篇硬拒绝 + 已有数据豁免

### 12.2 ⏸ v2 延后

- 年订 / promo code / trial period
- Apple / GitHub 登录
- Pro 分档模型（gpt-4o vs mini）
- AI 结果缓存（同 paragraph 24h 命中）
- 每秒 rate limit
- `invoice.payment_failed` 挽回邮件
- E2E 加密
- DB trigger 级 Library 硬限
- 团队订阅 / 共享 Library
- Canvas 导出 / 公开分享

### 12.3 实施阶段

| 阶段 | 预估 | 内容 |
|--|--|--|
| A · 后端骨架 | 4-6 天 | supabase CLI 本地起栈 · `migrations/001_init.sql` · RPC · Edge Function 空骨架 |
| B · 扩展登录 + 同步 | 1 周 | `supabase.ts` + adapter · LoginModal · AccountMenu 改造 · storage.ts 双写层 · Realtime |
| C · 迁移 | 3-5 天 | M1 静默上传 · M2 冲突弹窗 · migrationState 续传 · 只读态 |
| D · 托管 AI | 3-5 天 | `/ai-proxy` 完整 · `ai.ts` 路由 · QuotaChip · UpgradePrompt 402 分支 |
| E · 订阅 | 3-5 天 | `create-checkout-session` · `stripe-webhook` · BillingPortal · 订阅 Realtime |
| F · Polish | 3-5 天 | Library Cap Banner · 离线队列 · 错误 toast / modal 文案 · E2E 手动 · i18n |

**总 ≈ 4-6 周**（indie 节奏）

---

## 13. 验收标准

v1 done 的四条金线：

1. **Happy path**：新用户装扩展 → 点 E → LoginModal → Google 登录 → AI 结果流式 → margin note 保存 → 换设备登录同账号看到相同 note
2. **金钱流**：Free 用户耗完 20 次 → UpgradePrompt → 选 Pro → Stripe Checkout → 支付 → AccountMenu tier=Pro，配额 0/300 → AI 可继续
3. **逃生门**：任意时刻未登录用户点 "跳过 · 使用 BYOK" → 配了 key → AI 正常工作，全程无登录
4. **跨设备同步**：A 加高亮 → B realtime 看到 · A 写 memory → B realtime 刷新 · A 离线加高亮 → 上线自动同步 → B 看到

---

## 14. 设计评审附录（2026-04-24 · /plan-design-review 决定）

7 passes 走完，15 项设计决定落定，本节覆盖所有改动。**本节是权威**：凡与上文 §1–§13 冲突之处，以本节为准。实施阶段按本节细化。

### 14.1 Pass 1 · 信息架构

**1.1 · LoginModal headline 优先级** ★
- 大字：`解锁 20 次免费 AI 试用`（主价值、onboarding 紧迫价值）
- 小字：`+ 在所有设备看到相同的 Library / 高亮 / Memory`（长期价值）
- 样式：headline 字号 20px / 600 / `--font-serif` / `--ink`；subhead 12px / 400 / `--ink-soft`

**1.2 · UpgradePrompt 加一条关键差异行**
- 在 Sync / Pro 两卡下方插入一条横向差异 row：`托管 AI： — (Sync) / 300 次/月 (Pro)` 粗体 + walnut 色字，明确呈现"差 $8 换来的能力"

**1.3 · AccountMenu 加「切换账号」入口**
- 登录态菜单在"登出"上方新增一项 `切换账号`
- 点 → 弹 confirm modal："此操作会登出当前账号并清除本地 BYOK 配置和同步数据缓存" → 确认 → 直接弹 LoginModal
- 未弹 modal 时通过 Escape 取消

### 14.2 Pass 2 · 交互状态

**2.1 · Migration 进度 UX** ★
- Banner 改为：`☁ Syncing your library  {done} / {total} papers` + 下方 progress bar
- Progress 按 batch 的 paperIdMap 填充比例，非线性但用户感知有进展
- 完成时 toast：`Synced · 40 papers, 200 highlights now in the cloud · Sign in on another device to see them there`（见 3.x 的 aha moment 叠加）
- 失败时 banner 变为：`⚠ Migration paused · Retry` 红字 + 右侧 Retry 按钮

**2.2 · OTP 重发 rate limit**
- `Send OTP` 按钮按下后变为 `Send again (60s)` 倒数，禁用点击
- 倒数到 0 → 恢复激活、文案变 `Send again`
- 倒数期间 subhead 文字 `No email? Check spam, then resend in {N}s`

**2.x · 默认交互状态规范（所有新组件适用）**
- **Loading**：触发异步调用的按钮 press 后 `disabled` + 前置 `⏳` 图标 + 原文案保留；max 10s timeout
- **Error (inline)**：input 下方 `var(--foxglove)` 色 caption，2 行内
- **OTP expired/invalid**：自动清空输入 + 切换为 `Code expired or invalid — [Send new code]` 链接
- **Subscription skeleton**：AccountMenu 打开时 subscription fetch 未完成 → tier 相关行显示 `var(--ink-ghost)` skeleton
- **QuotaChip realtime 断连**：隐性 fallback 到 30s poll，无 UI 标示

### 14.3 Pass 3 · 用户旅程

**3.1 · Pro → Free 降级过渡 modal** ★
- 检测条件：`subscriptions.tier` 最近 7 天内从 `pro`/`sync` 变 `free` + 本地 session 仍有效 + 打开 reader 的首次
- 弹一次性 modal：`你的 Pro 订阅已到期` + 说明 + `[Restore]` 按钮（→ Billing Portal）+ `[暂不]`
- 关闭后写 `chrome.storage.local.churnModalSeen=true`，不再弹
- 对应 webhook：`customer.subscription.deleted` 处理后，extension 启动检测 `subscriptions` 变化触发此 modal

**3.2 · 试用即将用尽 heads-up**
- 条件：trial `used ≥ 15`（即剩 ≤ 5）
- AI 流完成后，`SelectionResultCard` 和 `MarginNote` 脚部（Copy/Close 按钮同列下方）追加一行：
  - 文字：`{N} free trials left · 配一把 key 或 [升级]`
  - 颜色：`var(--ink-faded)` 浅色
  - 点"升级" → UpgradePrompt
  - 不打断流式输出

**3.x · Migration aha moment**（§7.2 改动）
- Migration 成功 toast 文案改为：`Synced · {N} papers, {M} highlights now in the cloud · Sign in on another device to see them there`
- 第二行小字，给用户明确的下一步

### 14.4 Pass 4 · AI slop 清除

**4.1 · 所有 list item icon 去 emoji**
- AccountMenu 菜单项所有 emoji（⚙ ↩ 💳 ↑）替换为 `reader/components/icons.tsx` 的 SVG（需新增 `I.LogOut`、`I.CreditCard`，与现有 icon 同风格：`stroke=currentColor`、`fill=none`、`stroke-width=1.5`、默认 14px）
- 升级项用 `var(--forest)` 字色强化为 primary CTA，无需加 icon
- 登出 / 切换账号 / 管理订阅各配对应 SVG

**4.2 · 所有 modal / popup 入场动画**
- 统一使用现有 `fade-up 120ms ease-out`（AccountMenu 已有）
- 不新增动效类型（避免 motion slop）
- 出场不要求动画

### 14.5 Pass 5 · 设计系统对齐

**5.1 · tokens.css 新增 5 个变量**（两份都要改：`styles/tokens.css` + `chrome-extension/reader/styles/tokens.css`）
```css
:root {
  /* 已有：--paper --ink --walnut --foxglove --forest --sky --ink-highlight 等 */

  /* 新增：QuotaChip 和 Banner 用的 state 色 */
  --amber:          #C68148;  /* warn 前景 */
  --amber-soft:     #FCE5D4;  /* warn 背景 */
  --foxglove-soft:  #FADBD8;  /* critical 背景（前景用现有 --foxglove） */
  --forest-soft:    #D6E5DC;  /* Pro 徽章 / chip 背景 */
  --sky-soft:       #D6E2EE;  /* Sync 徽章 / chip 背景 */
}
[data-theme="dark"] {
  --amber:          #D4956A;
  --amber-soft:     #3C2E20;
  --foxglove-soft:  #3F2528;
  --forest-soft:    #2A3A2E;
  --sky-soft:       #2A3540;
}
```

**5.2 · QuotaChip 5 态全部走 tokens**
- Free normal：`--paper-deep` bg + `--ink-soft` fg
- Free warn（60–90%）：`--amber-soft` bg + `--amber` fg
- Free critical（≥ 100%）：`--foxglove-soft` bg + `--foxglove` fg
- Pro：`--forest-soft` bg + `--forest` fg
- Sync：`--sky-soft` bg + `--sky` fg
- 隐藏条件：未登录 且 `config_apikey` 已配

### 14.6 Pass 6 · 响应式 + 可访问性

**6.1 · UI 语言策略：i18n-ready 架构，v1 仅 zh-CN** ★
- 新建 `reader/lib/i18n.ts`：`export const messages = { 'zh-CN': {...}, 'en-US': {} }`，提供 `t(key)` 函数默认回退 zh-CN
- 所有 UI 字符串（LoginModal / AccountMenu / UpgradePrompt / QuotaChip / Banner / migration 文案 / error toast）必须从 messages 读，不得 hardcode
- v2 填 `en-US` 全套翻译即可支持英文，无代码重构

**6.2 · A11y 规范**
- LoginModal / UpgradePrompt / Churn modal：
  - `role="dialog"` + `aria-modal="true"` + `aria-labelledby={headlineId}`
  - 挂载时 focus 第一个可交互元素（Google 按钮 / 邮箱 input）
  - Tab 循环在 modal 内；Shift-Tab 反向
  - Escape 关闭（已有规范，延续）
  - Click on backdrop 关闭
- Icon-only button 必须 `aria-label`（已本地化）
- Touch target 最小 32×32px（扩展桌面）
- Focus indicator：`outline: 2px solid var(--walnut); outline-offset: 2px` 全局统一
- CI 加 `@axe-core/playwright` 或等价 snapshot 测试，5 个组件所有状态过 WCAG AA（4.5:1 text contrast）

**6.3 · 暗色模式**
- 5 个新组件完全基于 CSS variables（`--paper`, `--ink`, etc.）
- 自动跟随 `[data-theme='dark']`，无需独立 dark 样式表
- 光暗模式不同颜色值在 tokens.css 已分支定义

**6.4 · 窄窗口响应**
- LoginModal：默认 `width: 450px`；窗口宽 `< 500px` 时 `width: 100vw; border-radius: 0`
- UpgradePrompt：默认 `width: 560px`；窗口宽 `< 600px` 时 Sync / Pro 两卡竖向堆叠
- Churn modal：同 LoginModal 规则
- AccountMenu：230px 固定不改（popover 不是 modal）
- Banner：跟随 reader 主容器宽度（reader 自身已 responsive）

### 14.7 Pass 7 · 未决设计决定

**7.1 · BYOK 云端同步策略** ★（**影响 §3.2 + §5.1 + §6.6**）
- 新建 Supabase 表 `byok_prefs(user_id pk, base_url, model, updated_at)`（已加 DDL in §5.1）
- RLS：`create policy "own prefs" on byok_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());`
- 加入 realtime publication（已在 §5.3 更新）
- `chrome.storage.local` 拆两份：
  - `config_apikey`：纯字符串，apiKey only，**永远本地**
  - `config_prefs`：`{ baseURL, model }` 缓存，云端 mirror
- 扩展 `ai.ts` 路由逻辑改为：检查 `config_apikey` 非空即走 BYOK（baseURL / model 从 `config_prefs` 取）
- 登录成功后：fetch `byok_prefs` → 若云端有记录 → 回填 `config_prefs`；若本地已有 `config_prefs` 且云端空 → push 本地到云
- 登出：**清 `config_apikey` + `config_prefs`**（覆盖 §6.6 原规则：原规则说 BYOK 保留，此决定反转为不保留）
- 本地编辑 baseURL / model（Options 页）→ 即时 upsert `byok_prefs`
- 影响：Alice / Bob 共享 Mac 场景下，Bob 登录不会误用 Alice 的 key；Alice 多设备 baseURL/model 自动同步

**7.2 · `chat.turns` JSONB 元素 schema** ★（**影响 §5.1 + §7.3**）
- `chat.turns` 数组元素形状：
  ```ts
  type ChatTurn = {
    id:      string    // 客户端生成的 uuid (e.g., crypto.randomUUID())
    role:    'user' | 'assistant'
    content: string
    ts:      number    // epoch ms, client-issued at write time
  }
  ```
- Migration §7.3 chat merge 规则改为：按 `id` 去重 → 按 `ts` asc 排序 → 覆盖 `chat.turns`
- 并发冲突：两端同时生成新 turn 时 uuid 不同 → 都保留（按 ts 排序后自然穿插）；这是 acceptable，因为 chat 是 append-only 语义

**7.3 · paperflow.app 域名 + Vercel landing pages** ★（**影响 §9.2 + §12.3**）
- 注册 `paperflow.app`（~$12/年）
- 部署 3 个静态页：
  - `/billing/success`：文案"支付成功 · 订阅已激活 · 关闭此标签页返回 PaperFlow，新 tier 将在几秒内显示"
  - `/billing/cancel`：文案"本次支付未完成 · 你可以随时再次尝试"
  - `/pricing`：UpgradePrompt 的 web fallback（极简版，同两卡设计）
- 所有页面用 `styles/tokens.css` 的色板 / 字体，视觉与扩展一致
- 部署：Vercel free tier，自动 HTTPS
- 列为 Phase E 的前置依赖

**7.4 · Cancel-pending 中间态** ★（**影响 §5.1 + §9.3 + §10.2**）
- `subscriptions` 表加 `cancel_at_period_end boolean default false` + `canceled_at timestamptz`（已在 §5.1 DDL 中）
- Webhook `customer.subscription.updated` 处理器扩展：检查 `event.data.object.cancel_at_period_end`，若 `true` 写入 `subscriptions.cancel_at_period_end=true, canceled_at=new Date()`；若从 `true` 变回 `false`（用户 restore）→ 更新回 false + canceled_at=null
- AccountMenu Pro / Sync 态新增"取消待畀"子态（基于 `cancel_at_period_end=true`）：
  - 徽章变为 `PRO · ending {date}` 或 `SYNC · ending {date}`（灰底）
  - 下方新增一行：`Subscription ending in {N} days · [Restore]`
  - Restore 点 → Billing Portal（Stripe 自动处理 resubscribe）

**7.5 · `ai-proxy` 500 error adaptive 文案**
- 扩展接收 500 时根据 `config_apikey` 存在与否切换 toast 文案：
  - `config_apikey` 已配：`Service glitched · [Retry] or [Switch to BYOK]`
  - 未配：`Service glitched · [Retry] or [Set up OpenAI key]`（点 → 打开 Options 页）

**7.6 · Library Cap Banner 可 dismiss**
- Banner 右侧追加 `[×]` 关闭按钮
- Dismiss 写 `chrome.storage.local.libraryCapBannerDismissed={timestamp}`
- 下次用户尝试添加第 31+ 篇论文被硬拒绝 → 重置 `libraryCapBannerDismissed`，banner 重新出现

**7.7 · E2E 手动测试 checklist 细化**（补充 §11.3）
```
E2E 手动 (Chrome + 本地 Supabase)：
  1. 装扩展 → 打开 arxiv 论文 → 点 E → LoginModal 弹出
  2. Google 登录 → session 建立 → 弹 migration banner (若有本地数据)
  3. Migration 完成 toast → 验证 cloud 里 papers/highlights/memory 条数正确
  4. 继续点 E 至 20/20 → UpgradePrompt 弹
  5. 选 Pro → Stripe Checkout (test card 4242…) → 支付
  6. 回到扩展 → AccountMenu tier=Pro，配额 0/300
  7. 管理订阅 → Stripe Portal → 取消 → AccountMenu 显示 "取消待畀 · ending {date}"
  8. 换第二台设备登录同账号 → 验证 papers/highlights/byok_prefs 都可见
  9. 在设备 A 新增 highlight → 设备 B realtime 出现 (< 5s)
  10. 断网 → 设备 A 新增 highlight → 连网 → 设备 B 出现
  11. 设备 B 登出 → 本地 config_apikey + 云端缓存都清；papers/memory 本地副本清
  12. 同设备用另一账号登录 → apiKey 空状态 → 不会误用前账号 key
```

### 14.8 本附录影响的章节一览

| 原章节 | 改动 |
|--|--|
| §3.1 | 加 `config_prefs` ↔ `byok_prefs` 表 |
| §3.2 | BYOK 拆分：`config_apikey` 本地 + `config_prefs` 云端 mirror |
| §5.1 | `subscriptions` 加 2 列；新增 `byok_prefs` 表（**已在 DDL 中**） |
| §5.3 | Realtime 加 `byok_prefs`（**已在 SQL 中**） |
| §6.6 | 登出额外清 `config_apikey` + `config_prefs` |
| §7.3 | chat merge 规则改为 id 去重 + ts 排序（ChatTurn 结构见 14.7.7.2） |
| §9.3 | Webhook `updated` 分支处理 `cancel_at_period_end` |
| §10.x | 全部 UI 组件按 14.1–14.6 的规范执行 |
| §11.1 | 500 error 文案 adaptive（14.7.7.5） |
| §11.3 | E2E checklist 细化（14.7.7.7） |
| §12.1 | v1 scope 补加：byok_prefs 同步、churn modal、trial hint、cancel-pending UI、i18n 结构、landing pages、cancel_at_period_end 处理 |

### 14.9 已考虑但 v2 延后 (NOT in scope)

本附录过程中被讨论过、但 v1 不做的事：

- **BYOK apiKey 云端加密同步（pgcrypto + Vault）**：本可以做到"真正跨设备 apiKey 自动回填"，但当前 v1 决定 apiKey 永远本地（见 7.1）。v2 若要做，需：① 新增 `apikey_encrypted bytea` 列；② Edge Function 用 `pgp_sym_decrypt` 解密后交给扩展；③ Supabase Vault 托管加密 key。
- **Migration aha moment 更进一步**：比如推一条 email "Your library is now synced · Sign in on your other device at..."，v2 可加，v1 先不发任何额外邮件。
- **Trial heads-up 更进一步**：v2 可加 in-product notification center（仅一次 toast "5 free trials left"），v1 只在 SelectionResultCard 脚部显示。
- **Pro 分档模型**：Pro 用 gpt-4o, Free trial 用 gpt-4o-mini（当前 Edge Function env var `OPENAI_MODEL` 全档单模型）。
- **AI 结果缓存**：同 paragraph 24h 内命中已有 margin_note 直接返回，不调 OpenAI；v2 省成本大项。
- **每秒 rate limit**：除 20/300 配额外的高频限频（防爆刷）；v2 加。
- **`invoice.payment_failed` 挽回邮件**：v1 仅 Stripe 原生邮件 + churn modal；v2 自发内容邮件 win-back。
- **团队订阅 / 共享 Library / Canvas 公开分享**：v2 的产品扩展方向。
- **DB trigger 级 Library 硬限**：v1 只在扩展 INSERT 前 `select count(*)`；v2 加 trigger 防绕开。
- **i18n 填 en-US**：v1 仅 zh-CN，v2 加。
- **Apple / GitHub OAuth Provider**：v1 仅 Google + 邮箱。
- **Canvas 导出 / Markdown 导出**：与账号 / 同步不相关，独立 v2。

### 14.10 已复用的现有资产 (What already exists)

- `styles/tokens.css`（根 + `chrome-extension/reader/styles/`）—— warm paper 色板 + 字体 + 阴影 scale，所有新组件不得引入新 font / 色，只能 extend 现有 tokens
- `reader/components/icons.tsx`—— 已有 icon 风格规范（`stroke-width=1.5` / `fill=none`），新增 `I.LogOut` / `I.CreditCard` 等必须 match
- `reader/components/top-bar.tsx`—— 已有 `AccountMenu` + `IconButton` 组件，v1 改造不重写
- `reader/components/overlays.tsx`—— 已有 overlay 机制（CmdK, LibraryDrawer, TweaksPanel），LoginModal / UpgradePrompt / Churn modal 沿用同 `fade-up` 动画 + backdrop 模式
- `reader/lib/storage.ts`—— 已有 `chrome.storage.local` wrapper + quota 错误处理（`QuotaExceededError`），新 `config_apikey` / `config_prefs` / `migrationState` 走同机制
- 原型 `ink-streaming` / `paragraph-pinged` / `ink-pen-draw` 动画（spec 2026-04-20 §3.3）—— AI 流式结果反馈沿用，新增 footer hint（14.3.3.2）不干扰这些

### 14.11 设计评审计分卡

| Pass | 初始分 | 修后分 | Resolved |
|--|--|--|--|
| 1. Information Architecture | 7/10 | 9/10 | 3 issues |
| 2. Interaction State Coverage | 5/10 | 8.5/10 | 2 asks + 5 default rules |
| 3. User Journey & Emotional Arc | 5/10 | 8/10 | 2 asks + 1 default |
| 4. AI Slop Risk | 8/10 | 9.5/10 | 2 default rules |
| 5. Design System Alignment | 8/10 | 9/10 | 5 new tokens + icon specs |
| 6. Responsive & A11y | 3/10 | 8.5/10 | 1 ask + 4 default rule sets |
| 7. Unresolved Decisions | —/n | —/resolved | 4 asks + 3 defaults |
| **Overall** | **6/10** | **8.7/10** | 15 decisions locked |

---

## 15. 工程评审附录（2026-04-24 · /plan-eng-review 决定）

4 sections 过完。本节聚焦 ship-blocker 工程问题。优先级：本节 > §14 > §1–§13 冲突时。

### 15.1 架构 · sync:queue 跨账号清理

**问题**：§6.6 / §14.7.7.1 的登出清理列表不含 `sync:queue`。Alice 离线写入 → queue 累积 → 未 drain 登出 → Bob 登录 → drain 用 Bob JWT 提交 Alice 的数据。跨账号数据穿帮。

**Fix**：§6.6 + §14.7.7.1 登出清理追加一行 —— 清 `chrome.storage.local.sync:queue`。未 drain 的写入会丢，但 post-logout 用户已无 session 合法写入，丢更安全。

### 15.2 架构 · /ai-proxy 每用户 rate limit（v1 升级，非 v2 延后）

**问题**：§14.9 把 rate limit 归 v2 延后。但 20-次试吃配额独自不足以防爆刷 —— 100 条假注册账号 × 20 次 × $0.01 = $20 + CPU/带宽。上线前真实经济风险。

**Fix**：

- `supabase/migrations/005_rpc.sql` 追加：
  ```sql
  create table rate_limits (
    user_id       uuid references auth.users on delete cascade,
    window_start  timestamptz not null,
    count         int not null default 0,
    primary key (user_id, window_start)
  );
  -- RLS: 无客户端 policy（仅 service_role）

  create or replace function rate_limit_check(
    p_max_count int default 10,
    p_window_sec int default 300
  ) returns boolean
  language plpgsql security definer as $$
  declare
    v_uid uuid := auth.uid();
    v_bucket timestamptz;
    v_count int;
  begin
    if v_uid is null then raise exception 'unauthenticated'; end if;
    -- 5 分钟滑动窗口 bucketed
    v_bucket := date_trunc('minute', now()) -
                (extract(minute from now())::int % (p_window_sec / 60)) * interval '1 minute';
    insert into rate_limits (user_id, window_start, count)
    values (v_uid, v_bucket, 1)
    on conflict (user_id, window_start) do update
      set count = rate_limits.count + 1
    returning count into v_count;
    if v_count > p_max_count then
      return false;
    end if;
    return true;
  end $$;
  grant execute on function rate_limit_check(int, int) to authenticated;
  ```

- `/ai-proxy` 在 `increment_ai_usage` **之前**先 `supa.rpc('rate_limit_check')`；返回 false → 响应 `429 Too Many Requests` + `Retry-After: 60` 头 + body `{ reason: 'rate-limited' }`
- 扩展侧 `ai.ts` 处理 429：toast "请求频繁，请 1 分钟后重试"，不弹 UpgradePrompt，不扣配额

**工程量**：~10 行 SQL + ~4 行 Deno + 1 toast 文案。

### 15.3 代码质量 · 直接落入（不开问题）

- **Migration 脚本拆分**：原 `migrations/001_init.sql` 拆为 5 个文件：
  - `001_tables.sql` (9 表 DDL + byok_prefs + rate_limits)
  - `002_rls.sql` (policies)
  - `003_realtime.sql` (publications)
  - `004_triggers.sql` (updated_at + on_auth_user_created)
  - `005_rpc.sql` (increment_ai_usage + rate_limit_check)
- **`supabase/.env.example`**：Phase A 交付物，列全 9 个 env vars + 注释来源（OpenAI / Stripe / Supabase 三处）
- **storage-schema 防漂移**：`reader/lib/storage-schema.ts` 定义 `StorageKey` union type + `getItem<K extends StorageKey>(k: K)` typed wrapper，14+ 个 key 统一入口
- **Edge Function shared layer**：新建 `supabase/functions/_shared/` 含 `auth.ts`（getUserFromJWT） / `responses.ts`（json/error helpers） / `clients.ts`（supabase client factories）。4 个 Edge Function 不再重复代码

### 15.4 测试 · 必加的测试（不开问题）

以下是 spec §11.3 之外**本评审强制追加**的测试（Phase 对应阶段 ship 时必须同步完成）：

**Phase A (DB 测试)**
- RLS 隔离测试：对 9 个表各跑 user-A / user-B 矩阵（SELECT / INSERT / UPDATE / DELETE × A-own / B-own / anon）。单个参数化 test 循环覆盖 63 cases
- `increment_ai_usage` 并发测试：2 个 JWT client 同时调用，from used=299 limit=300，预期只有一个 return 300，另一 return -1
- `rate_limit_check` 滑动窗口测试：快速调 11 次，第 11 次 return false；等 5 分钟后窗口重置

**Phase B (扩展测试)**
- `chromeStorage` adapter getItem/setItem/removeItem 单元测试（vitest）
- `storage-schema.ts` 类型安全测试（TS compile-time check for unknown keys）
- `sync-queue.ts` enqueue / drain / 登出清空 test
- LoginModal Google OAuth mock / OTP 60s 倒数 test

**Phase C (Migration 测试)**
- M1 happy 路径（~100 papers）
- M1 batch-3-of-5 失败 → 重启恢复（`migrationState` 续传）
- M2 冲突合并规则：6 表各自语义按 §7.3 + §14.7.7.2 ChatTurn
- Free 30 篇超额豁免

**Phase D (AI Proxy 测试)**
- `/ai-proxy` 5 种 status code（200/401/402/403/429/500）path 覆盖
- BYOK 路径 **regression 测试**（iron-rule）：修 ai.ts 后原 BYOK 行为不变
- OpenAI mock fixture：流式 pipe 验证
- Adaptive 500 文案测试（with / without BYOK）

**Phase E (Stripe 测试)**
- Webhook 签名验证：happy / 篡改 body / 错误 secret 三个 case
- `checkout.session.completed` → tier 写入 + current_period_end 取自 retrieved subscription（非 s.expires_at）
- `subscription.updated` 的 `cancel_at_period_end=true` 分支 → DB 列更新
- 幂等：同 event id 重放无副作用

**Phase F (E2E)**
- §14.7.7.7 的 12 步 checklist 全跑一次（Chrome + 本地 Supabase）
- LLM eval：`OPENAI_MODEL` env var 变化时，用固定 prompt fixture 跑 10 次，输出 rubric 评分对齐 baseline

### 15.5 性能 · 直接落入（不开问题）

- **Realtime 订阅 scoping**：扩展按页面/paper_id 过滤订阅（Reader 页只订阅当前 paper 的 5 表 + 全局订阅 subscriptions/byok_prefs/papers 3 个）。避免每用户全表全量订阅
- **Migration 大 Library 预提示**：§7.5 补一句 —— 本地 >= 500 papers 时 M1 开始前 pre-banner "This may take a minute, please stay open"
- **Chat turns 长度硬限**：§5.1 chat 表 comment 加 "turns jsonb 超 1MB 时触发分表写 `chat_history` —— v1 不做，v2 迁移"
- **Edge Function 冷启动**：不优化（可接受 500ms 首次延迟，已有流式 UX 遮盖）

### 15.6 v1 scope 更新

**v1 新增**（从 §14.9 v2 延后清单移回）：
- `rate_limits` 表 + `rate_limit_check` RPC + /ai-proxy 集成（§15.2）
- 登出清 sync:queue（§15.1）

**v1 新增测试**：§15.4 的 5 phase testing checklist 作为 DoD

### 15.7 工作流拆分（并行化）

| Step | Modules | Depends on |
|--|--|--|
| A 后端骨架 | `supabase/migrations/*`, `supabase/functions/_shared/*` + 4 functions scaffold | — |
| B 扩展登录 | `reader/lib/{supabase,storage-schema,sync-queue,i18n}.ts`, `reader/components/{login-modal,account-menu}.tsx`, `top-bar.tsx` | — |
| C 迁移 | `reader/lib/migration.ts` | A, B |
| D 托管 AI | `reader/lib/ai.ts`, `supabase/functions/ai-proxy/*` | A, B |
| E 订阅 | `supabase/functions/{stripe-webhook,create-checkout-session,create-portal-session}/*`, `reader/components/upgrade-prompt.tsx`, paperflow.app landing pages | A, B |
| F polish | 各处 + library-cap-banner, churn-modal, error-adaptive | C, D, E |

**并行 lanes**：
- Lane 1 ‖ Lane 2：**A 和 B 独立 worktree 并行**（零模块重叠）
- Lane 3：**C ‖ D ‖ E 三路并行**（A+B merge 完成后；各自 touch 不同 lib 模块与 functions 子目录，无冲突）
- Lane 4：F

**Compression**：原 4-6 周线性可压到 ≈ 3 周 wall-clock，代价是 2-3 worktree 同时开。

