# PaperFlow Chrome Extension — Spec Review (Round 2)

Date: 2026-04-21
Reviewed spec: `docs/specs/2026-04-20-spec-chrome-extension.md`
Prototype reference: `components/*.jsx`, `styles/tokens.css`

---

## 概述

第二轮修订把第一轮发现的矛盾都按预期收敛了：

- Role 标准值统一到 §3.6 表
- Workspace toggle / Sidebar 职责划清（§9）
- `Paragraph.id` 规定了 `sec{n}-p{m}` 格式
- Summary 三段缓存粒度独立（`paper:{paperKey}:summary:threeLine` 等）
- §10.1 "与原型的差异" 总览表

本轮在新文本里又发现一批新问题，其中 A 组两项是必须在下钻代码前解决的内部矛盾。

---

## A. 必须解决的问题（会直接撞上实现）

### A1. `PaperMemory.role`（自由文本）与 `Library.role`（标准值）的桥没接上

**观察到的矛盾**
- §3.4：`Library.role` 必须是 §3.6 标准值 6 种之一或空
- §3.4：`Library.role / judgment` 来自 `PaperMemory` 对应字段
- §8.2：Memory tab 编辑态里，`role` 按 `{选项} — {自由文本}` 追加在 textarea 首部（原型 `chat-memory.jsx:410` 行为一致）

两个 role 数据形状不一样：`PaperMemory.role = "Background — a candidate alternative to ..."`，`Library.role = "Background"`。spec 没写提取规则，实现者会两头猜。

**建议补一条**
> `Library.role = extractRolePrefix(PaperMemory.role)`，其中 `extractRolePrefix(s)`：取 `s.split(' — ', 1)[0].trim()`；若结果匹配 §3.6 标准值则使用，否则 `Library.role = ''`。`PaperMemory.role` 为空字符串时 `Library.role = ''`。

同样的提取规则适用于 §8.4 OutlinePanel 的 role chip（目前 "展示 `paper.memory.role`（Role 标准值）" 这句与 Memory 存储格式对不上）。

### A2. "margin notes 数量" 没有持久化 source

**观察到的矛盾**
- §3.4：`annotations = 该论文的 highlights + margin notes 数量`
- §8.1：margin note 历史 "results 数组作为全局状态，不因 variant 切换而清空"——但这个 `results` 在 `viewer-app.jsx:43` 只是 `useState`，会话结束就没了
- 所有 `paper:{paperKey}:*` storage key 列表里没有 `notes` 一项

结果：关闭标签页后 `annotations` 在下次打开时算不出；或者 `annotations` 值一直是历史遗留（如果只累加不清理）。

**两条路二选一**
- 增加 `paper:{paperKey}:notes` 持久化键，结构 `{ id, kind, source, body, paragraphId, createdAt }[]`，并 spec 清楚 note 什么时候写入、什么时候删除
- 或把 `annotations` 定义改为 "仅 highlights 数量"，并把 §10 范围外补一句 "margin note 计数 v1 不纳入 annotations"

A2 也牵连到 Canvas 模式——§8.3 的 "Note 节点（用户的 margin notes ...）" 如果 margin notes 只在会话内存，跨会话 Canvas 就空了一半。

---

## B. 应该补清的歧义（留着会返工）

### B1. `paperKey` 跨 URL 形态的稳定性未定义

`arxiv.org/pdf/2402.18413`、`arxiv.org/html/2402.18413`、`arxiv.org/abs/2402.18413`、以及带版本号 `...v2` 的变体：这些应该映射到**同一** paperKey 才能共享缓存。

§3.4 说 "arXiv 模式返回 `paper.id`"，但没说 `paper.id` 怎么从 URL 规整出来（是否 `2402.18413`、是否剥 `v2`、是否剥 `arxiv-` 前缀——原型 `paper-data.jsx:3` 是 `"arxiv-2402-18413"`）。

**建议补**
> arXiv `paper.id` 规整规则：`/(\d{4}\.\d{4,5})(v\d+)?/` 提取主 id，丢弃版本号；所有 `arxiv.org/{pdf|html|abs}/{id}[v{n}]` 都映射到同一 `paper.id`，从而共享 `paper:{paperKey}:*` 缓存。

