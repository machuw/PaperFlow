# Analysis: AI 成本与会员档位定价

**日期**: 2026-05-07
**关联**: [SPEC](2026-05-07-spec-ai-cost-tier-pricing.md) · [Plan](../plans/2026-05-07-plan-ai-cost-tier-pricing.md)
**状态**: 首版（baseline，待真实 token 数据回流后修订）

---

## 0. 执行摘要

**核心结论**：在当前 Pro tier $12/月 + 30000 calls/月 上限的组合下，**没有任何一个候选模型能盈利**——按 baseline workload（chat 占 55%、summary 15% 等，平均每次调用 ~8K input + 1.5K output tokens）跑满 30k calls：

- 最便宜的 **GPT-4o mini** 月成本 **$59.40 / 用户**（亏 $47.40，5×售价）
- 当前生产用的 **Claude Haiku 4.5** 月成本 **$438 / 用户**（亏 $426，37×售价）
- 最贵的 **Claude Opus 4.7** 月成本 **$2190 / 用户**（亏 $2178，182×售价）

这是一个**定价/配额结构**问题，不是模型选型问题。换更便宜的模型救不了，因为最便宜的也已经亏 5×。

**建议（详见 §7，按推荐顺序）**：

1. **A — 大幅压低 Pro 月度上限**（30000 → ~2500 calls/月），保留 $12 售价 + 当前 Haiku 4.5。**优点**：最小改动；**缺点**：用户能体感的"自由感"下降，可能影响转化与续订。
2. **B — 升 Pro 售价 + 收紧上限**（$12 → $25-29/月，cap → 5000-8000 calls/月）。**优点**：跟 ChatGPT Plus / Claude Pro 价位接近，毛利健康；**缺点**：要做提价沟通与增量价值证明。
3. **C — 改成 token-based 配额**（按 input+output token 总量计费，例如 Pro = 5M tokens/月）。**优点**：用户付的 token 钱直接覆盖成本，重度用户自然消耗自己的额度；**缺点**：UX 概念复杂，要做 in-app token 计数 + 用户教育，工程量 ~1-2 个 phase。

不论选哪条，**第一步都是把真实 token 数据收齐**——本 phase 的 ai-proxy 改造（T5）已经把基础设施备好，2-3 周后用真实数据替换本报告的 baseline 假设再决策。

---

## 1. 方法

### 1.1 cost-plus 公式

```
cost_per_call(model, kind)        = (prompt × input_price + output × output_price) / 1e6
cost_per_call_weighted(model)     = Σ_kind  distribution[kind] × cost_per_call(model, kind)
monthly_cost_per_user(model)      = cost_per_call_weighted × calls_per_month
recommended_price(model, margin)  = monthly_cost_per_user / (1 − margin)
realised_margin(price)            = (price − monthly_cost_per_user) / price
```

`monthly_cost_per_user` 假设**用户跑满月度上限**（30000 calls）——这是**上界**估算（worst-case for us）。真实平均 ARPU 取决于用户实际使用率分布。

### 1.2 输入数据来源

| 数据 | 文件 | 抓取日期 | 备注 |
|---|---|---|---|
| 模型单价 | [`scripts/data/model-pricing.json`](../../scripts/data/model-pricing.json) | 2026-05-07 | 13 个模型，全部从官方 pricing 页抓取，0 个 tbd |
| Token 用量假设 | [`scripts/data/workload-assumptions.json`](../../scripts/data/workload-assumptions.json) | 2026-05-07（baseline） | **未实测**——`ai-proxy/index.ts:16` 注释 + 通用经验值 |
| 月度调用上限 | `supabase/migrations/013_pro_quota_30k.sql` | live | Pro = 30000 calls/月 |
| 现行档位价 | `.planning/seeds/v1.5-tier-policy-table.md` | 2026-05-06 | Free $0 · Sync $4/月 · Pro $12/月（dormant seed 中的草稿值） |

### 1.3 关键假设（read carefully）

