# PaperFlow Chrome Extension — Spec Review (Round 4)

Date: 2026-04-21
Reviewed spec: `docs/specs/2026-04-20-spec-chrome-extension.md`
Prototype reference: `components/*.jsx`, `styles/tokens.css`
Previous rounds: `docs/reviews/2026-04-21-review-chrome-extension.md`, `.../2026-04-21-review-chrome-extension-round3.md`

---

## 概述

第四轮修订把第三轮的 A/B/C 几乎全部落实：

- ✅ **A1** `findIntroParagraphs()` helper 写死在 §8.1，不再依赖 `Paragraph.section` 字符串匹配
- ✅ **A2** `resolveOutlineTarget()` helper 补上了 level-0 无直接段落的 fallback（§8.4）
- ✅ **B1** Chat Citation 合约 §3.7.4 定义完整：`[pN]` inline + 流式结束后抽取 + 去重成 `[1][2][3]`
- ✅ **B2** Ask (?) 预填行为 §3.7.5 写死：SelectionPinnedChip + user message 拼接模板
- ✅ **B3** System prompt 模板 §3.7.3 给出 8 条 baseline + memory 注入格式 + 段落上下文格式
- ✅ **C1-C9** 高亮多条同段规则、`chrome.storage` 额度超范围、`⌘\` kbd 策略、`--walnut-deep` token、model 隔离都补上了

新增 §3.7（AI 调用合约）、§3.8（AI 错误路径）、§3.9（model 缓存隔离）三节质量很高，基本把实现的核心语义锁住。§10.1 差异表也扩充到 23 条，review 时很容易对照。

这一轮主要检查新写的 §3.7-3.9 的合约是否完整、内部是否自洽。结论：**一处实质性遗漏**（Abstract 与 section 标题都没进 AI 上下文），其余 7 条是边角，影响 UX 但不阻塞实现。

---

## A. 实质性遗漏

### A1. AI 上下文里没有 `paper.abstract`

§3.7.1 段落上下文格式只注入 `paragraphs[]`：

```
# {paper.title}

By {authors...}. Published in {venue}.

## Paragraphs (cite with paragraph ids like [p1]):
[p1] {paragraphs[0].text}
...
```

**缺的是 `paper.abstract`**。abstract 常常是一篇论文信息密度最高的段落，尤其是：

- `Summary.threeLine` 的第一句"a) main idea"，abstract 里基本是原话的改写
- Chat 开场三问 "What's the core mechanism?" 也最依赖 abstract
- 不带 abstract 时模型可能得从 Introduction 里猜整体框架，质量下降

原型 `paper-data.jsx:8` 有独立的 `abstract` 字段，`PaperPage` 也专门把 abstract 渲染在段落上方（`paper-page.jsx:52-65`）——结构上 abstract 确实不是 paragraph。但注入 AI 时应该作为 paragraph 之前的独立 block。

**建议把 §3.7.1 改成**：

```
# {paper.title}

By {authors...}. Published in {venue}.

## Abstract
{paper.abstract}

## Paragraphs (cite with paragraph ids like [p1]; cite the abstract as [abs]):
[p1] {paragraphs[0].text}
[p2] {paragraphs[1].text}
...
```

并在 §3.7.4 Citation 合约里补一条 "`[abs]` → `{ quote: truncate(paper.abstract, 140), loc: 'Abstract' }`"。

### A2. 段落上下文里没有 section 结构信息

§3.7.1 的段落是扁平 list：

```
[p1] Transformer decoders struggle to carry information...
[p2] We argue a different decomposition...
...
```

模型看不到 p1 是 §1 Introduction、p6 是 §3.2 Retrieval as attention bias。对很多问题这没影响，但以下场景会伤：

- 用户问 "How does §4 compare to §3?" —— 模型不知道哪些 `[pN]` 属于 §4
- Chat suggestion 模板里已经在问 "What's the core mechanism of §{第一个章节}?" (§8.2) —— 模型得猜哪些段落属于这个章节
- `Translate current page` 按 page 选可见段落批量 translate —— 翻译质量对段落所在 section 语境敏感

**最小改动**：在每段前加所属章节标签：

```
[p1] §1 Introduction · Transformer decoders struggle to carry...
[p5] §3.1 Chunk residuals · Given hidden states h ∈ ℝⁿˣᵈ...
```

`section` 字段（§3.2 规定 = 最深层 outline label）正好适合直接拼。这一改也让 §3.7.4 的 `loc` 构造自然——`loc = 'p. {page} · §{paragraphs[N-1].section} · ¶ p{N}'` 本就在读 `section`。

---

## B. 应该补清的边角

### B1. §3.7.2 Memory 注入里的 "(done ones skipped)" 歧义

原文：

```
- Outstanding actions:
  - [ ] {nextActions[i].text}  (done ones skipped)
