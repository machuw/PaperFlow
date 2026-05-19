# ADR 0001 — Codex BYOK 用 OAuth Device Code Flow，不复用 chatgpt.com cookie

- **状态**：Accepted（2026-05-18）
- **相关 spec**：[`docs/specs/2026-05-12-spec-codex-subscription-byok.md`](../specs/2026-05-12-spec-codex-subscription-byok.md)
- **相关 plan**：[`docs/plans/2026-05-12-plan-codex-subscription-byok.md`](../plans/2026-05-12-plan-codex-subscription-byok.md)
- **承担实现**：Slice 1 (#8 codex-auth) + Slice 2 (#9 codex-stream)

## 上下文

PaperFlow 需要让 ChatGPT Plus/Pro/Team 用户用自己的订阅额度驱动扩展内 AI 调用，不另收 per-token 费用。spec §3.3 最初的假设是「借浏览器原生 cookie jar → 调 `chatgpt.com/api/auth/session` 换短期 JWT → 调 `/backend-api/codex/responses`」，并据此在 §14 写下「不做 OAuth 跳转客户端：OpenAI 不发第三方 Codex client_id，所以借浏览器 session 是唯一可行路径」。

Phase 0 spike 实测后，这个判断需要修正。

## 决策

放弃 cookie-based session steal，改用 **OAuth Device Authorization Grant**（RFC 8628），签发端 `auth.openai.com`：

- `client_id = app_EMoamEEZ73f0CkXaXp7hrann`（Codex CLI 公开使用的 client_id，可复用）
- `scope = openid profile email offline_access`
- 用户在选项页点「连接 ChatGPT」→ 扩展 `POST auth.openai.com/api/accounts/deviceauth/usercode` 拿 `user_code` + `device_auth_id` → 在新 tab 打开 `auth.openai.com/codex/device?user_code=...` → 用户在 ChatGPT 账号下确认 → 扩展 `POST /api/accounts/deviceauth/token` 轮询；授权成功时**服务端把 `code_verifier` 连同 `authorization_code` 一起返回**，扩展再用这对值 `POST /oauth/token` 兑换 `access_token` + `refresh_token`
- **不是 RFC 7636 PKCE**：真 PKCE 要求**客户端**生成 `code_verifier`、SHA-256 哈希成 `code_challenge` 在 `/usercode` 时发出去；这里 `code_verifier` 是服务端发的「一次性兑换 secret」，不是密码学绑定。当前实现复用 Codex CLI 的 OAuth 流程原样，没有自加一层 PKCE
- token 全量存 `chrome.storage.local`（**永不入云**，遵守 `feedback_byok_local_only.md`）；`access_token` 10 天 TTL，`refresh_token` 长 TTL（用 `grant_type=refresh_token` 续期）
- AI 调用直接打 `chatgpt.com/backend-api/codex/responses?client_version=0.42.0`，`Authorization: Bearer <access_token>` + `OpenAI-Beta: responses=experimental`
- 401 一次性 forceRefresh 自愈；二次 401 抛 `CodexReloginRequiredError`，UI 引导重登

## 备选方案及拒绝原因

### Alt A：spec §3.3 原方案 — chatgpt.com cookie + `/api/auth/session`

- ❌ **CORS HARD GATE 风险**：`chatgpt.com/api/auth/session` 是否允许 `chrome-extension://` origin 访问，必须实测。即使过了，也是无契约接口，CSP / Cloudflare / fingerprinting 任一变化都会一夜失效。
- ❌ **凭据生命周期不可控**：依赖用户主动保持 chatgpt.com 登录态，扩展无法主动 refresh — JWT 过期后只能让用户回到 chatgpt.com 手动刷新。
- ❌ **法务风险更高**：通过非公开私有 API 偷 session 是「滥用」嫌疑较大的行为；device code 是 OpenAI 自己设计的对外授权机制，是「面向开发者的公开协议」。

### Alt B：原生 binary helper（spike 阶段被用户明确拒绝）

- ❌ 用户体验门槛过高（要装 native messaging helper）
- ❌ 跨平台维护成本高
- ❌ Chrome Web Store 审核风险

### Alt C：FSA（File System Access API）写 codex CLI 的 token 文件

- ❌ Phase 0 spike 中已验证 dead：MV3 SW 权限不持久化，每次冷启动都要重新授权目录
- ❌ Cross-origin 场景下浏览器拒绝 `showOpenFilePicker`

## 经 Phase 0 spike 校验的关键事实

1. **Per-grant session 模型**：OpenAI 给每次 device-code grant 签发独立 session — `codex login --device-auth` 之间互不影响。stress test：扩展登录前 baseline 200/200 → 用户在另一处 `codex login --device-auth` → 扩展登录后再次 baseline 200/200。没有「one-session-only」互斥问题。
2. **`access_token` TTL = 864000s ≈ 10 天**：远长于一般 JWT（小时级），refresh 调用频率天然低。
3. **ChatGPT 账号要打开 `device code authorization` 开关**（2026 年 5 月之后默认关）：spec §15 与 onboarding modal 都要明确告诉用户在哪里开。
4. **`/backend-api/codex/responses` 请求形态**：
   - URL 必须带 `?client_version=0.42.0` 否则 400
   - body `model='gpt-5.2'`、`store: false`、`stream: true`、system message 必须摘出来放到顶层 `instructions` 字段
   - SSE delta 字段是 `json.delta`（非 `choices[0].delta.content`），结束信号是 `data: [DONE]`

## 实现拓扑

```
options/codex-login-panel.tsx
  ↓ loginStart() / loginPoll()
reader/lib/codex-auth.ts   ← OAuth 全生命周期（login/refresh/logout）
  ↑ getValidAccessToken({ forceRefresh })
reader/lib/codex-stream.ts ← Codex Responses 适配器（SSE + 401 自愈）
  ↑ streamCodexResponses(messages, signal, onChunk)
reader/lib/ai.ts           ← 在 callAI 里基于 sentinel baseURL 分流
  哨兵：cfg.baseURL === 'chatgpt://codex'
```

凭据存储：

| key | 内容 |
|---|---|
| `codex_auth_tokens` | `{ access_token, refresh_token, id_token?, expires_at, token_type }` |
| `codex_auth_user`   | `{ email }` |

两个 key 都在 `logout-cleanup.ts` 里登出时清除。

## 影响

- spec §3.3 的「3 个端点」表里 `/api/auth/session` 和 `/backend-api/models` **没用上**，留作历史记录；只保留 `/backend-api/codex/responses`
- spec §14 那条「不做 OAuth 跳转客户端」**作废**，本 ADR 是新的 SoT
- spec §3.4 的 `codex-session.ts` 模块名 → 实际叫 `codex-auth.ts`，签名也变了（基于 OAuth grant 而不是 cookie cache）
- spec §15 追加 spike 实测结论（per-grant session、10 天 TTL、device authorization 开关）

## 后续工作

- 用户手动 smoke test：真 Chrome 里走完登录 → 触发 Overview tab summarization → 看到流式输出
- 监控：CWS 公开发行前需观察 401 自愈失败率
- 文档：onboarding modal 已把 ChatGPT 账号端的 device authorization 开关步骤写进 i18n 9 语种