1. **每次调用的 token 量是 baseline 估算**，不是实测。当前生产里 `ai_usage_log.prompt_tokens / output_tokens` 列尚未填充——T5 的改造刚把这条 pipeline 接上，2-3 周后才有可信均值/中位数。
2. **kind 分布是 chat-heavy 猜测**（chat 55% / explain 20% / summary 15% / translate 5% / overview 5%）——同样未实测。
3. **不计 BYOK 用户**——用户自己付 API 费，不消耗我们成本。BYOK 比例假设为 0；如果实际有 30% 用户走 BYOK，下面所有"月成本/用户"应乘 0.7。
4. **不计 cache hit**：Anthropic 提供 prompt caching（cache hit 输入价 0.1×）；如果 chat 场景里相同 paper 多轮 chat 命中 cache，Anthropic 路径成本可下降 30-60%。本报告**保守估算未启用 cache**。
5. **不计 batch API**（OpenAI / Anthropic 都有 batch 50% 折扣）——交互式 paper reader 没法用 batch。
6. **不计 Free tier 与试用**：Free 是 lifetime 20 calls，新用户冷启动成本可忽略；Sync ($4) 不消耗 managed AI（见 §5）。

### 1.4 calls_per_month = 30000 的合理性

30000/月 = 1000/天 = 41.67/小时（24h 平均）= 不间断每分钟 0.69 次。这**不是**典型用户行为。真实分布可能是：

- **轻度（70%）**：< 500 calls/月（每天 10-20 次 ad-hoc 查论文）
- **中度（25%）**：500-3000 calls/月（每天读 2-5 篇深度 chat）
- **重度（5%）**：3000-30000 calls/月（每天读多篇 + 大量 chat 历史）

如果真实平均落在 1000 calls/月（30× 缩减），下面所有数字也 30× 缩减——**Pro $12 立即就能盈利**，且毛利可观。

**问题不在"30000 cap 是不是真消耗"，而是 cap 的存在让用户感知"我可以这么多次"，定价模型必须按 cap 算 worst case。**

---

## 2. 模型矩阵与单价

13 个候选模型，按 tier_class 分组：

| tier_class | 模型 | provider | input $/1M | output $/1M | output:input | 备注 |
|---|---|---|---:|---:|---:|---|
| **mini** | GPT-4o mini | openai | 0.15 | 0.60 | 4× | 价格锚点；老但便宜 |
| | GPT-4.1 mini | openai | 0.40 | 1.60 | 4× | 1M context |
| | Claude Haiku 4.5 | anthropic | 1.00 | 5.00 | 5× | **当前生产模型** |
| | Gemini 2.5 Flash | google | 0.30 | 2.50 | 8.3× | output 价跳得最陡 |
| **flagship** | GPT-4o | openai | 2.50 | 10.00 | 4× | 已被 GPT-5 取代 |
| | Claude Sonnet 4.5 | anthropic | 3.00 | 15.00 | 5× | |
| | Gemini 2.5 Pro | google | 1.25 | 10.00 | 8× | ≤200k 上下文价；>200k 是 2× |
| **frontier** | GPT-5 | openai | 1.25 | 10.00 | 8× | **与 Gemini 2.5 Pro 价格相同** |
| | GPT-5 mini | openai | 0.25 | 2.00 | 8× | mini-类前沿，性价比之王 |
| | Claude Opus 4.7 | anthropic | 5.00 | 25.00 | 5× | **从 Opus 4.1 的 $15/$75 大幅降价**；但新 tokenizer 同文本可能多消耗 ~35% tokens |
| | Claude Sonnet 4.6 | anthropic | 3.00 | 15.00 | 5× | 与 4.5 同价 |
| | Gemini 3 Pro (preview) | google | 2.00 | 12.00 | 6× | ≤200k 价 |
| | Gemini 3 Flash (preview) | google | 0.50 | 3.00 | 6× | |

**观察**：
- output:input 比从 4× 到 8.3× 不等，**output token 控制是降本关键**——每 100 token 输出比 100 token 输入贵 4-8 倍。
- 三家"mini"档不是同价位：GPT-4o mini ($0.15/$0.60) << GPT-4.1 mini ($0.40/$1.60) << Claude Haiku 4.5 ($1.00/$5.00)。Haiku 比 GPT-4o mini **贵 6.7× 输入、8.3× 输出**。
- Opus 4.7 大降价（vs Opus 4.1）但**仍是表中第二贵**（仅次于 GPT-4o flagship 在某些维度）。

---

## 3. 单次调用成本（按 kind × model）

