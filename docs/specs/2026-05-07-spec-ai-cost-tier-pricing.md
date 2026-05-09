# Spec: AI Token 成本统计与会员档位定价

**日期**: 2026-05-07
**Slug**: `ai-cost-tier-pricing`
**状态**: Draft（待用户 review 后转 Approved）

---

## 1. Objective（目标）

为 PaperFlow 的 **3 档会员模型**（Free / Sync / Pro）建立**数据驱动的定价依据**，做两件事：

1. **可观测性补全** — 在 `ai-proxy` 上捕获每次调用的 `prompt_tokens` / `output_tokens`，落入已存在但目前为空的 `ai_usage_log.prompt_tokens` / `output_tokens` 列。这是事实数据基线，未来定价、配额、成本告警都依赖它。
2. **定价分析交付物** — 用 **cost-plus** 模型（目标毛利 70%，可调）跨候选模型矩阵估算每次调用成本与每月每用户成本，给出 Sync / Pro 的**推荐零售价**与现行 $4 / $12 假设下的**实际毛利**。

### 用户与场景

- **主要用户**：项目所有者（决策者），需要一份"价格定多少能覆盖成本+留余量"的分析。
- **次要用户**：未来运营/产品（v1.5 的 `plans` 表起表时直接消费本次的成本基线）。

### 不在本次范围

- 不改前端 UI（不动 `quota-chip` / `top-bar` / Account 页）
- 不改配额上限（Pro 仍是 30000 calls/月）
- 不引入"按 token 计费"的配额模型（仍按 call-count）
- Free trial 的 20 次 lifetime 不变
- 不暴露 per-call token 数给客户端（usage_log 维持 service-role 写）

---

## 2. Tech Stack（技术栈）

| 层 | 技术 |
|---|---|
| Edge Function | Deno + Supabase Edge Runtime（已有） |
| DB | PostgreSQL on Supabase；表 `ai_usage_log` 已存在，schema 已含 `prompt_tokens`/`output_tokens int`（001_tables.sql:96-97） |
| 流解析 | OpenAI / Anthropic / Google 三家的 SSE 风格 `chat/completions` API；末尾 chunk 的 `usage` 字段（OpenAI 需 `stream_options: { include_usage: true }`）|
| 分析脚本 | Node.js 内置 `node:test` + 单文件 `.mjs`（不新增 npm 依赖）|
| 报告 | Markdown 写入 `docs/specs/` 兄弟位置（命名为 `*-analysis-*.md` 区分 SPEC 与产出）|

不新增依赖；不引入 Python / Jupyter。

---

## 3. Commands（命令）

```bash
# 本地启 Supabase + Edge Functions
supabase start
supabase functions serve ai-proxy --env-file ./supabase/.env

# 单测 token 解析器（usage-extractor）
cd supabase/functions && deno test --allow-read _shared/usage-extractor.test.ts

# 跑成本/定价分析（cost-plus 计算器）
node scripts/ai-cost-analysis.mjs \
  --pricing scripts/data/model-pricing.json \
  --workload scripts/data/workload-assumptions.json \
  --margin 0.70 \
  --out docs/specs/2026-05-07-analysis-ai-cost-tier-pricing.md

# 验证 token 实际落库（local Supabase）
psql "$LOCAL_DB_URL" -c "
  select model, kind, prompt_tokens, output_tokens, created_at
  from ai_usage_log order by created_at desc limit 10;
"
```

---

## 4. Project Structure（项目结构）

新增 / 改动文件：

