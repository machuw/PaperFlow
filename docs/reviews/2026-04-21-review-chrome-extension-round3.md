# PaperFlow Chrome Extension — Spec Review (Round 3)

Date: 2026-04-21
Reviewed spec: `docs/specs/2026-04-20-spec-chrome-extension.md`
Prototype reference: `components/*.jsx`, `styles/tokens.css`
Previous round: `docs/reviews/2026-04-21-review-chrome-extension.md`

---

## 概述

第三轮修订把第二轮列的 A/B/C 几乎全部解决：

- ✅ A1 `extractRolePrefix()` 接上 `PaperMemory.role` ↔ `Library.role` 桥
- ✅ A2 Margin notes 持久化到 `paper:{paperKey}:notes`
- ✅ B1 arXiv `paper.id` 规整规则（正则 + 示例）
- ✅ B2 `Paragraph.sectionId` 新字段
- ✅ B3 `sectionIndex` 明确为 level-0 序号
- ✅ B4 PDF 页码公式修正 + 1-indexing
- ✅ B5 keydown handler 排除可编辑元素
- ✅ B6 Summary 3s 节流 + 取消
- ✅ B7 chunk 仅作 UI 展示，不做截断
- ✅ B8 Canvas variant 下 Sidebar 按钮置灰
- ✅ B9 `hasMemory` 明确计算公式
- ✅ C 组 6 条基本都补上了（current spine 用 `--walnut-deep`、Chat suggestion 过滤名单、`memory` 非 optional、arXiv `pages=0`、10.1 差异表扩充）

本轮主要检查修订引入的新矛盾与仍未覆盖的实现细节。结论：有 2 处新矛盾要修（A1/A2），3 处影响 AI 集成的关键 contract 缺失（B1-B3），其余是边角。

---

## A. 修订引入的新矛盾

### A1. `Paragraph.section` 被降级为"仅展示"，但 §8.1 仍按它来锚定 Margin Note

- §3.2 新文："`Paragraph.section` 字段仅用于展示...**不再承担关联职责**；其值取所属 outline item 的 `label`"
- §8.1 "WHY THIS MATTERS" 的锚定规则仍是："`section` 字段包含 'Introduction' 的第一个段落"

两者直接冲突。按 §3.2 的原则，锚定应该改走 `sectionId` → `outline item` → label 匹配 "Introduction"，而不是直接读 `Paragraph.section`。

**建议把 §8.1 锚定规则改为**：
```
1. 先在 paper.outline 里找 level === 0 且 label.includes('Introduction') 的第一个 item
2. 若找到，用 findFirst(p => p.sectionId === item.id) 取第一段
3. 找不到 item 或找不到 paragraph，回退到 paragraphs[0]
```

同样的原则也要应用到 "LINKED CONTEXT"（Introduction 第二段）。

### A2. Outline 级点击可能找不到段落（level-0 无直接段落时）

§3.2 规定 `Paragraph.sectionId` 指向**最深层嵌套的** outline item。
§8.4 规定 outline 点击用 `findFirst(p => p.sectionId === outlineItem.id)` 精确定位。

矛盾场景：outline 为 `[2 Related (level-0), 2.1 RAG (level-1), 2.2 Long-context (level-1)]`，"2 Related" 本身没有直接正文段落（所有段落都在 2.1 / 2.2 里），此时：

- 用户点击 "2 Related"（level-0）
- `findFirst(p => p.sectionId === "2 Related 的 id")` → 返回 undefined
- 滚动目标丢失

**建议在 §8.4 补一段 fallback 规则**：
```
- 若 findFirst 命中，滚动到该段落
- 否则（level-0 item 仅含 subsection 段落），fallback 到：
  findFirst(p => p.id.startsWith(`sec{thisItemsLevel0Index}-`))
  即任何属于该 level-0 范围内的第一段（无论属于哪个 subsection）
```

或者反过来改 `Paragraph.sectionId` 的定义（让它既记最深层又记 level-0 链），但改数据模型成本更高，fallback 简单。

---

## B. 影响 AI 集成的关键 contract 缺失

这些不是显而易见的 bug，而是实现到一半才会发现"spec 没说这里怎么办"的那种。

### B1. Chat 的 Citation 输出格式未定义

§8.2 "引用渲染：AI 回答里 `[1]` `[2]` 用 `<sup>` 渲染... 回答结束后在消息下方以 CitationCard 列表展示引文原文（`quote` + `loc`）"

§10.1 的 "ChatView citations 注入时机" 也只说"按 SSE JSON 解析完成后一次性填入 `msg.citations`"。

