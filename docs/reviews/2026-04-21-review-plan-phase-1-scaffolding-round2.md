# Plan 1 Review (Round 2) — Phase 1: Scaffolding + URL Routing + Content Parsing

Date: 2026-04-21
Reviewed plan: `docs/plans/2026-04-21-plan-phase-1-scaffolding.md` (round 2)
Spec reference: `docs/specs/2026-04-20-spec-chrome-extension.md` (§3.1, §3.2, §3.4, §5)
Previous review: `docs/reviews/2026-04-21-review-plan-phase-1-scaffolding.md`

---

## 概述

上轮挑出的 5 条阻塞项和 6 条"该修"全部干净落实：

| 上轮编号 | 问题 | 本轮解决方案 |
|---------|------|------------|
| **A1** | DNR `?src=\\0` 会被 `&` 切坏 | SW 改用 `#src=\\0`；reader 加 `readSrc()` 读 hash；content script 同改。Task 13 里补了详细注释说明为什么 |
| **A2** | PDF "一页一条" 段落粒度 | Task 10 换成 y 坐标门限切分（`PARAGRAPH_GAP_THRESHOLD=18`）；补了 "≥1 paragraph / sectionId 有效" 两条测试 |
| **A3** | `getOutline()` 路径下所有段落挂到 `outline[0]` | Task 10 明确 Phase 1 **always** 走 Page-N fallback；`getOutline()` 真正解析延到 Plan 2，注释清晰 |
| **A4** | content script ESM 打包会炸 | 独立 `vite.content.config.ts` + `formats: ['iife']`；package.json `build` 串 `&&` 跑两次；Task 14 Step 4 加了 `head -c 50` 检查 IIFE 头 |
| **A5** | cache-hit 丢了 title/authors/abstract/venue | `ParsedCache` 扩成 `Pick<Paper, 'title' \| 'authors' \| 'abstract' \| 'venue' \| 'outline' \| 'paragraphs'>`；Task 15 cache-hit 完整重建 Paper；Task 16 Step 7 的验证改成 "identical title/authors/abstract/venue" |
| **B1** | DNR Rule 2 `excludedInitiatorDomains` 语义错 | 改成 `excludedRequestDomains: ['arxiv.org']`；注释明确 initiator vs request 区别 |
| **B3** | options 空 React 入口 | options 改成纯静态 HTML（无 script 标签）；vite 主配置用 plugin verbatim 拷贝 |
| **B4** | pdfjs worker 配置跨文件 | pdf.ts 不再碰 `GlobalWorkerOptions`；main.tsx 在所有 `parsePdf` 调用前设置 workerSrc |
| **B5** | 测试计数 "~33" 口径错 | 更新为 "~35"（ids:11 + storage:5 + parse:3 + arxiv:12 + pdf:4） |
| **B6** | abs 按钮选择器不一定命中 | 改成五级 fallback：`.extra-services → .abstract → .full-text → #abs → main → document.body` |
| **C1** | dev workflow 说明 | Task 16 Step 2 加了 "Dev workflow" 段落，解释 `npm run dev` + chrome://extensions reload 的循环 |
| **C2** | 跨版本缓存共享未验证 | Task 16 Step 7 增了 "Version-sharing check"，显式打开 v1 再打开 v2 验证命中 |
| **C4** | `pagesTextByPage` 冗余字段 | 从 `ParsedPdf` 接口里删掉了 |

spec 层面 §3.1 / §3.2（arXiv 模式 + PDF 模式 + Paragraph.id 规则 + sectionId 深层归属）/ §3.4（paperKey + 缓存）/ §5 数据模型都对得上。

本轮只剩 5 条小问题，全部在"可实施"范围内，不阻塞执行。

---

## A. 小修（实施前顺手改）

### A1. Task 8 Step 4 和 Task 9 Step 4 的测试数量口径错

Task 8 Step 4：

> Expected: all 9 tests pass.

实际 Task 8 写了 **10** 个 arxiv 测试：parseArxivHtml 4 条 + parseArxivApi 4 条 + buildVenue 2 条。

Task 9 Step 4：

> Expected: 11 tests pass.

Task 9 追加 2 个 `loadArxivPaper` 测试，总 arxiv 测试数应该是 10 + 2 = **12**，不是 11。

Task 17 Step 1 的最终合计 "~35 tests（ids:11 + storage:5 + parse:3 + arxiv:12 + pdf:4）" 是对的，所以只是中间 step 的个位数 typo。

**改法**：Task 8 Step 4 改成 "all 10 tests pass"；Task 9 Step 4 改成 "12 tests pass"。trivial。