(自动生成自 `scripts/ai-cost-analysis.mjs`，输入 = 上节 §2 单价 + workload-assumptions.json baseline)

| kind \ model | GPT-4o mini | GPT-4.1 mini | Claude Haiku 4.5 | Gemini 2.5 Flash | GPT-4o | Claude Sonnet 4.5 | Gemini 2.5 Pro | GPT-5 | GPT-5 mini | Claude Opus 4.7 | Claude Sonnet 4.6 | Gemini 3 Pro | Gemini 3 Flash |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **chat** (8K↑/1.5K↓) | $0.0021 | $0.0056 | $0.0155 | $0.0062 | $0.0350 | $0.0465 | $0.0250 | $0.0250 | $0.0050 | $0.0775 | $0.0465 | $0.0340 | $0.0085 |
| **summary** (12K↑/2K↓) | $0.0030 | $0.0080 | $0.0220 | $0.0086 | $0.0500 | $0.0660 | $0.0350 | $0.0350 | $0.0070 | $0.1100 | $0.0660 | $0.0480 | $0.0120 |
| **explain** (4K↑/0.5K↓) | $0.0009 | $0.0024 | $0.0065 | $0.0024 | $0.0150 | $0.0195 | $0.0100 | $0.0100 | $0.0020 | $0.0325 | $0.0195 | $0.0140 | $0.0035 |
| **translate** (2K↑/2K↓) | $0.0015 | $0.0040 | $0.0120 | $0.0056 | $0.0250 | $0.0360 | $0.0225 | $0.0225 | $0.0045 | $0.0600 | $0.0360 | $0.0280 | $0.0070 |
| **overview** (10K↑/1.5K↓) | $0.0024 | $0.0064 | $0.0175 | $0.0067 | $0.0400 | $0.0525 | $0.0275 | $0.0275 | $0.0055 | $0.0875 | $0.0525 | $0.0380 | $0.0095 |

**单次调用成本数量级感知**：
- 单次 chat 在 mini 档：**$0.002-0.016**（即 0.2-1.6 分美元）
- 单次 chat 在 flagship 档：**$0.025-0.047**
- 单次 chat 在 Opus 4.7：**$0.0775**（约一杯星巴克的 1/100）

---

## 4. Pro tier 月成本与定价建议

### 4.1 加权月成本（30000 calls/月，default distribution）

| Model | tier_class | provider | 加权 cost/call | 月成本/用户 |
|---|---|---|---:|---:|
| GPT-4o mini | mini | openai | $0.0020 | **$59.40** |
| GPT-5 mini | frontier | openai | $0.0047 | $141.00 |
| GPT-4.1 mini | mini | openai | $0.0053 | $158.40 |
| Gemini 2.5 Flash | mini | google | $0.0058 | $173.40 |
| Gemini 3 Flash (preview) | frontier | google | $0.0080 | $240.00 |
| **Claude Haiku 4.5** ← 当前生产 | mini | anthropic | $0.0146 | **$438.00** |
| Gemini 2.5 Pro | flagship | google | $0.0235 | $705.00 |
| GPT-5 | frontier | openai | $0.0235 | $705.00 |
| Gemini 3 Pro (preview) | frontier | google | $0.0320 | $960.00 |
| GPT-4o | flagship | openai | $0.0330 | $990.00 |
| Claude Sonnet 4.5 | flagship | anthropic | $0.0438 | $1314.00 |
| Claude Sonnet 4.6 | frontier | anthropic | $0.0438 | $1314.00 |
| Claude Opus 4.7 | frontier | anthropic | $0.0730 | $2190.00 |

**关键观察**：
- 最便宜的 GPT-4o mini 也要 **$59.40/月** 才能 break-even（不含任何 margin）。
- Pro 当前生产模型 **Claude Haiku 4.5 月成本 $438**——是 Pro 售价 $12 的 **36.5×**。
- 同档对比：GPT-4o mini 比 Claude Haiku 4.5 便宜 **7.4×**——如果纯按成本，应当从 Haiku 切换到 GPT-4o mini，但已经 commit 到 Haiku 是因为 v1.3 之后的 Bedrock 路径稳定性（见 `_shared/managed-models.ts:8` 注释）和质量考量。

### 4.2 cost-plus 推荐零售价