```
supabase/
├── functions/
│   ├── ai-proxy/index.ts              [改] 开 stream_options.include_usage；
│   │                                       从流末尾消费 usage 后 update ai_usage_log
│   └── _shared/
│       ├── usage-extractor.ts         [新] 纯函数：从 SSE chunk 解析 OpenAI/Anthropic
│       │                                    /Gemini 三种 usage 字段
│       └── usage-extractor.test.ts    [新] Deno test，覆盖 3 家 fixture
├── migrations/
│   └── 014_ai_usage_log_model_idx.sql [新] (model, created_at desc) 部分索引，
│                                            加速分析期 group-by

scripts/
├── ai-cost-analysis.mjs               [新] cost-plus 计算器，单文件 Node.js
└── data/
    ├── model-pricing.json             [新] 候选模型单价表（每 1M tokens 输入/输出价 +
    │                                        来源 URL + 抓取日期）
    └── workload-assumptions.json      [新] 每个 kind（chat/explain/summary/...）
                                              假设的 prompt+output token 量

docs/specs/
├── 2026-05-07-spec-ai-cost-tier-pricing.md      [本文件]
└── 2026-05-07-analysis-ai-cost-tier-pricing.md  [实施期产出，由脚本生成]
```

---

## 5. Code Style（代码风格）

`usage-extractor.ts` 用纯函数 + 显式 union type，便于单测与多供应商扩展：

```ts
// supabase/functions/_shared/usage-extractor.ts
export interface TokenUsage {
  prompt_tokens: number;
  output_tokens: number;
  /** 原始 provider 字段名，便于 schema 漂移时定位 */
  raw_source: 'openai' | 'anthropic' | 'gemini' | 'unknown';
}

/**
 * 从一个已 JSON.parse 的 SSE chunk 提取 usage。
 * 三家 schema 不同：
 *   OpenAI: { usage: { prompt_tokens, completion_tokens } }   末尾 chunk
 *   Anthropic: { type: 'message_delta', usage: { input_tokens, output_tokens } }
 *   Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount } }
 * 命中任一即返回；都不命中返回 null（非末尾 chunk 走这里）。
 */
export function extractUsage(chunk: unknown): TokenUsage | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const c = chunk as Record<string, unknown>;

  // OpenAI（要求上游开了 stream_options.include_usage）
  if (c.usage && typeof c.usage === 'object') {
    const u = c.usage as Record<string, number>;
    if (typeof u.prompt_tokens === 'number') {
      return {
        prompt_tokens: u.prompt_tokens,
        output_tokens: u.completion_tokens ?? 0,
        raw_source: 'openai',
      };
    }
    // Anthropic
    if (typeof u.input_tokens === 'number') {
      return {
        prompt_tokens: u.input_tokens,
        output_tokens: u.output_tokens ?? 0,
        raw_source: 'anthropic',
      };
    }
  }
  // Gemini
  if (c.usageMetadata && typeof c.usageMetadata === 'object') {
    const u = c.usageMetadata as Record<string, number>;
    return {
      prompt_tokens: u.promptTokenCount ?? 0,
      output_tokens: u.candidatesTokenCount ?? 0,
      raw_source: 'gemini',
    };
  }
  return null;
}
```

`ai-proxy/index.ts` 的改造**最小**——只在现有 `pipeThrough(makeContentFilterDetector())` 链上再叠一段
`pipeThrough(usageCaptureTransform)`，在流末尾把 usage 写回 `ai_usage_log`（需要把当前 insert 改为 insert + 拿到 row id，或末尾再 update —— 实施时确定）。

---

## 6. Testing Strategy（测试策略）

| 测试层 | 框架 | 位置 | 覆盖 |
|---|---|---|---|
| Unit | `deno test` | `supabase/functions/_shared/usage-extractor.test.ts` | 三家 SSE 末尾 chunk fixture（命中）+ 中间 delta chunk（不命中）+ 缺字段降级 |
| Integration | 本地 Supabase + curl | 手动 / 脚本 | 调一次 ai-proxy → `ai_usage_log` 最新行 `prompt_tokens` 与 `output_tokens` **均非 null** |
| E2E | Playwright CLI（已有 `chrome-extension/tests/e2e/`） | 现有 chat/summary 用例补一条 SQL 断言 | 用户视角触发一次 AI 调用后 DB 观测到 token 行 |
| Analysis | `node --test` | `scripts/ai-cost-analysis.test.mjs` | cost-plus 算式：成本 = (input × price_in + output × price_out) / 1e6；目标价 = 月成本 / (1 - margin)；样例数字与手算一致 |

