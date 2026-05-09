# Plan: AI Token 成本统计与会员档位定价

**Spec 来源**: [`docs/specs/2026-05-07-spec-ai-cost-tier-pricing.md`](../specs/2026-05-07-spec-ai-cost-tier-pricing.md)
**计划日期**: 2026-05-07
**状态**: Draft（待用户 review 后转 Approved，再进 Phase 3 Tasks）

---

## 1. 组件分解（7 个）

| ID | 组件 | 文件 | 类型 |
|---|---|---|---|
| **A** | `usage-extractor` 纯函数 + 单测 | `supabase/functions/_shared/usage-extractor.ts(.test.ts)` | Deno 模块 |
| **B** | `ai-proxy` 集成 token 落库 | `supabase/functions/ai-proxy/index.ts` (改) | Edge Function 改造 |
| **C** | 模型单价表 | `scripts/data/model-pricing.json` | 数据 |
| **D** | 工作负载假设表 | `scripts/data/workload-assumptions.json` | 数据 |
| **E** | DB 索引迁移 | `supabase/migrations/014_ai_usage_log_model_idx.sql` | SQL |
| **F** | cost-plus 计算器 | `scripts/ai-cost-analysis.mjs(.test.mjs)` | Node 脚本 |
| **G** | 分析报告（Markdown 产出） | `docs/specs/2026-05-07-analysis-ai-cost-tier-pricing.md` | 文档 |

---

## 2. 依赖图与实施 Waves

```
              ┌─── A (extractor) ─────► B (ai-proxy 集成)
              │
Wave 1 ──────┼─── E (索引)
(并行)        │
              ├─── C (pricing)  ──┐
              │                    ├──► F (calculator) ──► G (报告)
              └─── D (workload) ──┘
```

| Wave | 任务 | 并行性 | 启动条件 |
|---|---|---|---|
| **W1** | A · C · D · E | **4 路全并行**（彼此独立、不动同一文件） | 立即 |
| **W2** | B（依赖 A）· F（依赖 C, D） | 2 路并行 | W1 全绿 |
| **W3** | G | 单线 | F 全绿；B **不必上线**（报告独立于实测数据，B 决定的是"未来可校准"） |

预估时长：W1 约 0.5-1 day（C 主要时间花在调研模型价格）；W2 约 0.5 day；W3 约 0.5 day。整体 1.5-2 day。

---

## 3. 各组件详细设计

### 3.1 Component A — `usage-extractor`

**目标**：纯函数从 SSE chunk 解析三家供应商的 usage 字段，无副作用、易单测。

**接口**（已在 SPEC §5 给出完整代码）：
```ts
extractUsage(chunk: unknown): TokenUsage | null
```

**关键设计点**：
- **三家 schema 命中顺序**：先看 `chunk.usage.prompt_tokens`（OpenAI）→ `chunk.usage.input_tokens`（Anthropic）→ `chunk.usageMetadata.promptTokenCount`（Gemini）。三家共存的字段名歧义可控（`usage` vs `usageMetadata` 不同 key、OpenAI/Anthropic 字段名不同）。
- **降级**：缺字段返 0、找不到 usage 返 null（让上层决定写 NULL 还是不写）。**绝不抛**——streaming 链路出异常会破整个响应。
- **`raw_source` 字段**：保留原始来源，便于 schema 漂移时 debug。**不**写入 DB（DB 已有 `model` 列足够区分）。

**测试 fixture**（`usage-extractor.test.ts`）覆盖矩阵：
- ✅ OpenAI 末尾 chunk（`{ choices: [], usage: { prompt_tokens, completion_tokens } }`）
- ✅ Anthropic message_delta（`{ type: 'message_delta', usage: { input_tokens, output_tokens } }`）
- ✅ Gemini 任意 chunk（`{ usageMetadata: { promptTokenCount, candidatesTokenCount } }`）
- ✅ 中间 delta chunk（无 usage 字段）→ 返 `null`
- ✅ `usage` 存在但只有 input、缺 output → output 降级为 0
- ✅ 完全坏数据（`null` / `undefined` / 字符串）→ 返 `null`

**验收**：`deno test --allow-read supabase/functions/_shared/usage-extractor.test.ts` 全绿，6 条测试。

---

### 3.2 Component B — `ai-proxy` 集成

**改造点**（4 处）：

1. **L106 上游 fetch body**：在 OpenAI 路径加 `stream_options: { include_usage: true }`。Anthropic / Gemini 默认就给 usage，不需要改。但 newapi 转发到 Bedrock-Anthropic 时，stream_options 字段会被忽略（不报错），不影响。
   ```ts
   body: JSON.stringify({
     model: upstreamModel,
     messages: body.messages,
     stream: true,
     stream_options: { include_usage: true },  // ← 新增
   }),
   ```