### B2. `Paragraph.section` 和 `OutlineItem.id` 没有显式关联

§8.4 "点击条目滚动到目标段落" 要把 outline 点击解析到段落。原型靠 `paper.section === outline.label` 字符串相等（`paper-page.jsx:86-94` 的分组逻辑），但：

- arXiv HTML 模式嵌套的 `<section>`，subsection 里的 `<p>` 的 `section` 字段写什么？"3 Method" 还是 "3.1 Chunk residuals"？level-0 item 的滚动目标找不到
- 标签字符串相等对 label 格式敏感（`"1 Introduction"` vs `"1. Introduction"`）

**建议给 `Paragraph` 加 `sectionId: string`**（值 = 所属 `OutlineItem.id`）。outline → paragraph 直接 `findFirst(p => p.sectionId === outlineItem.id)`，不再依赖字符串相等。若嫌模型变动大，至少在 §3.2 里硬性规定 "`Paragraph.section` 值必须与某个 `OutlineItem.label` 精确相等；嵌套段落归属最近的 level-0 outline 的 label"。

### B3. `Paragraph.id` 里的 `sectionIndex` 究竟是谁的 index

§3.2 "`sec{sectionIndex}-p{paragraphIndexInSection}`" 没说 `sectionIndex` 是：

- outline 中 level=0 的序号？（比如 outline 有 "Abstract/1 Intro/2 Related/2.1 RAG..."，sectionIndex 只从 Abstract=0、1 Intro=1、2 Related=2 计数）
- 还是所有 level 平铺的序号？（2.1 RAG 是 sectionIndex=3）

不同实现会导致 id 不一致，缓存就对不上了。

**需要写死**：建议用 level-0 为准——嵌套 subsection 的段落 `sectionIndex` = 所属 level-0 section 的序号，`paragraphIndexInSection` 在该 level-0 范围内连续递增。

### B4. PDF 当前页的公式 + 1-indexing 都不对

§9：
```
currentPage = pages.findIndex(p => p.offsetTop + p.offsetHeight / 2 > scrollTop)
```

- 语义是 "找第一个中心在 scrollTop **下方** 的页"——当用户刚滚过页 N 的顶部时（scrollTop 略大于 N.offsetTop），公式会返回 N（因为 N 的中心还在下方）。这把上一页当成当前页
- findIndex 返回 0-based，spec 用 `p. {current}/{total}` 展示（原型展示 `p. 1/18` 是 1-based）——需要 `current + 1`

**修正**
```ts
const viewportMid = scrollTop + viewportHeight / 2;
const idx = pages.findIndex(p => p.offsetTop + p.offsetHeight > viewportMid);
const current = Math.max(0, idx) + 1;
```

或类似逻辑。并把展示改成 `p. {current}/{total}` 且 current 是 1-based。

### B5. 全局键盘监听没有排除可编辑元素

§3.3 "选中文本时按未按 meta/ctrl 的单键触发"——但 Chat composer、Memory 编辑态 textarea、options 页的 input 里如果用户选了文本再按 `e`，会误触发 Explain。原型 `viewer-app.jsx:49-62` 也有这毛病，但 prototype 的 textarea 里几乎不会恰好 selection 非空，真实环境下频繁发生。

**补一句**
> 监听处需要排除 target 是 `<input>`、`<textarea>`、`contenteditable` 的事件；或者更保守：只在 target 位于 `.paper-page` / `.margin-column-root` 之内时才处理快捷键。

### B6. Summary 3 次 AI 调用会在 "论文解析完成后立刻" 并发发射

§8.2 "论文解析完成后，对每段独立检查缓存；缺失则独立触发 AI 生成（3 次 AI 调用，并发发出）"

成本隐患：用户点开论文瞟一眼就关，也会触发 3 次全文上下文调用。原型没 AI 所以不用考虑，真实环境这是实打实的费用。

**建议二选一**
- 懒生成：用户首次切到 Classic 且 Summary tab focused 时才触发（代价：首次点 tab 有 5-15s 等待）
- 或加一个 §4 非功能约束："Summary 自动生成需延迟 3s 节流，若期间用户关闭 reader 则取消"