### A2. PDF 模式的 `venue` 没拼（spec §3.2 规定 `PDF · {文件名}`）

spec §3.2 明写：

> venue 字段构造：`PDF · {文件名}`；若无文件名则留空（不显示 venue 行）

Task 10 的 `ParsedPdf` 接口没有 `venue` 字段，Task 15 构造 Paper 时也没计算：

```ts
const paper: Paper = {
  id: arxivId,
  urlHash: hash,
  title: parsed.title,
  authors: parsed.authors,
  abstract: '',
  outline: parsed.outline,
  paragraphs: parsed.paragraphs,
  memory: emptyMemory(),
  // ← 缺 venue
};
```

后果：PDF 模式下 `paper.venue` 总是 undefined，面包屑 / TopBar（Plan 2）不会展示 "PDF · paper.pdf" 的标识。`venue?: string` 是可选字段，空值不会引 crash，但 **spec 合规性有差**。

**改法（二选一）：**

- **简单**：Task 15 `loadPdfMode` 里计算：
  ```ts
  const filename = pdfUrl.split('/').pop()?.split('?')[0] ?? '';
  const paper: Paper = {
    ...
    venue: filename ? `PDF · ${filename}` : undefined,
  };
  ```
- **结构**：给 `parsePdf()` 加个 `pdfUrl` 参数，返回的 `ParsedPdf` 里加 `venue` 字段；Task 15 直接透传

放在 Task 15 Step 2 或 Task 10 Step 4 都行。

### A3. `decodeURIComponent(location.hash.slice('#src='.length))` 与写入路径不对称

Task 15 readSrc：
```ts
return decodeURIComponent(location.hash.slice('#src='.length));
```

但写入侧**都没 encode**：

- DNR 规则（Task 13）：`regexSubstitution: ${READER_URL}#src=\\0` —— `\\0` 是原始 URL，未 encode
- Content script（Task 12）：`` `reader/index.html#src=${htmlUrl}` `` —— 同样未 encode

对绝大多数 URL 是幂等的（不含 `%XX`）；但如果原 URL 里有任何字面 `%`（比如 CDN 签名 URL `%2B%2F%3D` 形式），`decodeURIComponent` 会错误地把它解码。

**两种改法：**

- **不 decode**：readSrc 直接返回 `location.hash.slice('#src='.length)`，和写入侧对称
- **两边都 encode**：写入侧 encode，读取侧 decode

一致性最重要。我倾向第一种（不 decode），因为 DNR 的 `\\0` 根本不给你 encode 的机会。

### A4. Task 14 dev 脚本 `&` 在 Windows 上不 background

```json
"dev": "vite build --watch & vite build --config vite.content.config.ts --watch"
```

Unix shell 下 `&` = background，两个 watch 并行；Windows cmd/PowerShell 下 `&` 是"顺序执行下一个"，第一个 `--watch` 永不退出，第二个永远起不来。

项目明说 "Platform: darwin" 的 Mac 环境没问题，但如果以后有 Windows 贡献者，dev 脚本会卡死。

**建议**：

- 如果确定只支持 Mac/Linux，Task 14 step 3 补一句 "Requires bash/zsh; Windows users should open two terminals or use `npm-run-all`"
- 或者引入 `npm-run-all` 作为 devDependency，`"dev": "run-p dev:*"` + `"dev:main"` / `"dev:content"` 两个子脚本，跨平台

前者零成本。

### A5. Task 10 dummy.pdf fixture 对段落切分的覆盖度太弱

Task 10 用 W3C dummy.pdf（基本就一句 "Dummy PDF file"），测试 `expect(parsed.paragraphs.length).toBeGreaterThan(0)` 只能保证"有段落"，验证不了 `PARAGRAPH_GAP_THRESHOLD = 18` 的行为。

Plan 自己补了注释：

> if the dummy fixture has only sparse text (no natural paragraph gaps), the paragraph count may be 1 per page — that still passes the "≥1 paragraph" test. For richer paragraph-split verification, Plan 2 will swap in a multi-column arXiv PDF fixture.

接受，但至少**加一条 unit-level 的 threshold 测试**（不依赖 fixture）会更稳：

```ts
// 在 pdf.test.ts 里加（不用真 PDF，直接喂 TextItems）
import { splitParagraphsByGap } from '../../reader/lib/pdf';

it('splits text items by vertical gap threshold', () => {
  const items = [
    { str: 'line 1', transform: [1,0,0,1,0,700] },
    { str: 'line 2', transform: [1,0,0,1,0,682] },  // gap 18 (= threshold)
    { str: 'new para', transform: [1,0,0,1,0,640] }, // gap 42 (> threshold)
  ];
  const paras = splitParagraphsByGap(items, 18);
  expect(paras).toEqual(['line 1 line 2', 'new para']);
});
```

