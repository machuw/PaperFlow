# PaperFlow Chrome Extension — Spec

Date: 2026-04-20

---

## 1. 产品定位

将 PaperFlow UI 原型转化为 Chrome 扩展。用户在浏览器中打开 arXiv 链接或任意 PDF 时，自动以 PaperFlow 界面接管阅读体验，提供 AI 辅助的论文阅读能力。

---

## 2. 用户场景

### 场景 A — arXiv 论文
1. 用户在地址栏输入 `arxiv.org/pdf/2402.18413` 或 `arxiv.org/html/2402.18413`
2. 扩展自动重定向到 PaperFlow reader 页面（`abs` 页面不自动重定向，见场景 C）
3. 页面加载真实论文内容（标题、作者、大纲、段落）
4. 用户选中文本，按 E/S/T/H 触发 AI 操作，流式响应渲染为 MarginNote

### 场景 B — 任意 PDF
1. 用户点击任意网页上的 PDF 链接（非 arXiv）
2. 扩展拦截，重定向到 PaperFlow reader 页面
3. 页面解析 PDF，提取大纲和段落
4. 同场景 A 的 AI 操作体验

### 场景 C — arXiv abs 页面
1. 用户在 `arxiv.org/abs/xxxx` 页面
2. 页面注入"在 PaperFlow 中打开"按钮（不自动重定向）
3. 点击按钮后跳转到 reader 页面

---

## 3. 功能需求

### 3.1 URL 拦截

重定向通过 `declarativeNetRequest` 规则实现（比 content script 更早触发，无竞态，不需要 `tabs` 权限）。content script 仅处理无法用规则覆盖的场景（abs 页面注入按钮）。

| URL 模式 | 行为 | 实现方式 |
|----------|------|----------|
| `arxiv.org/html/{id}` | 自动重定向到 reader | declarativeNetRequest |
| `arxiv.org/pdf/{id}` | 自动重定向到 reader | declarativeNetRequest |
| `arxiv.org/abs/{id}` | 注入"在 PaperFlow 中打开"按钮（不自动重定向） | content script |
| URL 以 `.pdf` 结尾 | 自动重定向到 reader | declarativeNetRequest |

### 3.2 内容解析

**arXiv 模式**（优先）
- 并行 fetch `arxiv.org/html/{id}`（论文 HTML）和 `export.arxiv.org/api/query?id_list={id}`（元数据）
- HTML 解析：`<section>` 层级 → outline，`<p>` → paragraphs
- API 解析：title、authors、abstract
- **venue 字段构造**（arXiv API 无直接字段，需拼接）：`arXiv:{id}  [{primary_category}]  {published 日期，格式 "14 Feb 2026"}`；`primary_category` 从 API 返回的 `<category term="...">` 取 term
- **Fallback**：若 `arxiv.org/html/{id}` 返回 404（论文无 HTML 版本），自动切换到 PDF 模式，fetch `arxiv.org/pdf/{id}`

**PDF 模式**
- Reader 页面直接 fetch PDF；CORS 失败时回退到 SW 代理
- SW 代理路径：文件超过 30MB 时提示用户（Chrome 序列化在 40MB+ 时有卡顿风险）
- pdfjs-dist library 模式：`getOutline()` → outline，`getTextContent()` 按段落分组 → paragraphs
- `getOutline()` 返回空时 fallback：按页码生成 outline（`Page 1`、`Page 2`…），不显示空大纲
- `getMetadata()` → title、authors（质量取决于 PDF 元数据）
- venue 字段构造：`PDF · {文件名}`；若无文件名则留空（不显示 venue 行）

**Paragraph.id 生成规则（两种模式共用）：**
- 格式：`sec{sectionIndex}-p{paragraphIndexInSection}`，两部分都从 0 开始
- **`sectionIndex` 定义**：只计 `level === 0` 的 outline item 的序号。嵌套 subsection（level ≥ 1）的段落 `sectionIndex` = 所属 level-0 section 的序号；`paragraphIndexInSection` 在该 level-0 范围内连续递增（跨 subsection 不归零）
- 示例：outline 为 `[Abstract(0), 1 Intro(0), 2 Related(0), 2.1 RAG(1), 2.2 Long-context(1), 3 Method(0)]`，"2.1 RAG" 下第 2 段的 id 是 `sec2-p?`，`p?` 是该段落在整个 level-0 "2 Related" 范围内（含其所有 subsection）的连续递增序号
- **`Paragraph.sectionId`** 字段：值等于所属 outline item 的 `OutlineItem.id`（对嵌套段落，取最深层嵌套的那个 outline item 的 id，不是只取 level-0）。OutlinePanel 点击 → 滚动到目标段落使用 §8.4 的 `resolveOutlineTarget()` helper 精确定位（含 level-0 无直接段落的 fallback），避免依赖 `section === label` 字符串相等
- `Paragraph.section` 字段仅用于展示；取所属 outline item（最深层，与 `sectionId` 对齐）的 `label`。等价于 `paper.outline.find(o => o.id === p.sectionId).label`
- **PaperPage 的 section 标题渲染：** PaperPage 按 `Paragraph.section` 值分组插入 `<h2>`（原型 `paper-page.jsx:86-94` 逻辑），**不额外渲染父章节（level-0）标题**。因为 `section` 取最深层 label（通常是 subsection），视觉上章节层级扁平化——例如章节序列呈现为 `Abstract → 1 Introduction → 2.1 RAG → 2.2 Long-context → 3.1 Chunk residuals → ...`，父章节 "2 Related Work" / "3 Method" 不独立出现。这与原型行为一致；是否要补 level-0 作为 hierarchical header 归入 v2
- MarginNote 锚定失败时（`document.querySelector('[data-pid="xxx"]')` 返回 null），note 直接丢弃并记录一次 warning，不 fallback 到其他段落，避免视觉错位

**Chunk 定义（供 ContextIndicator 展示）：** chunk 数 = 段落按顺序合并到约 500 token 为一组后的组数；token 估算用 `text.length / 4` 的粗略近似（不引入完整 tokenizer）。**v1 chunk 仅用于 UI 展示**（ContextIndicator 的 `N chunks` 文字、Composer 底部 ScopeChip）；AI 调用时将完整 `paragraphs` 以 markdown 拼接后整体传入 prompt，不做截断。若未来遇到 context 超限，再引入截断策略——届时需同步修改本节并在 §10.1 记录偏离。

两种模式输出统一的 `Paper` 数据结构，UI 层无感知。

### 3.3 AI 功能

- 操作：Explain (E)、Summarize (S)、Translate (T)、Highlight (H)、Ask (?)
  - E/S/T：流式生成结果，Focus 渲染为 MarginNote、Classic 渲染为 SelectionResultCard
  - H：本地高亮，不触发 AI 调用；**v1 仅黄色单色**，对应 CSS class `hl-yellow`；高亮数据存 `chrome.storage.local`，key `paper:{paperKey}:highlights`，数据结构 `{ paragraphId: string; text: string; color: 'yellow' }[]`（`color` 字段保留供未来扩展）
    - 同一 paragraph 允许多条高亮（原型 `paper-page.jsx:106` 只取首个，此为 spec 偏离）；渲染时用 `highlights.filter(h => h.paragraphId === pid)` 逐条处理，对段落文本做 `indexOf(text)` 切片 wrap 成 `<mark class="hl-yellow">`
    - 高亮文本在段落中出现多次时，只 wrap 第一次出现；两条高亮字面完全相同时只保留先存入的那条（去重依据 `paragraphId + text`）
    - 两条高亮文本重叠但不完全相同（例如 `A = "foo bar"`，`B = "bar baz"` 同段同位置重叠）时，后存入的那条不生效（静默忽略）；v1 没有高亮删除入口，用户需手动清 storage 才能纠正——此限制在 §10 记录
  - Ask (?)：将选中文本作为初始上下文，切到 Classic 的 Chat tab 并预填引用；若当前为 Focus 模式，自动切换到 Classic