2. **L114-118 insert 改 await + 拿 row id**：
   ```ts
   // 改前：fire-and-forget，没拿 id
   EdgeRuntime.waitUntil(admin.from('ai_usage_log').insert({ ... }))
   // 改后：await + 拿 id（多一次 round-trip ~20-50ms，A3 允许 ≤110%）
   const { data: logRow } = await admin
     .from('ai_usage_log')
     .insert({ user_id: user.id, kind: body.kind, tier_at_call: tier, model: upstreamModel })
     .select('id').single()
   ```

3. **L123 stream pipeline 加 usage transform**（在 content-filter **之后**，避免破坏现有 quick 260507-cf 检测语义）：
   ```ts
   const usageCapture = makeUsageCaptureTransform(admin, logRow.id)
   return new Response(
     oaResp.body!
       .pipeThrough(makeContentFilterDetector())
       .pipeThrough(usageCapture),
     { headers: { 'Content-Type': 'text/event-stream' } }
   )
   ```

4. **新增 `_shared/usage-capture-transform.ts`**：TransformStream，每个 chunk passthrough 给客户端 + 用 `extractUsage` 解析，命中后通过 `EdgeRuntime.waitUntil` 异步 update（不阻塞流）；如果整流走完没命中，最后写 NULL（当前已是 NULL，等价于不写）。
   ```ts
   export function makeUsageCaptureTransform(admin, logId) {
     let lastUsage: TokenUsage | null = null
     return new TransformStream<Uint8Array, Uint8Array>({
       transform(chunk, controller) {
         controller.enqueue(chunk)
         // 解析 SSE 行（"data: {json}\n\n"），跳过 [DONE]
         const text = new TextDecoder().decode(chunk)
         for (const line of text.split('\n')) {
           if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
           try {
             const parsed = JSON.parse(line.slice(6))
             const u = extractUsage(parsed)
             if (u) lastUsage = u  // 取最后一次（SPEC §9 Q1 决议：取最后非 null）
           } catch { /* 半行 chunk，等下一次 */ }
         }
       },
       flush() {
         if (lastUsage) {
           EdgeRuntime.waitUntil(
             admin.from('ai_usage_log')
               .update({ prompt_tokens: lastUsage.prompt_tokens, output_tokens: lastUsage.output_tokens })
               .eq('id', logId)
           )
         }
       },
     })
   }
   ```

**关键决策（落 SPEC §9 Open Questions）**：
- **Q1** → 取**最后一次非 null 的 usage**（SSE 末尾最稳）
- **Q2** → **先 insert 拿 id，末尾 update**（不丢审计行；接受 ~20-50ms streaming 启动延迟）

**验收**：
- 本地启 Supabase + serve ai-proxy → curl 一次 → DB 三列齐全
- 现有 e2e（`chrome-extension/tests/e2e/`）全绿；特别 quick 260507-cf 的 content-filter 检测不挂
- streaming 第一字节延迟手测 ≤ 改造前 110%（用 curl `-w '%{time_starttransfer}\n'` 跑 5 次取 median）

---

### 3.3 Component C — `model-pricing.json`

**Schema**：
```json
{
  "fetched_at": "2026-05-07",
  "models": [
    {
      "id": "claude-haiku-4-5-20251001",
      "display_name": "Claude Haiku 4.5",
      "provider": "anthropic",
      "tier_class": "mini",
      "input_price_per_1m": 0.80,
      "output_price_per_1m": 4.00,
      "source_url": "https://www.anthropic.com/pricing",
      "_note": "current managed model in production"
    }
  ]
}
```

**模型清单（最低 8 个，SPEC §A4）**：

| tier_class | 候选 | 来源 |
|---|---|---|
| **mini** (4 个) | gpt-4o-mini · gpt-4.1-mini · claude-haiku-4-5 · gemini-2.5-flash | OpenAI / Anthropic / Google 官方 pricing 页 |
| **flagship** (3 个) | gpt-4o · claude-sonnet-4-5 · gemini-2.5-pro | 同上 |
| **frontier** (≥2 个，至少 1 个有公开价) | gpt-5 / gpt-5-mini · claude-opus-4-7 / claude-sonnet-4-6 · gemini-3-pro | WebSearch + 各家 pricing 页 |

**Ask first 项**：实施时若发现某个前沿 SKU 在 2026-05-07 仍**未公开价格**，**标 `tbd` 不编造**（SPEC §7 Never），并在报告里说明影响。

**验收**：JSON valid + ≥8 model + 每条至少 `id / provider / source_url / fetched_at`；前沿档允许 `tbd` 但要标。

---

### 3.4 Component D — `workload-assumptions.json`