按目标毛利反推：

| Model | 月成本/用户 | @ 50% 毛利 | @ 70% 毛利 | @ 85% 毛利 |
|---|---:|---:|---:|---:|
| GPT-4o mini | $59.40 | $118.80 | $198.00 | $396.00 |
| GPT-5 mini | $141.00 | $282.00 | $470.00 | $940.00 |
| GPT-4.1 mini | $158.40 | $316.80 | $528.00 | $1056.00 |
| Gemini 2.5 Flash | $173.40 | $346.80 | $578.00 | $1156.00 |
| Gemini 3 Flash (preview) | $240.00 | $480.00 | $800.00 | $1600.00 |
| Claude Haiku 4.5 | $438.00 | $876.00 | $1460.00 | $2920.00 |
| ... 后面更贵的略 ... | | | | |

**这些数字荒谬地高**——因为 30000 calls 上限本身就是不合理的天花板。任何 SaaS LLM 服务定价 $80-1500/月 都没有市场。

### 4.3 现行 $12 下的实际（亏损）情况

| Model | 月成本 | 净利润/用户 | 倍数 |
|---|---:|---:|---:|
| GPT-4o mini | $59.40 | **-$47.40** | 亏 5.0× |
| GPT-5 mini | $141.00 | -$129.00 | 亏 11.8× |
| Claude Haiku 4.5（当前） | $438.00 | **-$426.00** | **亏 36.5×** |
| Claude Opus 4.7 | $2190.00 | -$2178.00 | 亏 182.5× |

**13/13 全部亏损。**

### 4.4 切实可行的 Pro 配置（如果继续走 cost-plus 70% 毛利目标）

要让 Pro $12/月 在 70% 毛利下不亏，月成本必须 ≤ **$3.60**。要把 Claude Haiku 4.5 的月成本压到 $3.60 以下：

| 调整方向 | 数值 | 实际效果 |
|---|---|---|
| 降低 calls cap | 30000 → ~250 calls/月 | 等于压到 1/120，过分严苛 |
| 切到 GPT-4o mini | Haiku → GPT-4o mini | 月成本 $59.40 ÷ 7.4 = 仍是 $59.40，不够（还要再 16× 缩） |
| 降 token 假设 | chat 8000→500 in / 1500→100 out | 缩 ~16×，即 $438 ÷ 16 ≈ $27 → 还是不够 |
| **三招合用** | GPT-4o mini + 5000 calls/月 + 真实 token 缩 50% | $59.40 → ÷6 (calls) → $9.90 → ÷2 (tokens) → ~$4.95 → 接近 $3.60 |

实际答案：**只压 calls cap 一项最有杠杆**——降到 ~2500 calls/月 + 仍用 Haiku，月成本 $36.5 → 仍不够；切 GPT-4o mini + 2500 cap = $4.95 → **接近可行**。

---

## 5. Sync tier ($4/月) — 不消耗 managed AI

Sync 用户**不能**调用 ai-proxy（`013_pro_quota_30k.sql:28-30` 在 RPC 里 raise exception）。Sync 的成本结构与 AI 无关，只有 Supabase infra：

### 5.1 Sync infra 单位成本估算（数量级）

| 项目 | 假设 | 月成本 |
|---|---|---|
| Postgres 行 | 假设单用户：500 paper rows × 200B + 1000 annotation rows × 1KB ≈ 1.1 MB | < $0.01 / 用户 / 月 |
| Storage（PDFs 等） | 假设 ≤ 100 MB / 用户 cap（实际多数 < 30 MB） | $0.021 / GB-月 × 0.1 GB ≈ **$0.002** |
| Realtime | 仅在 tier 变化或同步推送时；事件数 < 100/月/用户 | < $0.001 |
| Edge Function 调用 | byok-sync, subscriptions-sync 等，估 50 calls/月 × $0.000002 | 可忽略 |
| Egress | 跨设备同步，≤ 1 GB/月/用户 | $0.09 / GB × 1 = $0.09 |
| **Supabase Pro 项目固定费** | $25/月（不分摊到单用户除非除以 N） | 在 1000 Sync 用户规模下 = $0.025/月/用户 |
| **小计** | | **~$0.13 / 用户 / 月** |