- 键盘触发：全局 `keydown` 监听；选中文本时按未按 meta/ctrl 的单键触发。`E/S/T/H` 匹配 `e.key.toLowerCase()`；`Ask` 匹配 `e.key === '?'`（即 Shift + `/`；若用户键盘布局下 Shift+/ 产生其他字符，提供退路：当选中文本存在且 `e.key === '/'` 且 `e.shiftKey === true` 时也触发）
- **监听排除可编辑元素**：handler 入口先 check `event.target`——如果是 `<input>` / `<textarea>` / `contenteditable === 'true'` 的节点，直接 `return`，不触发任何 AI 操作；这覆盖 Chat composer、Memory 编辑态 textarea、Options 页输入框等场景。⌘K / ⌘\\ / ⌘L 全局 shortcut 不受此限制（已由 meta/ctrl 保护）
- 接口：OpenAI 兼容（`/v1/chat/completions`），原生 `fetch` + `ReadableStream` 流式
- 配置：用户在 Options 页面填写 `baseURL`、`apiKey`、`model`
- 存储：`chrome.storage.local`，不打包进扩展
- **baseURL normalize**：`ai.ts` 在拼接路径前去掉末尾 `/`，避免 `//v1/chat/completions` 错误

**触发 AI 操作时的 UI 反馈：**
- 源段落添加 `paragraph-pinged` class，900ms 内播放 `ink-ping` 动画（闪烁+淡出），视觉上连接 selection 与结果位置；动画结束后自动移除 class
- Focus 模式：结果以 MarginNote 形式出现在段落旁，SVG 连接线配合 `ink-pen-draw` 动画
- Classic 模式：WorkspacePanel 自动切到 Summary tab，SelectionResultCard 在面板顶部以 `fade-up` 动画出现

**SelectionResultCard（Classic 模式结果卡片）：**
- 顶部：彩色点（流式时 `pulse-ink` 动画）+ 操作标签（Explain/Summarize/…）+ `p.{page} · ¶ {paragraphRef}` 定位 + Copy/Close 按钮
  - Copy：复制结果正文（不含引用块）到剪贴板
  - Close：关闭当前 SelectionResultCard，回到纯 Summary 视图
- 中部：引用原文 `blockquote`（左边 walnut-soft 色条，italic serif）——保证引用不丢失
- 下部：流式结果正文，流式中带 `ink-streaming` class（末尾闪烁光标）
- Classic 模式一次只显示最新一条结果；旧结果不保留在 WorkspacePanel 中（历史仅在 Focus 模式的 margin column 可见）

### 3.4 Library

- 首次打开论文时自动保存到 Library
- 存储字段：`{ id?, urlHash, title, authors, role?, topic?, judgment?, addedAt, lastRead, pages, annotations, hasMemory }`
  - 时间字段（`addedAt` / `lastRead`）一律用 **epoch ms 整数**；UI 展示时由 `formatRelative()` 转 "just now" / "3 days ago"（不再保留原型的 `opened` / `openedSort` 双字段冗余）
  - `role` 取值必须是 §3.6 Role 标准值 里列出的 6 种之一或空；由 `extractRolePrefix(memory.role)` 计算得出（§3.6）
  - `role` / `judgment` 由用户在 Memory tab 填写后回写（来自 `PaperMemory` 对应字段；`judgment` 直接取原值不处理）
  - `topic` v1 暂留空（无字段写入），UI 若无值则显示 "Uncategorized" 分组
  - `pages`：PDF 模式取 `pdfDoc.numPages`；arXiv HTML 模式无真实分页，存 `0`（UI 展示时若为 0 则不渲染 `{pages}p`，直接跳过这一段）
  - `annotations` = `highlights.length + notes.length`（来自 `paper:{paperKey}:highlights` 与 `paper:{paperKey}:notes`，见下文"margin notes 持久化"）
  - `hasMemory` 计算规则：
    ```ts
    hasMemory = !!(
      memory.whyItMatters?.trim() ||
      memory.role?.trim() ||
      memory.judgment?.trim() ||
      memory.linked.length > 0 ||
      memory.nextActions.length > 0
    )
    ```
    空字符串、纯空白、空数组都视为未设置，避免"打开一篇新论文就被标成 hasMemory"
- `LibraryDrawer` 从 `chrome.storage.local` 加载，替换 mock 数据

**Margin notes 持久化（`paper:{paperKey}:notes`）：**
- 用户每次触发 E/S/T 生成的 AI 结果同时写入 `chrome.storage.local` key `paper:{paperKey}:notes`
- 数据结构：`{ id: string; kind: 'explain'|'summarize'|'translate'|'ask'; source: string; body: string; paragraphId: string; createdAt: number }[]`
- 写入时机：流式结束（`onStreamDone` 触发）后一次性 put；失败中断的 note 不持久化
- 删除时机：用户在 margin note 上点击 Close 按钮（v1 Focus 模式 margin note 不提供删除入口，此项 **v1 不做**，仅保留数据结构）
- Reader 初始化时先从 `paper:{paperKey}:notes` 读入 `results` state；跨会话时 margin notes 保持可见
- Canvas 的 "Note 节点" 数据源同此 key（确保跨会话 Canvas 不空）
- `annotations` 计数中 `notes.length` 直接用此数组长度

**paperKey 工具函数（供 storage.ts 统一处理）：**
- `paperKey(paper) → string`：arXiv 模式返回 `paper.id`（见下方规整规则），PDF 模式返回 `urlHash`
- `urlHash = SHA-256(url).hex.slice(0, 12)`（Web Crypto `crypto.subtle.digest('SHA-256', ...)`，取前 12 hex）
- 所有 `paper:{key}:*` storage key 都经此函数生成，避免分散处理

**arXiv `paper.id` 规整规则（保证跨 URL 形态共享缓存）：**
- 正则：`/(\d{4}\.\d{4,5})(v\d+)?/`
- 从 URL 提取主 id，丢弃版本号后缀
- 所有 `arxiv.org/{pdf|html|abs}/{id}[v{n}][.pdf]` 形态都映射到同一 `paper.id`
- 示例：
  - `arxiv.org/pdf/2402.18413` → `2402.18413`
  - `arxiv.org/pdf/2402.18413v2` → `2402.18413`
  - `arxiv.org/html/2402.18413v3` → `2402.18413`
  - `arxiv.org/abs/2402.18413` → `2402.18413`
  - `arxiv.org/pdf/2402.18413v2.pdf` → `2402.18413`
- 非标准 id 格式（含旧式 `hep-th/0601001`）v1 走 PDF 模式的 `urlHash` 路径，不尝试规整

**LibraryDrawer UI（沿用原型）：**
- 右侧抽屉式，宽 `min(880px, 80%)`，标题区显示 `Library · {N} papers`
- 工具栏：搜索框（匹配 title + authors）+ Group by 分段控件（`Topic` / `Role` / `Recent`）+ `Has memory` 过滤切换
- `Recent` 按 `lastRead` 降序；`Topic` / `Role` 为空时归入 "Uncategorized"
- **LibraryRow 视觉细节**：
  - 左侧 3px 色条（"spine"），颜色按 Role 标准值映射（详见 §3.6）；当前论文的 spine 走 §3.6 末尾"当前论文行特殊视觉"规则（`var(--walnut-deep)`），不走 role 映射
  - 标题右侧若为当前论文显示 `NOW` 徽章（walnut 底 + paper 字）
  - 标题下方 `{authors} · {pages}p · {formatRelative(lastRead)}`
  - `judgment` 以斜体 serif 引用块展示（左边 rule 色条），单行省略
  - 右侧列：role 胶囊（walnut 色半透明底）+ `hasMemory` 图标 + `✎ {annotations}`

**解析结果缓存**：`outline` 和 `paragraphs` 解析后缓存到 `chrome.storage.local`，key 为 `paper:{paperKey}:parsed`。再次打开同一论文直接读缓存，跳过 fetch/parse。