不新增 e2e 项目，复用现有测试基础设施（按 `feedback_test_infra.md`）。

**最低覆盖**：usage-extractor 80% 行 + 100% 三家分支；其余按现有项目水位。

---

## 7. Boundaries（边界三层）

### Always do（每次都做）

- 改 ai-proxy 后**本地全链路**手测一次（chat / summary 各一），确认 `ai_usage_log` 三列（model/prompt/output）齐全
- `model-pricing.json` 每条都带 `source_url` + `fetched_at`（防 stale 数据被当事实）
- 文档中文（CLAUDE.md）
- E2E 用 Playwright **CLI**（`feedback_e2e_playwright_cli.md`），不用 Playwright MCP
- 默认 `npm run build:dev`（local Supabase），不动 hosted（CLAUDE.md 政策）

### Ask first（先问后做）

- 任何对**配额上限**的改动（30000 → 别的数字）
- 是否在前端展示 token 计数（"本月已用 X tokens"）— 当前明确**不做**
- 分析报告里的**建议定价**是否替换现行 $4 / $12 — 报告只**给建议**，是否真改 Stripe price 由人决策
- 是否扩展 `MANAGED_MODELS` 表加入新模型（gpt-5、sonnet-4-5 等）— 实施期可能需要，但要单独 phase
- 给 ai_usage_log 加新列（如 `tokens_cost_usd` 物化字段）— 不本期做，先靠分析脚本计算

### Never do（永远不做）

- 把 `ai_usage_log` 的 RLS 改宽（仍是 service-role 写、user 读自己的）
- 把客户端写 token 字段（任何客户端能编造 token 数的路径都不允许）
- 用非流式（`stream: false`）的回退 — 当前 SSE 链路 + content-filter detector 不能破
- 把 BYOK 调用计入成本分析（BYOK 用户用自己的 key，成本不归我们；报告里**只算 managed proxy**）
- 在 SPEC / 报告里编造未公开模型的价格（必须有 source URL；否则标 `tbd / not-yet-public`）

---

## 8. Success Criteria（验收）

可一一勾选，缺一不收：

- [ ] **A1** — `usage-extractor.ts` 单测通过：OpenAI / Anthropic / Gemini 三家 fixture 正确返回 `TokenUsage`；非 usage chunk 返回 `null`；缺字段安全降级（不抛）。
- [ ] **A2** — `ai-proxy/index.ts` 修改后，本地调一次 chat：`select prompt_tokens, output_tokens from ai_usage_log order by created_at desc limit 1` 两列均**非 null** 且为正整数。
- [ ] **A3** — `ai-proxy` 现有功能不回归：streaming 第一字节延迟 ≤ 改造前 110%；`makeContentFilterDetector` 仍生效（已有 quick 260507-cf 用例不挂）。
- [ ] **A4** — `scripts/data/model-pricing.json` 至少覆盖 **8 个**模型，分布：
  - mini 档：gpt-4o-mini、gpt-4.1-mini、claude-haiku-4-5、gemini-2.5-flash（≥ 3 个）
  - 旗舰档：gpt-4o、claude-sonnet-4-5、gemini-2.5-pro（≥ 2 个）
  - 前沿档：gpt-5-* 系列、claude-4.x（opus / sonnet 新版）、gemini-3.x（≥ 2 个，**至少 1 个**有公开价格；其余可标 `tbd`）