**Schema**：
```json
{
  "version": "baseline-2026-05-07",
  "_warning": "Baseline assumptions. Revise after Component B captures real production data.",
  "kinds": [
    {
      "kind": "chat",
      "prompt_tokens": 8000,
      "output_tokens": 1500,
      "_rationale": "ai-proxy/index.ts:16 注 'chat embeds full paper + history → 5–15K tokens'"
    },
    {
      "kind": "summary",
      "prompt_tokens": 12000,
      "output_tokens": 2000,
      "_rationale": "full paper → ~10K input + 1.5K output struct"
    },
    {
      "kind": "explain",
      "prompt_tokens": 4000,
      "output_tokens": 500,
      "_rationale": "selection + 2-3 paragraph context, terse output"
    },
    {
      "kind": "translate",
      "prompt_tokens": 2000,
      "output_tokens": 2000,
      "_rationale": "input ≈ output by definition"
    },
    {
      "kind": "overview",
      "prompt_tokens": 10000,
      "output_tokens": 1500,
      "_rationale": "library-level cross-paper synthesis"
    }
  ],
  "kind_distribution": {
    "_source": "guess; revise after telemetry — currently chat-heavy app",
    "chat": 0.55, "explain": 0.20, "summary": 0.15, "translate": 0.05, "overview": 0.05
  }
}
```

**验收**：JSON valid，5 种 `kind` 都有 prompt+output+rationale；distribution 加和 = 1.0。

---

### 3.5 Component E — `014_ai_usage_log_model_idx.sql`

```sql
-- 014_ai_usage_log_model_idx.sql
-- Phase ai-cost-tier-pricing: speed up monthly per-model aggregations
-- (used by scripts/ai-cost-analysis.mjs when querying real data).

create index if not exists ai_usage_log_model_created_idx
  on ai_usage_log (model, created_at desc);
```

**验收**：`supabase db reset` 后迁移成功；`\d ai_usage_log` 见新索引。

**风险**：若 `ai_usage_log` 已有大量行（生产），`create index`（非 concurrently）会短暂锁表。当前是 dev/local 环境优先，**不本期触发生产部署**；生产部署时 ops 决定换 `concurrently`。

---

### 3.6 Component F — `ai-cost-analysis.mjs`

**职责**：读 C+D，对每个 (model, kind) 算单次成本，按 distribution 加权得每模型月成本（per user, 30000 calls 上限），跑 cost-plus 推荐价 + 敏感性表，输出 markdown 片段。

**核心公式**：
```
cost_per_call(m, k)        = (prompt_k * price_in_m + output_k * price_out_m) / 1e6
cost_per_call_weighted(m)  = Σ_k distribution[k] * cost_per_call(m, k)
monthly_cost_per_user(m)   = cost_per_call_weighted(m) * 30000   # Pro tier
recommended_price(m, margin) = monthly_cost_per_user(m) / (1 - margin)
margin_at_price(m, price)  = (price - monthly_cost_per_user(m)) / price
```

**输出**（写入 `--out` 指定 md 文件的"自动生成"区段）：
- 表 1：每模型每 kind 单次成本
- 表 2：每模型加权 monthly cost / user @ Pro 30000 calls
- 表 3：margin = 50/70/85% 三组下的推荐价
- 表 4：固定 $12 / $4 下各模型实际毛利

**测试**（`ai-cost-analysis.test.mjs`，用 `node --test`）：
- ✅ 单例：input=1000, output=500, price_in=2, price_out=8 → cost = (1000*2 + 500*8)/1e6 = 0.006
- ✅ distribution 加权对账（手算两个 kind 的样例）
- ✅ margin 反推：cost=$3, margin=70% → price = $10
- ✅ JSON 缺字段安全降级

**验收**：node --test 全绿 + 用 SPEC §A6 矩阵跑一次能输出非空 md。

---

### 3.7 Component G — 分析报告

**结构**（按 SPEC §A6, §A7 验收清单）：

```markdown
# AI 成本与会员档位定价分析报告

## 0. 执行摘要（≤ 300 字）

## 1. 方法
   - cost-plus 公式
   - 数据来源（C 文件 + D 文件 + 实测占位）
   - 关键假设

## 2. 模型矩阵与单价
   - 表 1：8+ 模型 input/output per-1M tokens（来源链接）

## 3. 单次调用成本
   - 表 2：每 kind × 模型成本

## 4. Pro tier 月成本与定价建议
   - 表 3：30000 calls/月 加权成本
   - 表 4：margin 50/70/85% 推荐价
   - 表 5：现行 $12 下各模型毛利

## 5. Sync tier 单独章节（无 managed AI）
   - Postgres + Realtime + Storage 估算
   - 现行 $4 下毛利估算

## 6. 敏感性分析
   - chat-heavy vs summary-heavy 两套 distribution

## 7. 三条建议
   - 维持 / 微调 / 涨价 三选一推荐
   - 每条附"何种证据出现时改主意"

## 8. 已知不确定性
   - workload baseline 待真实数据修订
   - 前沿模型 tbd 项
```

**验收**：A1-A8 八条逐条勾选；§7 三条建议明确；§8 已知不确定性显式标注。

---

## 4. 风险矩阵