Sync $4/月 - $0.13 cost = **$3.87 净利润**，毛利 **96.7%**。

**Sync tier 是健康的**——只要不开放 managed AI（已经在 RPC 层 enforced）。

### 5.2 Sync 风险点（不是定价风险）

- 单用户 storage 突破 100 MB 上限（多 PDF + 大附件）—— 当前没硬 cap，应在前端加 200 MB 软 cap（**out of scope，记 follow-up**）
- 大量用户冷启动一次性同步全部历史 → realtime 拥塞 → **可能需要专项调优**

---

## 6. 敏感性分析

切换三种 distribution 看月成本/用户的变化：

| Model | default | chat-heavy | summary-heavy | summary-heavy / default |
|---|---:|---:|---:|---:|
| GPT-4o mini | $59.40 | $58.73 | $69.75 | 1.17× |
| GPT-4.1 mini | $158.40 | $156.60 | $186.00 | 1.17× |
| Claude Haiku 4.5 | $438.00 | $433.13 | $513.00 | 1.17× |
| Gemini 2.5 Flash | $173.40 | $171.56 | $201.90 | 1.16× |
| GPT-4o | $990.00 | $978.75 | $1162.50 | 1.17× |
| Claude Sonnet 4.5 | $1314.00 | $1299.38 | $1539.00 | 1.17× |
| Gemini 2.5 Pro | $705.00 | $697.50 | $821.25 | 1.16× |
| GPT-5 | $705.00 | $697.50 | $821.25 | 1.16× |
| GPT-5 mini | $141.00 | $139.50 | $164.25 | 1.17× |
| Claude Opus 4.7 | $2190.00 | $2165.63 | $2565.00 | 1.17× |
| Claude Sonnet 4.6 | $1314.00 | $1299.38 | $1539.00 | 1.17× |
| Gemini 3 Pro | $960.00 | $949.50 | $1122.00 | 1.17× |
| Gemini 3 Flash | $240.00 | $237.38 | $280.50 | 1.17× |

**观察**：所有模型对 distribution 偏移的响应**几乎一致**（≈1.16-1.17× from default → summary-heavy）——因为 summary 的 token 量（12k+2k = 14k）只比 chat（8k+1.5k = 9.5k）大 47%，而 distribution 只在 5-15% 之间挪动。

**结论**：distribution 不是关键变量。**关键变量是 calls/月 上限和单次平均 token 量**——这两者的不确定性都在 ±100% 以上量级，distribution 只能贡献 ±20%。

---

## 7. 三条建议

按推荐顺序：

### 建议 A — 大幅压低 Pro 月度上限（最低改动）

**操作**：
- Pro: 30000 calls/月 → **2500 calls/月**（12×缩）
- 模型保持 Claude Haiku 4.5（生产 incumbent）
- 价格保持 $12/月

**经济**：
- 月成本/用户 = $438 / 12 = **~$36.50**
- $12 价格下：仍亏 $24.50/用户

**……不够。要叠加切模型：** Haiku → **GPT-4o mini**（月成本 $59.40 / 12 = $4.95）→ **毛利 = ($12 - $4.95) / $12 = 58.8%**（接近 70% 目标但未达成）。

或者再叠加缩 token：把 chat 的 input 从假设的 8000 缩到 4000（要求实测平均确实在 4K 附近，或者前端裁剪 history 更激进）→ 月成本 $4.95 × 0.6 = $2.97 → **毛利 75.2%** ✅

**风险**：用户在试用期撞 cap 后会愤怒（"我以为 Pro 就是无限"）。

**何种证据让我改主意（推荐 A 不再合适）**：
- 用户调研显示 ≥30% Pro 用户每月会撞到 < 5000 calls 上限
- 真实 ai_usage_log 数据回流 2 周后显示中位 Pro 用户实际跑 ≥ 8000 calls/月（说明 30k cap 在感知上是必要的）

### 建议 B — 升 Pro 售价 + 收紧上限到中间值

**操作**：
- Pro: $12 → **$25/月**（双倍价；与 ChatGPT Plus $20 、Claude Pro $20 持平）
- Calls cap: 30000 → **8000 calls/月**（市场上类似产品的"够用"数字）
- 模型从 Haiku 切到 **GPT-5 mini**（成本极低 + 前沿质量）