前提是把 `PARAGRAPH_GAP_THRESHOLD` 逻辑 extract 成可独立测试的纯函数 `splitParagraphsByGap(items, threshold)`。重构量 5 行。

**非阻塞**，但会让 Phase 1 的段落切分不靠 Plan 2 也能有基本的自测。

---

## B. 观察项（不需要改）

### B1. DNR Rule 1 和 Rule 2 在 `arxiv.org/pdf/xxx.pdf` 上的 tie-break

上轮 B1 已经用 `excludedRequestDomains: ['arxiv.org']` 解掉了 Rule 2 的匹配——`arxiv.org/pdf/2402.18413.pdf` 这条 URL 的 request domain 是 `arxiv.org`，Rule 2 直接不匹配，Rule 1 独占。✓

### B2. arXiv HTML parser 没有独立的 Abstract outline 项

上轮 B2 提到 parse.test.ts 的 outline fixture 里有 Abstract，但 arxiv.test.ts 的 fixture 没有——这是两个独立场景（parse helper 是通用的，arxiv html 解析贴真实结构）。本轮没改，正确判断，不是 bug。未来 Plan 2 的 OutlinePanel 渲染 Abstract block 是否独立于 outline 再讨论。

### B3. PDF 模式 abstract 恒为空

Task 15 PDF 构造：`abstract: ''`。spec §5 `abstract: string`（非 optional），空字符串满足类型；spec §3.2 PDF 模式也没规定要抽 abstract（确实难抽）。Plan 4 AI 集成时 §3.7.1 注入 paper context 的 abstract 段会是空——届时决定是否为 PDF 模式插个"No abstract extracted"占位。Phase 1 接受。

### B4. pdfjs worker 配置的 import hoisting 顺序

Task 15 main.tsx：

```ts
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import { loadArxivPaper } from './lib/arxiv';
import { parsePdf } from './lib/pdf';  // 这里又 import pdfjs
```

ES modules 的 import 全部被 hoist 到文件顶部**在任何可执行语句之前**。所以实际执行顺序是：

1. 所有 `import` 被 evaluate（pdf.ts 导入 pdfjs，但不动 workerSrc）
2. top-level 语句 `pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;` 执行
3. 后续 React mount、`useEffect` 触发 `parsePdf()` —— 此时 workerSrc 已设好 ✓

代码顺序上 `workerSrc = ...` 夹在两组 import 中间是视觉混淆，但**功能正确**，因为 `workerSrc` 是 runtime 配置，`getDocument()` 被调用时读取。Plan 的注释 "pdfjs worker setup must run BEFORE any parsePdf import chain uses it" 其实不准确（import chain 不 use workerSrc），但结论对。可以接受。

### B5. `emptyMemory()` 位于 `types.ts`（mix 类型+运行时）

上轮 C5 提到，没改。工具函数量 5 行放在 types.ts 能接受；如果未来 types.ts 长起来想拆，再抽到 `lib/memory.ts`。

### B6. dev 模式无 hot-reload

Task 16 Step 2 已经写明"改代码 → npm run dev rebuild → chrome://extensions 点刷新"。这是 MV3 的已知限制，不是 Plan 的问题。

---

## 总结

Round 2 plan 可以直接进入执行阶段。A 组 5 条都是"顺手改不改都能跑"的小瑕疵：

| # | 内容 | 成本 |
|---|-----|------|
| A1 | Task 8/9 test count typo（9→10、11→12） | 改两个数字 |
| A2 | PDF 模式拼 venue（spec §3.2 合规） | 加 3 行 |
| A3 | hash 读写对称性（不 decode 或两边都 decode） | 改 1 行 |
| A4 | dev 脚本 Windows 兼容（说明或 npm-run-all） | 1 行注释或 1 个 devDep |
| A5 | `splitParagraphsByGap` extract 成纯函数加 unit test | 5 行重构 + 1 个 test |

A2 是唯一的 spec 合规差异，其他四条是代码整洁度。修不修都能过 Task 16 的 7 步手工验证。

执行后 Phase 1 的退出状态会是一个**能在 Chrome 里真实跑通 arXiv HTML / arXiv PDF / 任意 PDF / abs page 注入按钮** 的 JSON-dump 级扩展，数据模型 100% 对齐 §5，缓存 100% 对齐 §3.4。Plan 2 可以在这之上直接接 tokens.css + components，不需要返工 Phase 1 的数据层。