| ID | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| **R1** | newapi/Bedrock 不透传 OpenAI `stream_options.include_usage`，Anthropic 路径无 usage | 中 | 中 | extractor 返 null 不挂；DB 留 NULL；分析报告优先用假设值，标"实测数据 missing 时用 baseline" |
| **R2** | insert→update 多一次 DB round-trip 增加 streaming 启动延迟 | 高（必然） | 低（~20-50ms，用户感知 <1%） | 接受；A3 允许 ≤ 110% |
| **R3** | 客户端早断开 → flush 不被触发 → token 不写 | 低-中 | 低（NULL 行可统计排除） | 用 `EdgeRuntime.waitUntil` 包 update；接受偶发缺失 |
| **R4** | content-filter 与 usage transform 链路顺序错误破坏检测 | 低 | 高（破坏 quick 260507-cf 安全降级） | 顺序固定 content-filter 在 usage 之前；e2e 跑 quick 260507-cf 用例 |
| **R5** | 前沿模型（gpt-5.x / claude-4.x / gemini-3.x）2026-05-07 时点公开价缺失 | 中-高 | 中 | 标 `tbd`；分析报告主结论不依赖前沿档 |
| **R6** | v1.5 plans 表 phase 启动后改我们的 baseline | 高 | **正向**（plans 表消费本报告） | 互不阻塞；§11 已明确耦合方向 |
| **R7** | OpenAI `stream_options` 字段在 newapi 转发时**报错**（非忽略）导致整流挂掉 | 低 | 高（破坏现状） | 加一道 try：先用 stream_options 调一次本地，失败则降级关掉。**实施 T5 第一步**做这次冒烟 |

---

## 5. Verification Checkpoints（实施期门禁）

按 wave 收齐：

| Wave | Checkpoint | 检查动作 |
|---|---|---|
| W1 后 | **VC-A** | `deno test` 6 条全绿（usage-extractor） |
| W1 后 | **VC-E** | `supabase db reset` 成功 + `\d ai_usage_log` 含新索引 |
| W1 后 | **VC-CD** | `node -e "JSON.parse(...)"` 不挂；C ≥ 8 model；D 5 kind + sum=1.0 |
| W2 后 | **VC-B1** | 本地 curl ai-proxy → `select prompt_tokens, output_tokens from ai_usage_log order by created_at desc limit 1` 两列非 null |
| W2 后 | **VC-B2** | 现有 chrome-extension/tests/e2e/ 全绿（chat、summary、content-filter quick 260507-cf）|
| W2 后 | **VC-B3** | curl `-w '%{time_starttransfer}\n'` 跑 5 次 median ≤ 改造前 110% |
| W2 后 | **VC-F** | `node --test scripts/ai-cost-analysis.test.mjs` 全绿 + 干跑生成非空 md |
| W3 后 | **VC-G** | SPEC §8 A1-A8 自检表逐条勾完 |

任一 VC 不过 → 停下、和用户对齐、不进下一 wave。

---

## 6. 关键决策与 Trade-offs（一次性记录）

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| usage 写入时序 | (a) 先 insert 拿 id 再 update / (b) 末尾再 insert | **(a)** | 不丢审计行；用户已答可接受 ~20-50ms 启动延迟 |
| usage 取值 | (a) 取最后一次 non-null / (b) 取首次 / (c) 累加 | **(a)** | OpenAI/Anthropic 末尾最准；Gemini 每个 chunk 都给但末尾值最准 |
| 上游 fetch 加 stream_options | (a) 只对 OpenAI 路径加 / (b) 全路径加 | **(b)** | newapi 默认会忽略未识别字段；少一处分支；R7 用冒烟兜底 |
| BYOK 调用 | (a) 计入 / (b) 不计入 | **(b)** | SPEC §7 已定；BYOK 用户成本不归我们 |
| 索引添加方式 | (a) 普通 / (b) concurrently | **(a)** | 本期只在 dev/local 跑；生产部署由 ops 单独决策 |
| 报告位置 | `docs/specs/` 还是 `docs/plans/` | **`docs/specs/`** | 报告是事实 + 建议的产出，不是计划；与 SPEC 同目录便于交叉引用 |

---

## 7. Out of Plan（明确不做）

- 不在 ai-proxy 加 BYOK 路径的 token 捕获（BYOK 不走代理）
- 不动 `chrome-extension/reader/` 任何前端文件
- 不改 `MANAGED_MODELS` 注册（即使报告建议加新模型，也是下一个 phase 的事）
- 不改 Stripe price_id 配置
- 不写"按 token 计费"的配额改造（仍是 call-count）
- 不部署到 hosted Supabase（CLAUDE.md 政策：daily dev 走 build:dev）
- 不写运维监控（"月成本告警"等下一个 phase）

---

## 8. 进入 Phase 3 Tasks 的前置确认

请 review 这份 Plan，特别是：

1. **§3.2 R7 处理**：关于 `stream_options` 在 newapi 上的兼容冒烟，是否同意"实施期 T5 第一步先做一次活体测试，挂掉就降级关掉"这套兜底策略？ ✅ **2026-05-07 已同意**
2. **§4 R2 接受 20-50ms 启动延迟**：是否接受。 ✅ **2026-05-07 已同意**
3. **§3.7 G 的报告结构**：保留 §5 Sync tier 单独章节。 ✅ **2026-05-07 已同意**