### 3.5 Memory

- 每篇论文独立存储 memory（`whyItMatters`、`role`、`judgment`、`linked`、`nextActions`），key `paper:{paperKey}:memory`
- 新打开的论文 `memory` 各字段初始化为空（`whyItMatters: ''`、`role: ''`、`judgment: ''`、`linked: []`、`nextActions: []`）
- **空态渲染规则：**
  - `whyItMatters === ''`：Memory tab 的 headline 卡片隐藏；Focus 模式的 "WHY THIS MATTERS" 默认 margin note 隐藏
  - `linked.length === 0`：Memory tab 的 Linked context section 隐藏；Focus 模式的 "LINKED CONTEXT" 默认 margin note 隐藏；Canvas 的 linked 节点不创建
  - `nextActions.length === 0`：仅显示 "+ Add action" 输入框，不渲染空列表
  - `role === '' && judgment === ''`：Memory tab 顶部显示一条 "Set role and judgment to ground your memory" CTA；单个字段为空时各自显示 `edit` 按钮
- `MemoryView` 支持编辑所有字段，包括 `nextActions` 清单（勾选/新增/删除）
- 实时保存到 `chrome.storage.local`
- AI 调用时将 memory 非空字段注入 system prompt（按 §3.7.2 格式；空字段整条省略）

### 3.6 Role 标准值

所有使用 "role" 字段的地方（`PaperMemory.role`、`LibraryRow.role`、Memory tab 快速选项）都以此为准。

| Role | 含义 | Library 色条（`spine`） |
|------|------|----------------------|
| `Background` | 背景文献 | `var(--walnut-soft)` |
| `Method reference` | 方法引用 | `var(--sky)` |
| `Counter-evidence` | 反面证据 | `var(--foxglove)` |
| `Tangential` | 边缘相关 | `var(--ink-ghost)` |
| `Central` | 核心论文 | `var(--walnut)` |
| `Ancestor` | 先驱/前置（可选） | `var(--forest)` |

- 字符串严格使用首字母大写 + 连字符（如 `Counter-evidence`、`Method reference`）；不接受 `Counter` / `counter-evidence` / `method-ref` 等变体
- Memory tab 的快速选项按钮按此顺序展示前 5 个；`Ancestor` 不在快速选项里但允许手动输入（存储与色条映射仍按标准值识别）
- Library `spine` 遇到非标准值或空值时使用 `var(--ink-ghost)` 作为默认灰

**`PaperMemory.role` vs `Library.role` 的格式桥接：**
- `PaperMemory.role` 是自由文本，Memory tab 编辑态用 `{标准值} — {自由补充}` 模式（例："Background — a candidate alternative to RAG"）
- `Library.role` 必须是纯标准值或空
- **提取规则** `extractRolePrefix(s: string) → string`：
  - `const head = s.split(' — ', 1)[0].trim()`
  - 若 `head` 匹配 §3.6 6 个标准值之一：返回 `head`
  - 否则返回 `''`（空字符串）
  - `s` 为空或仅空白：返回 `''`
- 以下场景统一用 `extractRolePrefix()`：
  - Library 保存 / 刷新时 `library.role = extractRolePrefix(memory.role)`
  - OutlinePanel 的 role chip 展示 `extractRolePrefix(memory.role)`（§8.4）
  - Library spine 颜色映射的输入是 `extractRolePrefix(...)` 的结果

**当前论文行的特殊视觉：**
- 当前论文（即正在阅读的那一篇）的 spine 不按 role 着色，需要与普通 Central 论文区分
- 实现方式：在 `styles/tokens.css` 根选择器里加一条 `--walnut-deep: color-mix(in oklch, var(--walnut) 70%, var(--ink))`——因为 `--walnut` 和 `--ink` 都随 `data-theme` 变化，这条 token 自动适配 light/dark，无需分别写死两套；LibraryRow 保留原有 `NOW` 徽章与 `walnut-soft` 边框，两层视觉叠加区分"Central role"与"当前阅读中"

### 3.7 AI 调用合约

统一放在 `reader/lib/ai.ts`，所有 AI 入口（E/S/T、Ask、Summary 三段、Chat）都走此合约。

**3.7.1 段落上下文注入格式**

AI 调用时，将 `paper.abstract` + `paper.paragraphs` 以以下 markdown 格式拼接，作为 user message 的 "Paper" section（Summary / Chat）或作为 system message 追加（Explain/Summarize/Translate/Ask）：

```
# {paper.title}

By {paper.authors.join(', ')}.{venue 非空时追加 " Published in {venue}."}

## Abstract
{paper.abstract}

## Paragraphs (cite with paragraph ids like [p1]; cite the abstract as [abs]):
[p1] §{paragraphs[0].section} · {paragraphs[0].text}
[p2] §{paragraphs[1].section} · {paragraphs[1].text}
...
```

- `[p{N}]` 中 `N` 是 `paragraphs` 数组的 1-based 下标（不是 `paragraph.id`，便于模型输出简短引用；内部 mapping `N ↔ paragraphs[N-1]`）
- 每段前附 `§{section} · ` 前缀（section 来自 `Paragraph.section`，即最深层 outline label，§3.2），让模型知道 `[p5]` 属于 `§3.1 Chunk residuals`；有助于 Chat suggestion "core mechanism of §X" 的定位与 Translate 对章节语境的敏感度
- `paper.abstract` 为空字符串时整个 `## Abstract` block 省略；但段落头部说明 "cite the abstract as `[abs]`" 仍保留（模型可能 fallback 到段落）
- **v1 不做上下文截断**（§3.2），全部段落整体传入

**3.7.2 Memory 注入**

当 `paper.memory` 有非空字段时，将下列 block 插入 system prompt 末尾（按此顺序、仅包含非空字段）：

```
# Reader's memory on this paper
- Why it matters: {memory.whyItMatters}
- Role in research: {memory.role}
- Personal judgment: {memory.judgment}
- Linked work:
  - {linked[i].title} ({linked[i].role}): {linked[i].why}
  ...
- Outstanding actions:
  - [ ] {nextActions[i].text}
  - [ ] {nextActions[j].text}
  ...
```

字段注入规则（**括号里的说明仅为 spec 作者注，不写进 prompt**）：
- `whyItMatters` / `role` / `judgment`：trim 后为空字符串时整条省略
- `linked`：数组为空时整个 "Linked work:" block 省略
- `nextActions`：仅注入 `nextActions.filter(a => !a.done)`（已完成的不进 prompt）；过滤后列表为空则整个 "Outstanding actions:" block 省略
- 若所有字段都为空，整个 `# Reader's memory on this paper` block 也省略

**3.7.3 Prompt 模板（写死到 `ai.ts` 常量）**

| 入口 | System Prompt（在段落上下文前） |
|-----|-------------------------------|
| `Summary.threeLine` | "You are reading a research paper. Based on the paragraphs, write exactly 3 sentences. Each sentence stands alone. Cover: (a) main idea, (b) core mechanism, (c) key limitation. No bullet points, one sentence per line." |
| `Summary.keyTerms` | "Extract 3–5 key terms from the paper. For each, write a one-sentence definition in the paper's own framing. Format: `{term} :: {definition}`, one per line." |
| `Summary.detailed` | "Write a 2–3 paragraph summary of the paper for a researcher already familiar with the field. Preserve the paper's own decomposition and honest limitations. Plain prose, no bullets." |
| `Explain` (E) | "The reader selected a passage. Explain what it's actually claiming, in 2–4 sentences, at the level of a colleague thinking out loud. Avoid restating; go to the underlying claim." |
| `Summarize` (S) | "Compress the selected passage to 1–2 sentences that preserve its core claim." |
| `Translate` (T) | "Translate the selected passage to 中文 (Simplified Chinese). Preserve technical terms in their original form when they're canonical (e.g. 'attention', 'residual')." |
| `Chat` (base) | "You are a research assistant grounded in the paper below. Answer strictly from the paragraphs; cite them inline using `[pN]` where N is the paragraph index shown in the context. If the paper doesn't cover the question, say so directly." |
| `Ask` (?) | Chat base + 额外 user message 包装规则见 §3.7.5 |

