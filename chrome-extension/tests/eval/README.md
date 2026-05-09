# PaperFlow Eval Set

Phase 14 v1.2-agent milestone 验收 gate 数据集与 runner 配置。

## 文件结构

- `papers.json` — 50 篇经典 arxiv 论文 metadata（NLP/ML 25 + Stats 10 + Math 8 + Physics 7）
- `queries.json` — 20 个 user query × gold answer（Plan 14-02 落地）
- `runner.ts` — Node 脚本 `npm run eval` 入口（Plan 14-03 落地）
- `metric.ts` — Tool 选择 / 参数 / final answer 三 metric 计算（Plan 14-03 落地）
- `judge.ts` — LLM-as-judge prompt 模板（Plan 14-03 落地）
- `reporter.ts` — markdown 报告 + baseline diff（Plan 14-04 落地）

## papers.json schema

每个条目 5 字段：
- `paperId` — 内部稳定 id（queries.json 的 paperId 字段引用此 id）
- `arxivId` — arXiv canonical ID（如 "1706.03762" 或 legacy "math/0211159"）
- `arxivUrl` — `https://arxiv.org/abs/<arxivId>`
- `title` — 论文标题
- `category` — 4 类之一：`nlp-ml` / `stats` / `math` / `physics`

## 跑 eval（Plan 14-03 落地后启用）

前置：
1. `supabase start && supabase functions serve --env-file ./supabase/.env`（D-B1）
2. 配 `chrome-extension/.env.local`：填 `PF_EVAL_BYOK_KEY`（dev-only，不带 `VITE_` 前缀；Plan 14-03 read at call time，非构建期注入）
3. 配 `OPENAI_API_KEY`（LLM-as-judge 用 GPT-4o，D-B3）
4. 可选：配 `PF_EVAL_BYOK_MODEL`（默认 `claude-sonnet-4-5-20250929` —— eval 沿用 claude-code-openai-wrapper 路径跑模型，extension 端的 BYOK preset 已收窄到 openai-compatible，wrapper 仅作为本地 OpenAI 兼容端点）

跑：
```bash
cd chrome-extension && npm run eval
```

输出（D-C1）：
- stdout：实时进度 + 最终 markdown
- `.planning/eval/runs/{ISO date}.md` — 持久化报告
- `.planning/eval/runs/{ISO date}.json` — raw scores（baseline diff 用）

## Cost 预算

单次跑预估 $10-30（20 query × 2 model × ~5 tool calls × ~5k token ≈ 1M token）。
runner 内置 hard stop（D-Discretion `Cost budget cap` — Plan 14-03 实现）。

## 论文段落数据来源

runner 在执行 `readPaperSection` / `screenshotParagraph` 这两个 client tool 时按需从 arxiv 拉 PDF
并解析段落文本（pdfjs-dist 现有路径）；PDF 缓存到 `.tmp/eval-pdfs/{arxivId}.pdf`（gitignored）。
PDF 不入 git、不入 papers.json — papers.json 只放论文 metadata。
