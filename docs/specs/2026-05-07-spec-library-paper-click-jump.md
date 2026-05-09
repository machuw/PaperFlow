# Spec：Library 卡片点击跳转 + 阅读状态恢复

**关联 Phase**：`.planning/phases/27-library-paper-click-reader-hydration/`（v1.5-polish）
**关联 REQ**：REQUIREMENTS.md `LIBRARY (paper click → reader hydration — Phase 27, REQ IDs TBD)`
**作者**：Claude · 2026-05-07
**状态**：草案，待用户确认后进入 Plan 阶段

---

## 1. Objective（要做什么、为什么）

**用户故事**

> 作为一个已经收录了若干论文的用户，我点击 Library 抽屉里的任何一张论文卡片，期望在新 tab 打开该论文的 reader 主页面，并自动恢复我上次阅读时已生成的所有内容（解析、摘要、聊天历史、标注、笔记、canvas、阅读位置等）。

**现状缺陷（已诊断）**

1. **点击完全无反应（主因）** — `chrome-extension/reader/components/library-row.tsx:113` 的早退守卫
   ```ts
   if (t.closest('button, a, input, [role="button"], [role="menu"], [role="menuitem"]')) return;
   ```
   与卡片自身 `role={clickable ? 'button' : undefined}`（第 184 行）冲突：卡片就是最近的 `[role="button"]`，任何子元素 `closest()` 都先匹配到它 → 永远早退 → `onPaperClick` 从不触发。
2. **`row.src` 缺失时直接 toast 拒绝** — 旧条目 / 早期非 arxiv 来源没有捕获 `src`，目前会弹 "Open this paper from its original URL once to enable quick jump." 拒绝跳转。即便 `:parsed` 缓存还在，也无法打开。
3. **同 tab `hash + reload`** — 现有实现会丢掉当前 reader 的 in-memory 状态（chat 输入框、未保存草稿等），用户期望新 tab 打开。
4. **状态恢复未端到端验证** — 多数 `paper:*` 缓存（`:parsed` / `:memory` / `:notes` / `:highlights` / `:chatSessions` / `:summary:*` / `:overview:*` / `:canvas` / `:scroll` / `:workspace:tab` / `:variant-summary:*` 等）由各组件 mount 时按 `paperKey` 自行 hydrate，但需要逐项确认在新 tab 打开后确实复现。

**成功标准（可验证）**

- A. Library Drawer 中点击任意论文卡片的非交互区域 → 在新 tab 打开 `chrome-extension://<id>/reader/index.html#src=<URL>`，目标 tab 落到正确论文。
- B. 当 `row.src` 缺失但 `arxivId` 存在时 → 用 `https://arxiv.org/abs/<id>` 重建 URL 后跳转。
- C. 当 `row.src` 与 `arxivId` 都缺失，但 `paper:<key>:parsed` 缓存存在时 → 跳转到 `#paperKey=<key>`（新增的从缓存渲染入口），跳过原始 URL fetch。
- D. 当上述三者皆失（无 src、无 arxiv id、无解析缓存）→ 保留现有 toast，文案不变。
- E. 新 tab 打开后，下列状态在没有任何额外操作时自动恢复：
  - 论文正文 / outline / 段落（来自 `:parsed`）
  - 摘要 / Overview 各 section（来自 `:summary:*` / `:overview:*`）
  - 高亮 / 笔记 / 全部 chat session（含 active session 切换）
  - Canvas 布局 + agentNodes
  - 上次阅读位置 (`:scroll`) + 上次 workspace tab (`:workspace:tab`)
  - PaperMemory（whyItMatters / role / judgment / linked / nextActions）
- F. 当前 tab 不变（不 reload、不导航），用户可以在两个 tab 间切换。
- G. 点击卡片上的子按钮（library 选择、topic 选择、more 菜单、popover 等）依然只触发该按钮自身行为，不会"穿透"打开论文（由现有 `closest()` 逻辑覆盖，但需修复后保持兼容）。

**非目标**

