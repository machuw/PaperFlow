# PaperFlow Chrome Extension — 设计文档

## 1. 项目定位

将现有 PaperFlow UI 原型转化为可用的 Chrome 扩展，核心场景：用户在浏览器中打开 arXiv / PDF 链接时，自动以 PaperFlow 界面接管阅读体验，提供 AI 辅助的论文阅读能力。

---

## 2. 技术选型（复用优先）

| 需求 | 复用方案 | 来源 |
|------|---------|------|
| PDF 渲染 | `pdfjs-dist` library 模式（非 viewer.html），自己控制渲染 | npm |
| 扩展构建 | Vite 原生多入口配置（~20行 vite.config.ts），content script 打成 IIFE 格式 | vite |
| AI 调用 | 原生 `fetch` + OpenAI 兼容接口（`/v1/chat/completions`），支持任意 baseURL/apiKey/model | 原生 |
| UI 组件 | 直接迁移现有原型的 JSX 组件，零重写 | 本项目 |
| 字体/样式 | 现有 `tokens.css` 直接复用 | 本项目 |

---

## 3. 扩展架构

```
chrome-extension/
├── manifest.json              # MV3
├── vite.config.ts             # 多入口：reader + content + sw
├── background/
│   └── service-worker.ts      # 最小化：仅处理 tab 重定向触发
├── content/
│   └── detector.ts            # run_at: document_start，检测 PDF/arXiv
├── pages/
│   └── reader/
│       ├── index.html         # 全页面 Reader
│       └── main.tsx           # 挂载 ViewerApp，直接调用 AI
│   └── options/
│       ├── index.html         # BYOK 配置页
│       └── main.tsx
├── components/                # 直接复用原型所有 JSX 组件
├── styles/
│   └── tokens.css             # 直接复用
└── lib/
    ├── pdf-bridge.ts          # pdf.js 封装：文本提取、大纲解析、arXiv元数据
    └── ai-client.ts           # AI 流式调用（OpenAI 兼容接口）
```

---

## 4. 核心功能模块

### 4.1 内容接管（arXiv 优先）

- **触发条件**：content script（`run_at: document_start`, `all_frames: false`）检测 URL
  - `arxiv.org/html/` 或 `ar5iv.org/` → 直接重定向（优先，解析质量最高）
  - `arxiv.org/pdf/` 或 `.pdf` 结尾 → 直接重定向（fallback）
  - `arxiv.org/abs/` → 注入"在 PaperFlow 中打开"按钮（不自动重定向）
- **实现**：重定向到 `reader/index.html?url=<原始URL>&type=html|pdf`
- **渲染策略**：
  - HTML 模式：在 content script 或 SW 里 fetch arXiv HTML（扩展环境不受页面 CSP 限制），传给 reader page 解析，段落/公式/图表天然保留
  - PDF 模式：reader page 先直接 fetch PDF；仅当 fetch 失败（目标服务器不支持 CORS）时，回退到 SW fetch → `chrome.runtime.sendMessage` 传 ArrayBuffer → reader page 创建 blob URL → pdfjs-dist library 模式渲染

### 4.2 数据层替换（mock → 真实）

原型中 `window.PAPER` 是静态 mock，需替换为真实解析：

| 原型字段 | HTML 模式来源 | PDF 模式来源 |
|---------|-------------|------------|
| `title`, `authors`, `venue` | arXiv API (`export.arxiv.org/api/query`) | pdf.js 元数据 |
| `outline` | DOM 解析（`<section>` 标题层级） | pdf.js `getOutline()` |
| `paragraphs` | DOM 解析（`<p>` 段落） | pdf.js `getTextContent()` 按段落分组 |
| `abstract` | arXiv API 或 DOM 解析 | PDF 首页文本提取 |
| `memory` | `chrome.storage.local` 持久化 | 同左 |

### 4.3 AI 功能（E/S/T/H 操作）

