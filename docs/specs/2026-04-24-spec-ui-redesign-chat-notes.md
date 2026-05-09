# UI 改版：左侧常驻 Chat · 右侧 Overview/Note · 选区动作重构

**日期**：2026-04-24
**作者**：设计会话稿（Claude Code 辅助）
**范围**：`chrome-extension/reader/` 全量 UI 改版；Supabase schema 保持 JSONB、字段兼容
**关联**：取代 `docs/specs/2026-04-20-spec-chrome-extension.md` 里 §3.4（Outline panel）、§3.7（Abstract tab）、§3.8（Selection toolbar）几个小节的 UI 表述；对 `docs/specs/2026-04-24-spec-user-login.md` 的 notes 云同步规则做 `kind` 过滤扩展
**版本**：v1（一次性完整切换，无灰度）

---

## 0. 目标

把当前"右侧单 panel 聚合 Chat/Abstract/Memory"的 UI 重构为：

- **左侧常驻 Chat**，支持多 session（创建 / 切换 / 清空 / 历史抽屉），在 Classic / Summary / Canvas 三档统一常驻
- **右侧 Overview tab** 取代 Abstract tab：论文元信息 + 核心贡献（AI）+ 章节结构（可跳转）+ 关键词标签（AI）
- **新增 Note tab** 取代原"在 Abstract tab 里展示 SelectionResult 卡片"的路径：四个子 tab（高亮 / 笔记 / 解释 / 翻译）统一沉淀所有选区产出
- **Outline 面板下线**，章节结构嵌进 Overview
- **选区工具栏** 动作集：`Explain | Highlight | Note | Translate`（砍 Summarize、Ask；Ask 语义由"选区 → Chat 输入框自动 pin"替代）
- **Explain / Translate**：双写——Chat 出现 actionCard + AI 答；Note 对应子 tab 出现卡片；共享 `actionId` 做半联动跳转
- **Note**：只写 Note store；用户就地填写笔记
- **Highlight**：只写 Note store 的"高亮"子 tab

---

## 1. 布局总览

### 1.1 Shell 结构

三个变体（Classic / Summary / Canvas）共用同一外壳：

```
┌────────── TopBar ──────────┐
│ MigrationBanner             │
├──────┬────────────┬─────────┤
│ Chat │ Reader /   │ Right   │
│ Panel│ Summary /  │ Panel   │
│      │ Canvas     │         │
│ (可  │            │ (可拖宽 │
│ 拖宽 │            │  可隐藏)│
│ 可隐 │            │         │
│ 藏)  │            │         │
└──────┴────────────┴─────────┘
│ StatusRail                  │
└─────────────────────────────┘
```

两侧面板在三个变体下行为一致——**作为 flex 子元素占据布局空间**，不再是 canvas 下的 absolute 浮层。

### 1.2 隐藏 / 显示

- **左侧 Chat**：顶栏左侧新增一个"切 Chat"按钮；无默认快捷键
- **右侧面板**：保留现有 `⌘\` 快捷键（语义从"切 outline"改为"切右侧面板"；outline 已下线）
- 默认状态：Chat 默认显示，右侧面板默认显示

### 1.3 宽度

- Chat 面板：默认 360px，用户可拖拽左边界；上下限 280 ~ 520
- 右侧面板：保持现有 `activeWorkspaceWidth` 逻辑与默认值
- 持久化：各自独立 localStorage key

### 1.4 顶栏按钮改动

- 移除：切 Outline 按钮
- 新增：切 Chat 按钮（左起第一个 workspace 按钮）
- 保留：切右侧面板按钮（原 workspace toggle）、Library、变体切换器、CmdK 等
- **明确的从左到右顺序**：`[切 Chat] [切右侧面板] [Library] [变体切换] [CmdK] [Tweaks] [主题]`
  - 左起两个面板 toggle 按出现顺序对应物理位置（左面板 toggle 在左、右面板 toggle 居中），降低认知负担
  - `⌘\` 快捷键语义变更为"切右侧面板"。首次发布后用户首次加载 reader 时，若 `migrationVersion_260424_shortcut_toast` 为空，弹一次状态栏 toast "⌘\ 现在切换右侧面板（原 Outline 已下线）"，并持久化版本号 = 1

---

## 2. Chat 左侧面板（新）

### 2.1 视觉结构

**视觉层级规则（Pass 1 加入）**：消息流是主内容，必须占据面板绝大部分高度。Session tabs 视觉权重刻意压低；AI Assistant 欢迎横幅仅在空态出现。

```
消息流为空态（没有 active session 或 session 0 条消息）:
┌─ ChatPanel ────────────────────────────┐
│ [1] [2] [3]            [+] [✕] [⟳]     │  ← session tabs（高 32px、无背景、hairline 下边）
├────────────────────────────────────────┤
│                                        │
│   WelcomeCard（含 AI Assistant 标题、   │
│   建议 prompts — 复用现有设计）          │
│                                        │
├────────────────────────────────────────┤
│  ⟦"⟧ 已选中："xxx"             [x]       │
│  ┌──────────────────────────────┐      │
│  │ 输入框                        │      │
│  └──────────────────────────────┘      │
│                              [发送]    │
└────────────────────────────────────────┘

消息流非空态:
┌─ ChatPanel ────────────────────────────┐
│ [1] [2] [3] …           [+] [✕] [⟳]    │  ← 同上，AI Assistant 横幅已消失
├────────────────────────────────────────┤
│  消息流（ChatView）                     │
│    - actionCard + 紧跟 assistant 视觉   │
│      成对（共享 2px 左色条）             │
│    - 普通 user 气泡 / assistant md      │
├────────────────────────────────────────┤
│  📎 / 输入框 / [发送]                    │
└────────────────────────────────────────┘
```

**Session tabs 视觉规范（Pass 1 加入）**：
- 容器高 32px，背景 `transparent`，仅下边 0.5px `--rule` 分隔线
- 每个 tab：数字 seq，水平 padding 10px，无边框，无圆角背景
- active tab：文字 `--ink`，下方 1.5px `--walnut` 底线（紧贴容器下边）
- inactive tab：文字 `--ink-faded`，无任何 chrome；hover：文字变 `--ink`
- `+ / ✕ / ⟳` 图标按钮：18×18，hover 底色 `--paper-soft`，无文字 label
- 整行溢出时横向滚动条 auto-hide（`scrollbar-width: none`）

三个图标按钮（参照 Image #5）：
- `+` — 新建 session（按需创建：先乐观渲染新数字，首次发消息才持久化）
- `✕`（"clear"样式）— 清空当前 session 的所有消息，**保留 session 元信息**（seq/title 不变）
- `⟳`（历史钟表）— 展开历史抽屉（浮层）

### 2.2 Session 行为

| 行为 | 规则 |
|---|---|
| 内联标签显示 | 永远显示数字序号（1 / 2 / 3 …），不显示标题 |
| 溢出 | 不限数量，横向可滚动 |
| 标题生成 | 首条 user 消息前 30 字自动生成；用户可在历史抽屉里重命名 |
| 初次打开论文 | 不自动建 session；用户发第一条消息或触发选区动作时才建 |
| 清空当前 | 只清消息，session 元信息保留 |
| 历史抽屉删 | 元信息 + 消息都删；若删的是 active session，activeSessionId 回 null，UI 进空态 |
| 空态 | 没有 active session：ChatView 显示 WelcomeCard + 建议 prompts；第一条消息会自动触发创建 |

### 2.3 历史抽屉（ChatSessionHistory）

参照 Image #6 的组织结构：

```
┌─ CONVERSATIONS ─────────────────┐
│ [□] 首条消息前 30 字             │
│     2026-04-24 / 12:30           │
│                         [✎] [🗑] │  ← hover 显现
├─────────────────────────────────┤
│ [□] 另一个 session               │
│     2026-04-23                   │
└─────────────────────────────────┘
```

按 `updatedAt desc` 排序；点 item 切到该 session 并关抽屉；铅笔图标 = 原地重命名；垃圾桶 = 删除确认。

### 2.4 askPrefill 与选区联动

用户在 Reader 里选中文本：

- `PaperPage.onSelect(sel)` 触发：
  1. `setSelection(sel)` → `<SelectionToolbar>` 弹出
  2. `setAskPrefill(sel.text)` → Chat 输入框顶部自动出现"⟦"⟧ 已选中：..." chip（用 `I.Quote` SVG 图标，**禁止用 emoji 📎** — 见 §15 防 slop 规则）
- 用户点工具栏 Explain/Note/Translate → askPrefill 被 §4.1 流程清空
- 用户点工具栏 Highlight → askPrefill **保留**（highlight 不发送到 chat）
- 用户关工具栏 / 取消选区 → askPrefill 保留
- 用户点 pin chip 的 `x` → askPrefill 清空

### 2.5 actionCard 消息

`kind: 'actionCard'` 的 user 消息在 chat 流里的渲染，**与下一条 assistant 消息视觉成对**（共享 2px 左色条 — kind 色）：

```
╎ ┌─ [Explain · 第 1 页] ──────────────┐
╎ │ "The dominant sequence transduction │
╎ │  models are based on complex..."    │
╎ └─────────────────────────────────────┘
╎                                    
╎  AI assistant 回复 markdown…
╎                                    [→ Note]   ← 按钮延迟到 AI 流结束后出现
```

- 左侧 2px 色条（`--walnut` for explain / `--sky` for translate）同时盖 actionCard 和紧跟的 assistant 消息
- actionCard 本身：背景 `--paper-soft`，1px solid `--rule-soft`，圆角 6px
- 徽章 `[Explain · 第 1 页]`：kind 色文字，11px，letter-spacing 0.03em，uppercase
- 引文正文：13px italic，`--ink-soft`，最多 3 行 line-clamp
- `[→ Note]` 按钮在 AI 流 **结束后**再淡入（150ms fade），避免用户还在等回答时就看见"跳走"按钮；位置 = assistant 消息末尾右下角
- 孤儿 actionCard（note 已删）：`→ Note` 按钮不渲染

note 和 highlight kind 不出现在 chat，因此不会出现在 actionCard 渲染路径。

---

## 3. 右侧面板：Overview / Note / Memory

### 3.1 Tab 结构

```
┌─ WorkspacePanel ──────────────────┐
│ [Overview] [Note] [Memory]        │
├───────────────────────────────────┤
│  tab 内容                          │
└───────────────────────────────────┘
```

运行时 tab state 枚举：`'overview' | 'note' | 'memory'`。默认 tab：`'overview'`。

### 3.2 Overview Tab

**块顺序（Pass 1 决策：hierarchy as service — AI insight 最顶，参考数据最底）**：

1. 核心贡献（AI 生成，最重，用户进来 3 秒抢读的东西）
2. 章节结构（论文导航，用户进来可能点跳转）
3. 关键词（AI 生成，扫视辅助）
4. 论文信息（参考数据，像书的版权页，放最底）

> 注：原 spec 草稿的顺序是 信息→贡献→结构→关键词，因 hierarchy 评审决定改为贡献→结构→关键词→信息。下面子章节仍按原编号命名，但实际渲染顺序 = §3.2.2 → §3.2.3 → §3.2.4 → §3.2.1。

#### 3.2.1 论文信息（第 4 块渲染）

```
发表于       NeurIPS 2017
作者         Vaswani, A. 等 8 位
引用次数     47,892 次
研究领域     自然语言处理 / 深度学习
开放代码     GitHub 已开源
```

数据来源：
- `paper.title / authors / year / arxivId` — 已有字段，不翻译
- `OverviewMeta`（新存储）— 从 Semantic Scholar 懒加载
- 字段标签（发表于 / 作者 …）走 `t()` 支持多语言
- 任一字段缺失 → UI 显示 `—`；`codeUrl` 为空 → 不渲染"开放代码"这一行
- 没有 `arxivId`（本地 PDF）→ 只渲染 title/authors，OverviewMeta 跳过

**布局规则（Pass 7 加入）**：
- 两列 grid：label 列固定 80px 宽（中英两语都能容下最长 label "引用次数" / "Citations"）；value 列占剩余宽度
- label 超长 → 截断 + tooltip 显示完整 label
- 每行高 28px，垂直 gap 4px

#### 3.2.2 核心贡献（第 1 块渲染）

AI 生成的 3-5 条 bullet。独立于旧的 three-line/detailed（那两个被废弃）。

- 存储键：`overview_contributions_${paperKey}_${model}_${lang}`
- Prompt：`buildOverviewContributions(paper, lang)`，要求严格 bullet 输出
- 懒加载：Overview tab dwell 300ms 后触发（复用现有 dwell-timer 模式）
- 状态：loading / streaming / ready / error（同现有 SectionState）
- 切语言 → 下次查询 miss → 重新生成并覆盖缓存

#### 3.2.3 章节结构（第 2 块渲染）

```
1. Introduction                    p.1
2. Background                      p.2
3. Model Architecture              p.3
  3.1 Encoder and Decoder Stacks   p.3
  3.2 Attention                    p.3
  ...