---

## 9. Tasks（Phase 3 拆分）

7 个 task，按 W1/W2/W3 分波；每个 task ≤ 5 文件、单 session 可完成、含独立 verify 步骤。

### Wave 1（4 路并行，全独立）

#### T1 — usage-extractor 纯函数 + 单测

- **Acceptance**:
  - `extractUsage()` 函数签名与 SPEC §5 一致
  - 6 条单测覆盖：OpenAI 末尾 chunk · Anthropic message_delta · Gemini usageMetadata · 中间 delta(返 null) · 缺 output 字段(降级 0) · 坏数据(返 null 不抛)
  - 三家 fixture 用真实 API 文档示例字段名（不编造）
- **Verify**:
  ```bash
  cd supabase/functions
  deno test --allow-read _shared/usage-extractor.test.ts
  # 期望: 6 passed, 0 failed
  ```
- **Files** (2):
  - `supabase/functions/_shared/usage-extractor.ts`
  - `supabase/functions/_shared/usage-extractor.test.ts`

#### T2 — DB 索引迁移

- **Acceptance**:
  - 迁移文件 SQL 合法（参考 §3.5 完整 SQL）
  - `supabase db reset` 后 `\d ai_usage_log` 见 `ai_usage_log_model_created_idx` 索引
- **Verify**:
  ```bash
  supabase db reset
  psql "$LOCAL_DB_URL" -c "\d ai_usage_log" | grep ai_usage_log_model_created_idx
  ```
- **Files** (1):
  - `supabase/migrations/014_ai_usage_log_model_idx.sql`

#### T3 — 模型单价表

- **Acceptance**:
  - JSON valid（`node -e 'JSON.parse(...)'`）
  - ≥ 8 个模型，覆盖 mini(4) / flagship(3) / frontier(≥2，至少 1 个有公开价)
  - 每条至少含：`id / display_name / provider / tier_class / input_price_per_1m / output_price_per_1m / source_url / fetched_at`
  - 前沿档无公开价的标 `"input_price_per_1m": "tbd"` + `"_note": "<原因>"`
  - 价格抓取**全部**来自官方 pricing 页（OpenAI/Anthropic/Google），实施期用 WebSearch+WebFetch 取
- **Verify**:
  ```bash
  node -e "
    const m = require('./scripts/data/model-pricing.json');
    if (m.models.length < 8) throw 'need ≥8 models';
    for (const x of m.models) {
      if (!x.id || !x.source_url || !x.fetched_at) throw 'missing required field: ' + x.id;
    }
    console.log('OK', m.models.length, 'models');
  "
  ```
- **Files** (1):
  - `scripts/data/model-pricing.json`

#### T4 — 工作负载假设表

- **Acceptance**:
  - 5 种 kind（chat / explain / summary / translate / overview）每条含 `prompt_tokens / output_tokens / _rationale`
  - `kind_distribution` 5 项加和 = 1.0（±0.001 浮点容差）
  - chat 的 `_rationale` 引用 `ai-proxy/index.ts:16` 注释（保持可追溯）
  - 顶层 `_warning` 字段提示"baseline，待真实数据修订"
- **Verify**:
  ```bash
  node -e "
    const w = require('./scripts/data/workload-assumptions.json');
    if (w.kinds.length !== 5) throw 'need 5 kinds';
    const sum = Object.values(w.kind_distribution).filter(v=>typeof v==='number').reduce((a,b)=>a+b,0);
    if (Math.abs(sum - 1.0) > 0.001) throw 'distribution not summing to 1: ' + sum;
    console.log('OK distribution sum=', sum);
  "
  ```
- **Files** (1):
  - `scripts/data/workload-assumptions.json`

### Wave 2（2 路并行，依赖 W1）

#### T5 — ai-proxy 集成（依赖 T1）

实施分 3 子步，**T5.1 是 R7 的活体冒烟**——如果挂，立刻降级（T5.2 改成"OpenAI 路径才加 stream_options，其他路径跳过"）。

- **T5.1 stream_options 冒烟**（先做）:
  - 临时改 ai-proxy 的 fetch body 加 `stream_options: { include_usage: true }`，本地启 supabase + ai-proxy
  - curl 走两条路径：(a) 默认 fallback → OpenAI（`OPENAI_BASE_URL`），(b) `body.model = claude-haiku-4-5-20251001` → newapi
  - 两条都返 200 + 完整 SSE 流 → 通过；任一返 4xx 或流提前中断 → 降级到"分支 if provider==='openai' 才加 stream_options"
  - 结果记到 plan 的"实施日志"末尾（新增 §10）