- 所有 prompt 末尾追加一行 `Respond in the reader's language if they asked in one; otherwise default to English.`（Translate 除外，它强制中文）
- 流式模型调用不要求 structured output；输出 markdown 纯文本

**3.7.4 Chat Citation 合约**

- Chat 的 AI 回答中内联引用有两种 token：
  - `[pN]`——段落引用，N 与 §3.7.1 段落上下文的索引对应
  - `[abs]`——abstract 引用
- UI 解析：回答流式结束后，reader 端扫描文本，抽取所有 `[pN]` 和 `[abs]` 匹配；按首次出现顺序去重后生成 `msg.citations: Citation[]`
  - 段落 citation：`{ n, kind: 'paragraph', quote: truncate(paragraphs[N-1].text, 140), loc: formatLoc(N) }`
  - abstract citation：`{ n, kind: 'abstract', quote: truncate(paper.abstract, 140), loc: 'Abstract' }`
- `formatLoc(N)` 拼装规则（处理 page undefined 的情况）：
  ```ts
  function formatLoc(N: number): string {
    const p = paper.paragraphs[N - 1];
    const outlineItem = paper.outline.find(o => o.id === p.sectionId);
    const parts: string[] = [];
    if (outlineItem?.page != null) parts.push(`p. ${outlineItem.page}`);  // PDF 模式才有 page
    parts.push(`§${p.section}`);
    parts.push(`¶ p${N}`);
    return parts.join(' · ');
  }
  ```
  例：PDF 模式 `p. 13 · §6 Discussion · ¶ p9`；HTML 模式 `§6 Discussion · ¶ p9`（省略 page 段）
- `n` 是按 **回答中首次出现顺序** 去重后的序号（段落 + abstract 混合排序，便于显示为 `[1][2][3]`）
- 流式期间 `msg.citations = []`，不边流边解析（避免部分匹配跳动）
- `<sup>` 渲染时替换 `[pN]` / `[abs]` 为 `[n]`（用户看到的是 1、2、3 的顺序号，点击高亮对应 CitationCard）

**3.7.5 Ask (?) 的"预填引用"行为**

选择一种具体实现（写死）：

- Composer 上方出现一条 `SelectionPinnedChip`，展示选中文本（截断 120 字 + "…"），右侧 Close 按钮（点击移除 chip 并清除预填状态）
- 用户发送消息时，将 chip 的原文 + 输入框内容拼接为一条 user message，格式：

  ```
  About this passage:
  > {selected text}

  {user input}
  ```

  若用户没输入只按回车，默认 user input = `What does this mean?`
- 发送后 chip 自动消失（单次使用）
- 当前 variant 若是 Focus/Canvas，Ask 触发时切换到 Classic 并聚焦 Chat tab 的 composer。**该切换不持久化到 `localStorage.pf-variant`**——Ask 是一次性操作，不应污染用户的默认 variant 偏好
  - 实现：variant state 拆成 `variant`（内存）和 `persistedVariant`（localStorage）两层；`setVariant('classic', { transient: true })` 只改内存 state，下次打开论文仍读 `persistedVariant`
  - 用户手动在 TopBar Variant 切换器点击才写入 `persistedVariant`

### 3.8 AI 错误路径与配置校验

- **BYOK 未配置**：`chrome.storage.local.config.apiKey` 为空/未设置时，所有 AI 入口（E/S/T/Ask、Summary 自动生成、Chat 发送、CmdK 的 Summarize/Translate）一律 no-op 并在目标位置（margin note 位置、SelectionResultCard、SummarySection、Chat 消息流、顶层 toast）渲染一条错误条："API key not configured. **Configure API key →**"
  - "Configure API key →" 的 onClick handler 为 `() => chrome.runtime.openOptionsPage()`（不是普通 `<a href>`，普通链接跳不了扩展 Options 页）
  - `manifest.json` 需声明 `"options_ui": { "page": "options/index.html", "open_in_tab": true }`
  - StatusRail 的圆点同步变 foxglove 紫
- **网络/HTTP 错误**：AI 调用失败（非 2xx / 网络中断）在对应位置显示错误文案 + Retry 按钮（手动重试，无自动重试）；错误不写入缓存
- **流中断（fetch reject / 用户关闭 tab）**：已生成的部分文本不持久化（Margin notes 持久化条件为 `onStreamDone` 完整触发，见 §3.4）
- **流式过程中 variant 切换**：
  - AI 调用不因 variant 切换而 abort；`fetch + ReadableStream` 后台继续 pull 到完成
  - `onStreamDone` 正常触发时按 §3.4 持久化到 `paper:{paperKey}:notes`，`results` state 更新
  - 用户切回 Focus 时，新挂载的 `MarginColumn` 从 `results` state（seed 自 storage）读入完整 note——中途切出/切回过程中已流入的部分文本不丢失，完成后也能看到完整内容
  - 切到 Classic 时，若流仍在进行中，Classic 的 SelectionResultCard 显示该 note 的当前进度（flow 继续，UI 复用同一 `streamingKey`）；若流已结束，`SelectionResultCard` 按"最新一条"规则展示最终结果
  - 切到 Canvas 时，流继续在后台完成并落盘；用户切回 Focus/Classic 后才看到结果

### 3.9 Model 切换与缓存隔离

用户在 Options 换 model 后，旧缓存仍属于旧 model，避免 ContextIndicator 显示的 model 与缓存内容不匹配：

- **Summary 缓存 key 含 model 后缀**：
  - `paper:{paperKey}:summary:threeLine:{model}`
  - `paper:{paperKey}:summary:keyTerms:{model}`
  - `paper:{paperKey}:summary:detailed:{model}`
  - 切 model 后自动走新 key，旧 model 的缓存保留但不再命中
- **其他 AI 结果**（margin notes、chat 消息、selection result）**不**按 model 隔离：这些是用户创作产物，不应因切 model 而"消失"。切 model 后新生成的内容由新 model 产生，旧内容保持原样；Chat 气泡可选地保留生成它的 model 名（v1 不展示此元信息）
- ContextIndicator 显示的 `{model}` 始终是当前配置值

---

## 4. 非功能需求

- **API Key 安全**：仅存 `chrome.storage.local`，不上传，不打包
- **PDF 大小限制**：SW 代理路径超过 30MB 时提示用户（Chrome 序列化在 40MB+ 时有卡顿风险）
- **无 SW 主路径**：SW 仅作 PDF CORS fallback，不参与 arXiv 流程
- **MV3 兼容**：不依赖 SW 持久状态
- **CSP**：Vite 构建输出不含 `eval`（不使用 Babel standalone），满足 MV3 默认 CSP；`manifest.json` 无需额外 `content_security_policy` 字段

---

## 5. 数据模型