**经济**：
- GPT-5 mini 加权 cost/call = $0.0047
- 8000 calls × $0.0047 = **$37.60 / 用户 / 月**
- $25 价格下：**仍亏 $12.60**（毛利 -50%）

**……还是亏？切到 GPT-4o mini：**
- $0.0020 × 8000 = **$15.84 / 用户 / 月**
- $25 - $15.84 = $9.16 净利，**毛利 36.6%**（低但正）

或者保持 GPT-5 mini，cap 降到 4000 calls/月：
- $0.0047 × 4000 = $18.80
- $25 - $18.80 = $6.20 净，**毛利 24.8%**

**风险**：从 $12 涨到 $25 是 2× 提价，已有用户的流失（churn）会显著上升。需要同步推出**新价值**（新模型 / 新功能）来正当化提价。

**何种证据让我改主意（推荐 B 不再合适）**：
- 用户问卷显示 ≥40% 老用户在 $25 价位会取消订阅
- 竞品实际定价中位数 < $20（数据每季度核一次）

### 建议 C — 改为 token-based 配额（结构性变更）

**操作**：
- Pro: $12/月（保持） · 配额从 "30000 calls" 改为 "**5,000,000 tokens / 月**"
- 用户消耗 input + output token 总量
- 模型可以多选（让用户选 Haiku 还是 mini，按 token 直接扣）

**经济**：
- 5M tokens/月 在 GPT-4o mini 上 = **$1.50 - $3.00 / 用户 / 月**（取决于 input/output 比；典型 chat 比是 5:1，给 $1.95 估算）
- 5M tokens/月 在 Claude Haiku 4.5 上 = **$5.00 - $25.00 / 用户 / 月**（比 GPT-4o mini 贵很多）

如果用户**自由选模型**：
- 多数轻度用户（默认走 mini）→ 月成本 $1.95，**毛利 84%** ✅
- 少数重度用户（选 Haiku 跑满 5M）→ 月成本 $20，**亏 $8**（毛利 -67%）
- 但重度用户冷启动慢，平均下来仍可能净利为正

**优点**：
- 自然激励用户选便宜模型
- 商业上更"诚实"——付的 token 钱直接覆盖成本
- 重度用户会自然被定向到 BYOK（自己付 API 费）或更高档位

**缺点**：
- "tokens" 对终端用户是黑盒概念，需要 in-app 教育（"5M tokens ≈ 200 paper chats"）
- 需要 in-app token usage 显示 + 额度告警 UX
- 工程量：~1-2 个 phase（前端 token 显示 + 后端按 token 扣 + edge case 处理）

**何种证据让我改主意（推荐 C 不再合适）**：
- 用户测试显示 ≥50% 用户对"token"概念无法理解 / 对配额管理表示困扰
- Engineering 评估发现需要 ≥3 个 phase（成本超出短期预期）

---

## 8. 已知不确定性

| ID | 不确定性 | 现状 | 何时能消除 |
|---|---|---|---|
| **U1** | 单次调用真实平均 token 量 | baseline 假设 chat=8000 input / 1500 output；**未实测** | 本 phase T5 改造后，2-3 周回流真实数据 |
| **U2** | 真实 kind 分布 | chat 55% / explain 20% / summary 15% 是猜测 | 同 U1（用 `select kind, count(*) from ai_usage_log group by kind` 复核） |
| **U3** | 真实月度 calls 分布 | 假设满 30k；实际可能远低 | 同 U1 |
| **U4** | BYOK 用户占比 | 假设 0；实际未知 | 查 `select count(*) from byok_configs where is_active = true` 即可（已有数据） |
| **U5** | Anthropic prompt caching 命中率 | 假设 0；实际 chat 多轮重复 paper 上下文应有显著命中 | 实施 prompt caching + 实测——非本 phase |
| **U6** | Sync tier infra 成本估算 | $0.13/月/用户 是数量级估算；真实可能 1.5-3× | Supabase Dashboard 用量页拉真实数据，按用户数除一次 |
| **U7** | Opus 4.7 tokenizer 多消耗 ~35%（vendor 文档说的） | 估算时未应用 | 实测 1 周后看 Opus path 的 prompt_tokens 平均偏移 |
| **U8** | Frontier 模型（gpt-5.x / gemini-3.x）的实际质量是否值得用 | 价格已知，但 PaperFlow 场景下表现未测 | A/B 测试，下一阶段 |

