# Plan 1 Review — Phase 1: Scaffolding + URL Routing + Content Parsing

Date: 2026-04-21
Reviewed plan: `docs/plans/2026-04-21-plan-phase-1-scaffolding.md`
Spec reference: `docs/specs/2026-04-20-spec-chrome-extension.md` (§3.1, §3.2, §3.4, §5)
Prototype reference: `components/paper-data.jsx`, `components/paper-page.jsx`

---

## 概述

Plan 拆分粒度合理（17 个 Task、一条 TDD 主线）、scope 框得很干净（不碰 UI / 不碰 AI，Phase 1 只到 JSON dump）、依赖顺序基本正确（types → ids → storage → parse → 两侧解析器 → manifest → SW → vite → reader shell → verify）。

spec 覆盖上：§5 数据模型、§3.4 paperKey/cache、§3.1 DNR 重定向、§3.2 content parsing 都在 Task 里有对应落点。§3.3/§3.5/§3.6/§3.7/§3.8/§3.9 / §8 variants 都正确延到 Plan 2-5。

主要问题集中在 **Task 10 (PDF)** 和 **Task 13 (SW DNR 规则)**：这两处当前实现即使跑通测试也无法在 Chrome runtime 正确工作，会让 Task 16 的手工验证步骤失败。A 组 5 条需要在执行前修；B/C 为次级修正。

---

## A. 会导致 Task 16 手工验证失败的问题

### A1. DNR `regexSubstitution` 对 PDF URL 带 query 的情况会截断 `src`

Task 13 SW 注册的 rule：

```ts
redirect: { regexSubstitution: `${READER_URL}?src=\\0` }
```

`\0` 是整段匹配，**未做 URL-encoding**。Reader 端用 `new URLSearchParams(location.search).get('src')` 解析：

- 输入 URL：`https://cdn.example.com/paper.pdf?token=abc&exp=123`
- 拼接后 reader URL：`chrome-extension://.../reader/index.html?src=https://cdn.example.com/paper.pdf?token=abc&exp=123`
- URLSearchParams 看到：`src = "https://cdn.example.com/paper.pdf?token=abc"`（停在 `&exp=` 前），随后 `exp=123` 被当成另一个参数

对带 `&` 的 PDF 链接（大多数 CDN、签名 URL 都有），`src` 会被截断，`fetch(src)` 就 404。

**修法**：用 fragment 绑住整段：