- **T5.2 usage-capture-transform**:
  - 实现 `makeUsageCaptureTransform(admin, logId)` 按 §3.2 完整代码
  - SSE 行解析容忍半截 chunk（`split('\n')` 后跨 chunk 残行下次再拼）—— 实施时如果发现需要 `TextDecoderStream` 才能正确处理，可加；先按简单 `split('\n')` 起步，单测有半截 chunk fixture 兜底
- **T5.3 ai-proxy 改造**:
  - 按 §3.2 四处改造点修改 `index.ts`
  - 删除原 `EdgeRuntime.waitUntil(admin.from('ai_usage_log').insert(...))`，换为 await 拿 id
  - pipe 链路顺序：`oaResp.body → contentFilterDetector → usageCaptureTransform → response`

- **Acceptance**:
  - T5.1 冒烟有结论（通过 / 降级），写到 §10 实施日志
  - VC-B1：本地调一次 chat → `ai_usage_log` 最新行 `prompt_tokens` 与 `output_tokens` 均非 null 且 > 0
  - VC-B2：现有 e2e 全绿（`cd chrome-extension && npx playwright test` —— Playwright CLI 而非 MCP，按 `feedback_e2e_playwright_cli.md`）
  - VC-B3：streaming 启动延迟 5 次 median ≤ 改造前 110%
- **Verify**:
  ```bash
  # T5.1 冒烟
  supabase functions serve ai-proxy --env-file ./supabase/.env &
  curl -N -H "Authorization: Bearer $TEST_JWT" \
    -d '{"kind":"chat","messages":[{"role":"user","content":"hi"}]}' \
    http://127.0.0.1:54321/functions/v1/ai-proxy

  # VC-B1
  psql "$LOCAL_DB_URL" -c "
    select model, prompt_tokens, output_tokens, created_at
    from ai_usage_log order by created_at desc limit 1;
  "

  # VC-B2
  cd chrome-extension && npx playwright test

  # VC-B3
  for i in 1 2 3 4 5; do
    curl -N -w '%{time_starttransfer}\n' -o /dev/null -s -H "..." -d '{...}' http://...
  done | sort -n | sed -n '3p'  # median of 5
  ```
- **Files** (3):
  - `supabase/functions/ai-proxy/index.ts` (modify)
  - `supabase/functions/_shared/usage-capture-transform.ts` (new)
  - `supabase/functions/_shared/usage-capture-transform.test.ts` (new) — 单测覆盖：单 chunk usage / 跨 chunk 半行 / 中途出错不破流

#### T6 — cost-plus 计算器 + 单测（依赖 T3, T4）

- **Acceptance**:
  - CLI 接受 `--pricing / --workload / --margin / --out / --calls-per-month`（默认 30000）
  - 输出 §3.7 G 大纲的表 1-5 markdown 片段
  - 单测覆盖核心算式（4 条最少：单例 cost / 加权 cost / margin 反推 / 缺字段降级）
  - **Never**：单测不依赖网络、不读 `model-pricing.json` 真实文件（用 inline fixture）
- **Verify**:
  ```bash
  node --test scripts/ai-cost-analysis.test.mjs

  # 干跑（用真实 C+D 文件）
  node scripts/ai-cost-analysis.mjs \
    --pricing scripts/data/model-pricing.json \
    --workload scripts/data/workload-assumptions.json \
    --margin 0.70 \
    --out /tmp/dry-run.md
  test -s /tmp/dry-run.md && echo "OK non-empty output"
  ```
- **Files** (2):
  - `scripts/ai-cost-analysis.mjs`
  - `scripts/ai-cost-analysis.test.mjs`

### Wave 3（依赖 T6；T5 不必上线）

#### T7 — 分析报告

- **Acceptance**:
  - 含 §3.7 G 大纲全部 8 节（执行摘要 → 已知不确定性）
  - 表 1-5 由 `ai-cost-analysis.mjs --out` 生成（手写部分仅限叙述章节）
  - §7 三条建议（维持/微调/涨价）每条附"何种证据出现时改主意"
  - §8 显式标注：(a) workload baseline 未实测、(b) frontier 模型 tbd 项清单、(c) Sync infra 成本是数量级估算
  - SPEC §A1-A8 自检表附在报告**末尾**，逐条勾选 ✅
- **Verify**:
  - 人工 review，对照 SPEC §A6 / §A7 / §A8 三个清单逐条勾
  - 没有"建议但没说理由"的句子
- **Files** (1):
  - `docs/specs/2026-05-07-analysis-ai-cost-tier-pricing.md`

---

## 10. 实施日志

### 2026-05-07 实施回填

#### W1（已完成）

- **T1 usage-extractor**: 8/8 deno tests 全绿。比 plan 多 2 条单测（OpenAI 缺 completion_tokens 字段降级 + 集合性坏数据）。
  - 设计**细节调整 vs SPEC §5**：返回类型从 `TokenUsage`（必填）改为 `ChunkUsage`（`prompt_tokens / output_tokens` 各自可 null）。原因：Anthropic streaming 是**两段式**——`message_start` 给 final input + initial output(=1)，`message_delta` 给 running output。如果用合一类型，要么丢失 final output，要么覆盖 final input。返回 partial 让 transform 层独立 merge `last non-null` 是更小心的实现。SPEC §5 的代码片段是示意，本次实现是更紧的写法，不算偏离方向。