```typescript
interface Paper {
  id?: string;           // arXiv ID，规整后去版本号（见 §3.4）；PDF 模式为 undefined
  urlHash: string;       // SHA-256(url).hex.slice(0,12)，storage key 使用；arXiv/PDF 模式都有
  title: string;
  authors: string[];
  affiliations?: string[];  // 作者机构，PaperPage 标题区下方显示
  venue?: string;        // arXiv 模式："arXiv:{id}  [{cat}]  {date}"；PDF 模式："PDF · {filename}" 或空
  abstract: string;
  outline: OutlineItem[];
  paragraphs: Paragraph[];
  figures?: Figure[];    // v1 不解析也不渲染
  memory: PaperMemory;   // 非 optional，初始化时所有字段填空值（见 §3.5）
}

interface OutlineItem {
  id: string;            // 稳定 id，Paragraph.sectionId 引用该值
  label: string;
  level: number;         // 0 = section, 1 = subsection
  page?: number;         // 页码（PDF 模式有，HTML 模式无）
}

interface Paragraph {
  id: string;            // 格式 "sec{sectionIndex}-p{pInSection}"，零基；DOM 属性 data-pid 同值
  sectionId: string;     // 所属 OutlineItem.id（嵌套段落取最深层嵌套，不是 level-0）
  section: string;       // 展示用，= 所属 OutlineItem.label
  text: string;
  important?: boolean;   // 保留供未来使用，v1 不消费（UI 不渲染）
}

interface Figure {
  id: string;
  label: string;         // e.g. "Figure 1"
  caption: string;
  page?: number;
}

interface PaperMemory {
  whyItMatters: string;  // 空字符串表示未设置
  role: string;          // 自由文本，格式 "{标准值} — {自由补充}"；Library/OutlinePanel 用 extractRolePrefix() 提取纯标准值（§3.6）
  judgment: string;
  linked: { title: string; why: string; role: string }[];  // 空数组表示未设置
  nextActions: { text: string; done: boolean }[];          // 对象数组，替代纯字符串，以持久化勾选状态
}
```

---

## 6. 技术选型

| 需求 | 方案 | 理由 |
|------|------|------|
| 构建 | Vite 多入口 | content script 需 IIFE 格式，reader page 需 React |
| PDF 渲染 | pdfjs-dist library 模式 | 不依赖 viewer.html，自控渲染 |
| AI 调用 | 原生 fetch + ReadableStream | 绕开 MV3 SW 无持久状态限制 |
| UI 组件 | 原型组件模块化迁移 | 机械转换（window.X → export default），不重写逻辑 |
| 持久化 | chrome.storage.local | 无大小限制（相对），无需服务端 |

---

## 7. 目录结构

```
chrome-extension/
├── manifest.json
├── vite.config.ts
├── content/
│   └── inject.ts          # abs 页面注入按钮（IIFE）
├── reader/
│   ├── index.html
│   ├── main.tsx
│   ├── components/        # 原型组件，模块化
│   ├── lib/
│   │   ├── arxiv.ts       # arXiv HTML + API 解析
│   │   ├── pdf.ts         # pdfjs-dist 封装
│   │   ├── ai.ts          # OpenAI 兼容流式调用
│   │   └── storage.ts     # chrome.storage.local 封装
│   └── styles/
│       └── tokens.css     # 直接复用原型
├── background/
│   └── sw.ts              # 仅 PDF CORS fallback
└── options/
    ├── index.html
    └── main.tsx           # BYOK 配置
```

---

## 8. 三种视图模式详细设计

### 8.1 Focus 模式 — 侧边 Margin Notes

布局：论文主体（左，flex-1）+ margin notes 列（右，240px 固定宽）

**Margin Note 锚定机制：**
- 每个段落渲染时带 `data-pid="{paragraphId}"` 属性
- AI 操作完成后，通过 `document.querySelector('[data-pid="xxx"]').getBoundingClientRect().top` 计算段落垂直位置，作为 note 的 `position: absolute; top` 值
- 多个 note 重叠时按 `minGap=110px` 向下推移（原型 `MarginColumn` 已实现）
- 布局重算时机：挂载后立即计算一次，120ms 和 400ms 再各计算一次（覆盖字体加载和图片重排），`window.resize` 事件触发时重算
- 连接线：SVG `<path>` 从段落右边缘（margin-column 内坐标 `x=-36`）到 note 左边缘（`x=36`），控制点轻微下弯模拟手写；`stroke-dasharray: 60` + `ink-pen-draw` 520ms 动画描边；末尾小圆点 `fade-in` 320ms 延迟 420ms
- 流式输出实现：`ink-streaming` class 在文字末尾显示闪烁光标；文字流入采用字符级分片 `setTimeout` 递归（每 tick 推进 `2 + Math.floor(Math.random()*5)` 个字符，间隔 `18 + Math.random()*30` ms），模拟手写节奏。流式回调由 `ai.ts` 的 `ReadableStream` 驱动，token 到达后按上述节奏排队显示（避免 SSE 块一次性闪现）

**默认预置 notes（来自 `paper.memory`）：**

Introduction 段落解析用统一的 helper（不依赖 `Paragraph.section` 字段，它已被 §3.2 降级为仅展示用）：

```ts
function findIntroParagraphs(paper: Paper): Paragraph[] {
  const introItem = paper.outline.find(
    o => o.level === 0 && o.label.toLowerCase().includes('introduction')
  );
  if (!introItem) return paper.paragraphs;  // 无 Introduction，退到全文顺序
  const scoped = paper.paragraphs.filter(p => p.sectionId === introItem.id);
  if (scoped.length > 0) return scoped;
  // level-0 无直接段落，fallback 到属于该 level-0 范围内的任何段落
  // 通过 id 前缀匹配（§3.2 sectionIndex = level-0 序号）
  const level0Index = paper.outline
    .filter(o => o.level === 0)
    .findIndex(o => o.id === introItem.id);
  return paper.paragraphs.filter(p => p.id.startsWith(`sec${level0Index}-`));
}
```

- "WHY THIS MATTERS"
  - Body = `paper.memory.whyItMatters`
  - 锚定到 `findIntroParagraphs(paper)[0]`；数组为空时，锚定到 `paper.paragraphs[0]`
  - `whyItMatters` 为空时该 note 不渲染
- "LINKED CONTEXT"
  - Body = 若 `memory.linked[0]` 存在，则渲染为 `"→ {linked[0].title}" — {linked[0].why}`；否则不渲染（不使用原型里的硬编码元叙述句）
  - 锚定到 `findIntroParagraphs(paper)[1]`；若不足 2 段，锚定到 `paper.paragraphs[1]`，仍不足就不渲染

**Margin note 历史与变体切换：** results 数组作为全局状态，不因 variant 切换而清空。用户在 Focus 下生成 3 条 margin notes 后切到 Classic 再切回，这 3 条 margin note 仍在；Classic 的 SelectionResultCard 始终只显示最新一条，这一规则不会反向截断 Focus 的历史。

**StatusRail（底部状态栏，高 24px）：**
- 左侧：快捷键提示 `⌘K commands · ⌘\ outline · ⌘L library · E·S·T·H on selection`
- 右侧：运行状态指示，格式 `local memory · {model} · BYOK`，前面带一个小圆点（BYOK 已配置显示 forest 绿，未配置显示 foxglove 紫）
- 字体：`var(--font-mono)` 10px，颜色 `var(--ink-faded)`
- 在所有 reader 模式下常驻；Canvas 模式下隐藏

### 8.2 Classic 模式 — WorkspacePanel

布局：论文主体（左，flex-1）+ WorkspacePanel（右，380px 固定宽）

**Summary tab（默认）：**
- 生成内容分为 3 段独立缓存：THREE-LINE SUMMARY、KEY TERMS、DETAILED SUMMARY
- **缓存粒度**：每段独立 key，含 model 后缀以隔离不同 model 的生成结果（详见 §3.9）
  - `paper:{paperKey}:summary:threeLine:{model}`
  - `paper:{paperKey}:summary:keyTerms:{model}`
  - `paper:{paperKey}:summary:detailed:{model}`
- **触发时机（延迟节流，控制费用）**：
  - 论文解析完成后 **不立即** 触发 AI 生成
  - 启动一个 3s 定时器；若 3s 内用户关闭 reader 标签页或 `beforeunload` 触发，取消定时器，不发起请求
  - **用户停留在 Summary tab 且停留 300ms**（即当前 variant 是 Classic 且 tab 是 Summary，不论是持久化默认还是用户主动切入）：立即提前触发，跳过剩余等待
  - "停留 300ms" 的 timer 在离开 Summary tab（切 tab 或切 variant）时重置；切回 Summary tab 后重新计时
  - 3s 到期后对每段独立检查缓存；缺失则独立触发 AI 生成（3 次 AI 调用，并发发出）
  - 已有缓存的 section 直接读缓存渲染，不受定时器影响