原型中 `generateBody()` 返回硬编码文本，替换为真实 AI 调用：

```
用户选中文本 → SelectionToolbar → runAction()
→ reader page 直接调用 AI（原生 fetch + OpenAI 兼容接口，流式）
→ MarginNote 流式渲染（原型已有 ink-streaming 动画）
```

**配置**：用户在 Options 页面配置 `baseURL`、`apiKey`、`model`，存入 `chrome.storage.local`，支持 OpenAI / DeepSeek / Ollama 等任意兼容服务。状态栏已有 `BYOK` 标识，与原型一致。

### 4.4 Library（论文库）

原型已有 `LibraryDrawer` 组件，后端接入：
- 存储：`chrome.storage.local`，key 为 arXiv ID
- 数据：`{ id, title, authors, addedAt, lastRead, notes }`
- 触发：用户点击 "Add to Library" 或首次打开论文时自动保存

### 4.5 Memory（研究上下文）

原型 `memory` 字段（`whyItMatters`, `role`, `judgment`, `linked`）对应用户的研究笔记：
- 每篇论文独立存储在 `chrome.storage.local`
- Chat 面板（`WorkspacePanel` 的 chat tab）支持用户手动编辑
- AI 在 explain/summarize 时自动引用 memory 内容作为 system prompt 上下文

---

## 5. 三种视图模式详细设计

### 5.1 Focus 模式 — 侧边 Margin Notes

布局：论文主体（左）+ margin notes 列（右，240px 固定宽）

**Margin Note 锚定机制：**
- 每个段落有 `data-pid` 属性（如 `data-pid="p2"`）
- AI 操作完成后，`MarginNote` 组件通过 `document.querySelector('[data-pid="xxx"]')` 获取段落的 `getBoundingClientRect().top`，计算相对于 margin 列容器的偏移量，设为 `position: absolute; top: <offset>px`
- 多个 note 重叠时按 `minGap=110px` 向下推移（原型 `MarginColumn` 已实现）
- 连接线：SVG `<path>` 从段落右边缘画到 note 左边缘，`ink-pen-draw` 动画模拟手写效果
- 流式输出：`ink-streaming` CSS class 在文字末尾显示闪烁光标，原型已实现

**默认预置 notes（原型已有）：**
- "WHY THIS MATTERS" — 锚定到 p2，来自 `paper.memory.whyItMatters`
- "LINKED CONTEXT" — 锚定到 p3，来自 `paper.memory.linked`

### 5.2 Classic 模式 — WorkspacePanel

布局：论文主体（左，flex-1）+ WorkspacePanel（右，380px 固定宽）

**三个 Tab：**

**Summary tab（默认）：**
- THREE-LINE SUMMARY：AI 对全文生成3条核心结论，右侧刷新按钮可重新生成
- KEY TERMS：提取论文关键术语 + 一句话定义
- DETAILED SUMMARY：全文详细摘要段落
- 以上内容在论文首次加载时自动触发 AI 生成，结果缓存到 `chrome.storage.local`

**Chat tab：**
- 对话界面，用户可针对论文内容提问
- system prompt 注入：论文全文摘要 + `paper.memory` 上下文
- 消息历史存储在 `chrome.storage.local`，按论文 ID 隔离

**Memory tab：**
- 展示并编辑 `paper.memory` 字段：`whyItMatters`、`role`、`judgment`、`linked`
- 可手动编辑，保存到 `chrome.storage.local`
- AI 操作时自动引用 memory 内容作为 system prompt 上下文

### 5.3 Canvas 模式 — 全屏可视化

布局：全屏替换 reader，顶部有"← Back"返回按钮

**绘图方案：使用 `react-flow`（github.com/xyflow/xyflow）**
- 零手写图形引擎，直接复用成熟库
- 节点类型：
  - 论文节点（标题、作者、venue）
  - 章节节点（对应 outline 每一项）
  - Note 节点（用户的 margin notes 和 memory）
  - 关系节点（linked papers）