**未定义**：
- AI 怎么输出 citations？是在回答里插入 `[1]` 然后末尾附 JSON？还是用 OpenAI structured output？还是解析模型自由发挥的 Markdown？
- `quote` 和 `loc` 这两个字段从哪里来？是我们 prompt 里把段落打上 id 后让模型引用，还是模型自己编一个 loc？

原型 `chat-memory.jsx:241-268` 用 `pickAnswer()` 返回硬编码对象，完全绕开了这件事。真实实现会卡在这里。

**建议**：定义一个具体的 prompt/output 合约。我倾向于用这种：
```
System prompt 中给模型附 paragraphs 的 markdown，每段带 id：

  Paper paragraphs (cite using paragraph id):
  [p1] Transformer decoders struggle to carry...
  [p2] We argue a different decomposition...
  ...

回答里用 [p1]、[p2] 直接 inline；UI 解析时从 paper.paragraphs 查原文与 loc。
```

不管选哪种，在 §3.3 或 §8.2 里把合约写死。

### B2. `Ask (?)` 的 "预填引用" 具体行为未定义

§3.3 "Ask (?)：将选中文本作为初始上下文，切到 Classic 的 Chat tab 并预填引用"

"预填引用" 有至少 3 种实现：
1. 选中文本进 composer 作为一段 blockquote 前缀，用户再打问题
2. 选中文本作为已发送的第一条 user 消息，AI 自动回复
3. 选中文本作为隐藏 system context 注入，用户正常发问

三种体验差很远。原型 selection-toolbar 的 `ask` 按钮在 prototype 里完全等价于 explain（viewer-app.jsx:65-95 没分支），不能参考。

**建议**：在 §3.3 挑一种写死，并描述 composer 的视觉（比如"composer 上方出现一条可关闭的 selection pinned chip，发送时作为 user message 的一部分，格式 `About this passage: \"{text}\"\n\n{user input}`"）。

### B3. AI system prompt 模板未定义

§3.5 "AI 调用时将 memory 非空字段注入 system prompt（空字段不注入）"

怎么注入？顺序？格式？没有示例。实现者得从头发明一份 prompt 模板。

不同 prompt 下同一 paper 会得到不同 `Summary / Chat / Ask` 结果——这是扩展的"灵魂"，应该被 spec 规定。

**建议**：在 §3.3 末尾加一节 "system prompt 模板"，至少列出：
- Summary 三段（threeLine / keyTerms / detailed）各自的 system prompt
- Chat 的 system prompt 基座（含 memory 非空字段注入格式）
- SelectionResultCard 的 Explain / Summarize / Translate 各自 prompt

每条 prompt 一两句话即可。例：
```
Summary.threeLine:
  "You are reading a research paper. Based on the following paragraphs,
   write exactly 3 sentences capturing the paper's core claims. Each
   sentence must stand alone and together cover: (a) main idea,
   (b) mechanism, (c) limitation."
```

没有这些，AI 输出的质量完全取决于实现者的 prompt 工程水平，review 时也无从对照。

---

## C. 仍未覆盖的细节

### C1. `Paragraph.section` 的 "所属 outline item" 取哪一层

§3.2 "`Paragraph.section` 字段...其值取所属 outline item 的 `label`"

"所属" = 最深层（和 `sectionId` 一致）还是 level-0？如果要与 `sectionId` 对齐（sectionId 取最深层），那 `section` 也应取最深层的 label。原型 `paper-data.jsx` 的行为是最深层（"2.1 Retrieval-augmented LMs"）。spec 可以直接写"`section = outline.find(o => o.id === sectionId).label`"消除歧义。

### C2. `chrome.storage.local` 额度下 Margin notes 数组的增长

`paper:{paperKey}:notes` 只增不减（§10 明确 v1 无删除入口）。假设单条 note 约 1-2 KB（含 source + body），用户长期使用 100+ notes 不是问题；但如果用户跨 50 篇论文 × 50 notes = 2500 条，总存储接近 chrome extension 的 10 MB 上限。v1 可以不管，但**建议在 §10 范围外加一句"v1 不做 note 级 eviction / 存储配额检查，若触发 chrome.storage 报错靠 console 暴露"**，提醒实现者不要默默吞错。

### C3. BYOK 未配置时 AI 操作的错误路径

§8.1 StatusRail 用 foxglove 紫点提示"BYOK 未配置"，但用户在这种状态下按 E/S/T / 打开 Summary 时的行为没写：
- 静默失败？
- 弹 toast "Please configure API key in Options"？
- 自动打开 Options 页？