- Loading state：解析中新增 `.shimmer-line` CSS class 显示占位块；AI 生成中显示 `ink-streaming` 动画
- 降级：任一段 AI 调用失败，只在该 SummarySection 内部显示错误提示 + 重试按钮（手动，无自动重试），不阻塞其他段与其他 tab；错误不写入缓存，下次打开论文重新尝试
- SummarySection 右侧刷新按钮：
  - `threeLine` 和 `detailed` section 显示 `I.Refresh` 按钮，清除对应子 key 并重新生成
  - `keyTerms` section 不显示刷新按钮（与原型一致）
- 顶部若存在 selection 结果，以 SelectionResultCard 形式渲染在 Summary sections 之前，覆盖式展示（只保留最新一条，旧结果不堆叠）
- 底部 **ContextIndicator**：圆角提示条，内容 `Generated from full paper · {N} chunks · via {model}`（`N` 按 §3.2 chunk 定义计算，`model` 从配置读取），右侧 "Change" 按钮（v1 为占位，点击无效果；保留视觉以对齐原型）

**Chat tab：**
- 对话界面，针对论文内容提问
- system prompt：按 §3.7.3 `Chat (base)` 模板 + §3.7.2 Memory 注入 + §3.7.1 段落上下文
- 消息历史存储在 `chrome.storage.local`（key `paper:{paperKey}:chat`），按论文隔离
- 初始消息（不写入持久化历史，每次打开面板动态生成）：
  - 欢迎语："I've read the paper. Ask anything — I'll cite paragraphs inline."
  - 3 条 suggestions：
    - "第一个章节" 定义：`outline` 中第一个满足 `level === 0` 且 `label` 不包含以下关键词（忽略大小写）的 item：`Abstract` / `References` / `Acknowledgements` / `Appendix` / `Bibliography`
    - 若能找到该章节，模板化生成："What's the core mechanism of §{该章节 label}?" / "How does this compare to prior work?" / "Where does it fail?"
    - 若 outline 为空或所有 level-0 item 都命中过滤黑名单，退到通用三问："What's the core mechanism?" / "How does this compare to prior work?" / "Where does it fail?"
  - 欢迎语与 suggestions 仅在 `paper:{paperKey}:chat` 为空数组时展示；用户发送第一条消息后消失，且不再回归
- 引用渲染：按 §3.7.4 Chat Citation 合约——模型输出 `[pN]`，UI 扫描后按出现顺序去重生成 `[1][2][3]` 展示为 walnut 色 `<sup>`，下方 CitationCard 列出 quote + loc，点击定位到段落
- Composer 底部 `ScopeChip`（"Full paper" + chunk 数）为视觉展示，v1 不支持切换 scope

**Memory tab：**
- `whyItMatters` 以 headline 卡片呈现，下方三个操作按钮 Keep / Rewrite / Doesn't fit —— **v1 仅渲染视觉，无 onClick 逻辑，不触发 AI**（保留 UI 以对齐原型，避免未来重做样式）
- `role`、`judgment`：inline edit 模式 —— 默认展示文本 + 右上 `edit` 按钮；点击进入编辑态，显示 `<textarea>` + Save/Cancel 按钮，Save 后实时写回 `chrome.storage.local`
- `role` 编辑态额外显示快速选项（按钮形式）：`Background` / `Method reference` / `Counter-evidence` / `Tangential` / `Central`——点击将选项作为前缀追加到 textarea 首部（格式 `{选项} — {自由文本}`）
- `judgment` 编辑态采用 foxglove 色强调边框，区别于 role 的 walnut 色
- `linked`：只读列表（v1 不支持新增/删除/编辑），点击卡片跳转到对应 paper（若已在 Library 中）
- `nextActions`：可勾选清单，**勾选状态持久化**到 `chrome.storage.local`（key `paper:{paperKey}:memory`，与其他 memory 字段同对象；`PaperMemory.nextActions` 为 `{ text, done }[]` 结构，见 §5）；支持新增（底部 "+ Add action" 输入框）和删除（hover 显示删除按钮）
- 所有字段修改实时保存到 `chrome.storage.local`

### 8.3 Canvas 模式 — 全屏可视化

布局：全屏替换 reader，顶部"← Back"返回 Focus/Classic；Canvas 模式下 StatusRail 隐藏

**绘图方案：`react-flow`（xyflow/xyflow），替换原型 `canvas-view.jsx` 的渲染层**
- 原型 `CanvasView` 组件废弃，由 react-flow 实现替代（保留组件文件名和 props 接口不变，内部重写）
- 背景：dot-grid，实现为 CSS `radial-gradient(circle at 1px 1px, var(--ink-ghost) 0.6px, transparent 0)` + `background-size: 24px 24px`，叠加 `var(--paper-deep)` 底色（沿用 react-flow 自带的 Background 组件，`variant="dots"`）
- 节点类型：
  - 论文节点（标题、作者、venue）
  - 章节节点（outline 每一项）
  - Note 节点（用户的 margin notes 和 memory 的 whyItMatters / 3-line summary / linked）
  - 关联论文节点（`memory.linked`）
- 边：章节节点 → 论文节点，note 节点 → 对应章节节点；边样式为 walnut-soft 色 `stroke-dasharray: 3 4`
- 初始布局：`dagre` 自动排布（`dagre` + `react-flow` 标准组合）
- 节点可拖拽，布局持久化到 `chrome.storage.local`（key `paper:{paperKey}:canvas`）
- 顶部左侧工具栏胶囊：`← Back to reader` + 分隔线 + `{N} cards · {M} links`（数字根据当前节点和边实时计算）
- 顶部右侧工具栏胶囊：缩放（`−` / 百分比 / `+`）——使用 react-flow 的 `<Controls />` 组件，通过 props 仅保留 zoom-in / zoom-out 按钮，外层用 `var(--paper-soft)` 背景、`var(--rule)` 边线包裹以匹配原型视觉
- 画布 Pan 交互由 react-flow 原生支持（空白处拖拽平移、滚轮缩放），无需自行实现
- **Canvas 内的 Chat 节点为静态预览**：展示最近一次 Chat 对话的 user 问题 + AI 回答片段 + 1 条引用；v1 不可在 Canvas 内直接输入对话（用户切回 Classic 模式继续聊）

### 8.4 OutlinePanel

布局：左侧 260px 固定宽，从 `paper.outline` 渲染章节树，点击条目滚动到目标段落。

**点击滚动规则（`resolveOutlineTarget(item, paper)` helper）：**
```ts
function resolveOutlineTarget(item: OutlineItem, paper: Paper): Paragraph | undefined {
  // 1. 精确匹配：段落直接归属 item
  const direct = paper.paragraphs.find(p => p.sectionId === item.id);
  if (direct) return direct;

  // 2. level-0 且仅含 subsection 段落时，fallback 到 sectionIndex 匹配
  if (item.level === 0) {
    const level0Index = paper.outline
      .filter(o => o.level === 0)
      .findIndex(o => o.id === item.id);
    return paper.paragraphs.find(p => p.id.startsWith(`sec${level0Index}-`));
  }
  return undefined;
}
```
- 返回的 paragraph 通过 `document.querySelector('[data-pid="{id}"]').scrollIntoView({ behavior: 'smooth', block: 'start' })` 定位
- `resolveOutlineTarget` 返回 undefined 时（极端情况：解析损坏），点击条目不滚动，仅在控制台记录 warning

**条目展示：**
- 每一项显示章节 label 和 level（level 0 一级、level 1 二级缩进 12px）
- PDF 模式若 `page` 有值，右侧以 mono font 显示页码
- 当前滚动到的章节高亮显示（scroll spy，规则见下）