- [ ] **A5** — `scripts/data/workload-assumptions.json` 包含 PaperFlow 现有 5 种 `kind`：`chat / explain / summary / translate / overview` 的 prompt+output token 假设值，每条带**理由注释**（注释字段 `_rationale`，例如 chat 注 "embeds full paper + 3-turn history → seed 5–15K from ai-proxy:16"）。
- [ ] **A6** — 分析报告 `docs/specs/2026-05-07-analysis-ai-cost-tier-pricing.md` 含：
  - 每模型单次调用成本表（按 kind × model）
  - Pro tier 在 30000 calls/月、各 kind 占比下的**月成本/用户**
  - cost-plus 70% 毛利下的**推荐零售价**
  - 现行 $12 (Pro) / $4 (Sync) 假设下的**毛利或赤字**
  - **敏感性表**：margin 50% / 70% / 85%、call-mix 偏向 chat-heavy vs summary-heavy 各一组
  - **Sync tier 单独章节**：Sync 不消耗 managed AI，列 Sync 的非-AI 成本（Postgres + Realtime + Storage 估算）作为对照
- [ ] **A7** — 报告**结尾**给出 3 条可执行建议（"维持现价 / 微调到 $X / 涨到 $Y"），每条附**关键假设**与**何种证据出现时改主意**。
- [ ] **A8** — 全程不改前端、不改配额数字、不改 Stripe price_id。

---

## 9. Open Questions（待回答）

实施前**不阻断**，但要记录、必要时再确认：

1. **Q1** — 末尾 usage chunk 出现时机：OpenAI 在 `data: [DONE]` 之前的最后一个 chunk；Anthropic 在 `message_delta` 块；Gemini 在每个 chunk 都给但末尾值最准。**实施时**要决定：取最后一次 vs 累加第一次出现 — 当前倾向**取最后一次非 null 的**（最稳）。
2. **Q2** — `ai_usage_log` 当前**先 insert** 再返回流（line 114-118）。要拿到 row id 后用末尾 update 写 token，还是改成"末尾再 insert"（流失败就丢这条 log）？倾向**先 insert 占位 + 末尾 update**，不损失审计。
3. **Q3** — workload 假设值在没有真实数据前的 baseline：建议先用 `chat=8000/1500、summary=12000/2000、explain=4000/500、translate=2000/2000、overview=10000/1500`（input / output），**报告显著标注"待真实数据回归后修订"**。是否同意这套 baseline？
4. **Q4** — gpt-5.x / claude-4.x / gemini-3.x 在 2026-05-07 的实际公开 SKU 与价格，由实施 agent 在写 `model-pricing.json` 时查官网 + WebFetch；遇到无公开价的 SKU 标 `tbd` 不阻塞分析（其他模型够推得出结论）。
5. **Q5** — Sync tier 的非-AI 成本估算需要 Supabase 用量明细（DB 行数、Realtime 通道数、Storage GB）— 这些数字从 `supabase status` / Supabase Dashboard / 估算行数推导，**精确到数量级**即可，不追求两位有效数字。

---

## 10. 实施顺序提示（不属于 SPEC，给下游 phase 的 hint）

按 spec-driven-development 流程，下一步是 **Phase 2 Plan**。建议拆 4 个 task：

1. `usage-extractor` 纯函数 + 单测（最小、可独立 ship）
2. `ai-proxy` 集成 + 本地 e2e 验证（依赖 1）
3. `model-pricing.json` + `workload-assumptions.json` 数据收集（与 1、2 并行）
4. `ai-cost-analysis.mjs` 计算器 + 报告生成（依赖 3，可与 2 并行）

预估总工作量：1.5 - 2 天（不含等真实数据回流的几周）。

---

## 11. 与既有 dormant seed 的关系

`.planning/seeds/v1.5-tier-policy-table.md` 描述了 v1.5 把配额/价格做成 `plans` 表。**本 SPEC 的成本分析报告就是那个 phase 的输入数据** — 决定 `plans` 表种子里 `monthly_limit`、`price_label` 应该取什么值。两者**互不阻塞**：本 SPEC 不依赖 plans 表落地，plans 表 phase 启动时直接消费本 SPEC 的报告即可。