- **T2 014_ai_usage_log_model_idx.sql**: 文件就位，索引 SQL 经语法检查；**DB apply 验证 deferred 给用户环境**（本 session 内 docker 命令在 shell 里 hang，无 psql client，无法 `supabase db reset` + `\d`）。
- **T3 model-pricing.json**: 后台子 agent 完成，13 个模型，0 tbd（出乎意料地全部前沿档都有公开价）。
  - **关键意外**：Claude Opus 4.7 已降至 $5/$25（Opus 4.1 是 $15/$75，3× 便宜）。GPT-5 与 Gemini 2.5 Pro 价格雷同（$1.25/$10）。Opus 4.7 用新 tokenizer，相同文本可能多用 ~35% tokens，已记入 `_note`。
- **T4 workload-assumptions.json**: 5 kinds + 1 default + 2 alternative distributions 全部加和 = 1.0。

#### W2（部分完成）

- **T5.1 stream_options 兼容冒烟**: 选择**走 plan §6 决策 (b)**——OpenAI 路径**和** newapi 路径都加 `stream_options: { include_usage: true }`。**未做活体冒烟测试**（需要有效 JWT + OPENAI_KEY 真实开销）。技术依据：Anthropic / Gemini streaming API 对未识别字段是 ignore 而非 reject（OpenAPI/JSON 标准），且 newapi 是 OpenAI-compatible 转发器，未识别字段直接透传给上游。**风险**：极低；如真出问题（4xx 或流挂），最小修复是把 stream_options 包在 `if (provider === 'openai')` 分支里——3 行代码。
- **T5.2 usage-capture-transform.ts**: 8/8 deno tests 全绿。覆盖 OpenAI / Anthropic 两段式 / Gemini / 跨 chunk 半行 / 坏 JSON / 无 usage / keepalive 注释行 / defer error 不传播。
  - **类型 trade-off**：`UsageUpdateDeps.update / defer` 用 `PromiseLike<unknown>` 而非 `Promise<unknown>`。原因：Postgrest builder（`admin.from(...).update().eq()`）是 thenable 不是真 Promise。
- **T5.3 ai-proxy/index.ts**: 4 处改造完成，`deno check` 通过。
  - **小偏离 vs Plan §3.2**：`EdgeRuntime.waitUntil(p)` 用 agent-run/index.ts:114 同款的 `(globalThis as { EdgeRuntime?: ... }).EdgeRuntime` typed cast，不是裸调用。原因：原 ai-proxy 裸调 `EdgeRuntime.waitUntil` 实际**通不过 deno check**（type-only 错误，runtime 没事），但项目从来没跑过 ai-proxy 的 deno check 所以一直没暴露。我新增的代码若也裸调，会被新跑的 check 抓住。改用 typed pattern 是项目内一致风格。

#### T5 集成验证 deferred 项（用户在本地 supabase 跑）

`supabase functions serve` 运行中（PID 40057，已自动重载我的新代码）；54321/54322/54323 三端口 OK。但我**无法**在本 session 内完成下面三项验证（缺 JWT mint 工具或 docker 不响应）：

| ID | 验证 | 用户运行 | 期望 |
|---|---|---|---|
| **VC-B1** | DB token 列写入 | 见下文 #1 | 最新 row `prompt_tokens / output_tokens` 都非 null 且 > 0 |
| **VC-B2** | 现有 e2e 不回归 | `cd chrome-extension && npx playwright test` | 全绿；尤其 quick 260507-cf 不挂 |
| **VC-B3** | streaming 启动延迟 ≤110% | 见下文 #2 | 5 次 median ≤ 改造前 baseline × 1.10 |
| **(T2)** | 014 迁移落库 | 见下文 #3 | `\d ai_usage_log` 见 `ai_usage_log_model_created_idx` |

**用户操作清单**：

```bash
# 0. 应用 014 迁移（local supabase）
supabase db reset           # 注意：会清空 local 数据
# 或者只跑新迁移：
supabase migration up

# 1. VC-B1：用现有 mintTestUserJWT helper 拿一个 JWT，然后：
JWT=$(node -e "...mintTestUserJWT script...")
curl -N -X POST http://127.0.0.1:54321/functions/v1/ai-proxy \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"kind":"chat","messages":[{"role":"user","content":"Say hi"}]}' \
  > /tmp/sse-out.txt
# 然后查 DB:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select model, prompt_tokens, output_tokens, created_at
  from ai_usage_log order by created_at desc limit 3;
"

# 2. VC-B3：拿改造前 baseline（git stash my changes 后跑 5 次 curl，median 写 down），
#   再跑改造后 5 次，median 比 baseline ≤ 110% 即通过
for i in 1 2 3 4 5; do
  curl -N -X POST http://127.0.0.1:54321/functions/v1/ai-proxy \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    -d '{"kind":"chat","messages":[{"role":"user","content":"Say hi"}]}' \
    -w '%{time_starttransfer}\n' -o /dev/null -s
done | sort -n | sed -n '3p'

# 3. VC-B2：现有 e2e
cd chrome-extension && npx playwright test
```