```

括号里的 "done ones skipped" 读起来像是要**字面写进 prompt** 的注释，实际意图是 spec 作者在告诉实现者 "filter 掉 done=true 再渲染"。模型如果真看到 "(done ones skipped)" 会疑惑。

**建议**：把括号注释拎出来变成 bullet point：

```
- Outstanding actions:
  - [ ] {nextActions[i].text}     ← 仅列 done === false 的条目；已完成的省略
```

或者直接写：

> 仅注入 `nextActions.filter(a => !a.done)`；若过滤后列表为空，整个 "Outstanding actions" block 一起省略。

### B2. `§3.7.4` loc 里 `OutlineItem.page` 为 undefined 时的格式

spec：`loc: 'p. {page} · §{section} · ¶ p{N}'`，且说 "page 来自 `OutlineItem.page`（若有）"。

HTML 模式下 `OutlineItem.page` 一律 undefined，`loc` 会变成 `p. undefined · §1 Introduction · ¶ p2`。

**建议**：

> 若 `page` 未定义：`loc` 省略 `p. {page} · ` 段，变成 `§{section} · ¶ p{N}`。原型 `chat-memory.jsx:247` 的示例是 `p. 13 · §6 Discussion · ¶ p9`，在 PDF 模式下才完整。

### B3. `Translate current page` 在 arXiv HTML 模式下语义不明

§9.1 CmdK: "对当前可见段落批量调用 translate，结果写入 margin notes"

- PDF 模式："当前可见段落" = 在当前 page canvas 视窗内的段落。OK。
- arXiv HTML 模式：**没有 page 概念**（§9 面包屑显示 `—/—`），"当前可见段落" 应该解释为 "viewport 内的段落"

**建议**：

> HTML 模式下 "current page" = reader 容器 viewport 内完全或部分可见的 `<p[data-pid]>` 集合；PDF 模式下 = 当前 page canvas 对应的段落。两种模式都用同一 helper `getVisibleParagraphs(container)` 实现。

### B4. 流式过程中 variant 切换的清理语义未定义

场景：用户在 Focus 模式触发 E（Explain），流式正在往 MarginNote 里写字。用户中途切到 Classic。

- 底层 `fetch + ReadableStream` 是继续 pull 还是 abort？
- margin note 已经有部分文本但未 `onStreamDone`——按 §3.4 "失败中断的 note 不持久化" 这条会落盘失败
- 用户切回 Focus 时看到半截 note 还是看不到？
- 如果继续 stream 到完成，完成后是否写入 `paper:{paperKey}:notes`？

原型不涉及（无真 AI）。spec 建议的处理：

> 流式调用在后台继续到完成，不因 variant 切换而 abort；`onStreamDone` 触发时按 §3.4 持久化到 `paper:{paperKey}:notes`；若用户切回 Focus，新挂载的 MarginColumn 从 `results` state（seed 自 storage）恢复完整 note。Classic 的 SelectionResultCard 在当前变体不存在时静默丢弃（不阻塞 stream）。

写清楚能避开一类 subtle bug。

### B5. `PaperPage` 的 section header 渲染会变"扁"

§3.2 把 `Paragraph.section` 定义为"最深层 outline label"（= `outline.find(o => o.id === sectionId).label`）。

原型 `paper-page.jsx:86-94` 的 `renderParagraphs()` 按 `p.section !== currentSection` 分组插 `<h2>`。在新定义下：

- 用户看到的 section 标题序列是：`Abstract → 1 Introduction → 2.1 Retrieval-augmented LMs → 2.2 Long-context attention → 3.1 Chunk residuals → ...`
- **父章节 "2 Related Work" / "3 Method" 不再出现**——因为他们的直接段落可能是空的（或者其直接段落也会显示自己的 label，但父 section 的标题整体缺失）

原型数据 `paper-data.jsx:27-66` 里每个 paragraph.section 也是 subsection 级（"2.1 Retrieval-augmented LMs"、"3.1 Chunk residuals"）——所以原型 UI 本来就是扁的，这不是 spec 引入的 regression。

**但值得在 spec 里明确这一点**，否则实现者可能以为需要渲染出 level-0 的 parent header 而在代码里打补丁。

**建议在 §3.2 或 PaperPage 相关的描述里补一句**：

> PaperPage 按 `Paragraph.section` 值分组插 `<h2>`，不额外渲染父章节（level-0）标题。视觉上章节层级扁平化，是否要补 level-0 作为 hierarchical header 归入 v2。

### B6. OutlinePanel 滚动高亮的 "当前章节" 判定规则

§8.4 "当前滚动到的章节高亮显示（通过监听 reader scroll 事件 + outline DOM offsetTop 计算）"——这句含糊了两个问题：

1. "outline DOM" 是哪个 DOM？是 OutlinePanel 里的按钮节点？还是 PaperPage 里的 section `<h2>`？
2. 高亮的是直接对应的 outline item（sectionId 指向的那个，可能是 level-1），还是 level-0 parent？

原型 `outline-panel.jsx:63` 高亮靠 `active` prop 传入，未实现 scroll spy；`viewer-app.jsx:38` 默认是 `'intro'` 硬编码。v1 要真实现 scroll spy。

**建议**：

> 监听 reader 容器的 `scroll` 事件，取视口中线（`container.scrollTop + container.clientHeight / 2`）；找到 `<p[data-pid]>` 列表中 offsetTop 最接近且不超过中线的那一段 → 查它的 `Paragraph.sectionId` → 高亮 OutlinePanel 里 id === sectionId 的条目（最深层，不上升到 level-0）。防抖 120ms。

### B7. Ask (?) 自动切换 variant 的副作用

§3.7.5 "当前 variant 若是 Focus，Ask 触发时自动 `setVariant('classic')`"

但 §8.1 + 原型 `viewer-app.jsx:6` 规定 `variant` 持久化到 `localStorage.pf-variant`。Ask 一次就会把用户的默认 variant 永久改掉——下次打开新论文会是 Classic，不是用户选的 Focus。

**建议二选一**：

- **Ask 临时切换不持久化**：`setVariant('classic', { transient: true })`，内部临时 state 不写 localStorage；用户手动点 Variant switcher 才持久化。需要 refactor `variant` state
- **Ask 强制持久化**（当前 spec 隐含的行为）：但需要在 §3.7.5 补一句明确 "Ask 会把 pf-variant 改为 classic，后续会话也默认 Classic"，让用户知情

我倾向前者，因为 Ask 是一次性操作，改默认 variant 违反用户预期。

### B8. `chrome.runtime.openOptionsPage()` 导航未提

§3.8 "**Configure API key →**"（链接跳 Options 页）—— 但跳 Options 页是 chrome extension 专属 API。`<a href>` 不行，需要 `chrome.runtime.openOptionsPage()`（见 [MV3 docs](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-openOptionsPage)）。

**建议在 §3.8 补一行**：

> "Configure API key →" 的 onClick handler 为 `() => chrome.runtime.openOptionsPage()`；不是普通 `<a>`。manifest 需声明 `options_ui` 或 `options_page`。

---

## C. 小问题

- **C1**：§8.2 "用户停留在 Summary tab 且停留 300ms" ——timer 是否随 tab 切换重置未说。建议补 "切出 Summary tab 即重置；切回后重新计时"。
- **C2**：§3.9 "Chat 气泡可选地保留生成它的 model 名（v1 不展示）"——但如果 system prompt 在 mid-conversation 换 model 后也变化（因为 model 的 context/system prompt 可能差），同一个 thread 的上下文对模型连续性有损。可 v1 接受，但差异表（§10.1）里加一行 "Chat thread 可能跨多个 model 消息" 比较好。
- **C3**：§3.7.3 Translate prompt 硬编码 "Translate to 中文"——对非中文用户是坏默认。原型也是中文示例，v1 跟原型一致可接受，但可以在 §10 范围外加 "非中文用户语言配置" 一条提醒这是已知限制。
- **C4**：§3.8 "StatusRail 的圆点同步变 foxglove 紫"——已在 §8.1 描述过，§3.8 再提是重复但无害。若要精简可删一处。
- **C5**：§10 "`QUOTA_BYTES` 错误...不对用户展示"——用户一条 note 写失败后再也没反馈。至少在 console 之外给个 toast 会更尊重用户。v1 接受 console-only，但 v1.1 时记得回来补。

---

## 总结

spec 已经达到 **可以写代码** 的成熟度。这一轮挑的 A 组（abstract + section 结构进 prompt）是对 AI 输出质量影响最大的一项，虽然不改也能跑，但明显会让 Summary / Chat 的质量打折；建议在进 `docs/plans/` 之前把 §3.7.1 补上。

B 组都是"写得不明确实现者会自行发挥"的那种，十分钟就能补清。

修完 A 后建议直接起计划文档——再多轮 spec review 的边际收益在降低。