- 不在本期给 Sidebar / Popover / Dropdown 添加论文列表（它们当前只渲染 library/topic 类目，没有 paper rows）。
- 不修改 `paper:*` 缓存的写入策略；只确保读取路径在跳转后正常工作。
- 不引入跨 paper 的 SPA 切换（in-tab paper swap），新 tab 已经满足需求。
- 不解决 BYOK / 配额 / Auth 相关的"打开后才发现没权限"问题——这些是 reader 加载链路的既有逻辑。

---

## 2. Tech Stack

- 现有：Chrome Extension MV3、Vite 5、React 18、TypeScript、`chrome.storage.local` 持久化
- 新增依赖：**无**
- 新 API 调用：`chrome.tabs.create({ url, active: true })`（已在 `manifest.json` 的 `tabs` 权限内，需确认）

---

## 3. Commands

```bash
# 默认开发（本地 Supabase）
cd chrome-extension && npm run build:dev

# 一次性 typecheck
cd chrome-extension && npm run typecheck   # 或 tsc -p tsconfig.json --noEmit

# 单元 / 集成测试（vitest）
cd chrome-extension && npm test -- --run

# E2E（Playwright）
cd chrome-extension && npm run test:e2e

# Lint
cd chrome-extension && npm run lint
```

构建后 `chrome://extensions/` → PaperFlow → 🔄 reload。

---

## 4. Project Structure（本次涉及的文件）

```
chrome-extension/reader/
├── components/
│   ├── library-row.tsx            ← 修复 closest() 守卫；保持 onPaperClick API 不变
│   └── library-drawer.tsx         ← handleNavigateToPaper 改为 chrome.tabs.create + 缓存路径回退
├── lib/
│   ├── ids.ts                     ← 新增 reconstructUrlForLibraryRow(row)：arxiv → URL；其他 → null
│   └── (storage.ts 不动)
├── main.tsx                       ← readSrc() 旁新增 readPaperKey()；loadPaper 支持纯 paperKey 入口
└── tests/
    ├── unit/library-row.test.tsx  ← 新增：clickable 卡片的 click event 必须触发 onPaperClick
    ├── unit/library-drawer.test.tsx ← 新增：handleNavigateToPaper 的三条分支（src / id 重建 / paperKey）
    └── e2e/library-jump.spec.ts   ← 新增：Drawer → 卡片点击 → 新 tab → 状态恢复断言
```

---

## 5. Code Style

匹配现有代码（紧凑 React + 函数式 + `var(--token)` 内联样式）。

**示例：修复 `library-row.tsx` 的 closest 守卫**

```tsx
// Before（bug）：卡片自身 role=button 让 closest 永远早退
if (t.closest('button, a, input, [role="button"], [role="menu"], [role="menuitem"]')) return;

// After：排除卡片自身（e.currentTarget），只拦真正的子级交互元素
const interactive = t.closest('button, a, input, [role="menu"], [role="menuitem"]');
if (interactive && interactive !== e.currentTarget) return;
// 注意：不再把 [role="button"] 列入选择器——卡片本身就是 role=button，
// 子级的 button 已被前面的 'button' 覆盖。
```

**示例：`handleNavigateToPaper` 重写为新 tab + 缓存回退**

```ts
async function handleNavigateToPaper(rowKey: string) {
  if (rowKey === currentPaperKey) { onClose(); return; }
  const row = rows.find(r => (r.id ?? r.urlHash) === rowKey);
  if (!row) return;

  // 优先级：row.src → 用 arxivId 重建 → 用 paperKey 走缓存渲染 → toast 拒绝
  let target: { kind: 'src'; value: string } | { kind: 'paperKey'; value: string } | null = null;
  if (row.src) target = { kind: 'src', value: row.src };
  else if (row.id && /^\d{4}\.\d{4,5}/.test(row.id)) target = { kind: 'src', value: `https://arxiv.org/abs/${row.id}` };
  else if (await getCachedParsed(rowKey)) target = { kind: 'paperKey', value: rowKey };

  if (!target) {
    showToast({ message: t('library.jump.needsOriginalUrl') });
    return;
  }

  // 重要：#src= 走原始 URL（不要 encodeURIComponent）。inject.ts / sw.ts DNR 都
  // 用 raw URL，readSrc() 用 location.hash.slice('#src='.length) 不 decode；
  // 一旦在写入侧 encode，读出来就是 'https%3A%2F%2F...' → fetch() 当相对路径 →
  // ERR_FILE_NOT_FOUND（2026-05-07 playwright 复现确认）。
  // #paperKey= 同理保持原始字符串（paperKey 是受控的 ASCII，不需要 encode）。
  const fragment = target.kind === 'src' ? `#src=${target.value}` : `#paperKey=${target.value}`;
  const url = chrome.runtime.getURL('reader/index.html') + fragment;
  chrome.tabs.create({ url, active: true });
}
```

**示例：`main.tsx` 支持 `#paperKey=` 入口**