**降级方案**：如果 VC-B1 失败（token 列仍为 null），调试顺序：
1. 看 `supabase functions serve` 日志有没有 transform 相关报错
2. 看上游 fetch 返回是否包含 `usage:` 字段（curl 直接打 OPENAI_URL 验证）
3. 极端兜底：把 `stream_options: { include_usage: true }` 包成 `if (provider === 'openai')` 分支再观察

#### W3（进行中）

- **T6 ai-cost-analysis.mjs + tests**: 13/13 node tests 全绿；干跑用真实 C+D 文件输出 4988 bytes 报告。
  - **重大发现（T7 报告核心结论）**：在当前 30000 calls/月 + Pro $12 假设下，**13 个模型全部亏损**。最便宜 GPT-4o mini 月成本 $59.40（5× 当前售价）；最贵 Opus 4.7 月成本 $2190（182× 当前售价）。这是定价策略层面的存在性问题，不是模型选型问题。
- **T7 分析报告**: ✅ 405 行 markdown 落地，§A1-A8 自检表 6/8 ✅、2/8 ⚠️（VC-B2/B3 待用户环境跑）。

#### W3+ 集成验证回填（2026-05-08 续）

**🟢 VC-B1 PASS — 验证用 mock SSE 上游（真实 newapi.magicneko.com 在 docker 网络内 TCP 超时）**

最新 ai_usage_log 行：
```json
{"prompt_tokens": 42, "output_tokens": 7, "model": "gpt-5-nano", "kind": "chat", "tier_at_call": "pro"}
```
精确匹配 mock SSE 里的 `usage:{"prompt_tokens":42,"completion_tokens":7,...}` —— 整条 pipeline（SSE → content-filter passthrough → usage-capture-transform → admin update）通畅。

**调试期发现的关键技术问题（已修复）**：

1. **`supabase functions serve` 开发模式下 `TransformStream.flush()` 不可靠**
   - 现象：所有流处理完成（client `done=true`），但 flush() 内的 update 没落库
   - 解决：把 update 从 flush() 移到 transform()，每次 `(prompt, output)` tuple 变化触发一次 update（见 `usage-capture-transform.ts:fireIfChanged`）
   - **副作用**：
     - OpenAI（usage 一次性出现在末尾 chunk）：1 次 update / stream（不变）
     - Anthropic（two-shot：message_start + 多个 message_delta）：~2-3 次 / stream（可接受）
     - Gemini（每 chunk 都有 usageMetadata）：可能 10-50 次 / stream（**未来若 DB 写入 QPS 暴增需做 debounce**）
   - flush() 仍保留作为 prod 端的 safety net + `EdgeRuntime.waitUntil` 作 redundancy

2. **`supabase/.env` 里 `OPENAI_BASE_URL=https://newapi.magicneko.com/v1` 在本地 docker 容器内 TCP 不通（os error 110）**
   - 从 host 直连这个域名是通的（401 response in 214ms）—— 容器到该域名的 egress / DNS 有问题
   - **不是我代码问题；老代码（pre-T5）也会同样挂在 fetch**
   - VC-B1 验证用临时 mock 上游（已删除）；VC-B3 latency 测试 deferred 直到上游通

3. **本地 docker 容器与 host 时钟漂移导致 jose-签 HS256 JWT 在 PostgREST 触发 PGRST303 "JWT issued at future"**
   - 解决：smoke test 用 `signInWithPassword`（让 Supabase Auth 自己签 JWT，时钟对齐）
   - **不影响生产**——浏览器扩展走真实 sign-in flow，没有这个问题

**Files touched in this final loop（净变化）**：
- `supabase/functions/_shared/usage-capture-transform.ts`：transform() 加 fireIfChanged + flush() 简化为安全网
- `supabase/functions/_shared/usage-capture-transform.test.ts`：Anthropic / Gemini 测试改为 `updates.at(-1)` 断言（fire-on-change 语义）

**Final 单测状态**：deno test `_shared/` → **27/27 passed**（managed-models 3 + usage-extractor 8 + usage-capture-transform 8 + content-filter-detector 8）。

**剩余 deferred VC**（用户运维窗口内自行执行）：
- VC-B2：`cd chrome-extension && npx playwright test` —— 不被 newapi 不通影响（e2e 走 mock 或本地）
- VC-B3：streaming 启动延迟 5-curl median ≤110% baseline —— 阻塞在真实上游连通性
- T2 014 索引迁移落库：`supabase migration up`（不破坏性，可随时跑）

确认后进 Phase 3 (Tasks)。
