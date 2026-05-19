# ADR 0002 — Codex 可选模型：动态发现 + 跟 auth 同生命周期

- **状态**：Accepted（2026-05-19）
- **相关 ADR**：[ADR-0001](0001-codex-byok-via-device-code-flow.md)（device-flow 决策）
- **相关 spec**：[`docs/specs/2026-05-12-spec-codex-subscription-byok.md`](../specs/2026-05-12-spec-codex-subscription-byok.md)
- **承担实现**：v0.2.1 — Codex preset 用户可选模型 + user_code 复制按钮
- **拆 slice**：本 ADR 覆盖 v0.2.1 全部决策；落地按 vertical slice 分四个 PR：
  - **Slice 1 (#22)** — backend plumbing：`fetchCodexModels` + 自动 discovery + `codex_available_models` 存储 + `cfg.model` 走通 + logout 清理（**本 PR**）
  - **Slice 2 (#24)** — Options 页 `<Field label="MODEL">` + `<select>` UI + storage change 监听（blocked by Slice 1）
  - **Slice 3 (#25)** — Stored-model mismatch self-heal + 一次性 toast（blocked by Slice 1）
  - **Slice 4 (#23)** — user_code 复制按钮（独立，平行进行）

## 上下文

v0.2.0 把 Codex preset 的模型**硬编码**为 `gpt-5.2`：
- `byok-presets.ts:80` — `defaultModel: 'gpt-5.2'`
- `codex-stream.ts:50` — `body.model: 'gpt-5.2'`

Spec §12.2 Q4 pre-spike 时假想过一条 fallback 偏好链（`gpt-5-codex` → `gpt-5` → `gpt-5-thinking-high` → `gpt-4o` → `availableModels[0]`），意图是「OpenAI 多个模型时智能挑」；post-spike 实测发现 `/codex/models` 当前只返回 `gpt-5.2`，那条偏好链彻底是 dead code。

随着 OpenAI 后续给 Codex 加新模型（gpt-5.3 / 6 / codex-mini 之类是迟早的事）、订阅 tier 差异化（Plus vs Pro vs Team 可用模型不同）变得现实，硬编码方案的成本会上升：
- 每个新模型要发版 / 不能反映用户实际订阅范围 / 旧 fallback 链跟现实脱钩。

## 决策

**Codex preset 的可选模型清单从 `chatgpt.com/backend-api/codex/responses` 同源的 `/codex/models?client_version=0.42.0` 端点动态发现**；清单的生命周期跟 OAuth token 绑定（一起出生、一起 refresh、一起死）；用户在 BYOK 行通过一个新的 `<Field label="MODEL">` + 原生 `<select>` 选择。

### 关键决策点

1. **发现源**：`GET chatgpt.com/backend-api/codex/models?client_version=0.42.0`，`Authorization: Bearer <access_token>` + `OpenAI-Beta: responses=experimental`（跟 `/codex/responses` 同 headers）
2. **fetch 时机**：
   - `loginPoll` 完成 token 交换后立即调一次
   - `getValidAccessToken` 触发 refresh 成功后顺便再调一次
   - **不** Options 页打开时再调（无意义 thrash）
   - **不** 维护 TTL（订阅模型权限对 ChatGPT 账号是稳定的，refresh 链路顺带刷新足够）
3. **存储**：新增 typed key `codex_available_models: string[]`，存 `chrome.storage.local`，归属于 codex auth 命名空间（跟 `codex_auth_tokens` / `codex_auth_user` 一起；logout 时一起清）
4. **Fetch 失败兜底**：写入 `[CODEX_DEFAULT_MODEL]`（常量 = `'gpt-5.2'`，spike 实测可用）。AI 调用永远不因 model 发现失败而 fail
5. **默认值**：
   - 首次登录 → `availableModels[0]`（让 OpenAI 自己决定排序）
   - v0.2.0 升级用户 → `cfg.model` 不动（已经是 `'gpt-5.2'`，继续用）
   - Stored model 不在 fetched list → 一次性 action toast `Model "<old>" is no longer available. Switched to "<new>".` + 自动 reset 到 `availableModels[0]`
6. **UI**：Slice 5 已存在的 `<Field label="CHATGPT ACCOUNT">` 下方新增独立 `<Field label="MODEL">`；select 即使只有 1 项也渲染、enabled（透明度 > 节省一行像素）
7. **codex-stream 改造**：`body.model` 从硬编码 `'gpt-5.2'` 改读 `cfg.model`；如果 `cfg.model` 为空字符串则 fall back 到 `CODEX_DEFAULT_MODEL`（防御式，避免向 OpenAI 发空 model 触发 400）

## 备选方案及拒绝原因

### Alt A1：写死 enum

```ts
export const CODEX_MODELS = ['gpt-5.2'] as const;
```

- ❌ **维护成本高**：OpenAI 加新模型需要发版 + 公开 mirror sync + 提示用户升级
- ❌ **跟 tier 失联**：Plus / Pro / Team 实际可用范围不同，写死的列表无法反映
- ❌ **没有 spike 时观察的事实优势**：spike 已经知道 `/codex/models` endpoint 存在且 working

### Alt A2：让用户自由文本输入 model id

- ❌ **UX 差**：用户得去查模型 id
- ❌ **没护栏**：填错 → 403，错误归因困难
- ❌ **跟 Slice 5 的 polish 目标矛盾**：Slice 5 刚把 codex 的 apiKey/baseURL/model 三个 text input 都藏起来，再拉一个 text input 回来是回退

### Alt B1：TTL-cached fetch（每 N 小时重新 fetch）

- ❌ **复杂度无收益**：TTL 边界 + 老 cache + 新 fetch 失败这三个分支都得测；订阅模型权限本身又是稳定的
- ❌ **跟 token 生命周期重复**：access_token 已经有 10 天 TTL + refresh 链路，model list 跟着搭便车比独立 TTL 更简单

### Alt B2：每次 callAI 调用前都 fetch

- ❌ **wasteful network thrash**：每次 AI 调用前多一次 GET，论文阅读场景下用户连续触发选词翻译会高频拉爆
- ❌ **latency**：streaming 体验断了

### Alt C1：保留 spec §12.2 Q4 的硬编码偏好链

```
gpt-5-codex → gpt-5 → gpt-5-thinking-high → gpt-4o → availableModels[0]
```

- ❌ **基于假想清单**：post-spike 验证只有 `gpt-5.2`，链头那几个根本不在 `availableModels` 里，整条链触发不到
- ❌ **未来不可预测**：OpenAI 后续加什么模型我们也不知道哪个该排前面；硬编码偏好就是预测，预测就会过时

### Alt C2：UI 不让用户选，永远用 `availableModels[0]`

- ❌ **失去用户控制**：不同任务可能想用不同模型（chat vs 翻译 vs 总结），剥夺选择没必要
- ❌ **跟 BYOK 整体哲学冲突**：BYOK 的核心是「用户控制」，其它 preset 都让用户填 model

## 经验证的关键事实

1. **`/codex/models` 端点存在且响应正常**（Phase 0 spike Round 2 验证）
2. **当前订阅返回值只有 `gpt-5.2` 一项**（spike 实测；spec §15.5 记录）
3. **`access_token` TTL 10 天**（ADR-0001 §15.2）— refresh 频率天然低，搭便车 fetch model list 的总开销可以忽略
4. **OpenAI 的 model 排序在 response 里是有意义的**（Codex CLI 的实现也是直接取第一项作为默认，不做客户端排序）

## 实现拓扑

```
options/main.tsx
  └─ <Field label="CHATGPT ACCOUNT">
       <CodexLoginPanel />              ← Slice 1
     </Field>
  └─ <Field label="MODEL">              ← v0.2.1 NEW
       <select>{availableModels.map(...)}</select>
     </Field>
        │ value = cfg.model
        ↑ onChange → setCfg({ ...cfg, model: e.target.value })
        ↑ options = readFromStorage('codex_available_models')
                      ↑ updated by chrome.storage.onChanged listener

reader/lib/codex-auth.ts
  ├─ fetchCodexModels(accessToken): Promise<string[]>  ← v0.2.1 NEW
  ├─ loginPoll(...)
  │    └─ after token exchange: fetchCodexModels + setItem('codex_available_models', ...)
  └─ getValidAccessToken({ forceRefresh })
       └─ after successful refresh: fetchCodexModels + setItem(...)

reader/lib/codex-stream.ts
  └─ streamCodexResponses
       └─ body.model = messages-passed-in-model || CODEX_DEFAULT_MODEL  ← was 'gpt-5.2' literal

reader/lib/byok-presets.ts
  └─ export const CODEX_DEFAULT_MODEL = 'gpt-5.2'      ← v0.2.1 NEW (constant)
     defaultModel: CODEX_DEFAULT_MODEL                  ← was literal
```

凭据 / 状态存储补充：

| key | 内容 | v0.2.1 |
|---|---|---|
| `codex_auth_tokens` | OAuth tokens | 已存在 (v0.2.0) |
| `codex_auth_user` | `{ email }` | 已存在 (v0.2.0) |
| `codex_available_models` | `string[]` | **新增** |

`logout-cleanup.ts` 同步加一行 `removeItem('codex_available_models')`。

## 影响

- spec §12.2 Q4 的偏好链描述作废，ADR-0002 是新的 SoT
- spec §15.5 的「只接受 `gpt-5.2`」要更新为「当前实测返回 `['gpt-5.2']`；扩展不再硬编码，从 `/codex/models` 动态获取」
- `logout-cleanup.ts` 新增清理项
- `tests/codex-auth.test.ts` 新增 `fetchCodexModels` 单测（mock 200/4xx/5xx/网络错）
- `tests/codex-stream.test.ts` 已有的「body.model = gpt-5.2」断言要更新为「body.model = (caller-supplied) || fallback」
- 公开 mirror 同步：CHANGELOG.md 加 v0.2.1 段，README 不需要改（disclosure block 与模型选择无关）

## 后续工作

- 实现侧 TDD（cycle 1: fetchCodexModels happy path → cycle 2: fetch 失败 fallback → cycle 3: UI 渲染读 storage → cycle 4: select onChange 写 cfg.model → cycle 5: mismatch toast → cycle 6: codex-stream cfg.model wiring → cycle 7: logout cleanup → cycle 8: i18n 9 locales）
- v0.2.1 bump + release
- 监控：OpenAI 加新模型时验证扩展自动接住（手动 smoke 即可）

## 未决

PR #30 review 期间识别的几个边界情况，明确**不阻塞 v0.2.1**：

- **并发 refresh 触发双 toast**：`getValidAccessToken` 没做 in-flight dedup（见 #28），fast 连续 refresh 可能触发两次 mismatch toast。两次写都是相同的 idempotent 值，状态一致；用户只是看到两次提示。等 #28 落地后顺带消除。
- **非 active codex 配置不参与 reconcile**：用户有多个 codex BYOK 行时，只 reconcile active 那一个。inactive 行的 stale model 在 Slice 2 picker 里仍会渲染，激活时第一次 callAI 才会 400，被 Slice 3 #12 的 `CodexApiSurfaceChangedError` toast 兜住。可接受。
- **Logout 不清 cfg.model**：登出只清 `codex_available_models` + tokens，BYOK 行的 model 字段不动。下次登录 discovery 跑完会再次触发同一个 mismatch toast，相当于自然重放。这是有意的——避免登出时改用户编辑过的字段。