```ts
function readPaperKey(): string | null {
  // 与 readSrc() 一致：不 decode（写入侧也不 encode）。
  if (location.hash.startsWith('#paperKey=')) return location.hash.slice('#paperKey='.length);
  return null;
}

// loadPaper 之外新增：从缓存渲染（不重新 fetch）
async function loadPaperFromCache(paperKey: string): Promise<LoadedPaper | null> {
  const cached = await getCachedParsed(paperKey);
  if (!cached) return null;
  const mem = (await getMemory(paperKey)) ?? emptyMemory();
  return {
    paper: { /* 与 loadPaper 同结构，id/urlHash 从 paperKey 反推 */ },
    pdfRuntime: null,  // 缓存路径不再启动 pdfjs；如缓存表明是 PDF，需另行处理（见 Open Questions Q4）
  };
}
```

**命名约定**

- 新函数：`reconstructUrlForLibraryRow`、`readPaperKey`、`loadPaperFromCache`
- i18n key：`library.jump.needsOriginalUrl`
- 测试文件：`library-row.test.tsx` / `library-drawer.test.tsx` / `library-jump.spec.ts`

---

## 6. Testing Strategy

| 层级 | 框架 | 覆盖点 |
|---|---|---|
| Unit | Vitest + RTL | `library-row.test.tsx`：clickable 卡片点击非交互区域必须 fire `onPaperClick`；点击子按钮 / popover / input 必须 NOT fire |
| Unit | Vitest | `library-drawer.test.tsx`：`handleNavigateToPaper` 的三条分支 + 当前论文 → onClose；mock `chrome.tabs.create` |
| Unit | Vitest | `ids.test.ts`：`reconstructUrlForLibraryRow` 对各来源（arxiv id-only / arxiv URL / 其他 URL / 空）的输出 |
| Integration | Vitest | `main.test.tsx`：`#paperKey=` 入口 → `loadPaperFromCache` 命中 → ViewerApp 正常 mount |
| E2E | Playwright | `library-jump.spec.ts`：seed paper + memory + chat session → 打开 Drawer → 点卡片 → 新 tab 载入 → 断言摘要/笔记/chat/scroll 都已恢复 |

**测试位置**：`chrome-extension/tests/`（遵循 MEMORY 中的项目惯例，复用现有基建，不新建子项目）。

**覆盖目标**：本次改动文件 line coverage ≥ 85%；E2E 走完一次完整跳转链。

---

## 7. Boundaries

**Always do（每次必做）**
- 修改后跑 `npm run typecheck` + `npm test -- --run` + 至少手测 Drawer 点击 + 新 tab 状态恢复
- 走 `chrome.runtime.getURL('reader/index.html')` 构造扩展内 URL，不硬编码扩展 ID
- i18n 文案走 `t('library.jump.needsOriginalUrl')`，三种 locale（en/zh-CN/ja 或现有支持集）都加翻译键

**Ask first（先问再动）**
- 若需要给 `manifest.json` 加 `tabs` 权限（先确认是否已在 permissions 内）
- 若 `loadPaperFromCache` 路径下要支持 PDF（涉及把 pdfDoc 重新启动）→ 见 Open Questions Q4
- 若需要修改 `LibraryRow` schema（例如新增字段）→ 与 syncLibraryRow / cloud schema 联动，需要单独 Phase
- 若决定把 Sidebar 也改成显示论文列表 → 不在本 Spec 范围

