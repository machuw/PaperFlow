# 通过本地 OpenAI-compat 桥接用 Claude Code 跑 PaperFlow Agent（claude-code-openai-wrapper）

更新于 2026-04-29 · 适用 PaperFlow v1.2-agent (Phase 12+)

> **状态：** Verified by author + runtime tested on 2026-04-29（wrapper v2.2.0 / commit `a0d8e4d`、Claude Code CLI 2.1.123、Python 3.11、macOS）。

***

## 0. 历史背景

本文先前的版本（commit `aaf63c7`）尝试用 [LiteLLM](https://github.com/BerriAI/litellm) 作为 OpenAI-compat 桥接层，前提是「LiteLLM 把请求路由给本机 `claude` CLI 复用订阅」。**那个前提是错的**：LiteLLM 的 `anthropic/<model>` provider 是直连 `api.anthropic.com` 的 hosted-API 客户端——没有真实 Anthropic API key 时直接 401，并不会调用本机 CLI。LiteLLM 当前没有「spawn 本地 CLI」的 provider 实现。MED-4 跨 AI runtime 验证暴露了这一点。

本期 pivot 到 **`RichardAtCT/claude-code-openai-wrapper`**——一个 FastAPI 实现的桥接层，启动时通过本机 `~/.claude` 凭据走 Claude Agent SDK，对外暴露 OpenAI-compatible 端点（`/v1/models` + `/v1/chat/completions` + `/v1/messages`）。这是当前已知唯一能在桌面端「免 key 跑订阅 Claude Code」的开源桥接。

***

## 1. 一句话价值

如果你已经订阅了 Anthropic Claude Code（订阅版按月付费、CLI 本地登录），就可以**复用同一个订阅**让 PaperFlow 的 agent 跑 Claude Sonnet 4.5——**不需要再单独申请 Anthropic API key**，也不会再扣 Stripe 配额。

实现方式：本地起一个 [`claude-code-openai-wrapper`](https://github.com/RichardAtCT/claude-code-openai-wrapper)（OpenAI-compat 接口）→ wrapper 通过 Claude Agent SDK 读取本机 `~/.claude` 订阅凭据 → PaperFlow 把 BYOK baseURL 配为 `http://localhost:8000/v1` 直连。

> 本文档仍然保留文件名 `2026-04-29-claude-code-via-litellm.md` 以保持 git 历史延续；preset id 仍为 `local-litellm` 以保持 chrome.storage 与 Supabase `byok_configs.name` 的迁移兼容。下一期（Phase 13）可视情况重命名为 `local-bridge`。详见 §8。

***

## 2. 前置条件

| 条目 | 要求 |
|------|------|
| Claude Code CLI | 已 [安装](https://docs.claude.com/en/docs/claude-code/quickstart)，本地终端 `claude --version` 可执行；并已通过 `claude /login` 完成订阅登录（或运行过 `claude auth login`，二者写入同一份 `~/.claude` 凭据） |
| `~/.claude` 目录 | 存在且包含登录后凭据（`ls -la ~/.claude`，应能看到 `agents`、`projects` 等子目录） |
| Python | 3.10、3.11、3.12 或 3.13（wrapper 在 `pyproject.toml` 中声明 `python = "^3.10"`） |
| Poetry | 已安装；若没有：`curl -sSL https://install.python-poetry.org \| python3 -`，然后 `export PATH="$HOME/.local/bin:$PATH"` |
| 端口 8000 | 本机 `lsof -i :8000` 为空（被占请用 `--port 8001` 启动 wrapper，并把 PaperFlow baseURL 同步改为 `http://localhost:8001/v1`） |
| PaperFlow 扩展 | 已安装、已登录账号（BYOK 多配置功能依赖 v1.2-agent Phase 12 上线后版本） |

***

## 3. 安装与启动

### 3.1 克隆 wrapper

锁定到验证过的 `v2.2.0` 版本（`a0d8e4d`），避免主分支变更带来的不确定性：

```bash
git clone --depth 1 --branch v2.2.0 https://github.com/RichardAtCT/claude-code-openai-wrapper
cd claude-code-openai-wrapper
```

### 3.2 安装依赖

```bash
poetry install
```

约 1–3 分钟，会装 FastAPI、uvicorn、`claude-agent-sdk` 等约 90 个包到 wrapper 自己的 virtualenv。

### 3.3 启动服务

```bash
poetry run uvicorn src.main:app --port 8000
```

启动期间会看到一段 banner 日志（约 10–15 秒），关键行：

```
Claude Code authentication validated: claude_cli
✅ Claude Agent SDK verified successfully
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

让该终端窗口保持运行（或 `tmux` / `screen` / `nohup` 后台化）。

> **关于身份验证：** wrapper 默认 auto-detect——如果已运行 `claude /login` 完成订阅登录，wrapper 直接使用 `~/.claude` 中的 OAuth token，**完全不需要**设置 `ANTHROPIC_API_KEY`。日志里 `auth_method=claude_cli` 即是这个状态。如果你显式设置了 `ANTHROPIC_API_KEY` 环境变量，wrapper 会优先走 API key（你按 token 计费，而不是订阅）。

***

## 4. PaperFlow 配置

1. 打开 PaperFlow Options 页面（右键扩展图标 → 选项 / Options）
2. 滚到「BYOK 配置」区
3. 点「+ 新建配置」
4. 在「预设」下拉选 **Local Claude (via wrapper)** ——baseURL / model / apiKey 自动填好：
   - baseURL: `http://localhost:8000/v1`
   - model: `claude-sonnet-4-5-20250929`
   - apiKey: `placeholder`（任意非空字符串；wrapper 默认不校验客户端 token，但 PaperFlow `agent-client.ts` 走 OpenAI SDK 协议，必须有一个非空字段）
5. 配置名填 `Claude via local wrapper`（任意，1-32 字符）
6. 点「保存」

保存后，你应该看到该行右侧出现绿色 chip 「**已检测到 (6 models)**」，证明 PaperFlow 在 1.5s 内成功 `GET http://localhost:8000/v1/models` 并解析出 6 条 Anthropic 模型。

7. 点行内的 radio 按钮把这个配置设为「当前活跃」

***

## 5. 验证

以下输出取自 2026-04-29 的实测（macOS 25.4 + Python 3.11.13 + wrapper v2.2.0 + Claude Code CLI 2.1.123）。

### 5.1 健康检查

```bash
curl -s http://localhost:8000/health
```

实测输出：

```json
{"status":"healthy","service":"claude-code-openai-wrapper"}
```

### 5.2 模型列表

```bash
curl -s http://localhost:8000/v1/models
```

实测输出（精简显示）：

```json
{"object":"list","data":[
  {"id":"claude-opus-4-5-20250929","object":"model","owned_by":"anthropic"},
  {"id":"claude-sonnet-4-5-20250929","object":"model","owned_by":"anthropic"},
  {"id":"claude-haiku-4-5-20251001","object":"model","owned_by":"anthropic"},
  {"id":"claude-opus-4-1-20250805","object":"model","owned_by":"anthropic"},
  {"id":"claude-opus-4-20250514","object":"model","owned_by":"anthropic"},
  {"id":"claude-sonnet-4-20250514","object":"model","owned_by":"anthropic"}
]}
```

### 5.3 一次 chat completion

```bash
curl -s -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer placeholder" \
  -d '{
    "model":"claude-sonnet-4-5-20250929",
    "messages":[{"role":"user","content":"Reply with exactly one word: hi"}]
  }'
```

实测输出（OpenAI-compat 信封完整、字段对齐）：

```json
{
  "id":"chatcmpl-cd323d380fae1271",
  "object":"chat.completion",
  "created":1777468564,
  "model":"claude-sonnet-4-5-20250929",
  "choices":[{
    "index":0,
    "message":{"role":"assistant","content":"...","name":null},
    "finish_reason":"stop"
  }],
  "usage":{"prompt_tokens":9,"completion_tokens":7,"total_tokens":16},
  "system_fingerprint":null
}
```

> **关于 `content` 字段：** 上面的 `"..."` 在 PaperFlow 实际跑 agent 时会是 Sonnet 的真实回复。在「另一个 Claude Code 实例正同时占用本机 CLI」的语境下（典型场景：你正用 Claude Code 在另一个终端编程，又同时让 wrapper 走同一份订阅），bundled SDK 可能短暂返回 `[Request interrupted by user]`——这是已知 wrapper / Claude Agent SDK 行为；关闭其它 `claude` 实例后再发请求即可拿到正常 assistant content。**注意：协议层 200 OK + OpenAI-compat 信封 + token usage 全部正确——这是 PaperFlow `agent-client.ts` 解析所依赖的全部约定**，所以 PaperFlow 端到端不受此影响。

### 5.4 PaperFlow 端到端

1. 切到任意 arXiv 论文阅读页
2. `⌘K` 打开命令面板 → 找 "Run agent demo"（开发菜单触发器，仅 dev build 可见）
3. 浏览器 DevTools → Network 标签找到 `/agent-run` 请求
4. 看 SSE 流持续推送 `text-delta` / `tool-input-available` / `tool-output-available` 帧
5. wrapper 终端窗口同步看到 `POST /v1/chat/completions HTTP/1.1 200 OK` 日志

如果 5 个步骤全跑通，**整条路径已贯通**。

***

## 6. 故障排查

| 症状 | 可能原因 | 排查 / 修复 |
|------|---------|------------|
| `poetry install` 报 `command not found: poetry` | Poetry 未装 / 不在 PATH | `curl -sSL https://install.python-poetry.org \| python3 -`，然后 `export PATH="$HOME/.local/bin:$PATH"` |
| 启动报 `OSError: [Errno 48] Address already in use` | 8000 端口被占 | `lsof -i :8000` 找占用进程 → 杀掉，或用 `--port 8001`（同时把 PaperFlow baseURL 改为 `http://localhost:8001/v1`） |
| 启动 banner 缺 `Claude Code authentication validated` | `~/.claude` 未登录 | 终端运行 `claude /login`（或 `claude auth login`）完成订阅登录，再重启 wrapper |
| 启动期间 SDK verify 卡死 ≥ 30 秒 | 本机 `claude` CLI 受阻或 OAuth token 过期 | 先 `claude --version` 验证可执行；再 `claude --print "hi"` 看能否本地直接对话；若 token 过期则重新 `claude /login` |
| `/v1/models` 返回 200 但 `data: []` | wrapper 启动了但 SDK 校验失败 | 看启动 log 中是否出现 `❌ Claude Agent SDK verification failed`；按上一行修复 |
| Chat completion 返回 `[Request interrupted by user]` | 另一个 `claude` 实例正占用本机 CLI | 关闭其它 `claude` 进程（`pgrep claude` 看活跃 PID），或减少并发；wrapper 自身 200 OK + 协议合规，PaperFlow 端到端不受影响 |
| PaperFlow chip 显示 黄色「localhost:8000 未响应」 | wrapper 未启动或端口不一致 | 先核对终端窗口 wrapper 在跑；再核对 PaperFlow baseURL 与 wrapper 实际监听端口一致 |
| Agent 跑出来但 wrapper log 报 `429 too_many_requests` | 触发 wrapper 内置限流（默认 chat 10 req/min） | 短暂等待 60 秒；或在 `.env` 设 `RATE_LIMIT_CHAT_PER_MINUTE=60` 后重启 wrapper |
| 想跑 GPT-4o 而不是 Claude | 无需切预设 | 在「BYOK 配置」新建一行用 `OpenAI` 预设，填真实 sk-…，切换 active 即可 |

***

## 7. 附录 A：用 OpenAI Codex CLI 走相似的本地路径

如果你用 OpenAI [Codex CLI](https://github.com/openai/codex)（订阅 ChatGPT Plus / Team），思路相同——找一个本地桥接把订阅 CLI 包装成 OpenAI-compat 端点。**目前没有发现一个像 claude-code-openai-wrapper 那样成熟的 Codex CLI 桥接**，社区方案仍在演进中。如果你最终找到一个能稳定起本地端点的桥接（端口 N），把 PaperFlow Options 的 baseURL 改为 `http://localhost:N/v1`、model 改为对应 ID、apiKey 仍可用任意非空占位字符串，即可复用 PaperFlow 主流路径——和 §4 完全一致。

> 在 Codex 桥接成熟之前，建议直接用 OpenRouter（preset `OpenRouter` + 真实 OpenRouter key + `openai/gpt-4o`），这是当前最实际的「订阅外」OpenAI 接入。

***

## 8. 注意事项

### 为什么不直接装 Anthropic Claude Agent SDK 到 PaperFlow 仓库？

我们考虑过、并明确决定**不引入** `@anthropic-ai/claude-agent-sdk` 到 PaperFlow 自己的代码（chrome-extension/ + supabase/functions/）。原因（详见 `.planning/notes/2026-04-27-agent-runtime-selection.md` §4）：

- 该 SDK 需要 `spawn child_process` 起本地 `claude` 进程；Chrome 扩展（MV3）的 service worker 不允许 spawn
- 即便绕到 Edge Function (Deno) 也不允许 spawn
- 该 SDK 的设计中心是「Claude Code 本身」而不是论文阅读器；做的事情和 PaperFlow agent 长程任务高度重叠但不正交
- 当前已知的 BYOK 路径走法在 SDK 文档里不是主路径，存在已知 bug

**`claude-code-openai-wrapper` 的 OpenAI-compat 路径是当前唯一支持的 Anthropic 接入方式**——它是用户在自己机器上跑的进程，对 PaperFlow 而言只是一个 OpenAI-compat HTTP 端点；PaperFlow 主流路径（`agent-client.ts` → Edge Function → BYOK passthrough）零代码改动；spawn 发生在用户主机的 wrapper 进程内部，不进 Edge Function 也不进扩展。

**重要边界：** wrapper 内部依赖 `claude-agent-sdk`（这是 wrapper 作者自己仓库的 dependency；见 wrapper `pyproject.toml`）。PaperFlow 仓库本身仍然没有引入 `@anthropic*` 依赖——这条不变量由静态守卫测试 `chrome-extension/tests/no-anthropic-sdk-grep.test.ts` 强制：任何 PR 在 `chrome-extension/` / `supabase/functions/` 里 import `@anthropic-ai/*` 或 `@anthropic/*` 都会 CI 红灯。Wrapper 是用户自行起的外部进程，不受这条守卫约束。

### 关于 preset id 仍为 `local-litellm` 的命名兼容

Phase 12 Plan 06 在 commit `4ea68b6` 已经把 `local-litellm` 这个 preset id 写入：

- chrome.storage.local 的 `config_apikeys[<configId>]` map（key 与 BYOKPreset.id 不直接耦合，但用户已保存的 config 行 `name` 字段可能是 `Local LiteLLM …`）
- Supabase `public.byok_configs` 行的 `name` 字段（用户面前的「配置名」）
- 单元测试 `chrome-extension/tests/byok-presets.test.ts` 的多个断言

为了 **不破坏** Wave 2 已 ship 的 byok-configs migration（v1.1 单 config 自动迁为 'Default' 行），本期 **保留 preset id `local-litellm`**——只把 `label`、`defaultBaseURL`、`helpText` 三个面向用户的字段更新为 wrapper 语义。下一期（Phase 13 设置页 redesign）若决定彻底重命名为 `local-bridge` / `local-claude-wrapper`，需要另起 migration 把 `byok_configs.name` 历史值 `Local LiteLLM …` 平迁到新名——本期不做。

### 何时可能切到原生路径？

- Anthropic 推出官方 OpenAI-compat 端点（`api.anthropic.com/v1` 兼容）→ 我们移除 wrapper 依赖，直连
- 用户反馈「wrapper 启动太麻烦」累计较多 → 评估 v1.5 引入 Native Messaging Host (B 路径) 或 Companion app (C 路径)
- 上游 wrapper 项目停止维护 → 评估 fork 维护、或转向其他桥接、或正式落地 B/C 路径

目前 v1.2-agent 的设计就是 A 路径（文档驱动的本地桥接）这一条。

***

## 参考链接

- claude-code-openai-wrapper 仓库：<https://github.com/RichardAtCT/claude-code-openai-wrapper>（pinned `v2.2.0` / `a0d8e4d`）
- Claude Code 快速入门：<https://docs.claude.com/en/docs/claude-code/quickstart>
- OpenAI Codex CLI 仓库：<https://github.com/openai/codex>
- OpenRouter API：<https://openrouter.ai/docs>
- LiteLLM（最初尝试，已 pivot）：<https://github.com/BerriAI/litellm>
- PaperFlow v1.2-agent 选型 note：`.planning/notes/2026-04-27-agent-runtime-selection.md`

***

*Doc owner: PaperFlow agent runtime · 2026-04-29 (pivoted from LiteLLM premise after MED-4 cross-AI runtime verification)*