```ts
redirect: { regexSubstitution: `${READER_URL}#src=\\0` }
```

reader 里换成 `location.hash.replace(/^#src=/, '')`（不走 URLSearchParams 避开 `&` 切分）。DNR 的 `regexSubstitution` 没有 `\\0` 的 URL-encode 能力，这是目前 API 层面的事实限制。

**Task 15 的 inject.ts 也一起改**：目前 `` `reader/index.html?src=${encodeURIComponent(htmlUrl)}` `` 用 encode 是对的，但为了和 DNR 的路径保持一致，建议统一改成 `#src=` 形式。

### A2. Task 10 PDF paragraph 粒度是 "一页一条"，与 spec §3.2 不符

Task 10 Step 4 实现里：

```ts
// Paragraphs: one paragraph per page (Phase 1 approximation; Plan 2 can refine).
for (let pageNum = 1; pageNum <= numPages; pageNum++) {
  ...
  raw.push({ outlineItemId, text });   // 每页一条
}
```

但 spec §3.2 写的是 "`getTextContent()` **按段落分组** → paragraphs"，不是按页。一页合并成一条会让后续所有按 `paragraphId` 的行为全部失真：

- §3.7.4 Chat citation `[pN]` → 定位到 "整个第 N 页"，点击后用户跳到页顶，毫无用处
- §3.3 Highlight `hl-yellow` wrap 一整页的连续文本——选择首段高亮尾段内容会出错
- §8.1 Margin note 锚定 `data-pid` 只剩 page 级颗粒度

Plan 自己承认 "Plan 2 can refine"，但 Plan 1 的 Task 16 手工验证列了 "`paragraphs[]` 有 `id: 'sec0-p0'` 等" 作为成功判据——如果 PDF 模式下 outline 来自 `getOutline()`（见 A3），会出现**全部段落都挂在 `outline[0]` 下**的退化状态，手工看到的 JSON 难以确认"合理"。

**建议**：Phase 1 至少做 `getTextContent()` 按 `y` 坐标分块的最粗糙段落切分（参考 pdfjs 官方示例，即 "新的一段 = 当前 item 的 `transform[5]` 与上一条差 >1.5 * lineHeight"）。实现量 20-30 行，比 Plan 2 纯重写方便。

### A3. Task 10 PDF outline：`getOutline()` 路径下所有段落会挂到 `outline[0]`

紧跟 A2，实现里的 outline-paragraph 映射：

```ts
if (pdfOutline && pdfOutline.length > 0) {
  outline = pdfOutline.map((item: any, idx: number) => ({
    id: `o${idx}`,
    label: item.title,
    level: 0,
    page: undefined,        // ← 没 page
  }));
} else {
  outline = [...Page N fallback with page: i+1...]
}

...

// Mapping page → outline item
const itemIdx = outline.findIndex(o => o.page === pageNum);   // 永远 -1（getOutline 路径）
const outlineItemId = outline[itemIdx === -1 ? 0 : itemIdx].id;
```

`getOutline()` 返回的 item 是 `{title, dest, items}`，`dest` 解析成页码需要 `doc.getPageIndex(dest[0])`——Plan 没做。结果 `page: undefined`，所有 `findIndex` 返回 -1，fallback 到 `outline[0]`。即一篇 20 页的论文所有段落都挂到 `outline[0]`（第一章），`buildParagraphs` 给出 `sec0-p0` … `sec0-p{N-1}`。后续 Plan 2 OutlinePanel 点击 "Method" 章节会跳到 `sec0-p?`（第一章某段），用户困惑。

**两种修法（任选）：**

- **简单**：Phase 1 **强制走 Page N fallback**（忽略 `getOutline()`），反正 Plan 1 只到 JSON dump，Plan 2 再用 `getPageIndex(dest[0])` 把真实 outline 接回来
- **真实现**：解析 `dest` → `pageIdx`，把 `page` 字段填回 `OutlineItem`，同时修 "根据 paragraph y 坐标找所属 outline item" 的 mapping（需要知道 outline item 的起止页）

推荐简单版。Plan 应该在 Task 10 里把 "Phase 1 忽略 `getOutline()`" 写明，而不是含糊的 "Plan 2 can refine"。

### A4. Content script 在 MV3 下会被当成非模块加载，ESM 输出会炸

Task 14 vite.config.ts `output.format: 'es'` 对所有 entry 一视同仁，包括 `content/inject.ts`。

manifest.json 的 `content_scripts` 条目没写 `"type": "module"`：

```json
"content_scripts": [
  {
    "matches": ["https://arxiv.org/abs/*"],
    "js": ["content/inject.js"],
    "run_at": "document_idle"
  }
]
```

Chrome 加载时以传统 script 方式注入 `content/inject.js`。即使 Task 12 的 `inject.ts` 源码是自包含的 IIFE，vite 用 ESM 格式输出时可能在顶部插入 `export {};` 这类语句；此外 `import { RawParagraph } from '../types'` 这类模块依赖会保留 import 语法。传统 script 看到 `import`/`export` 直接报 SyntaxError，content script 不执行，abs 页面不会注入按钮。

Task 14 末尾自己也犹豫了一句：

> Content scripts should be IIFE, but since ours is self-contained and runs at document_idle, ESM format works if Chrome treats it as a regular script.

"if Chrome treats it as a regular script" —— 不会。Chrome 2024 已支持 `content_scripts` 的 `"type": "module"` 字段，**但必须显式声明**。

**两种修法（任选）：**

- 给 `content_scripts[0]` 加 `"type": "module"`（需 Chrome 118+，当前可接受）
- 在 vite.config.ts 里给 content script 用 `format: 'iife'`：rollupOptions 改成多 output 配置，或者单开一个 `vite.content.config.ts` 专门打 inject.ts

spec §7 注释 "content script 需 IIFE 格式" 暗示第二种是 spec 作者的预期，但 Phase 1 用 "type: module" 更省事。两者都行，**选一个写进 plan**。

### A5. 缓存命中时丢了 `title` / `authors` / `abstract` / `venue`

Task 15 reader/main.tsx 里：

```ts
const cached = await getCachedParsed(key);
if (cached) {
  const mem = (await getMemory(key)) ?? emptyMemory();
  setState({
    kind: 'ok',
    paper: {
      id: arxivId ?? undefined,
      urlHash: await urlHash(src),
      title: '(from cache)',     // ← 死值
      authors: [],                // ← 空
      abstract: '',               // ← 空
      outline: cached.outline,
      paragraphs: cached.paragraphs,
      memory: mem,
    },
  });
  return;
}
```

spec §3.4 只说 outline + paragraphs 入 `paper:{key}:parsed`，但 §3.4 同一段也写 "再次打开同一论文直接读缓存，**跳过 fetch/parse**"。这两条矛盾——如果 title/authors/abstract/venue 不缓存，"跳过 fetch" 就做不到；强行跳就是 Plan 现在的 "(from cache)" 假值。

Task 16 Step 7 的验证判据：

> JSON dump should show `title: "(from cache)"` indicating cached path was taken

用假值当 "缓存命中" 的标志在 Phase 1 能跑通，但后续 Plan 2 的 TopBar 面包屑 / OutlinePanel 会直接显示 `(from cache)`。

**两种修法（二选一，建议在 plan 里定一种）：**

- **扩展缓存 schema**：把 title/authors/abstract/venue 也存进 `paper:{key}:parsed`（反正这些字段 arXiv 论文只会因为版本号改动变化，没版本号变动基本不变）
- **只缓存 HTML 解析、metadata 总是重新 fetch API**：API 调用快（<1s），arXiv 也较稳定；缓存收益主要来自 HTML parse

第一种更符合 spec "跳过 fetch/parse" 语义，建议。相应要改 `storage.ts` 的 `ParsedCache` 类型。

---

## B. 该修但不阻塞

### B1. DNR Rule 1 和 Rule 2 在 `arxiv.org/pdf/xxx.pdf` 上都会匹配

Task 11 规则：

```json
Rule 1: regexFilter: "^https://arxiv\\.org/(html|pdf)/.+"
Rule 2: regexFilter: "^https?://.+\\.pdf(\\?.*)?$", excludedInitiatorDomains: ["arxiv.org"]
```

`arxiv.org/pdf/2402.18413.pdf`：Rule 1 匹配（`.+` 贪婪吃到结尾），Rule 2 也匹配（`.pdf$`）。两条都 priority 1。

`excludedInitiatorDomains` 作用于**发起请求的页面**的域，不是**请求目标**的域。用户地址栏直接输入没有 initiator → Rule 2 也生效。Chrome 在两条都适用时的 tie-break 未明确定义。

**修法**：Rule 2 应该用 `excludedRequestDomains: ['arxiv.org']`（按目标域排除），或者 Rule 1 的 regex 改得不包含 `.pdf$` 结尾。前者语义更干净。

### B2. arXiv HTML parser 没抽出 Abstract outline 项，和 Task 6 的测试数据不一致

Task 6 的 `buildParagraphs` 测试用了这个 outline：

```ts
const outline: OutlineItem[] = [
  { id: 'o0', label: 'Abstract', level: 0 },    // ← 第一条是 Abstract
  { id: 'o1', label: '1 Introduction', level: 0 },
  ...
];
```

Task 8 的 fixture `arxiv-html.html` **没有 `<section id="abs">`**，parseArxivHtml 只扫 `section[id]`。测试 expected outline 从 `1 Introduction` 开始，没 Abstract。

这意味着：

- arXiv 模式下 `Paper.abstract` 由 API `<summary>` 填充，outline 里不出现 Abstract 项
- prototype `paper-data.jsx:10` 有 `{id: "abs", label: "Abstract", ...}` 作为 outline 第一项——spec 里没强制，但 prototype 风格是有的

原型 `paper-page.jsx:52-65` 独立渲染 abstract block（不从 outline 拿），所以 Plan 不把 Abstract 入 outline 也说得过去，**但 Plan 2 的 OutlinePanel 渲染时要注意 outline 第一项不是 Abstract**，否则跟 prototype 视觉有落差。

**建议**：在 Plan 1 里加一条注释，或者 Plan 2 写 OutlinePanel 时补一条"Abstract 作为视觉上的第一个 outline 条目（非数据层）"。

### B3. Options 页面 main.tsx 只有 `export {};`，加载一个空模块无意义

Task 15:

```tsx
// Placeholder — Plan 3 will implement BYOK form (baseURL, apiKey, model).
export {};
```

options/index.html 用 `<script type="module" src="./main.tsx">` 加载。空模块会被 vite 正常打包，但页面上没 React 渲染，仅 HTML 里的 "PaperFlow Options — BYOK form will live here in Plan 3" 静态文字。

如果 Phase 1 完全不打算让 options 页做任何事，更干净的做法是**暂时从 manifest 里移除 `options_ui`**，或者去掉 `<script type="module">` 标签。当前写法是"有 entrypoint 但啥也不做"，加载开销小但容易被 Plan 3 误以为已经做过一部分。

### B4. Task 10 的 pdfjs worker 配置会在 main.tsx 里被二次覆盖

`reader/lib/pdf.ts`：

```ts
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = '';  // fake worker
}
```

`reader/main.tsx`：

```ts
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
```

顺序上 main.tsx 在 pdf.ts 之后执行，所以 workerSrc 最终是 bundled URL，对的。但：

1. pdf.ts 的 `workerSrc = ''` 没什么意义——pdfjs 有空字符串时会 fallback 到 fake worker；但如果用户的 reader 是只用 arXiv HTML 模式（完全不加载 PDF），多此一举
2. 配置分布在两个文件，后续维护易错

**建议**：把 workerSrc 配置完全放到 main.tsx，pdf.ts 不碰 `GlobalWorkerOptions`。或者在 pdf.ts 里暴露一个 `configureWorker(url: string)`，main.tsx 显式调用。

### B5. Task 16 测试数量口径对不上

Task 17 Step 1 注释 `ids: 11, storage: 5, parse: 3, arxiv: 11, pdf: 3 → ~33`。

实际数：

- ids（Task 3 的 6 + Task 4 的 3 + 2）= 11 ✓
- storage = 5 ✓
- parse = 3 ✓
- arxiv（Task 8 的 4+4+2 = 10，Task 9 的 2）= **12**
- pdf = 3 ✓

合计 34，不是 33。微不足道，但"~33" 是不精确的统计；如果用 `--reporter verbose` 输出 34 会让读者误以为多跑了。改成 "~34" 即可。

### B6. Task 12 abs button 选择器不一定命中

```ts
const header = document.querySelector<HTMLElement>('.extra-services, .full-text, .abs');
```

我没找到 `.abs` 是 arXiv 的真实 class（arXiv abs 页面常见的是 `.leftcolumn`、`.abstract`、`.full-text-container`、`.extra-services`）。如果三个选择器都 miss，`return` 后按钮不出现，abs 场景直接失效。

**建议**：把选择器改成覆盖面更广的组合（至少 `.extra-services, .abstract, #abs, main`），并在 Task 16 Step 6 验证 "抽屉按钮确实出现在抽象区域附近"。失败时改成注入到 `document.body.firstChild` 作为兜底。

---

## C. 小问题

- **C1**：Task 14 末尾 `npm run dev = vite build --watch` 生成的 dist/ 变化需要手动 `chrome://extensions` reload，体验一般。在 plan 注释里提一句"Phase 1 dev 工作流：改代码 → `npm run dev` 自动 rebuild → 点 chrome://extensions 刷新按钮"，省得后来人踩。
- **C2**：Plan 没定 arXiv 缓存失效规则（版本号被 normalize 去掉，v1/v2/v3 共用缓存）。spec §10 也没写，属于被继承的已知限制。Task 16 Step 7 可以补一句"打开 `2402.18413v1` 和 `2402.18413v2` 验证共享缓存"，作为已知行为而非 bug。
- **C3**：Task 10 step 5 "If the dummy fixture doesn't cover the parsing path well, skip `it.skip()` the paragraph test" —— dummy.pdf 只有 1-2 页纯文字，够覆盖"有文本"测试；但一旦实现改成按段落切，dummy fixture 未必能区分出多段。建议 Plan 1 换个有分节的小 PDF（例如 arXiv 的老论文 1-2 页版），或者测试直接 mock pdfjs 返回值。
- **C4**：Task 10 `pagesTextByPage` 放在 `ParsedPdf` 里但目前没人用，Plan 注释"exposed for ContextIndicator later"——Plan 2 的 ContextIndicator 只要 chunk 数，不需要 pagesTextByPage；真正需要 page 原文的是 Plan 2 的"Translate current page"（§9.1）。把注释改准确或先删这个字段，Plan 2 需要再加。
- **C5**：`reader/types.ts` 的 `emptyMemory()` export 是个小工具函数——放在 types 文件里有点混 type + runtime，但量小可接受。如果介意，挪到 `lib/memory.ts` 或 `lib/model-defaults.ts`。
- **C6**：Task 13 SW 的 `chrome.runtime.onMessage` 用 `sendResponse` + `return true`——MV3 SW 可能在 30s 空闲后被 kill，大 PDF 的 proxy fetch 如果 >30s 会失败。Phase 1 用 30MB 上限兜着，勉强够；如果未来 40MB+ PDF 要走 proxy，这里会是下一个坑。暂不管。

---

## 总结

Phase 1 plan 结构扎实，TDD 秩序清晰，spec 覆盖到位。**A 组 5 条是执行前必须修的**（修完之后 Task 16 的手工验证能真正通过）：

1. DNR 用 fragment 代替 query 避开 URL 里的 `&`
2. PDF 段落至少按 y 坐标粗切，不是一页一条
3. PDF outline：Phase 1 强制走 Page N fallback，别用 getOutline 的 `page: undefined`
4. Content script 配 `"type": "module"` 或改 IIFE 打包
5. 扩展 parsed cache 的 schema，让 title/authors/abstract/venue 也进缓存

B 组 6 条修完之后 plan 就可以落地实施。C 组是维护型细节。

修完 A/B 后 Phase 1 可以进入执行阶段。Phase 2 接入 UI 时建议回来看一眼 A2/A3（PDF 段落粒度）是不是还欠，以免 OutlinePanel 的跳转体验直接劣化。