- 边：章节节点连接到论文节点，note 节点连接到对应章节
- 初始布局：`dagre` 自动排布（`dagre` + `react-flow` 是标准组合）
- 节点可拖拽，布局持久化到 `chrome.storage.local`

---

## 6. TopBar 控件设计

TopBar 右侧三个控件（截图红框区域）：

| 控件 | 图标 | 功能 |
|------|------|------|
| 暗色模式 | 月亮图标 | 切换 dark theme，`data-theme="dark"` 写到 `<html>`，持久化到 `localStorage` |
| 亮色模式 | 太阳图标 | 切换 light theme |
| Tweaks | 星形/魔法棒图标 | 打开 TweaksPanel 浮层 |

**TweaksPanel 内容（原型已有 `TweaksPanel` 组件）：**
- Reader font：Serif / Sans 切换
- Page width：滑块，480–960px
- Paper grain：开关，控制 `.paper-grain` CSS class
- Margins：开关，控制 Focus 模式下 margin notes 列是否显示

所有 tweaks 持久化到 `localStorage` key `pf-tweaks`，reader page 启动时读取。

**右边栏隐藏按钮（TopBar 左侧）：**
- 点击切换 `workspaceOpen` state（Classic 模式下隐藏/显示 WorkspacePanel）
- Focus 模式下同一按钮控制 outline 面板

---

## 6. 键盘快捷键（继承原型）

| 快捷键 | 功能 |
|--------|------|
| `E` | Explain 选中文本 |
| `S` | Summarize 选中文本 |
| `T` | Translate 选中文本 |
| `H` | Highlight 选中文本 |
| `⌘K` | 命令面板 |
| `⌘\` | 切换大纲 |
| `⌘L` | 打开 Library |

---

## 7. 实现阶段

**Phase 1 — 骨架（1-2天）**
- Vite 多入口配置，扩展可加载
- content script 检测 arXiv/PDF URL 并触发重定向
- reader page 显示原型 UI（仍用 mock 数据）
- **验收**：① 打开 arxiv.org/pdf/xxxx → 自动跳转到 reader page，看到 PaperFlow UI；② 打开 arxiv.org/abs/xxxx → 页面出现"在 PaperFlow 中打开"按钮

**Phase 2 — 真实内容渲染（2-3天）**
- 优先实现 arXiv HTML 模式：fetch HTML，解析段落/大纲/元数据，填充 `window.PAPER`
- fallback 实现 PDF 模式：pdfjs-dist library 模式，`getTextContent()` 按段落分组
- **验收**：打开真实 arXiv 论文，大纲、段落、标题正确显示

**Phase 3 — AI 功能（1-2天）**
- `ai-client.ts` 接入 AI（原生 fetch + OpenAI 兼容接口，流式）
- 替换 `generateBody()` 为真实调用
- Options 页面实现 BYOK 配置

**Phase 4 — Library & Memory（1天）**
- `chrome.storage.local` 持久化
- Library 增删查
- Memory 编辑和 AI 上下文注入

---

## 8. 关键约束

- **AI 流式响应**：reader page 直接用原生 fetch 调用 OpenAI 兼容接口，绕开 MV3 SW 无持久状态限制
- **arXiv HTML fetch**：在 content script 或 SW 里执行（扩展环境不受页面 CSP 限制），结果传给 reader page
- **PDF 跨域加载**：reader page 先直接 fetch；失败时回退到 SW fetch → sendMessage 传 ArrayBuffer（注意 64MB 消息限制）；manifest 声明 `host_permissions: ["*://*.arxiv.org/*", "https://export.arxiv.org/*"]`
- **Vite content script 打包**：content script 必须打成 IIFE 格式，需在 vite.config.ts 中单独配置
- **API Key 安全**：Key 仅存 `chrome.storage.local`，不上传，不打包进扩展