**Scroll spy（当前章节高亮规则）：**
- 监听 reader 容器的 `scroll` 事件，防抖 120ms
- 计算视口中线：`const mid = container.scrollTop + container.clientHeight / 2`
- 遍历 `[data-pid]` 元素（PaperPage 渲染的段落 DOM），找到 `offsetTop ≤ mid` 中 offsetTop 最大的那一段（即视口中线当前所落的段落）
- 取该段落的 `data-pid` 反查 `Paragraph.sectionId`——高亮 OutlinePanel 中 `id === sectionId` 的条目（最深层，不上升到 level-0 parent；若想同时高亮 parent 链可在 v2 加）
- 视口内没有段落（极端：所有段落都在视口下方，滚到最顶）时高亮第一个条目

**顶部元信息区（沿用原型视觉，数据真实化）：**
- Role chip：展示 `extractRolePrefix(paper.memory.role)`（详见 §3.6），颜色按 §3.6 表取；`extractRolePrefix` 返回空字符串时不渲染 chip
- Topic chip：v1 `paper.topic` 始终为空，**顶部 topic chip 在 v1 不渲染**（原型的 `long-context` / `retrieval` 硬编码展示移除）

**阅读时间估算：v1 不渲染**（原型底部的 "~42 min" 阅读时间估算 v1 移除；若未来要加，计算规则为 `ceil(totalWords / 250)` 分钟，以占位文本 "~{n} min read" 展示）。

---

## 9. TopBar 控件设计

**左侧：**
| 控件 | 图标 | 功能 |
|------|------|------|
| Sidebar 切换 | Sidebar | **仅切换 outline 面板显示/隐藏**，职责不随 variant 变化；**Canvas variant 下按钮置灰不响应**（Canvas 不渲染 outline，切换无可见效果，保持与 Workspace toggle 同样的"在无效果的 variant 下置灰"规则） |
| Logo + "PaperFlow" | — | 静态展示 |
| Library | Library | 打开 Library drawer（等价 ⌘L） |

**右侧（从左到右）：**
| 控件 | 图标 | 功能 |
|------|------|------|
| CmdK | Command | 打开命令面板（⌘K） |
| Variant 切换器 | Book / Grid / Layers | 三段控件，切换 Focus / Classic / Canvas，选择持久化到 `localStorage` key `pf-variant` |
| 主题切换 | 月亮 / 太阳 | 切换 dark / light，`data-theme` 写到 `<html>`，持久化到 `localStorage` key `pf-theme` |
| Tweaks | Settings | 打开 TweaksPanel 浮层 |
| Workspace toggle | Sparkle | 切换 WorkspacePanel 显示/隐藏；**仅在 Classic variant 下可点击**，Focus / Canvas 下按钮置灰不响应（避免与左侧 Sidebar 职责重叠） |

**面包屑（居中）：** `{paper.title}` + 页码。
- HTML 模式无真实分页（即 arXiv HTML 模式），页码显示为 `—/—`
- PDF 模式通过监听 reader 容器的 `scroll` 事件 + 各 page canvas 的 `offsetTop` 推断当前页（pdfjs library 模式不发 `pageNumber` 事件，需自行计算）：
  ```ts
  const viewportMid = container.scrollTop + container.clientHeight / 2;
  const idx = pages.findIndex(p => p.offsetTop + p.offsetHeight > viewportMid);
  const current = Math.max(0, idx) + 1;   // 1-indexed 展示
  ```
  逻辑含义：找到第一个"底边在视口中线之下"的页，即视口中线所落的那一页。展示格式 `p. {current}/{total}`（current 为 1-based）

**TweaksPanel 内容：**
- Reading font：Serif / Sans 切换
- Page width：滑块，560–900px
- Margin notes：开关，控制 Focus 模式下 margin notes 列显示
- Paper grain：开关，控制 `.paper-grain` CSS class

所有 tweaks 持久化到 `localStorage` key `pf-tweaks`。

---

## 9.1 CmdK 命令面板

⌘K 打开，顶部搜索框，按 Category 分组展示条目。条目选中后 Enter 执行或点击执行。

**v1 支持的命令：**

| Category | Command | 全局快捷键 | 行为 |
|----------|---------|---------|------|
| Paper | Summarize whole paper | — | 切换到 Classic 的 Summary tab，触发整篇 summary 重新生成 |
| Paper | Translate current page | — | 对"当前可见段落"批量调用 translate，结果写入 margin notes。**"当前可见段落" 定义**：统一 helper `getVisibleParagraphs(container)`——返回 reader 容器 viewport 内完全或部分可见的 `[data-pid]` 段落集合（用 `getBoundingClientRect()` 与 container rect 交集判断）。PDF 模式自然覆盖当前页，HTML 模式覆盖视口段落 |
| Paper | Ask question about paper | — | 切换到 Classic 的 Chat tab 并聚焦输入框 |
| Memory | Set role in my research… / Write my judgment / Link to another paper… | — | 切换到 Classic 的 Memory tab，并将对应字段切入编辑态 |
| Jump | Open Library | ⌘L | 打开 Library drawer |
| View | Layout: Focus / Classic / Canvas | — | 切换 variant |

**Kbd 徽标显示策略：** CmdK 条目右侧只为实际绑定了全局快捷键、且该条目会出现在 CmdK 列表中的命令渲染 `<kbd>`。v1 全局 shortcut 集合为：`⌘L` (Open Library)、`⌘K`（打开本面板）、`⌘\` (Toggle outline)、选中文本时的 `E/S/T/H/?`；其中只有 `Open Library` 是 CmdK 列表中的条目，`⌘\` 和 selection shortcuts 不在 CmdK 里（StatusRail 已展示 `⌘\`），不参与 kbd 徽标规则。原型上 `⌘S` / `⌘T` / `/` 三个 kbd 徽标 **在 v1 中删除**（避免用户按下后无反应）。未来若要加全局快捷键，同时在 `viewer-app` 的 keydown handler 中绑定并在 CmdK 条目上补回 kbd。

**Jump 分组组成：** v1 Jump 分组仅保留 `Open Library` 一条；原型的 `Jump to § 3 Method` / `Jump to § 4 Experiments`（章节跳转）**v1 不做**（handler 未接通，后续版本再基于 outline 动态生成命令项）。由于 Jump 分组只剩一条，UI 上该分组仍独立展示（与其他分组保持统一结构），不做合并。

---

## 10. 范围外

**平台与存储：**
- Firefox / Safari 支持
- `chrome.storage.sync`（100KB 限制不够用）
- 离线模式
- 非 PDF / 非 arXiv 的普通网页

**内容解析：**
- figures 解析与渲染（数据模型保留 `Figure` 接口，v1 不解析也不渲染）
- `Paragraph.important` 字段消费（数据模型保留，v1 UI 不渲染）

**交互（原型有 UI 但 v1 不做）：**
- CmdK 的 `Jump to § N` 动态章节跳转条目（原型 handler 未接通）
- CmdK 条目上 `⌘S` / `⌘T` / `/` 的 kbd 徽标（原型仅视觉展示，v1 未实现全局 shortcut，徽标移除）
- TweaksPanel 的 Density（Cozy / Normal / Compact）—— 原型持久化但未应用到任何样式，v1 不加入 TweaksPanel
- Canvas 模式内 Chat 卡片的交互输入（v1 仅静态预览最近一次对话，用户切到 Classic 继续聊）
- Memory tab 的 `whyItMatters` Keep / Rewrite / Doesn't fit 三按钮的 onClick 行为（v1 仅占位视觉，不触发 AI）
- Memory tab 的 linked 条目新增 / 删除 / 编辑（v1 只读）
- ContextIndicator 的 "Change" 按钮（v1 为视觉占位）
- Library 的 `topic` 字段写入（v1 `topic` 始终为空，Group by Topic 时全部归入 "Uncategorized"；`role` / `judgment` 正常回写）
- OutlinePanel 顶部 Topic chip（原型硬编码 `long-context` / `retrieval`，v1 移除）
- OutlinePanel 底部阅读时间估算（原型 "~42 min"，v1 移除）
- Margin note 删除入口（v1 只新增不删除，`paper:{paperKey}:notes` 的删除逻辑保留在 schema 中；若误生成需用户手动清 storage）
- Summary 的 chunk 级 prompt 截断（v1 发完整 paragraphs，不做 context 超限处理；未来若触发可再加）
- Highlight 删除入口（同 margin note，v1 无删除 UI；重叠/重复高亮只能通过手动清 storage 纠正）
- `chrome.storage.local` 额度保护（v1 不做 eviction / 配额检查）：chrome extension 本地存储上限 ~10MB，用户跨 50 篇论文 × 50 margin notes 会逼近上限；v1 不做主动清理，写入失败时 console 记录 `QUOTA_BYTES_PER_ITEM` 错误，同时顶层弹一次 toast "Storage is full. Clear some notes in Library." 提示用户，但不提供清理 UI（用户需手动 `chrome://extensions` → 扩展详情 → 清除存储）；后续版本补 LRU eviction 或存储面板
- Translate 目标语言配置化：v1 prompt 硬编码 "Translate to 中文"（见 §3.7.3），对非中文用户是坏默认；v1.1 考虑在 Options 里加 "Translation target language" 配置