**Never do（绝对不做）**
- 不删除 `library-row.tsx` 的早退守卫（即使修复后简化），仍要拦子级交互元素，否则 popover/menu 会被卡片点击穿透
- 不写 BYOK 配置到云端（MEMORY: feedback_byok_local_only）
- 不直接改 `subscriptions.tier`（Stripe webhook 唯一写入路径）
- 不在 commit 里塞 `dist/`
- 不开 hosted Supabase 跑日常迭代（CLAUDE.md 政策：build:dev only）

---

## 8. Success Criteria（验收 checklist）

- [ ] **Drawer 点击触发**：点击任意一张卡片的非交互区域，能看到一个新 tab 弹出（不依赖键盘）
- [ ] **arxiv 旧条目可跳**：构造一个 `row.src=undefined, row.id="2401.12345"` 的条目，点击 → 新 tab 用 `https://arxiv.org/abs/2401.12345` 打开
- [ ] **缓存兜底可跳**：构造 `src=undefined, id=undefined`，但写好 `paper:<urlHash>:parsed` 缓存 → 点击 → 新 tab 用 `#paperKey=<urlHash>` 打开，渲染缓存内容
- [ ] **toast 兜底**：上述三者都没有 → 显示 `library.jump.needsOriginalUrl` toast，行为不变
- [ ] **同 tab 不动**：跳转后原 reader tab 的 chat 输入 / 滚动 / 选区都没丢
- [ ] **状态恢复**（手测 + E2E 各一）：新 tab 中
  - [ ] outline / 段落正确
  - [ ] 摘要 / Overview 显示之前生成的内容（非加载态）
  - [ ] highlights / notes 渲染
  - [ ] chat session 切换器显示之前的 session，并自动落到 active session
  - [ ] canvas 节点位置 + agentNodes 还原
  - [ ] 滚动位置回到上次（`:scroll`）
  - [ ] workspace tab 回到上次（`:workspace:tab`）
- [ ] **typecheck + 单元测试 + E2E 全绿**
- [ ] **DEV pill 仍可见**（确认未影响 dev/prod 环境指示）

---

## 9. Open Questions（需要用户决策）

> 这些问题如果你不指定，我会按括号中的 default 推进。

1. **i18n 文案要不要顺便改？** 现有 toast `'Open this paper from its original URL once to enable quick jump.'` 是硬编码英文。本期是否一起改成 i18n key + 三语？(default：是，文案 key = `library.jump.needsOriginalUrl`)
2. **`#paperKey=` 入口的 `Paper.id` / `urlHash` 怎么填？** 缓存路径下我们没有原始 URL，只有 paperKey。`Paper.id` 用 `paperKey`（如果是 arxiv 形式）or `undefined`？(default：若 paperKey 形如 `2401.xxxxx` 则填 id，否则只填 urlHash)
3. **PDF 缓存的兜底渲染怎么办？** `loadPaper` 对 PDF 缓存会重新启动 pdfjs 走 `loadPdfPath(pdfUrl, ...)`，需要原始 PDF URL。如果 `row.src` 缺失，能不能从缓存里抽出 URL？或者 PDF 路径直接 fallback 到 toast？(default：fallback 到 toast，PDF 缓存兜底放 v1.6 再做)
4. **当前论文重复点击**：现在是 `if (rowKey === currentPaperKey) { onClose(); return; }`。新 tab 模式下是否也要保持这个短路（避免开重复 tab）？(default：保持短路 + 关 drawer)
5. **新 tab 焦点行为**：`chrome.tabs.create({ active: true })` 立即抢焦点。是否要 `active: false` 让用户手动切换？(default：active: true，符合"立即跳转"心智)

---

## 10. 不在本 Spec 范围（明确划掉，避免 scope creep）

- Library Sidebar / Popover / Dropdown 添加论文列表
- BYOK 在新 tab 的同步行为（已经由 storage 自动处理）
- 跨设备 sync 的 paper 状态拉取（已由 Phase D-F 覆盖）
- 跨 paper 的 SPA in-tab swap（性能优化，留待后续）
- Library Drawer 的搜索 / 排序 / 筛选改进
- 卡片视觉重做

---

**下一步**：用户 review 本 Spec → 解决 Open Questions → 进入 `agent-skills:planning-and-task-breakdown` 拆任务。