4. Why Self-Attention              p.6
5. Training                        p.7
6. Results                         p.8
7. Conclusion                      p.10
```

- 数据来源：`paper.outline`（已有）
- 默认一级展开，二级折叠；点击二级可展开；再点收起
- 点任意 item 触发跳转：复用现有 `scrollToOutlineItem(item, effectivePaper)` 逻辑
- section label 不翻译（原文显示）

#### 3.2.4 关键词标签（第 3 块渲染）

扁平的 chip 列表（和旧 keyTerms 的"term :: definition"不同——新版只要名字，不带定义）：

- 存储键：`overview_keywords_${paperKey}_${model}_${lang}`
- Prompt：`buildOverviewKeywords(paper, lang)`，要求 6-12 个简短 tag，换行分隔
- 点击 chip：无操作（v1 不做）；未来可加"按关键词搜相关论文"

### 3.3 Note Tab

```
┌─ Note ────────────────────────────┐
│ [解释 1] [高亮 3] [笔记 2] [翻译 0]│  ← 子 tab + 计数 chip
├───────────────────────────────────┤
│                                   │
│  NoteCard 列表（按 createdAt desc）│
│                                   │
└───────────────────────────────────┘
```

#### 3.3.1 子 tab

4 个（和 4 种 kind 一一对应，Q4-A）。计数 chip = 该 kind 的 note 条数。

**顺序（Pass 1 决策 — 与 SelectionToolbar §4.1 一致）**：`解释 | 高亮 | 笔记 | 翻译`（对应 kind `explain | highlight | note | translate`）。用户在工具栏最左点 Explain，切到 Note tab 就在最左子 tab 找到卡片，没有"第几个"的记忆成本。

**默认子 tab（Pass 1 加入）**：首次进 Note tab，以"最近一次有写入的 kind"为默认；全库为空 → 默认 `解释`。规则：
```
defaultKind = notes 中 updatedAt 最大的那条的 kind；若 notes 为空则 'explain'
```
本次会话内手动切过子 tab → 持久化 `note_activeSubtab_${paperKey}`，下次优先用该值。

**计数 chip = 0 态**：仍可点击（进入对应空态）；chip 文字 `--ink-faded`，count 数字颜色亮度下降但不隐藏。

#### 3.3.2 NoteCard（按 kind 分支 layout — Pass 1 决策）

不再用"统一 layout + 内容区"模板。按 kind 分成两组 layout：

**Layout A — 主内容在上，引文作小字注脚**（用于 `note` / `explain` / `translate`）：

```
╎ ┌─────────────────────────────────────┐
╎ │ [主内容区]                          │  ← 14px --ink，正常行高
╎ │ - explain/translate: AI 答 markdown │
╎ │ - note: 用户笔记正文 markdown        │
╎ │                                     │
╎ │ ─────────────────                   │  ← 0.5px --rule-soft
╎ │ “选中原文（最多 2 行 truncate）…”    │  ← 12px italic --ink-faded
╎ │                                     │
╎ │ 第 1 页         04-24 12:30  [→ Chat]│  ← footer 11px --ink-faded
╎ └─────────────────────────────────────┘
```

**Layout B — 引文为主**（用于 `highlight`）：

```
╎ ┌─────────────────────────────────────┐
╎ │ “选中原文（可展开 / 多行）”          │  ← 14px --ink，正常行高
╎ │                                     │
╎ │ 第 1 页                 04-24 12:30 │  ← footer 11px --ink-faded
╎ └─────────────────────────────────────┘
```

**通用规则**：
- 卡片左侧 2px 窄色条按 kind 区分：`explain=--walnut`、`highlight=--walnut-soft`（Pass 6 校正：原拟 `--ink-highlight` 在 `--paper` 上对比不足 1.6:1，色条会透明；`--walnut-soft` #B5935F 对比 3.6:1 满足 WCAG AA）、`note=--forest`、`translate=--sky`
- 引文 truncate 行数：Layout A = 2 行；Layout B = 默认 3 行、点击展开全文
- `[→ Chat]` 按钮：hover 显现，仅 `chatSessionId` 有效时；孤儿 note 显示灰态按钮 + tooltip "原对话已删除"（§6.3 已定义）

**卡片交互态**（Pass 2 将补完 spec）：
- rest：背景 `--paper`，0.5px `--rule-soft` 外边
- hover：背景 `--paper-soft`，`[→ Chat]` 和其他 hover-only 控件淡入
- focus（键盘 Tab）：2px `--walnut` 聚焦环，offset 2px
- 作为 chat→note 跳转目标时：`flash highlight 600ms` — 背景短暂 pulse 到 `--walnut-soft` 再衰减
- 编辑中（仅 `note` kind）：2px solid `--walnut` 边框，textarea 替代 markdown 渲染

同一段原文被多次操作（先高亮、后解释）= 多张独立卡片（Q4 选②）。

#### 3.3.3 "笔记"动作的就地编辑器

点选区工具栏"笔记" → 不走 AI，而是弹出 `<NoteEditorPopover>` 在选区附近：

```
┌────────────────────────┐
│ 笔记                    │
│ ┌────────────────────┐ │
│ │ (textarea)         │ │
│ │                    │ │
│ └────────────────────┘ │
│          [取消] [保存]  │
└────────────────────────┘
```

保存后：`notes.upsert({ id, kind:'note', quote, loc, userText, createdAt })`；**不写 chat**。后续用户可在 Note tab 的"笔记"子 tab 里点卡片再次编辑。

### 3.4 Memory Tab

保留现状，无改动（Q10-c1）。

---

## 4. 选区工具栏（SelectionToolbar）

### 4.1 动作集

从 5 → 4：

**旧**：`explain | summarize | translate | highlight | ask`（键位 E/S/T/H/?）
**新**：`explain | highlight | note | translate`（顺序按用户需求 §4：解释 / 高亮 / 笔记 / 翻译）

| 动作 | 键位 | 备注 |
|---|---|---|
| Explain | `E` | 沿用 |
| Highlight | `H` | 沿用 |
| Note | `N` | **Pass 6 新增** — Note 首字母 |
| Translate | `T` | 沿用 |

`summarize`（旧 `S` 键）彻底砍，无替代（Q5）。
`ask`（旧 `?` 键）语义被"选中 → Chat 输入框自动 pin"替代（Q5-D + §2.4）。

`S` / `?` 键位**永久弃用**：用户按下时 toolbar 不响应、不报错（防止指头肌肉记忆触发不可见动作）。

### 4.A 删除 + 5 秒 Undo（Pass 7 加入）

Chat session 和 Note 卡片的删除使用同一交互模式：**hard delete + StatusRail toast undo**，因为这两类对象都可能代表用户长时间投入的内容（5 小时对话、详细笔记），不能让单次误点摧毁。

**触发入口**：
- Chat session：历史抽屉行 hover → 右侧 `[🗑]` 图标按钮（§2.3 已 spec'd）
- Note 卡片：卡片 hover → 卡片右上角 `[×]` 图标按钮（**Pass 7 新增**：spec 原稿没说删除入口）；图标 14px，padding 9px，hit area 32×32

**点击流**：
1. 立即从 UI 移除（乐观 — 用户感觉立刻成了）
2. 立即从 storage 删除（持久化）
3. StatusRail 出 toast：`已删除 [对话 #2] · [撤销]`（i18n key `delete.undoToast`）
4. 5 秒倒计时 — toast 右侧细线条进度
5. 用户点 `[撤销]` → 从 in-memory snapshot 恢复 → 重新写 storage → toast 立即消失
6. 倒计时结束 / 用户切论文 → toast 消失，撤销不可用

**snapshot 实现**：删除前把整个对象序列化进 `lastDeleted_${kind}` in-memory 变量（不持久化，刷新即丢，但用户 5 秒内不会刷新）；新一次删除覆盖前一次的 snapshot。多次连删只能撤销最后一次。

**特殊情况**：
- 删 active chat session → activeSessionId 回 null + ChatView 进空态；撤销 → 恢复且自动 re-activate 回原 session
- 删 active 子 tab 的最后一条 note → 子 tab 进空态；撤销 → 恢复
- 删除时 AI 流式正在输出（NoteCard kind=explain） → 先 abort fetch，再删；撤销 → snapshot 含 `aiAnswer:''` 状态，restore 后用户可重试

i18n 字串：
- `delete.toast.session` = "已删除对话 · [撤销]"
- `delete.toast.note` = "已删除 · [撤销]"
- `delete.toast.dismiss` = "撤销不可用" (5 秒过后浮出再淡，弱反馈)

### 4.2 高亮动作细节

- 单色（v1）；**复用 `tokens.css` 现有的 `--ink-highlight: #E8D385`**（Pass 5 校正：原 spec 草稿漏看了这个已存在的 token，不再新增 `--highlight-yellow-bg`）
- 正文高亮底色：`rgba(232, 211, 133, 0.45)`（`--ink-highlight` 叠 45% alpha 得到柔和纸页感）；hover 到 0.55；选中 0.65
- 不走 chat，不走 AI
- 持久化：复用现有 `Highlight` 类型 + `lib/highlight-ranges.ts`；Note store 里同步写一条 `kind:'highlight'`（以 Note 为主视图，highlight-ranges 负责正文渲染）
- 用户在 Note tab 的"高亮"子 tab 里删除 → 同步删除 `Highlight` 记录 → 正文中高亮也消失

---

## 4.3 状态规范（Pass 2 加入）

全 spec 涉及 14 个表面 × 4 类状态 = 32 个视觉态。不能让实现者自由发挥，否则每个表面会出一种"No items found."。

### 4.3.1 通用态视觉令牌

| 态 | 视觉规则 |
|---|---|
| **loading** | `ink-streaming` 光标动画用于流式内容；非流式用 `--ink-ghost` 文字 + 脉冲透明度 1600ms 循环；**不用 spinner** |
| **empty** | 温暖空态 — 1-2 行叙事文案（`--ink-faded` 14px）+ 一个主 CTA 按钮或建议操作；**不写 "No items found"** |
| **error** | 背景 `--foxglove-soft`，文字 `--foxglove`，含"重试"按钮；**不用红色×图标**（太刺眼） |
| **partial** | 缺失字段用 `—`（`--ink-ghost`）；不折叠整块 |

### 4.3.2 ChatPanel · 状态

| 态 | 视觉 |
|---|---|
| 无 active session | 不渲染 session tabs 下方的消息流；中央区 `WelcomeCard` — 复用现有 chat-view 的 `WelcomeCard` + `suggestionSet(paper)`（3 个 suggestion：`What's the core mechanism of §…?` / `How does this compare to prior work?` / `Where does it fail?`）+ 下方一行 `--ink-faded` 12px 文案："也可以在正文里选中一段，用工具栏的 Explain。" 输入框和底部 pin chip 仍可用（一发消息自动建 session） |
| 有 active session、0 消息（清空后） | 同上中央区，但隐藏"也可以..."一行 — 用户已经会用了；suggestions 依然显示 |
| streaming 中 | 最后一条 assistant 消息末尾显示 `ink-streaming` 光标；输入框 disabled（灰 `--ink-faded`，`cursor: not-allowed`）；`[发送]` 按钮文字变"停止"（v1：点停止 = abort fetch + 保留已流出的部分） |
| AI 失败 | assistant 消息变成 `error` 态卡片：`--foxglove-soft` 背景、`--foxglove` 文字"⊕ AI 回复失败"，下方 `[重试]` 按钮。失败卡片与 actionCard 通过 `actionId` 联动 — Note tab 对应卡片也进 error 态（§4.3.5） |
| 输入框校验失败（空提交、太长） | 不 toast，输入框下 0.5 行 `--foxglove` 12px 文字提示；聚焦输入框后消失 |

### 4.3.3 ChatSessionHistory 抽屉 · 状态

| 态 | 视觉 |
|---|---|
| 0 会话 | 抽屉中央："还没有对话历史。" + 再下一行 12px 建议"问问这篇论文试试。"（`--ink-faded`）— 不放 CTA 按钮（用户关抽屉回到 input 即可） |
| 1+ 会话 | 列表（§2.3 已设计） |
| 删除确认 | 行内替换为 `—— 删除此对话？[取消] [删除]` 而非 modal；避免弹窗 |

### 4.3.4 Overview tab · 状态

| 区块 | loading | empty | error |
|---|---|---|---|
| 论文信息 | Semantic Scholar 抓取中：已知字段正常显示，未知字段 `…` `--ink-ghost` 脉冲；抓完替换 | 本地 PDF 无 arxivId：只显 title/authors，其他行整体隐藏（不要留一堆 `—`） | Semantic Scholar 404 / rate limit：未知字段 `—`，不显错误 banner（非关键数据，静默降级） |
| 核心贡献 | skeleton：3 条 14px 灰条（`--rule-soft`）宽度随机，之后被 streaming 文字逐步替换 | 不可能 empty（AI 会强制 bullet 输出） | `--foxglove-soft` 卡片"生成失败 · 重试"；下面不保留旧缓存残留 |
| 章节结构 | 无 loading（`paper.outline` 在 paper load 时已就绪） | `paper.outline` 为空（本地 PDF）：整块不渲染；标题"Contents" 也不显示 | n/a |
| 关键词 | 同核心贡献 skeleton（6 个 14px chip 宽度占位） | 不可能 empty | 同核心贡献 error |

### 4.3.5 Note tab · 状态

| 态 | 视觉 |
|---|---|
| 子 tab count = 0 | 子 tab chip 可点，进入该 kind 后，列表中央显示温暖空态：<br>• 解释：`"还没解释过任何段落。"` + 14px CTA `"在正文里选中一段，用 Explain"`<br>• 高亮：`"还没高亮过文字。"` + `"双击 H 或用工具栏的高亮"`<br>• 笔记：`"还没写过笔记。"` + `"选中文字，用工具栏的 Note"`<br>• 翻译：`"还没翻译过段落。"` + `"选中文字，用工具栏的 Translate"` |
| 全库 0（所有 kind 都空） | 默认停在"解释"子 tab，展示该 kind 的空态（§3.3.1 默认子 tab 规则） |
| AI 失败（kind=explain/translate 的 NoteCard） | Layout A 的主内容区被替换为 error 卡片（`--foxglove-soft` 背景、`--foxglove` 文字"⊕ AI 回复失败"），下方 `[重试]` 按钮；引文脚注和 footer 保持；重试成功后卡片正常化 |
| 孤儿 note（session 已删） | `[→ Chat]` 按钮灰态 + tooltip "原对话已删除"（§6.3 已定义） |
| 编辑中（kind=note） | 卡片边框变 2px solid `--walnut`；主内容区 markdown render 被替换为 textarea；footer 出现 `[取消] [保存]` 按钮 |

### 4.3.6 NoteEditorPopover · 状态

| 态 | 视觉 |
|---|---|
| idle | textarea 自动聚焦；placeholder "写下你的笔记…"（`--ink-ghost`） |
| saving（短暂） | `[保存]` 按钮文字变 "保存中…" + 禁用；一般 < 50ms |
| 存储失败（空间满 / 权限） | 按钮下方 1 行 `--foxglove` 12px 错误"保存失败：本地存储已满"；不关闭 popover，用户可复制文本留痕 |

### 4.3.7 SelectionToolbar · 状态

| 态 | 视觉 |
|---|---|
| BYOK 未配置 + 配额未超 | 4 个按钮全部可点（Pass 2-B 决策）；点 Explain/Translate 时触发现有的"API key not configured" 错误流（§329 的现有规则，toast + CTA 链接 Options） |
| BYOK 配但 Free tier 配额已耗尽 | 同上，按钮可点；点 Explain/Translate 弹 `QuotaChip` 现有 upgrade-prompt 流 |
| 正文空选区（应该不可能到达此组件，但防守） | `selection` 为空时 `<SelectionToolbar>` 直接 return null（§1 已有） |
| 加载 Ranges 失败（选区跨复杂 DOM） | toolbar 不出现，不 toast（现有 `PaperPage.onSelect` 静默处理） |

### 4.3.8 MigrationBanner · 状态（迁移相关）

spec §10 的 3 次迁移只在第一次 reader 启动时跑，用户看不见过程。**MigrationBanner 现有行为保留**，不为 `shortcut_toast` 或 `drop_abstract` 额外出 banner（太吵）。只有 `chat_sessions` 迁移若失败（步骤 A 抛异常），走现有 `MigrationBanner` 的错误态。

---

## 5. 数据模型

### 5.1 存储键

```ts
// lib/storage-schema.ts 新增 / 修改：

// Chat sessions（per paper）
chatSessions_${paperKey}                     // ChatSession[]
chatSessionMessages_${paperKey}_${sid}       // ChatMessage[]
activeChatSession_${paperKey}                // string | null

// Notes（per paper）
notes_${paperKey}                            // Note[]

// Overview（per paper × model × lang）
overview_contributions_${paperKey}_${model}_${lang}   // string (markdown)
overview_keywords_${paperKey}_${model}_${lang}        // string (换行分隔的 tag 列表)
overviewMeta_${paperKey}                              // OverviewMeta

// 迁移版本号
migrationVersion_260424_chat_sessions_${paperKey}     // 1 once done
migrationVersion_260424_drop_abstract                 // global, 1 once done
migrationVersion_260501_cleanup_legacy_chat           // global, 1 once done（延迟清理）

// 删除
chat_${paperKey}                             // 旧 chat 扁平列表，延迟 7 天后彻底清
summary_threeLine_*                          // Abstract tab 缓存，立即清
summary_detailed_*                           // 同上
summary_keyTerms_*                           // 同上
```

### 5.2 类型定义

```ts
// types.ts 新增：

export interface ChatSession {
  id: string;
  seq: number;                   // 创建序号，内联标签用
  title: string;                 // 首条 user 消息前 30 字；可改
  createdAt: number;             // Unix ms
  updatedAt: number;             // Unix ms
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  kind?: 'actionCard';           // 新：来自选区动作的 user 消息
  action?: {
    kind: 'explain' | 'translate';  // note/highlight 不写 chat，因此不出现在 action.kind
    actionId: string;
    quote: string;
    loc?: { page?: number; paragraph?: number };
  };
  text: string;
  citations?: Citation[];
  createdAt: number;             // Unix ms
}

export interface Note {
  id: string;                    // = 对应的 actionId（explain/translate/note 由选区动作创建时）；highlight 独立生成
  kind: 'highlight' | 'note' | 'explain' | 'translate';
  quote: string;
  loc: { page?: number; paragraph?: number; charRange?: [number, number] };
  color?: string;                // highlight 专用，v1 单色（字段预留）
  aiAnswer?: string;             // explain / translate 专用
  userText?: string;             // note 专用
  chatSessionId?: string;
  chatMessageId?: string;
  createdAt: number;             // Unix ms
  updatedAt: number;             // Unix ms
}

export interface OverviewMeta {
  venue?: string;
  citations?: number;
  codeUrl?: string;
  field?: string;
  fetchedAt: number;             // Unix ms, 7 天 TTL
}
```

### 5.3 云同步（Supabase 表，Pass 5 修正）

> **校正**：本节原稿写"`papers.notes` (JSONB)"是错的 — user-login spec 实际定义了独立表 `margin_notes`。下面文字按真实 schema 写。

- **`margin_notes` 表（独立表）**：扩展 `kind` CHECK 约束（见下"Schema 迁移"），同步 `kind in ('note', 'highlight')` 的条目；AI 产出（`'explain'` / `'translate'`）**不上云**（流量大、对设备同步价值低，留本地）
- **`highlights` 表**：现有，保留；与 `margin_notes` 里 `kind='highlight'` 保持一致性（写入时双写，读取时以 `margin_notes` 为准。`highlights` 表负责正文 Range 恢复，`margin_notes` 负责 Note tab 列表视图）
- Chat sessions / messages — **纯本地**，不上云
- Overview AI 段（contributions / keywords） — **纯本地**，不上云
- OverviewMeta（Semantic Scholar） — **纯本地**，7 天 TTL

**Schema 迁移（Pass 5 决策 — 必做）**：

```sql
-- 在 user-login spec 的 margin_notes 表上做：
alter table margin_notes
  drop constraint margin_notes_kind_check;

alter table margin_notes
  add constraint margin_notes_kind_check
    check (kind in ('explain','summarize','translate','ask','note','highlight'));
```

- 保留 `'summarize'` 和 `'ask'`（已废弃但老记录可能存在，不破坏老数据）
- 加 `'note'` 和 `'highlight'`（本 spec 新增的 kind）
- 这条 ALTER 在 supabase 迁移里加一个新 migration 文件（命名 `20260424_extend_margin_notes_kind.sql`），与本 spec 的代码改动一起 land

**`sync-queue` 层 predicate 扩展**（user-login spec §14 已指）：写入时按 `kind in ('note','highlight')` 过滤；其它 kind 的 note 留本地。

**读取兼容**：`margin_notes` 里**缺 `kind` 字段**的老条目（不可能 — 列是 NOT NULL），不会出现；不过本地 Note store 里若读到旧 schema 的对象（不带 kind），默认 `kind='note'`。

---

## 6. 关键状态流

### 6.1 选区动作 → 双写（方案 A）

```
用户点 Explain 按钮
    ↓
runSelectionAction('explain', sel, currentSessionId?)   // lib/selection-actions.ts
    ↓
1. actionId = crypto.randomUUID()
2. 如 sessionId 缺：sid = chatSessions.createAndActivate()
3. 写 chat：
     userMsg = { kind:'actionCard', action:{kind:'explain', actionId, quote, loc} }
     assistantPending = { role:'assistant', id: assistantId, text:'' }
     appendChatMessage(paper, sid, userMsg)
     appendChatMessage(paper, sid, assistantPending)
4. 写 note：
     notes.upsert({ id: actionId, kind:'explain', quote, loc,
                    chatSessionId: sid, chatMessageId: assistantId, aiAnswer: '' })
5. callAI('explain', buildExplainMessages) + onChunk
     - 每个 chunk: setChatMessages(patch assistant text)
     - 完成: finalize assistant + notes.patch(actionId, { aiAnswer: final })
     - 失败: assistant 改错误态；note 保留 aiAnswer:''，用户可从 Note tab 重试
6. 清空 askPrefill
```

**translate** 同上，prompt 换 `buildTranslateMessages`。

**note**：只执行步骤 1（生成 `actionId`），跳过步骤 2-3（**不创建 chat session，不写 chat**），改为就地弹 `<NoteEditorPopover>`；用户保存时执行步骤 4 的 note upsert（`kind:'note'`, `userText` 非空，`chatSessionId` / `chatMessageId` 留空），跳过步骤 5（不走 AI）。步骤 6 清空 askPrefill。

**highlight**：只执行步骤 1（生成 `actionId`），跳过步骤 2-3、5-6，只做步骤 4 的 note upsert（`kind:'highlight'`, `chatSessionId` / `chatMessageId` 留空）+ 同步写入 `Highlight` 记录（参照 §4.2）。askPrefill 保留不清空。

### 6.2 Session 切换

```
ChatSessionTabs 点击某个数字
    ↓
setActiveChatSession(sid) + 持久化 activeChatSession_${paperKey}
    ↓
chat-panel 监听 activeSessionId 变化：
    - loadChatSessionMessages(paper, sid) → setChatMessages
    - 清空 askPrefill
```

### 6.3 Chat ↔ Note 跳转（③ 半联动）

Chat actionCard 上"→ Note"按钮：
```
navigate('note', { actionId })
    ↓
    setTab('note')
    setNoteKind(action.kind)
    scrollTo(actionId) + flash highlight 600ms
```

Note 卡片"→ Chat"按钮（仅当 `chatSessionId` 有效时显示）：
```
ensureChatOpen()
setActiveChatSession(note.chatSessionId)
scrollTo(note.chatMessageId) + flash highlight 600ms
```

孤儿 note（session 已删）：按钮灰态 + tooltip "原对话已删除"。

### 6.4 AI 失败的 note 重试

Note tab 卡片上 `aiAnswer === ''` 显示"重试"按钮：
```
点击 → 重跑 §6.1 的第 5 步（callAI），补上 aiAnswer
chat 里对应的 assistantMsg 同步更新
```

### 6.5 回访连续性（Pass 3 加入）

用户回到一篇之前读过的论文，应该感受到"扩展记得我"。

**新增持久化键**：

```ts
// lib/storage-schema.ts 新增：
workspace_tab_${paperKey}                 // 'overview' | 'note' | 'memory'
paper_scroll_${paperKey}                  // number | null（pixel offset）
last_visit_${paperKey}                    // number | null（Unix ms）
```

**恢复流程**（reader 启动后、UI mount 前执行 `runRestoreContext_260424()`）：

| 步骤 | 行为 |
|---|---|
| 1. 读 `workspace_tab_${paperKey}` | 命中 → 设置 active tab；缺省 → `'overview'`（首次） |
| 2. 读 `paper_scroll_${paperKey}` | 命中 → mount 后 `requestAnimationFrame(2x)` 内 scrollTo；缺省 → 顶部 |
| 3. 读 `note_activeSubtab_${paperKey}` | （Pass 1 §3.3.1 已加）；恢复 Note tab 内子 tab |
| 4. 读 `activeChatSession_${paperKey}` | （§5.1 已存在）；恢复 active chat session |
| 5. 计算"上次足迹" | `count(notes_*)`、`count(highlights)`、`chatSessions_*.length`；若都为 0 → 跳过；任一 > 0 且 `last_visit_${pk}` 非空 → 触发 ghost rail |
| 6. 写新 `last_visit_${paperKey}` | `Date.now()`，下次回访作对比 |

**Ghost StatusRail**（StatusRail 现有组件扩展）：

- 触发条件：步骤 5 命中
- 文案模板（i18n）：`"上次：{n} 条笔记 · {h} 处高亮 · {c} 个对话"`（任一计数为 0 时省略该子句；全 0 不触发）
- 视觉：`--ink-faded` 12px，左侧 0.8em sparkle 图标（复用 `I.Sparkle`）；右侧 auto `[×]` 关闭按钮
- 动效：mount 时 fade-in 200ms；停留 10s 后 auto fade-out 600ms；用户主动关 / 切 tab → 立即消失
- 存储位置：StatusRail 现有的 `transientItem` 槽位（不创建新槽）

**写入时机**：
- `workspace_tab_*`：tab 切换时 debounced 200ms 写入
- `paper_scroll_*`：正文容器 scroll 时 debounced 1000ms 写入；切论文时 flush
- `last_visit_*`：reader unmount 时一次写入

**降级**：任一 key 缺失或 JSON parse 失败 → 当作"首次"处理，不报错。

### 6.6 AI 水印（Pass 3 加入）

所有 AI 生成的内容块在角落显示 11px `--ink-faded` 来源标签，让用户始终知道"这是 AI 写的，不是论文原文"。

| 位置 | 文案 |
|---|---|
| Overview · 核心贡献 区块标题右侧 | `AI · {model}` 例如 `AI · gpt-4o-mini` |
| Overview · 关键词 区块标题右侧 | 同上 |
| NoteCard kind=`explain`/`translate` 主内容区底部 | `AI · {model} · {YYYY-MM-DD}` |
| Chat actionCard 紧跟的 assistant 消息底部 | 已有 chat 消息时间戳格式不变 |

水印**必须显示**，即使空间紧张；不允许折叠成 `[i]` 图标 — 这是诚信问题，不是装饰。

### 6.7 ActionCard 首次提示（Pass 3 加入）

用户**首次**触发选区动作（`migrationVersion_260424_actionCard_hint` 为空）→ 在 chat 出现的第一条 actionCard **下方**叠一行 12px `--ink-faded` 注脚（持续可见，不淡出）：

> 「选区动作会自动引用原文，可在 Note tab 回看。」

用户点击注脚右侧的 `[知道了]` → 持久化版本号 = 1，再不出现。10 秒无操作 → 自动消失（仍然写持久化）。

---

## 7. 组件清单

### 7.1 新增

```
chrome-extension/reader/components/
├── chat-panel.tsx                   # 左侧外壳
├── chat-session-tabs.tsx            # 顶部 session 标签条
├── chat-session-history.tsx         # 历史抽屉
├── overview-view.tsx                # 右侧 Overview tab 根
├── overview-paper-info.tsx          # 论文信息卡
├── overview-outline.tsx             # 章节结构
├── overview-contributions.tsx       # 核心贡献
├── overview-keywords.tsx            # 关键词标签
├── note-view.tsx                    # 右侧 Note tab 根
├── note-card.tsx                    # 统一 4-kind NoteCard
└── note-editor-popover.tsx          # 选区笔记编辑器

chrome-extension/reader/lib/
├── chat-sessions.ts                 # Session CRUD
├── notes.ts                         # Note CRUD
├── selection-actions.ts             # runSelectionAction 统一入口
├── overview.ts                      # AI 段生成 + prompt builders
└── semantic-scholar.ts              # 外部元数据抓取
```

### 7.2 修改

| 文件 | 变动 |
|---|---|
| `main.tsx` | Shell 重构为 `[Chat][Main][Right]`；runAction → 走 `runSelectionAction`；state 加 sessions/activeSessionId；outlineOpen 删；tab 枚举改 `'overview' \| 'note' \| 'memory'`；默认 tab `'overview'` |
| `components/workspace-panel.tsx` | tab 列 = `Overview \| Note \| Memory`；props 删 chat 相关（askPrefill / chatMessages / onChatSend / onDismissAskPrefill / summaryState / onSummaryRefreshAll） |
| `components/chat-view.tsx` | 新增 `actionCard` 消息类型渲染分支；ChatView 移出 WorkspacePanel，放进新 ChatPanel |
| `components/selection-toolbar.tsx` | 动作枚举改 4 个；顺序按用户需求 |
| `components/top-bar.tsx` | 新增"切 Chat"按钮；删"切 Outline"按钮；`⌘\` 重新绑定到"切右侧面板" |
| `lib/ai.ts` | 新增 `buildOverviewContributions / buildOverviewKeywords / buildExplainMessages / buildTranslateMessages`（如已有则复用）；保持 `callAI(kind)` 入口 |
| `lib/storage.ts` | 加 `getChatSessions / setChatSessions / getChatSessionMessages / appendChatSessionMessage / getNotes / setNotes / getOverviewSection / setOverviewSection / getOverviewMeta / setOverviewMeta` 等 |
| `lib/storage-schema.ts` | 新增 key 定义 |
| `lib/i18n.ts` | 新增 UI 字串 key（`tabs.overview/note/memory`、`chat.clear/new/history`、`note.kinds.*` 等）；沿用现有查表机制 |

### 7.3 删除

| 文件 | 原因 |
|---|---|
| `components/abstract-view.tsx` | 被 overview-view 取代 |
| `components/outline-panel.tsx` | Outline 下线 |
| `components/margin-column.tsx` | 旧 focus 变体残留，已不可达 |
| `components/margin-note.tsx` | 同上 |
| `components/selection-result-card.tsx` | 统一由 note-card 承担 |

**Pass 5 加入：删除前抢救** — 这些文件里有可复用片段，**删除前必须抽出**：

| 来源 | 抽到 | 用途 |
|---|---|---|
| `outline-panel.tsx` 的 `scrollToOutlineItem(item, paper)` | `lib/scroll-to-outline.ts` | §3.2.3 章节结构点击跳转 |
| `selection-result-card.tsx` 的 quote/footer DOM 结构 | `note-card.tsx` Layout B 起点 | NoteCard kind=highlight 的引文卡片复用既有结构，避免从零写 |
| `abstract-view.tsx` 的 `SectionState` loading/streaming/ready/error 状态机 | `lib/section-state.ts` 或保留在 `overview-contributions.tsx` 内 | §3.2.2 / §3.2.4 复用 |
| `margin-note.tsx` 的 `ink-streaming` 光标 CSS class（若是组件内 inline） | 移到 `styles/ink-animations.css`（若不在那） | Pass 2 §4.3.2 chat streaming + Overview contributions skeleton 都要用 |

实现顺序：先 commit "抽公共代码"，再 commit "删除旧组件"，避免一次性删除导致需要回头找代码。

**Pass 5 加入：组件复用机会**（§7.2 修改清单的补充）—

| 组件 | 在新表面复用方式 |
|---|---|
| `chat-view.tsx` 内的 `WelcomeCard` + `suggestionSet(paper)` | 直接抽到 `chat-panel.tsx`，用于 Pass 2 §4.3.2 空态 |
| `chat-view.tsx` 内的 `Composer` | 同上 |
| `markdown.tsx` `MarkdownBody` + `buildCitationMap` | NoteCard Layout A 主内容区的 explain/translate/note 渲染 |
| `migration-banner.tsx` | Pass 2 §4.3.8 错误态复用 |
| `quota-chip.tsx` + `upgrade-prompt.tsx` | Pass 2 §4.3.7 BYOK / 配额错误流 |
| `status-rail.tsx` 现有 `transientItem` 槽位 | Pass 3 §6.5 ghost rail 显示 |

---

## 8. i18n

### 8.1 覆盖范围

| 内容 | 策略 |
|---|---|
| UI chrome（tab / 按钮 / toast / sub-tab 标题） | `t()` 查表 |
| AI 生成内容（contributions, keywords, explain/translate 答, session 标题） | Prompt 注入 `outputLanguage`；缓存键带 lang；切语言→下次生成时重建 |
| 原文 / 结构化字段（title, authors, quote, arxivId, 页码, 时间戳） | 不翻译 |

### 8.2 翻译动作的目标语言

- 默认目标 = `config.outputLanguage`
- v1 不支持"点按钮时选目标语言"子菜单

### 8.3 Overview 缓存失效

- 切语言 → 下次读 `overview_contributions_${pk}_${model}_${newLang}`，miss → 自动重生成
- 不主动清旧语言缓存（用户切回 zh 时直接命中）

---

## 9. 懒加载与触发时机

| 数据 | 触发 |
|---|---|
| Overview contributions / keywords | 右侧 tab 切到 `overview` 并 dwell 300ms（复用 main.tsx:526 的模式） |
| Semantic Scholar meta | 右侧 tab 切到 `overview` 时触发（不 dwell），有 7 天 TTL；失败不 retry，显示 `—` |
| Chat session 的消息 | 切到该 session 时惰性加载（一次性读完，session 长度可预期为小） |
| Note 列表 | tab 切到 `note` 时一次性加载整个 `notes_${paperKey}` |

---

## 10. 迁移与回滚

### 10.1 一次性迁移（reader 启动时）

在 `main.tsx` paper 载入后、UI 渲染前执行 `runMigrations_260424()`：

**步骤 A — Chat 扁平历史 → Sessions**（per paper，有版本号防重）
```
读 chat_${paperKey}；若非空：
  sid = randomUUID, seq = 1
  title = 首条 user 消息前 30 字，无则 "原对话"
  写 chatSessions_${paperKey} = [{ id:sid, seq:1, title, createdAt, updatedAt }]
  写 chatSessionMessages_${paperKey}_${sid} = 旧消息数组
  写 activeChatSession_${paperKey} = sid
  标记 migrationVersion_260424_chat_sessions_${paperKey} = 1
  // 不删旧键 chat_${paperKey}，留给 §10.3 延迟清理
```

**步骤 B — Abstract 缓存清理**（global，一次）
```
扫描 keys 匹配 /^summary_(threeLine|detailed|keyTerms)_/ → 全删
标记 migrationVersion_260424_drop_abstract = 1
```

**步骤 C — Persisted tab state**
```
workspace tab 在现有代码里只是 useState（非 localStorage）→ 无需迁
默认值改为 'overview'
```

### 10.2 运行时降级

- 读到 `notes` 里缺 `kind` 字段的条目 → 默认 `kind='note'`
- 读到 `ChatMessage` 缺 `kind` 字段 → 默认是普通消息（不是 actionCard）
- `paper.arxivId` 为空（本地 PDF）→ Overview 论文信息只显 title/authors，Semantic Scholar 跳过

### 10.3 延迟清理（发布后 7 天再生效）

在后续版本加 `runMigrations_260501_cleanup_legacy_chat()`：
```
扫描 keys 匹配 /^chat_/（不带 Sessions 前缀的旧键）→ 删除
标记 migrationVersion_260501_cleanup_legacy_chat = 1
```

### 10.4 回滚策略

- 无 feature flag，发布即切换；严重问题走 Chrome 商店版本回退
- 已迁移用户数据：chat 旧键在 7 天内保留，短期回滚可以读到；7 天后彻底清
- 每一步迁移写 `console.info` 日志 + 追加到 `migrations_log` 本地 key（array），方便支持排查

---

## 11. 测试

### 11.1 单元测试（`chrome-extension/tests/unit/`）

| 文件 | 覆盖 |
|---|---|
| `chat-sessions.test.ts` | create / switch / clear / delete / rename；按需创建；删最后一个回 null；迁移 round-trip |
| `notes.test.ts` | CRUD / 按 kind 分桶 / 孤儿 note 仍可查 |
| `selection-actions.test.ts` | 双写共享 actionId；AI 失败时 note 保留 `aiAnswer=''` + 可重试；highlight 不走 chat；note 不走 AI |
| `overview.test.ts` | prompt 构造；缓存键带 lang |
| `semantic-scholar.test.ts` | mock fetch：404 / rate limit / 成功；7 天 TTL；无 arxivId 返回 null |
| `migration-260424.test.ts` | 0→1 迁移 fixture；旧键延迟删；多次运行幂等 |

### 11.2 集成测试（`chrome-extension/tests/integration/`）

按现有约定跑（接本地 Supabase stack）：

- 选中 → Explain → AI 流完：chat 出现 actionCard + assistant 回复；notes 出现 `kind:'explain'` + `aiAnswer` 非空；共享 actionId
- 选中 → Note → 写文字 → 保存：chat **无**新消息；notes 出现 `kind:'note'` + `userText` 非空
- Cloud sync（登录用户）：`notes_${pk}` 的 `kind:'note'|'highlight'` 上云；`kind:'explain'|'translate'` 不上云
- 切 session：消息列表切；askPrefill 清空
- 历史抽屉删 active session：activeSessionId 回 null；ChatView 进空态

### 11.3 Acceptance Criteria（对齐用户需求 6 条）

1. Chat 面板在 Classic/Summary/Canvas 均常驻；可拖宽；顶栏按钮可切显隐
2. Session 内联标签支持 1+ 个（新建/切换/清空/历史抽屉删）；刷新后 activeSessionId 保留
3. Overview tab 显示四区块；切 `outputLanguage` 后 contributions/keywords 自动用目标语言
4. 选区工具栏显示 `Explain | Highlight | Note | Translate`；无 Summarize/Ask
5. Explain/Translate：Chat 出现 actionCard + AI 答；Note 对应子 tab 出现卡片；共享 actionId；Note→Chat 跳转可达。Note：Chat 无变化，Note 出现用户笔记卡
6. Note tab 四子 tab（高亮 / 笔记 / 解释 / 翻译），每个带计数 chip；刷新后状态恢复；高亮点击可在正文定位

### 11.4 Out of scope（v1 不做）

- 多色高亮选择器 UI
- 翻译动作的目标语言子菜单
- Notes 全量上云（含 AI 答）
- Outline 章节名翻译
- Session 跨论文合并视图
- Chat session 上云同步
- Overview 论文信息字段的编辑 / 手动修正
- 关键词 chip 的搜索 / 过滤能力

---

## 12. 待定与已知风险

| 项 | 说明 | 处置 |
|---|---|---|
| Semantic Scholar rate limit | 公共端点 ~100 req/5min | 本地 7 天 TTL + tab 切入时才触发 |
| AI 失败场景 | explain/translate 失败时 note 卡片可能堆积 | 显示重试 + 允许用户删除 |
| 本地 PDF 无 arxivId | 论文信息区块降级 | 只渲染 title/authors，其他留空 |
| Note 数量增长 | 长期使用可能累积大量 note | v1 按 createdAt desc 排序即可；v2 加搜索 |
| Canvas 下两侧都打开时可视区过窄 | 用户手动隐藏 | 文档 / onboarding 提示 |
| migration 幂等性 | 重复执行不能破坏状态 | 用 migrationVersion 版本号门闸 |

---

## 13. 不在此 spec 范围的假设

1. ~~`supabase` schema 不做任何 ALTER~~ — **Pass 5 撤回**。本 spec **必须**改一次 `margin_notes.kind` 的 CHECK 约束（见 §5.3 "Schema 迁移"）。这是本 spec 唯一的 schema 变更，与本 spec 代码同 PR land。
2. `lib/i18n.ts` 现有机制已支持新增字串；无需引入新库
3. `tokens.css` 现有调色板**完全足够** — 4 个 note kind 色条用 `--walnut / --ink-highlight / --forest / --sky`；正文高亮底色用 `rgba(232,211,133,0.45)`（`--ink-highlight` + 45% alpha）。**不新增任何 token**（Pass 5 校正：原稿提议的 `--highlight-yellow-bg` 是多余的）。
4. Chrome `storage.local` 容量足以承载新结构（v1 估算每篇论文 < 100KB）；真正超限的场景留给后续分片

---

## 14. 变更对其他 spec 的影响

- `docs/specs/2026-04-20-spec-chrome-extension.md` §3.4 / §3.7 / §3.8 的 UI 表述在实现此 spec 后**事实上作废**；本 spec 视为后继
- `docs/specs/2026-04-24-spec-user-login.md` 多处需同步修订（**Pass 5 详细化**）：
  - §156 的 `margin_notes.kind` CHECK 约束需扩展为 `('explain','summarize','translate','ask','note','highlight')` — 与本 spec §5.3 的 ALTER 同步落地
  - §14 / sync-queue 描述的"`notes` cloud sync"规则改为：`kind` 过滤只同步 `'note' / 'highlight'`，AI 产出（`'explain' / 'translate'`）不上云；老 kind `'summarize' / 'ask'` 也不再写新数据，但 schema 保留以兼容历史记录
  - 一切对"papers.notes JSONB 列"的引用都改为"`margin_notes` 表" — 这是 user-login spec 自己的真实 schema
- **DESIGN.md 同步更新**（Pass 5 加入）：DESIGN.md §4.3 / §4.5 / §5.1 / §5.2 / §6 描述的旧架构（focus 变体、MarginNote、SelectionResultCard、WorkspacePanel 三 tab Summary/Chat/Memory）在本 spec 落地后全部作废。**PR landing 时同步重写 DESIGN.md** 这几节；不允许"代码改了文档没改"。

---

## 15. 视觉防 slop 检查表（Pass 4 加入）

实现期 review 用，每条都是 hard rule。AI slop 是这种产品最容易掉的坑。

### 15.1 字体（绝对禁止 system-ui）

- 正文阅读区（reader）：复用 tokens.css 的 `--font-serif`（已是 Crimson Text / Iowan Old Style 之类的真 serif）
- UI chrome（tab、按钮、chip、footer 时间戳）：复用 tokens.css 的 `--font-sans`
- **禁止**：`font-family: -apple-system` / `font-family: system-ui` / `font-family: Inter` 作为新表面的默认（这是 "我放弃排版了" 信号）
- 等宽（仅代码片段、行号）：`--font-mono`

### 15.2 圆角刻度（统一）

| 表面 | 刻度 |
|---|---|
| 输入框 / 大区块容器 | 8px |
| actionCard / NoteCard | 6px |
| chip（关键词、子 tab、askPrefill chip） | 4px |
| Session 数字 tab | **0**（无圆角，仅底线表示 active） |
| 图标按钮（`+ / ✕ / ⟳` / TopBar / SelectionToolbar） | 4px hover bg；按钮本身无 border |
| **禁止**：bubble pill（`border-radius: 999px`）—— 关键词 chip 不允许 |

### 15.3 区块容器策略

Overview tab 4 块、Note tab NoteCard 列表，**绝不**渲染成"4 个 box-shadow 浮起的卡片堆叠"：

- Overview：4 块用 0.5px `--rule-soft` 水平 hairline 分隔，**单一容器**滚动；每块标题用 small-caps + letter-spacing，不靠卡片框边
- Note tab：每张 NoteCard 是独立交互单元（card-as-interaction，合理），允许 1px `--rule-soft` outline；**禁用** `box-shadow` 装饰；hover 改背景 `--paper-soft` 而非加阴影

### 15.4 颜色编码 ≠ 装饰

NoteCard 左侧 2px 色条按 kind 区分（§3.3.2）—— 这是 **signal**：用户能从色条快速识别 kind。**不是装饰**。实现期 review 时不要被 "这看起来像 SaaS 启动模板的彩色 left-border 卡" 误判删掉。判别：色条**承载信息**（kind 编码） → 保留；色条**只为好看** → 删。

### 15.5 关键词 chip — 防 bubble pill

§3.2.4 规范：text-only + 0.5px `--rule-soft` border + `--ink-faded` 文字 + 0 圆角 fill。**绝不**实现成：
- ❌ `background: var(--walnut-soft)` 等彩色填充
- ❌ `border-radius: 999px` bubble pill
- ❌ icon prefix（`# attention` 之类的 #）— 干净文字即可

### 15.6 emoji 禁令

UI chrome 不允许 emoji 作设计元素。已纠正的位置：
- ❌ ~~📎 已选中~~ → ✓ `I.Quote` SVG 图标
- ❌ ~~rocket / sparkle 在标题里~~ → ✓ section heading 纯文字
- ❌ ~~AI emoji 当 bullet point~~ → ✓ 标准 disc bullet 或无 bullet

唯一例外：用户写在 `note` kind 里的笔记正文，markdown 渲染允许用户自己输入的 emoji（用户内容，不是 chrome）。

### 15.7 装饰禁令

- ❌ 渐变背景（除非现有 token 已有）
- ❌ 浮动 blob / wavy SVG 分隔
- ❌ box-shadow 当装饰（`--shadow-2` 仅用于浮层 popover / toolbar，不用于静态区块）
- ❌ 彩色背景的 section heading
- ❌ skeuomorphic 纸张高光（"paper grain" 是现有可选 token，不属此列）

### 15.8 hierarchy 通过 type weight，不通过颜色

Overview "Core Contributions" > "Contents" > "Keywords" > "Paper Info" 的层级关系（Pass 1 §3.2 决策），用：
- 字号：14px / 13px / 12px / 13px label
- 字重：500 / 500 / 400 / 400
- 间距：32px gap before "Core Contributions"，24px before others

**不用**：彩色 heading 区分谁更重；不用 emoji 区分；不用图标区分。

---

## 16. 响应式与可访问性（Pass 6 加入）

### 16.1 视口断点策略

| 视口宽度 | 行为 |
|---|---|
| ≥ 1440px | 双面板正常布局；拖拽上限 520px |
| 1200-1440px | 双面板正常布局；拖拽下限 280/320 |
| 1024-1200px | 单侧打开正常；**双侧都开**时右面板 auto-collapse 到 32px 宽边栏（仅 `[Overview][Note][Memory]` 三个图标，点击 expand 为 380px overlay 浮层） |
| 768-1024px | 两面板默认 overlay 模式（点击 toggle 触发 `position: absolute` 浮层 + backdrop），不抢正文宽度 |
| < 768px（罕见） | 两面板 100vw 全屏 overlay；StatusRail 隐藏；正文 `padding: 16px` |

**Canvas 变体特殊规则**：默认两面板都收起；用户主动点 toggle → overlay 模式（不挤压画布）。

正文区 `min-width: 480px`（保证一行能放下一段意思完整的句子）；窗口窄到正文 < 480px 时整体水平滚动而非压字。

### 16.2 键盘导航

| 组件 / 范围 | 键位 |
|---|---|
| 全局 | `⌘\` 切右面板 (§1.4) · `⌘⇧\` 切左 Chat 面板 · `⌘K` 命令面板 (沿用) · `⌘L` Library (沿用) |
| ChatPanel 聚焦时 | `⌘T` 新建 session · `⌘W` 关当前 session（弹删除确认） · `Esc` 取消 askPrefill |
| ChatSessionTabs | `←` `→` 切换；`Enter` 激活；`Tab` 移到下一个交互区 |
| ChatSessionHistory 抽屉 | `Esc` 关；`↑` `↓` 切 session；`Enter` 进入；`R` 重命名（行聚焦时）；`Delete` 删除（行聚焦时） |
| Note tab 子 tab | `←` `→` 切子 tab |
| NoteCard | `Tab` 进入卡片；`Enter` 主操作（note→编辑、explain/translate→跳 chat、highlight→正文定位）；`Delete` 删除确认 |
| NoteEditorPopover | `Esc` 取消；`⌘Enter` 保存 |
| SelectionToolbar | `E` Explain · `H` Highlight · `N` Note · `T` Translate（§4.1） |
| Composer 输入框 | `Enter` 发送；`⇧Enter` 换行 |

**Tab 顺序**：TopBar → 左 Chat 面板 → 正文 → 右 Workspace 面板 → StatusRail。所有可点元素必须 `tabindex` 可达（不允许 `tabindex="-1"`，除非元素装饰性）。

**Focus 视觉**：所有可聚焦元素 focus 时显示 2px `--walnut` outline，offset 2px；不允许 `outline: none`。

### 16.3 ARIA Landmarks 与 semantic markup

| 组件 | role / 属性 |
|---|---|
| ChatPanel 容器 | `role="region" aria-label="AI chat assistant"` |
| ChatSessionTabs 容器 | `role="tablist" aria-label="Chat sessions"` |
| 每个 session tab | `role="tab" aria-selected={isActive} aria-controls={panelId}` |
| WorkspacePanel tab 行 | `role="tablist" aria-label="Workspace tabs"` |
| Note 子 tab 容器 | `role="tablist" aria-label="Note kinds"` |
| NoteCard | `role="article"`，`<h3>` 标题（kind 名 sr-only），引文用 `<blockquote>` |
| askPrefill chip | `role="status" aria-live="polite"` |
| StatusRail ghost (Pass 3) | `role="status" aria-live="polite"` |
| SelectionToolbar | `role="toolbar" aria-label="Selection actions"` |
| AI 流式答 | 容器 `aria-live="polite" aria-busy={streaming}`；流结束后 `aria-busy="false"`，屏幕阅读器一次读完 |
| 错误态卡片 | `role="alert"`（确保 SR 立即读出） |

### 16.4 颜色对比（WCAG 2.1 AA）

所有正文文字（14px+）vs 背景对比 ≥ 4.5:1；大字（18px+ / 14px Bold+）≥ 3:1；图形元素（图标、色条、border）≥ 3:1。

| 用途 | 色组合 | 对比 | 通过 |
|---|---|---|---|
| 正文 ink #1C1A15 / paper #F6F1E6 | — | ~13:1 | ✓ |
| 副文 ink-soft #3A3428 / paper | — | ~9.5:1 | ✓ |
| 灰文 ink-faded #6B6152 / paper | — | ~4.7:1 | ✓ AA |
| ghost #A59B86 / paper | — | ~2.7:1 | ✗ AA — **仅用于装饰**（图标、占位符），不用于正文 |
| NoteCard 色条 explain --walnut #8B6B3E | — | ~5.4:1 | ✓ |
| NoteCard 色条 highlight --walnut-soft #B5935F | — | ~3.6:1 | ✓ AA graphics |
| NoteCard 色条 note --forest #4F6B4A | — | ~5.0:1 | ✓ |
| NoteCard 色条 translate --sky #4C6A87 | — | ~5.4:1 | ✓ |
| Error --foxglove #A34B5E / foxglove-soft bg | — | ~4.6:1 | ✓ AA |

**Dark mode 校验**：tokens.css 已定义 dark variant；实现期 review 时 4 个 NoteCard kind 色 vs `--paper` (#181613) 也要逐项算对比，不能假设直接好。

### 16.5 Touch target

最小 hit area 32×32（接近 WCAG 2.2 AA 24×24 但更宽松友好）：

- 图标按钮 SVG 尺寸 18×18，外层按钮 padding 7px 得到 32×32 hit area
- ChatSessionTab 数字 tab 高 32px，水平 padding 10px → hit area ≥ 32×32
- 关键词 chip：text 12px + 6px 上下 padding + 10px 左右 padding ≈ 28×100px 横长，touch target 接近达标
- NoteCard `[→ Chat]` 按钮：图标 14px + 6px padding → 26×26（**未达** — 改为 padding 9px → 32×32）

### 16.6 屏幕阅读器关键流程

3 条 SR 必须 work 的核心 flow（实现期手动验证）：

1. 选中文字 → SelectionToolbar 出现：SR 应读出 "Selection toolbar, 4 actions, Explain button" 等
2. AI 流式答：SR 不读流式过程（`aria-live="polite"` + `aria-busy`），流结束后读完整答
3. Chat → Note 跳转：跳转后 SR 读出"目标 note card highlighted"，并 focus 到该卡片

### 16.7 减动效（prefers-reduced-motion）

`@media (prefers-reduced-motion: reduce)`：
- `fade-up` / `flash highlight 600ms` / `ink-streaming` 光标 → 全部禁用
- AI 流式答仍然流（语义需要），但去掉光标动画
- ghost StatusRail 不 fade，直接 mount + 5s 后 immediate hide

---

## 17. 工程评审决议（Eng Review Addendum）

本节由 `/plan-eng-review` 产出，列出 8 条架构修订。**对前文的覆盖关系**：本节决议是后续真理；前文与本节冲突处以本节为准。

### 17.1 Storage key 命名约定 — 全部对齐 `paper:${key}:*`（覆盖 §5.1）

既有 `chrome-extension/reader/lib/storage.ts:30-36` 已将所有 per-paper 键定为 `paper:${key}:*` 冒号正序。本 spec §5.1 原写下划线反序，**全部改为冒号正序**：

```ts
// 本 spec §5.1 修订后的 key schema：

paper:${key}:chatSessions                    // ChatSession[]
paper:${key}:chatSessionMessages:${sid}      // ChatMessage[]
paper:${key}:activeChatSession               // string | null
paper:${key}:notes                           // Note[]
paper:${key}:overview:contributions:${model}:${lang}   // markdown
paper:${key}:overview:keywords:${model}:${lang}        // tag list
paper:${key}:overviewMeta                    // OverviewMeta
paper:${key}:workspace:tab                   // 'overview'|'note'|'memory'
paper:${key}:scroll                          // number | null
paper:${key}:lastVisit                       // number | null
paper:${key}:note:activeSubtab               // 'explain'|'highlight'|'note'|'translate'

// 全局键（无 paper key）：
schemaMigrationVersion:260424:dropAbstract                // global
schemaMigrationVersion:260501:cleanupLegacyChat           // global
shortcutToastSeen:260424                                  // global
actionCardHintSeen:260424                                 // global

// 旧键迁移（spec §10.1 步骤 A 修订）：
// 旧：paper:${key}:chat                     （扁平 ChatMessage[]，既有命名）
// 新：paper:${key}:chatSessions + paper:${key}:chatSessionMessages:${sid}
```

`storage.ts` 现有 `k = { ... }` 常量需扩展，新增对应的 key builder。

### 17.2 Per-paper 动态键放在 `storage.ts`，不在 `storage-schema.ts`（覆盖 §7.2）

既有项目分两层：
- `storage-schema.ts` — 静态全局键（typed wrapper，TS literal types）
- `storage.ts` — per-paper 动态键（key builder + raw chrome.storage.local）

本 spec 的 6 个新 per-paper 键 + 4 个全局键应分别落入两个文件：
- 全局键（4 个 `schemaMigrationVersion:*` / `shortcutToastSeen:*` / `actionCardHintSeen:*`）→ `storage-schema.ts` 的 `StorageSchema` 类型加字段
- 全部 per-paper 键 → `storage.ts` 的 `k` 构造器扩展 + 新增 getter/setter helpers

§7.2 修改清单更正：
- ❌ 原稿：`lib/storage-schema.ts` 加 `getChatSessions / setChatSessions / ...`
- ✓ 修订：`lib/storage.ts` 加 `getChatSessions / setChatSessions / getChatSessionMessages / appendChatSessionMessage / getNotes / setNotes / getOverviewSection / setOverviewSection / getOverviewMeta / setOverviewMeta` + 对应 key builders
- ✓ `lib/storage-schema.ts` 加 4 个全局键到 `StorageSchema` 类型 map

### 17.3 Migration 模式拆分：本地演化用 `schema-migration`，云上传保留 `migration`（覆盖 §10 + §7.1）

避免命名冲突。新增独立模块：

```
chrome-extension/reader/lib/
├── migration.ts                      # 既有 — M1 silent cloud upload (保持不变)
├── schema-migration.ts               # 新增 — 本地数据结构演化
└── ...
```

`schema-migration.ts` 暴露：
- `runSchemaMigrations_260424()` — spec §10.1 步骤 A/B/C
- `runSchemaMigrations_260501_cleanupLegacyChat()` — spec §10.3
- `runRestoreContext_260424()` — spec §6.5（属于"启动时恢复上下文"，与 schema 演化同生命周期，落入同一模块）

调用顺序：reader paper 载入后、UI 渲染前 → `runSchemaMigrations_260424()` → `runRestoreContext_260424()` → mount UI。`migration.ts` 的 M1 cloud upload 仍受现有调度（用户登录时触发），与 schema migration 解耦。

§7.1 新增清单加 `lib/schema-migration.ts`，§10 各处 `runMigrations_260424` 改为 `runSchemaMigrations_260424`。

### 17.4 `ChatMessage` 类型双声明 — 仅改 `types.ts:171`（澄清 §5.2）

项目存在两个 `ChatMessage`：
- `chrome-extension/reader/types.ts:171` — UI 消息（`id / role / text / citations / createdAt`）
- `chrome-extension/reader/lib/ai.ts:126` — OpenAI 请求体（`role / content`）

本 spec §5.2 的 `kind?: 'actionCard' / action?: {...}` 字段 **仅加在 `types.ts` 的 UI message 上**。`ai.ts` 的请求体 ChatMessage 不动（OpenAI API 不需要 actionCard 概念）。

### 17.5 Supabase migration 文件名约定（覆盖 §5.3）

既有 `supabase/migrations/001_tables.sql ~ 005_rpc.sql` 用 `00N_name.sql` 顺序前缀。本 spec §5.3 写 `20260424_extend_margin_notes_kind.sql`，**改为 `006_extend_margin_notes_kind.sql`**。

### 17.6 添加 `unlimitedStorage` permission（新增到 §7.2）

`chrome-extension/manifest.json` `permissions` 数组**追加 `"unlimitedStorage"`**：

```json
"permissions": ["storage", "unlimitedStorage", "declarativeNetRequest", "identity", "alarms"]
```

`unlimitedStorage` 不是敏感权限，Chrome 不会弹"重新授权"对话框。突破 chrome.storage.local 默认 10 MB 限制（实际上限由 disk 决定）。Spec §13.4 的"v1 估算每篇论文 < 100 KB"作为非约束信息保留，不再是硬上限。

### 17.7 5 秒 Undo snapshot 生命周期（澄清 §4.A）

snapshot **绑定到 `currentPaperKey`**，新增独立模块 `lib/undo-snapshot.ts`：

```ts
// chrome-extension/reader/lib/undo-snapshot.ts

type Snapshot = {
  paperKey: string
  kind: 'chat-session' | 'note-card'
  payload: any              // serialized object pre-delete
  timeoutId: number
  onExpire: () => void      // permanently flush (no-op, since delete already wrote storage)
  onRestore: () => Promise<void>  // restore to storage + UI
}

let active: Snapshot | null = null

export function pushSnapshot(snap: Omit<Snapshot, 'timeoutId'>): void {
  if (active) clearTimeout(active.timeoutId)         // 覆盖前一次
  active = {
    ...snap,
    timeoutId: setTimeout(() => { active = null }, 5000) as unknown as number,
  }
}

export async function tryUndo(): Promise<boolean> {
  if (!active) return false
  clearTimeout(active.timeoutId)
  await active.onRestore()
  active = null
  return true
}

export function flushOnPaperChange(newPaperKey: string): void {
  if (active && active.paperKey !== newPaperKey) {
    clearTimeout(active.timeoutId)
    active = null   // 跨论文 undo 风险消除
  }
}
```

调用规则：
- delete 流程：先持久化删除 → `pushSnapshot({ paperKey: cur, kind, payload, onRestore })` → toast 显示 `[撤销]`
- toast `[撤销]` 点击 → `tryUndo()`
- paper 切换（`useEffect` 监听 `currentPaperKey` 变化）→ `flushOnPaperChange(newKey)`
- v1 仅支持 undo 最后一次；同 paper 连续删除 → 后者覆盖前者 snapshot

### 17.A Code Quality 决议（C1-C5，新增 5 条）

#### 17.A.1 不新增 explain/translate 独立 prompt builder（覆盖 §7.2）

§7.2 原稿写"`lib/ai.ts` 新增 `buildOverviewContributions / buildOverviewKeywords / buildExplainMessages / buildTranslateMessages`"。但 ai.ts 已有 `buildMessages(kind)` + `promptFor(kind, lang)`。**直接扩展 `kind` 集合**，不新增 builder：

```ts
// ai.ts 现有：
export type AiActionKind = 'explain' | 'summarize' | 'translate' | 'ask'

// 修订后：
export type AiActionKind =
  | 'explain' | 'translate'                                  // 选区动作
  | 'overviewContributions' | 'overviewKeywords'             // Overview AI 块
  | 'summarize' | 'ask'                                      // deprecated, 保留至 v2 移除（不新写入）

// promptFor() 内 case 增加 'overviewContributions' / 'overviewKeywords'
// callAI(kind, options) 入口不变
```

§7.2 修订：~~`新增 buildExplainMessages / buildTranslateMessages`~~ 删除；改为"扩展 `AiActionKind` + `promptFor()` case 分支"。

#### 17.A.2 NoteCard 主内容区使用 `MarkdownBody`（澄清 §3.3.2）

NoteCard kind=`explain/translate/note` 的主内容区**必须**复用 `chrome-extension/reader/components/markdown.tsx` 的 `MarkdownBody` 组件。不允许从零写新的 `<Markdown>` 渲染器。citation 高亮 + LaTeX + code block 等行为通过复用统一。

§3.3.2 加一句："主内容区 markdown 渲染走 `MarkdownBody`，与 chat assistant 消息一致"。

#### 17.A.3 AI 流式 abort 模式（新增到 §6.1 + §6.2）

`streamThroughProxy` / `streamBYOK` 接受 `AbortSignal` 参数：

```ts
export async function callChatCompletion(
  options: CallOptions,
  signal?: AbortSignal,
): Promise<void>
```

调用约定：
- 每次 `runSelectionAction` 启动时创建 `AbortController`，存入与 actionId 关联的 in-flight map
- 用户切 chat session（§6.2）→ abort 当前 paper 所有 in-flight
- 用户切 paper（reader 卸载之前）→ abort 当前 paper 所有 in-flight
- 用户在 chat 里点 `[停止]` (Pass 2 §4.3.2) → abort 该单条 in-flight
- 流式 partial 内容**保留**：`AbortController.abort()` 触发后，已流出的 chunk 已经写入 assistantMsg.text。状态从 `streaming` 变 `aborted`，UI 显示 "AI 回复被中断" + `[重试]` 按钮（与 §4.3.2 error 态共用视觉）
- 同 actionId 的 NoteCard 同步进 aborted 态

#### 17.A.4 Retry 防并发（澄清 §6.4）

NoteCard "重试" 与 chat actionCard "重试" 共享同一 actionId。新增 retry in-flight 守卫：

```ts
const retryInFlight = new Set<string>()  // module-level in lib/selection-actions.ts

export async function retryAction(actionId: string): Promise<void> {
  if (retryInFlight.has(actionId)) {
    setToast({ kind: 'info', text: '上次重试还在进行' })
    return
  }
  retryInFlight.add(actionId)
  try {
    // 找到 note + chat assistantMsg（actionId 索引）
    // 重跑 callAI
    // 同步更新两边
  } finally {
    retryInFlight.delete(actionId)
  }
}
```

§6.4 加这条约束。

#### 17.C Performance 决议（P1-P4，新增 4 条）

#### 17.C.1 NoteCard list 性能（覆盖 §9 + §12）

v1 不上虚拟滚动 — 单篇论文 50-100 卡片以内浏览器扛得住。**但**：
- 实现期 NoteCard render 数量 > 200 时 `console.warn('Note list >200 cards, consider virtualization')` 作前哨
- §12 风险表"Note 数量增长"标记升级：v2 实施 `react-window` 虚拟滚动；本 spec **不实施**

#### 17.C.2 去掉 workspace_tab 的 debounce（覆盖 §6.5）

§6.5 原稿写"`workspace_tab_*`：tab 切换时 debounced 200ms 写"。tab 切换是离散动作，无需 debounce。直接同步 `chrome.storage.local.set({ 'paper:${k}:workspace:tab': value })`。`paper_scroll` 的 1000ms debounce 保留（高频事件）。

#### 17.C.3 内存 snapshot 大小校验（澄清 §17.7）

- NoteCard snapshot：~5KB，5s hold，不需特殊处理
- ChatSession snapshot：可能 50-200 messages × ~500B = 25-100KB，5s hold —— **OK**，不阻塞
- 实现期：snapshot push 时若 payload 超过 1MB 走 console.warn（防御性，正常情况触发不到）

#### 17.C.4 AI 流式 chunk rAF batching（新增到 §6.1）

`streamThroughProxy` / `streamBYOK` 加 chunk batching 层：

```ts
// pseudo-code 在 streaming reader loop 内：
let pendingText = ''
let rafScheduled = false

function flushPending() {
  rafScheduled = false
  if (!pendingText) return
  setChatMessages(prev => updateAssistantText(prev, assistantId, pendingText))
  pendingText = ''
}

function onChunk(text: string) {
  pendingText += text
  if (!rafScheduled) {
    rafScheduled = true
    requestAnimationFrame(flushPending)
  }
}

// 流结束 / abort 时强制 flush
function onComplete() { flushPending(); /* finalize */ }
```

效果：60fps 设备每秒最多 60 次 setChatMessages（vs 每 SSE chunk 一次约 10-50 次/秒）。低端机 jank 消除。NoteCard kind=explain/translate 的同步 streaming 也走同一 batching（共用 lib 函数）。

---

### 17.B Test Plan 补完（覆盖 §11）

§11.1 / §11.2 / §11.3 原稿提了 6 个 unit + 5 integration scenario + 6 acceptance —— 远不够（覆盖率 ~10%）。本 review trace 64+ 路径 + 用户流，列出**必加测试清单**：

#### 17.B.1 新增 unit tests

| 文件 | 覆盖 |
|---|---|
| `tests/unit/schema-migration.test.ts` | step A/B/C 幂等 · partial failure recovery · 0→1 round-trip · 跨版本（260424→260501） |
| `tests/unit/restore-context.test.ts` | runRestoreContext 6 步骤 · ghost rail 触发条件（counts > 0 + lastVisit 非空） · storage parse fail 降级 |
| `tests/unit/undo-snapshot.test.ts` | pushSnapshot 5s 自动过期 · 覆盖语义（连续 push）· paper 切换 flush · onRestore 调用 |
| `tests/unit/format.test.ts` | 4 个 formatter（chat / note / session / relative） × zh-CN + en-US locale × invalid timestamp 兜底 |
| `tests/unit/semantic-scholar.test.ts` | jittered TTL 5-9 天范围 · negative cache 24h · 单并发 queue（连续 fetch 3 个 → 串行）· 404 / network timeout / rate-limit 各路径 |
| `tests/unit/selection-actions.test.ts`（扩展原稿） | AbortController 中断 partial 保留 · retry in-flight 守卫 · 4 种 kind 双写矩阵 · sid 缺省自动建 session |
| `tests/unit/chat-sessions.test.ts`（原稿已列） | 新建/切换/清空/删除/重命名 · 按需创建 zombie 防御 · clear vs delete active 差异 · title 30 字截断 |
| `tests/unit/notes.test.ts`（原稿已列） | 4 kind CRUD · highlight 双写 + 双删 · kind 过滤 · 老数据无 kind 默认 'note' |
| `tests/unit/overview.test.ts`（原稿已列） | prompt 构造 · 缓存键带 lang · 切语言重生 · AI 失败错误态 |
| `tests/unit/migration-260424.test.ts`（原稿已列） | 0→1 fixture · 多次幂等 · 版本号守门 · 老键延迟删 |

#### 17.B.2 新增 integration tests

| 文件 | 覆盖 |
|---|---|
| `tests/integration/notes-dual-write.test.ts` | highlight 双写 highlights + margin_notes 一致 · 删一边另一边同步 |
| `tests/integration/sync-queue-kind-filter.test.ts` | 4 种 kind × 上云/不上云矩阵 · note + highlight 上云 · explain + translate 不上云 |
| 原稿 §11.2 列的 5 条 scenario | 保留 |

#### 17.B.3 新增 E2E tests

新增 `chrome-extension/tests/e2e/`（若不存在则创建）。建议用 Playwright（与既有 chrome 扩展测试模式对齐）。

| 文件 | 覆盖 |
|---|---|
| `selection-explain-flow.spec.ts` | 选区 → Explain → chat actionCard + Note 卡 + 双向跳转 + flash highlight |
| `selection-highlight.spec.ts` | 选区 → Highlight → 正文背景 + Note tab 高亮卡 + 删卡同步消失正文高亮 |
| `selection-note.spec.ts` | 选区 → Note → NoteEditorPopover → 保存 → 卡片显示 + 编辑往返 |
| `selection-translate.spec.ts` | 选区 → Translate → 与 Explain 同形 |
| `chat-session-mgmt.spec.ts` | 新建/切换/清空/历史抽屉删/重命名 + askPrefill 切 session 清空 |
| `undo-toast.spec.ts` | 5 秒 undo: chat session + Note 两路径 + paper 切换 flush |
| `return-visit.spec.ts` | ghost StatusRail 触发 + tab 恢复 + scroll 恢复 |
| `responsive-breakpoints.spec.ts` | 1024 / 768 / canvas 三档断点（Pass 6 §16.1） |
| `keyboard-nav.spec.ts` | ⌘\\, ⌘⇧\\, N 键, Tab 顺序 |
| `aria-landmarks.spec.ts` | landmark roles + aria-live + role="alert"（§16.3 + §16.6 三条 SR 流） |

#### 17.B.4 LLM Eval suites

新增 `chrome-extension/tests/eval/`（若不存在则创建）。每次 ship 前跑：

| 文件 | 覆盖 |
|---|---|
| `eval/contributions.test.ts` | 5 篇不同领域 paper × 输出格式约束（3-5 bullet × 每条 ≤ 1 行 × 不超出 abstract 事实范围） |
| `eval/keywords.test.ts` | 5 篇 paper × 6-12 个 chip × 无重复 × paper-相关 |
| `eval/explain.test.ts` | 10 段选区 × 答必含原文片段（防引用幻觉） |

#### 17.B.5 Critical regression tests

git log `4398353 fix(ext): drop local-format id when migrating margin_notes` 已踩过 margin_notes 同步坑。本 spec 又改 sync-queue + 加 ALTER table，必须有以下 regression test 守住：

- `tests/unit/sync-queue-kind-filter.test.ts` — kind 集合扩展不漏老 kind 上云路径
- `tests/integration/legacy-chat-migration.test.ts` — 老用户的 `paper:${k}:chat` flat data → 新 ChatSessions schema 一比一保留
- `tests/integration/highlight-dual-write.test.ts` — `highlights` 表与 `margin_notes` 表一致性约束（spec §5.3 双写）
- `tests/integration/shortcut-toast-once.test.ts` — `shortcutToastSeen` 只显示一次（§1.4 + §17.1）

§11 不替换原稿 6 + 5 + 6 项，本 §17.B 是**补充**。最终 testing footprint：原稿 17 + 本 review 新增 ~18 + eval 3 ≈ **38 个测试文件**。

§11.4 OUT OF SCOPE 加一条："多次 undo stack（v1 仅最后一次可 undo，§17.7 决策）"。

### 17.A.5 时间格式集中到 `lib/format.ts`（新增到 §7.1）

新增 `chrome-extension/reader/lib/format.ts`：

```ts
// 全部时间显示走这里，i18n 友好
export function formatChatTimestamp(ms: number, locale: string): string  // "10:32 AM" / "10:32"
export function formatNoteCardFooter(ms: number, locale: string): string // "Mar 26" / "3 月 26 日"
export function formatSessionHistoryRow(ms: number, locale: string): string // "2026-04-24 12:30"
export function formatRelative(ms: number, locale: string): string         // "5 minutes ago" / "5 分钟前" — for ghost StatusRail
```

§7.1 新增清单加 `lib/format.ts`。所有时间显示组件（ChatMessage / ChatSessionHistory / NoteCard / StatusRail ghost）从这一处取格式器。

---

### 17.8 Semantic Scholar 雪崩防御（覆盖 §3.2.1 + §9 + §12）

新增 `lib/semantic-scholar.ts` 时**必须**实现三道防御：

1. **Jittered TTL 5-9 天**：每条 OverviewMeta 写入时计算 `expiresAt = fetchedAt + (5 + Math.random() * 4) * 24h`。读取时若 `now > expiresAt` 即 cache miss。同周加的 100 篇 paper 的 expiry 自然分布在 4 天内。

2. **Negative cache 1 天**：fetch 失败（404/rate-limit/network）时仍写入 OverviewMeta，但 `failed: true / failedAt: now`。读取时若 `failed && now - failedAt < 24h` → 立即返回 null（不再触发 fetch），UI 显示 `—`。1 天后才允许重试。

3. **全局单并发**：模块内置 promise queue，最多 1 个 in-flight 请求；其它 paper 进 Overview tab 触发时排队等候。Public Semantic Scholar 端点 100 req/5min，单并发 + 网络往返 ~500ms = max ~600 req/5min，远低于上限（实际更低，因为大部分命中 cache 不发请求）。

OverviewMeta 类型扩展：
```ts
export interface OverviewMeta {
  venue?: string
  citations?: number
  codeUrl?: string
  field?: string
  fetchedAt: number
  expiresAt: number       // §17.8 加：jittered 5-9 days
  failed?: boolean        // §17.8 加：negative cache flag
  failedAt?: number       // §17.8 加：negative cache timestamp
}
```

§12 风险表"Semantic Scholar rate limit"风险关闭。

---

## 18. Eng Review 收尾输出（2026-04-25）

### 18.1 NOT in scope (eng-review-confirmed)

| 项 | 一句话 |
|---|---|
| 多次 undo stack | v1 仅最后一次 undo 可救。多次 undo 增量复杂度 vs. 真实使用频率不值得（§17.7） |
| Note 列表虚拟滚动 | v1 限 ≤200 卡片不实施 react-window。production warn sentinel 触发后再加（TODO.md UI redesign launch checklist） |
| AI eval CI 集成 | eval 文件写入 v1，但 CI 调度延后到下个 PR |
| DESIGN.md 重写 | 单独 PR，保持本次 redesign PR 聚焦于代码 |
| Storage quota 自动 LRU 退退 | `unlimitedStorage` permission 解决了上限问题，无需 LRU |
| 多色高亮 | spec §11.4 已声明，未变 |
| 翻译目标语言子菜单 | spec §11.4 已声明 |
| Notes 全量上云（含 AI 答） | 仅 note + highlight 上云，explain/translate 留本地（§5.3） |
| Outline 章节翻译 | 章节标题不翻译（§8.1） |
| Session 跨论文合并视图 | 单论文内 session 管理 |
| Chat session 上云 | 纯本地 |
| Overview 字段编辑 | 显示用，非编辑 |
| 关键词搜索 | v2 带搜索 |
| 单 fetch storage quota error 弹 modal | 加了 unlimitedStorage 后，set() 失败概率极低；toast 兜底足够 |

### 18.2 What already exists（既有可复用）

| 既有 | 复用方式 | 来源 |
|---|---|---|
| `chat-view.tsx` 内 `WelcomeCard` + `suggestionSet(paper)` | ChatPanel 空态直接复用（Pass 2 §4.3.2） | `chrome-extension/reader/components/chat-view.tsx` |
| `chat-view.tsx` 内 `Composer` | ChatPanel 输入框直接复用 | 同上 |
| `markdown.tsx` `MarkdownBody` + `buildCitationMap` | 所有 AI markdown 渲染路径（actionCard/NoteCard/chat assistant）（§17.A.2） | `chrome-extension/reader/components/markdown.tsx` |
| `migration-banner.tsx` | schema-migration 失败态复用（Pass 2 §4.3.8） | `chrome-extension/reader/components/migration-banner.tsx` |
| `quota-chip.tsx` + `upgrade-prompt.tsx` | BYOK / 配额错误流（Pass 2 §4.3.7） | `chrome-extension/reader/components/quota-chip.tsx` |
| `status-rail.tsx` 现有 `transientItem` 槽 | ghost StatusRail 显示（Pass 3 §6.5） | `chrome-extension/reader/components/status-rail.tsx` |
| `ai.ts` `callChatCompletion` + `streamThroughProxy` + `streamBYOK` | callAI 主入口扩展 kind 集合即可（§17.A.1） | `chrome-extension/reader/lib/ai.ts` |
| `ai.ts` `promptFor(kind, lang)` + `langInstruction` | 加 explain/translate/contributions/keywords case 即可（§17.A.1） | 同上 |
| `highlight-ranges.ts` + `Highlight` 类型 | 高亮持久化 + Range 恢复（§4.2） | `chrome-extension/reader/lib/highlight-ranges.ts` |
| `outline-panel.tsx` 内 `scrollToOutlineItem` | 抽到 `lib/scroll-to-outline.ts` 后复用（§7.3 抢救） | `chrome-extension/reader/components/outline-panel.tsx` |
| `selection-result-card.tsx` 的 quote/footer DOM 结构 | 作为 NoteCard Layout B 起点（§7.3 抢救） | `chrome-extension/reader/components/selection-result-card.tsx` |
| `abstract-view.tsx` 的 `SectionState` 状态机 | 抽到 `lib/section-state.ts` 复用（§7.3 抢救） | `chrome-extension/reader/components/abstract-view.tsx` |
| `migration.ts` (M1 cloud upload) | 不复用 — 与新 schema-migration 解耦（§17.3） | `chrome-extension/reader/lib/migration.ts` |
| `tokens.css` 全部色板 | 4 个 NoteCard kind 色 + `--ink-highlight` + `--paper`/`--ink` 系列均现有 | `styles/tokens.css` |
| `ink-streaming` / `fade-up` 动画 class | actionCard / NoteCard / 流式光标统一复用 | `styles/ink-animations.css` (推测) |
| `vitest.config.ts` + 21+ 既有测试 | 新 unit 测试落入 `chrome-extension/tests/unit/` 既有目录 | `chrome-extension/vitest.config.ts` |
| `supabase/migrations/00N_*.sql` 编号约定 | 新 migration 编号 006（§17.5） | `supabase/migrations/` |

### 18.3 Failure modes — 关键路径生产失败场景

每条新代码路径列 **1 个真实生产失败 + 是否有测试 + 是否有 error handling + 用户是否看到清晰错误**：

| Codepath | 失败场景 | 测试? | Error handling? | 用户清晰错误? |
|---|---|:-:|:-:|:-:|
| `selection-actions.runSelectionAction(explain)` | OpenAI API 5xx 中途 | ✓ §17.B.1 | ✓ Pass 2 §4.3.2 双错对称 | ✓ "AI 回复失败 + [重试]" |
| `selection-actions.runSelectionAction(highlight)` | `highlight-ranges` Range 失败（DOM 跨复杂结构） | ⚠ 需补 | ✓ 既有 silent skip | ❌ silent — flag |
| `chat-sessions.deleteSession` | rapid double-click → 双删 | ⚠ §17.7 snapshot 覆盖语义需测 | ✓ snapshot 模型 | ✓ |
| `notes.upsertNote(highlight)` 双写 | margin_notes 写成功 + highlights 失败 | ⚠ 需补 integration | ❌ 无原子保证 | ❌ silent — flag |
| `schema-migration.runSchemaMigrations_260424` step A 中断 | 写到一半 storage 异常 | ⚠ §17.B.1 必有 | ✓ 版本号守门 | ⚠ 重启再跑 |
| `semantic-scholar.fetchMeta` 网络 timeout | network 30s 挂起 | ✓ §17.8 negative cache | ✓ 1 天负缓 | ✓ UI 显示 `—` |
| `restore-context.runRestoreContext` storage parse fail | 老用户某个 key 是 corrupted JSON | ⚠ 需补 | ✓ §6.5 降级"当首次" | ✓ 静默降级 |
| `streamThroughProxy` AbortController abort | 用户切论文期间 | ⚠ §17.A.3 必有 | ✓ partial 保留 | ✓ "中断 + 重试" |
| `undo-snapshot.flushOnPaperChange` | 切论文时 snapshot 没清 | ⚠ 需补 | ✓ §17.7 模型 | ⚠ 内部 bug — flag |
| `ai.ts` rAF batching `flushPending` | 流刚结束、rAF 被取消 | ⚠ 需补 | ✓ onComplete 强制 flush | ✓ 不丢内容 |

**Critical gaps** (silent + 无 test + 无 handling)：

1. **`highlight-ranges` Range 恢复失败 silent skip**：用户在复杂 DOM（嵌套 footnote、跨段落）上选区高亮，恢复时 Range API 抛错。当前是 silent skip — 用户**不知道**自己的高亮丢了。**应在 Pass 2 §4.3.2 加一条 toast：`某些高亮在此布局下无法恢复`**。
2. **`notes.upsertNote(highlight)` 双写非原子**：先写 margin_notes 后写 highlights。中间 fail → margin_notes 表里有 kind=highlight 的 note，highlights 表里没记录。下次 reader 启动时高亮在 Note 列表里能看到，正文里看不到 —— **隐式数据漂移**。**应加 try/catch + 反向回滚**或**改为先写 highlights 后写 margin_notes 并记录中间态**。这是 §17.B.5 已列的 critical regression test 必抓的。

§17.B.5 regression test list 已含这两项的覆盖。

### 18.4 Worktree parallelization strategy

30 文件改动按依赖关系分成 4 lane：

| Step | Modules touched | Depends on |
|------|----------------|------------|
| **L1.1**：lib 基础设施（schema-migration / undo-snapshot / format / scroll-to-outline / section-state） | `chrome-extension/reader/lib/` (新文件) | — |
| **L1.2**：Schema ALTER + sync-queue kind filter | `supabase/migrations/006_*.sql` + `chrome-extension/reader/lib/sync-queue.ts` | — |
| **L1.3**：tokens.css + ink-animations.css 微调 | `chrome-extension/reader/styles/` | — |
| **L2.1**：Chat panel 全栈 | `lib/chat-sessions.ts` + `components/chat-panel.tsx` + `chat-session-tabs.tsx` + `chat-session-history.tsx` + 修改 `chat-view.tsx` | L1.1 (format) |
| **L2.2**：Note 全栈 | `lib/notes.ts` + `lib/selection-actions.ts` + `components/note-view.tsx` + `note-card.tsx` + `note-editor-popover.tsx` + 修改 `selection-toolbar.tsx` | L1.1 + L1.2 |
| **L2.3**：Overview 全栈 | `lib/overview.ts` + `lib/semantic-scholar.ts` + `components/overview-*.tsx` (5 个) | L1.1 |
| **L3**：Shell 重构 + main.tsx 调度 | `main.tsx` + `top-bar.tsx` + `workspace-panel.tsx` + manifest.json + i18n.ts | L2.1 + L2.2 + L2.3 |
| **L4**：删除清理 | 删 5 个旧 component | L3 |

**Parallel lanes 编排**：

```
TIME →

Lane A:  [ L1.1 lib infra      ] → [ L2.1 Chat panel    ] →
Lane B:  [ L1.2 schema + sync  ] → [ L2.2 Note system   ] → [ L3 shell + main ] → [ L4 delete ]
Lane C:  [ L1.3 styles         ] → [ L2.3 Overview      ] →

(L1.* 三 lane 完全独立可并行；L2.* 三 lane 之间也独立但都依赖 L1)
```

**冲突 flag**：
- L2.2 (Note) 修改 `selection-toolbar.tsx` 同时 L3 也要动它（移除 summarize/ask）。建议 L2.2 完成 toolbar 改动后 merge 到 main 后 L3 再启。
- L3 修改 `i18n.ts` 同时 L2.* 三个 lane 都要往 i18n.ts 加新字串。建议每个 L2 子任务完成时 push 各自的 i18n key 到 main，L3 最后做去重 + 重组。

**实施建议**：5 个 worktree（L1.1, L1.2, L1.3, L2.x 选一个开始, L3 准备好基线）。CC + gstack 单人开 5 worktree 并行：~3 天 → 1.5 天 wall clock。

### 18.5 Completion summary

```
+================================================================+
|         PLAN ENG REVIEW — COMPLETION                            |
+================================================================+
| Step 0 Scope         | scope accepted as-is（design review 已锁）|
| Architecture Review  | 8 issues, 5 with tradeoff, all resolved  |
| Code Quality Review  | 5 issues, 1 with tradeoff, all resolved  |
| Test Review          | coverage diagram, 50+ gaps, ~18 new tests|
| Performance Review   | 4 issues, 1 with tradeoff (rAF batching) |
| NOT in scope         | written (14 项)                          |
| What already exists  | written (16 项可复用)                    |
| TODOS.md updates     | 3 项追加到现有 TODO.md UI redesign 段    |
| Failure modes        | 10 codepath × 4 列表，2 critical gaps   |
| Outside voice        | skipped (user choice)                    |
| Parallelization      | 4 lanes, L1 三并行, L2 三并行, L3 + L4 串行|
| Lake Score           | 18/18 chose complete option              |
+================================================================+

Spec growth: 1170 → ~1600 lines (eng addendum §17 + §18 ~430 lines)
```
---

## Approved Mockups

| Surface | Mockup Path | Direction | Notes / Implementation Constraints |
|---|---|---|---|
| Note tab (active state) | `~/.gstack/projects/PaperFlow-Design/designs/chatgpt-mockup-20260424/v3-note-tab.png` | warm-paper light theme · 解释 sub-tab 激活 · 3 NoteCards 演示 4 种 kind 的 layout 区分 | **实现时相对 mockup 调整 3 处**：(a) NoteCard 左侧 2px 色条要按 §3.3.2 / §16.4 的全饱和 token 颜色，mockup 里色条太淡几乎看不见；(b) actionCard 徽章按 §2.5 是纯文字 `[Explain · 第 1 页]`，不带 `?` 图标前缀（mockup 仍带着）；(c) sub-tab 是 kind filter，解释 sub-tab 应**只**显示 kind=explain 的卡片（mockup 为视觉演示把 4 种 kind 卡片凑在了一张图） |
| Overview tab (active state) | `~/.gstack/projects/PaperFlow-Design/designs/chatgpt-mockup-20260424/v3-overview-tab.png` | warm-paper light theme · 4 块按 Pass 1.1 顺序 · 所有 AI 生成块带 "AI · gpt-4o-mini" 水印 · Contents 用 dotted leaders | 实现完全按 mockup 的视觉层级 + spec §3.2 的字号/字重/spacing 规则。无 deviation。 |

Mockup 作为"质感锚定 + 视觉验证"用；任何实现/mockup 不一致以 spec 文字为准。

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 17 issues across 4 sections, 0 unresolved, 2 critical gaps flagged (highlight Range silent fail · highlight dual-write non-atomic), 18 new tests planned |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (PLAN) | score: 7/10 → 9/10, 18 decisions added, 2 mockups approved (v3) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

**UNRESOLVED:** 0 (across both reviews)
**CRITICAL GAPS:** 2 (eng review §18.3 — `highlight-ranges` silent skip, `notes.upsert` dual-write non-atomic) — regression tests planned in §17.B.5
**VERDICT:** Design + Eng both CLEAR — ready to implement (skip_eng_review=false satisfied)