---

## 10.1 与原型的差异（Spec 偏离原型的行为）

实现时以本 spec 为准；以下条目为 spec **主动偏离**原型的点，review 时用来对照：

| 偏离 | 原型行为 | Spec v1 行为 | 原因 |
|------|---------|-------------|------|
| StatusRail | 所有 variant 常驻 | Canvas 下隐藏 | Canvas 自带工具栏，StatusRail 冗余 |
| PaperPage Figure 1 占位块 | `paper-page.jsx` 渲染 `FigurePlaceholder` + caption | 不渲染 | §10 明确 figures 超范围 |
| Paragraph.id | 原型用 `p1`、`p2` 手写序号 | `sec{n}-p{m}` 结构化生成 | 真实解析无法维持 `pN` 顺序 |
| `nextActions` 数据结构 | 原型为 `string[]`，checkbox 无 state | `{ text, done }[]`，`done` 持久化 | 支持勾选状态持久化（§8.2） |
| LibraryRow 时间字段 | 原型 `opened`（字符串）+ `openedSort`（int） | 单字段 `lastRead: epoch ms` + `formatRelative()` | 去重，避免双字段不同步 |
| Margin note LINKED CONTEXT body | 原型硬编码 "You wrote about this…" 元叙述 | 取 `memory.linked[0]` 的 `title` + `why` 拼接 | 让默认 note 反映真实 memory |
| Workspace toggle 与 Sidebar 按钮 | 原型 Sidebar 按钮仅切 outline，Sparkle 按钮切 workspace | spec 保持同一分工，明确 Sparkle 在 Focus/Canvas 下置灰 | 消除"两个按钮做同一件事"的歧义 |
| TopBar 页码 | 原型硬编码 `p. 1/18` | HTML 模式 `—/—`；PDF 模式基于 scroll + offsetTop 计算 | library 模式 pdfjs 不发 pageNumber 事件 |
| CmdK Jump 分组 | 原型含 `s3` / `s4` 章节跳转条目 | 仅保留 `Open Library` | handler 未接通，避免假功能 |
| 高亮颜色 | 原型 `color: 'yellow'` 硬编码 | v1 仍单色黄，但 storage 预留 `color` 字段 | 未来支持多色时 schema 不变 |
| Margin note 默认标题 | 原型 "Why this matters — for you" / "You wrote about this" | spec uppercase mono 风格 "WHY THIS MATTERS" / "LINKED CONTEXT" | 统一原型里 mono uppercase 标签体系，避免大小写/短句不一致 |
| Margin notes 存储 | 原型 `results` 只在 useState，会话结束即丢失 | 持久化到 `paper:{paperKey}:notes` | 跨会话保留，Canvas / annotations 计数 / Library hasMemory 都依赖 |
| Paragraph.sectionId | 原型靠 `paper.section === outline.label` 字符串相等 | 新增字段 `sectionId = OutlineItem.id` | 字符串相等对 label 格式敏感，嵌套 section 定位错误 |
| ChatView citations 注入时机 | 原型 `i > text.length - 30` 启发式塞 citations | 真实实现按 SSE JSON 解析完成后一次性填入 `msg.citations`，流式期间 citations 为 `[]` | 原型启发式在真实 API 下不适用 |
| PaperMemory optionality | 原型 `paper.memory` 可能 undefined（mock 未统一） | spec `memory` 非 optional，初始化时各字段填空值 | 消除到处 `paper.memory?.xxx ?? ''` |
| `hasMemory` 空态 | 原型仅检查对象存在 | 检查各字段 trim/length 是否全部未设置 | 避免"打开新论文就被标记为 hasMemory" |
| Summary 生成时机 | 原型无 AI 调用，不涉及 | 解析完成后 3s 节流，用户关闭则取消 | 控制 API 费用 |
| 当前论文 spine 颜色 | 原型 `var(--walnut)` 实色 | 新增 token `var(--walnut-deep)` | 与 Central role 的 walnut 颜色区分 |
| Focus 默认 note 锚定 | 原型靠 `Paragraph.section` 字符串匹配 "Introduction" | spec 走 `findIntroParagraphs()`：outline label `includes('introduction')` + sectionId + level-0 fallback | 与 §3.2 "section 仅展示用" 原则一致 |
| 高亮多条同段 | 原型 `paper-page.jsx:106` 只取首个匹配 | v1 允许多条高亮共存并逐条 wrap | storage schema 本就是数组，不人为限制 |
| Summary 缓存 key | — | 加 model 后缀 `:{model}` 隔离 | 避免切 model 后 UI 显示的 model 与缓存内容不符 |
| Chat citation 合约 | 原型 `pickAnswer()` 硬编码 citations 对象 | spec 定义 `[pN]` inline + 流式结束后抽取，`n` 按出现顺序编号 | 真实模型必须有确定的输出格式 |
| Ask (?) 预填行为 | 原型 ask 按钮等价于 explain（无实质） | spec 定义 SelectionPinnedChip + 拼接 user message | 原型未实现，必须写死一种 |
| AI system prompt 模板 | 原型无 AI 调用，无模板 | spec §3.7.3 写死 8 条 prompt | 影响输出质量，实现者不应自行发明 |
| BYOK 未配置错误路径 | 原型无 AI 调用 | spec §3.8 统一错误条 + "Configure API key →" 跳 Options | 实现时统一处理，避免多处各自发明 |
| AI 上下文注入 abstract | 原型无 AI 调用 | §3.7.1 注入 `## Abstract` block；Citation 合约支持 `[abs]` | abstract 是信息密度最高的段落，不注入会降低 Summary / Chat 质量 |
| 段落前附 `§{section}` 标签 | 原型无 AI 调用 | §3.7.1 每段前加 section 前缀 | 让模型能回答 "§3 和 §4 有什么不同" 类问题 |
| 流式中切 variant | 原型无真 AI | §3.8：流不 abort，后台完成后 `onStreamDone` 落盘；Focus/Classic 各自从 state 恢复显示 | 避免切 variant 触发的 subtle bug |
| Ask (?) 切 variant 持久化 | — | 临时切换不写 localStorage（`transient: true`） | Ask 是一次性操作，不应污染用户的 variant 偏好 |
| OutlinePanel scroll spy | 原型 `active` 硬编码 `'intro'`，无 spy | 监听 reader scroll + 视口中线 + offsetTop 最接近段落的 sectionId | 原型只是 mock，真实体验需要动态高亮 |
| Chat thread 跨多个 model | — | 历史消息与新消息可能由不同 model 产生（§3.9：chat 不按 model 隔离） | 连续对话保留，牺牲 thread 内 model 一致性；v1 不展示气泡 model 元信息 |
| PaperPage section header 层级 | 原型已扁平（paragraph.section 均为 subsection） | spec 明确不渲染 level-0 parent header | 对齐原型行为，避免实现者打补丁 |