**所有 U1-U3 都会随 §10 实施日志列出的 VC-B1（真实 token 落库）解开**。

---

## 9. 下一步

按时间从近到远：

1. **本周内**：用户跑 Plan §10 列出的 VC-B1/B2/B3 三个集成验证（需要本地 supabase 启动 + JWT mint），确认 ai-proxy 改造在生产路径上工作。
2. **2-3 周后**（数据积累）：跑下面 SQL 把 baseline 假设替换为真实数据，重新生成本报告：
   ```sql
   -- 真实 token 用量（按 kind）
   select kind, model,
          percentile_cont(0.5) within group (order by prompt_tokens) as p50_in,
          percentile_cont(0.5) within group (order by output_tokens) as p50_out,
          count(*) as n
   from ai_usage_log
   where created_at > now() - interval '14 days'
     and prompt_tokens is not null
   group by kind, model;

   -- 真实 kind 分布
   select kind, count(*) * 1.0 / sum(count(*)) over () as share
   from ai_usage_log where created_at > now() - interval '14 days'
   group by kind;

   -- 真实 calls 分布
   select percentile_cont(0.5) within group (order by n) as p50,
          percentile_cont(0.95) within group (order by n) as p95
   from (select user_id, count(*) as n from ai_usage_log
         where created_at > now() - interval '30 days' group by user_id) t;
   ```
3. **数据回流后**：在 §7 三建议之间做最终选型。**强烈倾向 C**（token-based 配额），但需要 §7C 的"何种证据让我改主意"也通过验证。
4. **最终选型后**：v1.5 `plans` 表 phase 启动（[`.planning/seeds/v1.5-tier-policy-table.md`](../../.planning/seeds/v1.5-tier-policy-table.md)）以本报告的最终数字为种子。

---

## 10. SPEC §A1-A8 自检清单

| # | 验收项 | 状态 |
|---|---|---|
| A1 | usage-extractor 单测覆盖 OpenAI/Anthropic/Gemini + 边界 | ✅ 8/8 deno tests 全绿 |
| A2 | ai-proxy 改造后 ai_usage_log token 列非 null | ⚠️ 单测 + 类型 OK；活体 VC-B1 待用户运行（见 Plan §10）|
| A3 | streaming 不回归（≤110% 启动延迟） | ⚠️ deno check pass + 401 smoke pass；活体 VC-B3 待用户运行 |
| A4 | model-pricing.json ≥8 模型，三档分布 | ✅ 13 个模型（mini 4 / flagship 3 / frontier 6），全部公开价 |
| A5 | workload-assumptions.json 5 kinds + rationale | ✅ 5 kinds + default + 2 alternatives，sum=1.0 |
| A6 | 报告含表 1-5 + Pro 月成本 + cost-plus 推荐价 + 现行 $12 毛利 + 敏感性 + Sync 章节 | ✅ §3-§6 全覆盖 |
| A7 | §7 三条建议 + 每条附"何种证据改主意" | ✅ §7 A/B/C 三条，每条带证据条件 |
| A8 | 不改前端 / 不改配额 / 不改 Stripe | ✅ 本 phase 仅 ai-proxy + scripts + docs |

**✅ A1, A4, A5, A6, A7, A8 在本 session 内已收尾。**
**⚠️ A2, A3 需要用户在本地 supabase + JWT 环境下手动跑（见 [Plan §10](../plans/2026-05-07-plan-ai-cost-tier-pricing.md#10-实施日志)）。**

---

## 11. 报告再生

如要在更新数据后重生成本报告的表 1-5：

```bash
node scripts/ai-cost-analysis.mjs \
  --pricing scripts/data/model-pricing.json \
  --workload scripts/data/workload-assumptions.json \
  --margin 0.70 \
  --out /tmp/regen.md
# 手动把 /tmp/regen.md 的"## 自动生成"段替换本文件 §3-§6 的对应块
```

或者改 `scripts/ai-cost-analysis.mjs` 让它支持 `--include-narrative` 模式，把本文件的 §0-§2 + §7-§9 作为 template 拼回去——属于下一个 phase 的事。