哪种都比 "打开即烧" 强。

### B7. `Chunk 仅作展示与上下文截断，不影响 UI 渲染` 自相矛盾

§3.2 最后一句。"上下文截断" 意味着 AI 调用时会裁段落；"不影响 UI 渲染" 又否认裁剪后果。实际做法是 "发给 AI 的 prompt 里只取前 N 个 chunk 以控长度"？还是 "全部 chunk 都发，chunk 只是计数"？

**需要写明**
- 如果只是计数（UI 展示 `14 chunks` 纯信息）：删掉 "上下文截断" 字样
- 如果要做截断：明确截断阈值和策略（"若 chunks 合计 token 数 > model_context_limit - 2000，按排名截断…"）

### B8. Canvas variant 下 Sidebar 按钮行为未定义

§9 "Sidebar 切换在所有 variant 下都是同一职责"——但 Canvas 根本不渲染 outline（§8.3 "全屏替换 reader"）。按钮点击改变 `outlineOpen`，但 Canvas 下看不到变化，切回 Focus 才显现。

**补一句**
> Canvas variant 下 Sidebar 按钮仍可点击，仅修改 `outlineOpen` 状态，实际可见效果在切回 Focus/Classic 时体现。

或：Canvas 下隐藏 Sidebar 按钮，与 Workspace toggle 置灰规则对齐。

### B9. `hasMemory` 定义与 §3.5 空态不兼容

§3.4 `hasMemory = memory 对象存在任一非空字段时为 true`。§3.5 `nextActions` 初始化为 `[]`——空数组算 "非空字段" 吗？`linked: []` 呢？

**建议改成**
```ts
hasMemory = !!(
  whyItMatters ||
  role ||
  judgment ||
  linked.length > 0 ||
  nextActions.length > 0
)
```

把空数组和空字符串都视为未设置，避免 "打开就自动算作 hasMemory"。

---

## C. 小问题

- **C1**：§3.6 `Central → walnut`，§3.4 "当前论文行的 spine 一律 `var(--walnut)`"——Central 且 current 会跟其他 Central 视觉一样（失去 "NOW" 的色条区分）。补一句 "current 论文行 spine = walnut-deep 或 walnut + 额外 `border-left: 1px solid var(--paper)` 留白" 可以解决。或直接把 Central 配成另一种颜色（比如 walnut-deep）。
- **C2**：§8.1 "WHY THIS MATTERS" 与原型标题 "Why this matters — for you" 有出入；不是 bug，但可以在 §10.1 补一行记录。
- **C3**：§8.2 Chat 模板化 suggestions 的 "第一个章节" 若是 Abstract / References / Acknowledgements 会很别扭。建议限定为 "第一个 `level === 0 && !['Abstract','References','Acknowledgements','Appendix'].some(kw => label.includes(kw))` 的 outline item"。
- **C4**：§5 `memory?: PaperMemory` 是 optional，但 §3.5 规定新论文一初始化就存在空 memory。改成非 optional（`memory: PaperMemory`）更贴合实际数据流，避免调用点到处写 `paper.memory?.role ?? ''`。
- **C5**：§3.4 Library 初次保存时的 `pages` 字段来源：PDF 模式是 `pdfDoc.numPages`，arXiv HTML 模式没有真实分页——§9 已说面包屑显示 `—/—`，但 `Library.pages` 要填什么？建议 arXiv HTML 模式下存 `0` 或者用段落数 `/ 500 * 2` 估算，spec 要写明。
- **C6**：§10.1 差异表里可以再补一行 "ChatView 流式的 citations 注入时机"（原型 `chat-memory.jsx:37` 用 `i > text.length - 30` 这种启发式塞 citations；真实 SSE 下要等 JSON 解析完才有 citations，时机不同），否则实现照抄 prototype 会出 bug。

---

## 总结

A1 和 A2 是阻塞项，trim 之前要先动结构（加 `Library.role` 提取规则、决定 margin notes 的持久化策略）。B 组里 B1-B4 是典型 "实现到一半才发现" 的坑，建议都在本轮就补进去。B5-B8 是风险项，写死一行就能省掉一轮 bugfix。