prototype 没 AI 所以无参照。**建议在 §3.3 补一行**：
> 若 `chrome.storage.local` 的 `config.apiKey` 未设置，所有 AI 入口（E/S/T/Ask、Summary 自动生成、Chat 发送、CmdK 的 Summarize/Translate）一律 no-op 并在目标位置（margin note 位、SelectionResultCard、SummarySection、Chat 消息流）渲染一条带 "Configure API key →" 链接的错误条，点击跳 Options 页。

### C4. 多个高亮落在同一段时的渲染

原型 `paper-page.jsx:106`：`const hl = highlights.find(h => h.paragraphId === item.id)` — 只取首个匹配，多选只渲染第一条。

spec §3.3 存储结构 `{ paragraphId, text, color }[]` 没限制"每段至多一条"，但渲染规则没说。**建议在 §3.3 或 §8 补一段**：
- 同一 paragraph 上允许多条高亮；渲染时按 `highlights.filter(h => h.paragraphId === pid)`，逐条 `indexOf(text)` 再 wrap
- 两段高亮文本重叠时，v1 只保留先存的那一条（新的不生效，用户需先删旧高亮——但 v1 又没删除入口，所以这基本等于"用户不能撤销误选"，要同时补删除入口或接受这个限制）

### C5. 用户切换 `model` 后已缓存的 Summary 是否作废

用户在 Options 里把 `gpt-4.1-mini` 换成 `gpt-5-pro`，下次打开同一论文时：
- `paper:{paperKey}:summary:threeLine` 缓存里还是旧模型的结果
- ContextIndicator 显示的 `{model}` 是新模型，和缓存内容对不上

v1 做法没写。**最简处理**：在 §3.4 补一句"Summary 缓存 key 里包含 model 后缀：`paper:{paperKey}:summary:threeLine:{model}`；切模型自动隔离"。或者更宽松：换模型后保留旧缓存，只显示，用户手动点刷新按钮重新生成。挑一种说清楚。

### C6. §9.1 "v1 只有 Open Library + ⌘K 本身绑定全局 shortcut" 是事实错误

`viewer-app.jsx:51` 明摆着还有 `⌘\` toggle outline。外加 §8.1 StatusRail 文案也列了 `⌘\ outline`。把 `⌘\` 添进这句话即可：
> v1 只有 `Open Library`（⌘L）、`Toggle outline`（⌘\\）、`⌘K` 本身绑定全局 shortcut。`⌘\\` 因 "Toggle outline" 不是 CmdK 条目，所以不受 kbd 徽标规则影响。

### C7. Summary 触发时机：用户本来就在 Summary tab 上

§8.2 "若用户在 3s 内主动切到 Summary tab 并保持停留 300ms，立即提前触发"——这处理的是"切入"动作，但如果用户 `pf-variant = 'classic'` 且上次 tab 是 Summary，打开论文的第一瞬间用户就已经在 Summary tab，从未"切入"。3s 硬等没必要。

**建议改为**：
> 若 variant 是 Classic 且当前 tab 是 Summary（无论是通过持久化默认还是用户主动切入），300ms 停留后立即触发；否则等 3s 定时器。

### C8. `--walnut-deep` 与 light/dark 主题的关系

§3.6 "light / dark 两套主题各加一条"——但 `color-mix(in oklch, var(--walnut) 70%, var(--ink))` 这个公式在 light/dark 下会自动用对应的 `--walnut` / `--ink`，两套主题不需要分别写死。spec 可以简化为"在 tokens.css 根 token 里加一条 `--walnut-deep: color-mix(...)`，自动随主题变化"。

### C9. `Paragraph.section` "包含 Introduction" 的语义

§8.1 "`section` 字段包含 'Introduction' 的第一个段落" —— 大小写敏感？"1. Introduction" 可以；"introduction"、"INTRODUCTION"（有些 PDF 解析出来是全大写）可能不行。**建议**：匹配时用 `label.toLowerCase().includes('introduction')`。同样对 Chat suggestion 的黑名单关键词过滤规则已经"忽略大小写"（§8.2），Focus 默认 note 锚定也应该对齐。

---

## 总结

A1 / A2 是本轮引入的新矛盾，必须修——一个是 spec 自己前后不一致（section 字段定位），另一个是边界 case（level-0 outline 无直接段落）。

B1-B3 是 AI 集成的核心 contract。之前几轮聚焦在"UI 怎么长"、"数据怎么存"，这一轮需要把"怎么跟模型说话、怎么解析模型输出"也写死，否则实现者会自行发明一套，review 时没法对比。

C 组都是边角，不影响 v1 能不能跑，但写清楚可以减少一次 PR review round。

修完 A/B 后，spec 应该可以进入 `docs/plans/` 阶段做实现计划拆分。
