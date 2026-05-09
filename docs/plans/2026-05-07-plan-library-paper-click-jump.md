# Plan：Library 卡片点击跳转 + 阅读状态恢复

**关联 Spec**：`docs/specs/2026-05-07-spec-library-paper-click-jump.md`（已确认，5 个 Open Questions 全锁 default）
**关联 Phase**：`.planning/phases/27-library-paper-click-reader-hydration/`
**作者**：Claude · 2026-05-07
**状态**：草案，待用户 review 后开始实施

---

## Overview

修复 Library Drawer 卡片点击的三个缺陷：
1. **断**：`closest('[role="button"]')` 与卡片自身 `role="button"` 冲突，导致 `onPaperClick` 永不触发
2. **窄**：仅 `row.src` 可用时才能跳；旧条目 / 缓存兜底缺失
3. **粗**：同 tab `hash + reload` 丢失当前 reader in-memory 状态；UX 应改为新 tab

四个垂直切片，每片完成后用户可见的功能闭环都会增强一截：A 修点击、B 改新 tab + i18n、C 加 fallback 链、D 验证状态恢复全覆盖。

---

## Architecture Decisions

| 决策 | 理由 |
|---|---|
| 修 `closest()` 守卫时 **不去掉对 `[role="button"]` 子元素的拦截**，仅排除 `e.currentTarget` 自身 | 防止未来子元素引入 `role="button"`（如自定义按钮）时再次穿透 |
| 跳转走 `chrome.tabs.create({ url, active: true })`，**不**改 `manifest.json` permissions | MV3 中 `tabs.create` 打开扩展自己的 URL 不需要 `tabs` 权限；4 处已在用 |
| 新增 `#paperKey=<key>` 入口，与现有 `#src=<URL>` 并存 | 让缓存兜底路径有独立信号，避免 `loadPaper(src=paperKey)` 时被 `urlHash(src)` 二次哈希 |
| `loadPaperFromCache` 路径下 **不启动 pdfjs**（PDF 缓存兜底推到 v1.6） | 缓存里没有原始 PDF URL，重启 pdfDoc 需要额外 schema 改动；本期只覆盖 HTML 缓存 |
| arxiv id 重建用 `https://arxiv.org/abs/<id>`（非 `/pdf/`） | `loadPaper` 对 `/abs/` 走 HTML 解析路径，`/pdf/` 走 pdfjs；abs 路径与 fresh load 行为一致 |
| 测试落点遵循 `tests/library-v2/{unit,e2e}/`，i18n key 文案 + ids helper 走 `tests/lib/` 或就近 | 与现有 library v2 测试集群保持一致，复用 `_fixtures.ts` |
| i18n key 命名 `library.jump.needsOriginalUrl`，三语都加 | MEMORY: 文档中文，但代码 i18n key 英文；翻译由 Claude 直接产出（不引入运行时 MT） |

---

## 依赖图

```
                    [A1] library-row.tsx closest() 守卫修复
                         ├─ [A2] library-row 单测
                         └────────────────────────────────┐
                                                          ▼
[B1] i18n keys 三语 ──┐                            (Drawer 现有 handler 跑通)
                      ├─[B2] handleNavigateToPaper ──→ chrome.tabs.create + i18n toast
[B3] mock chrome.tabs └─                           [B4] drawer 单测（同 tab → 新 tab 行为变更）
                                                          │
                                                          ▼
[C1] ids.ts: reconstructUrlForArxivRow ──────┐
[C2] storage.ts: loadPaperFromCache (新)   ──┤
[C3] main.tsx: readPaperKey + 入口分发 ───────┼──→ [C4] handleNavigateToPaper 加 4 段 fallback
[C5] ids/loadFromCache 单测                  │      [C6] drawer fallback 4 分支单测
                                             │      [C7] main.tsx integration: #paperKey= 入口
                                             ▼
                          [D1] e2e: 点击 → 新 tab → 7 项状态恢复断言
                          [D2] 手测 checklist
```

---

## Task List

### Phase A：修点击穿透（即刻解锁"点不动"）

#### A1：修 `library-row.tsx` 的 closest 守卫

**Description**：把卡片自身（`e.currentTarget`，role=button）从早退选择器中排除，仅拦真正的子级交互元素。

**Acceptance criteria**：
- [ ] `handleCardClick` 在点击卡片非交互区域时调用 `onPaperClick(rowKey)`
- [ ] 点击子级 `<button>` / `<a>` / `<input>` / `[role="menu"]` / `[role="menuitem"]` 时**不**触发 `onPaperClick`
- [ ] 点击子级带 `[role="button"]` 的虚拟按钮（如未来引入）时**不**触发 `onPaperClick`
- [ ] 点击发生在文字 selection 后（`window.getSelection().toString()` 非空）时**不**触发（保留现有逻辑）
- [ ] `handleCardKeyDown` 行为不变（Enter/Space 仍触发）

**Verification**：
- [ ] `cd chrome-extension && npm run typecheck`
- [ ] `cd chrome-extension && npm test -- click-jump --run`
- [ ] 手测：build:dev → reload → ⌘L → 点击任意卡片非按钮区域 → URL 变化（A 阶段仍是 hash + reload）

**Dependencies**：None（最小、最高优先级）

**Files likely touched**：
- `chrome-extension/reader/components/library-row.tsx`（约 5 行）

**Estimated scope**：XS

---

#### A2：单测 `library-row.test.tsx` — 点击穿透矩阵

**Description**：用 RTL 渲染 `LibraryRowView`，覆盖点击穿透 / 拦截的 5 个矩阵分支。

**Acceptance criteria**：
- [ ] 测试 1：点击卡片正文 → `onPaperClick` 被调用
- [ ] 测试 2：点击卡片上的 "more" 按钮 → `onPaperClick` 不被调用，`setCardMenuOpen` 切换
- [ ] 测试 3：点击 library 选择按钮 → `onPaperClick` 不被调用
- [ ] 测试 4：模拟 `window.getSelection().toString()` 非空 → 点击不触发 `onPaperClick`
- [ ] 测试 5：键盘 Enter（focus 在卡片自身）→ `onPaperClick` 触发
- [ ] 测试 6：`isCurrent=true` 或无 `onPaperClick` → 卡片不带 `role="button"`、tabIndex 不存在

**Verification**：
- [ ] `npm test -- click-jump --run` 全绿，新 6 个 case
- [ ] coverage 报告显示 `handleCardClick` / `handleCardKeyDown` ≥ 90% line coverage

**Dependencies**：A1

**Files likely touched**：
- `chrome-extension/tests/library-v2/unit/click-jump.test.tsx`（新建）
- 复用 `tests/library-v2/_fixtures.ts` 里的 LibraryRow 工厂（如有，否则就近创建）

**Estimated scope**：S

---

### Checkpoint A：点击不穿透了

- [x] A1 + A2 全绿（2026-05-07）
- [x] 手测确认点击 → URL 变化 + 论文成功加载（playwright network log 验证 200 OK）
- [x] **意外发现 + 已修：`handleNavigateToPaper` 原本对 hash 调 `encodeURIComponent`，与 `inject.ts` / `sw.ts` raw URL 约定不一致，导致 `readSrc()` 拿回 encoded 字符串、`fetch()` 当成相对路径 → ERR_FILE_NOT_FOUND**。已去掉 encodeURIComponent，使 #src= 走 raw URL。

#### A3（追加）：Hash encoding convention 规范

**Description**：发现 `library-drawer.tsx:203` 把 raw URL `encodeURIComponent` 之后写入 `location.hash`，但 `main.tsx:69` `readSrc()` 用 `slice` 不 decode；旧的 `inject.ts` / `sw.ts` 都按 raw URL 设计。结果就是从 library 跳转后 fetch 失败。

**已修**：
- `library-drawer.tsx`：`window.location.hash = '#src=' + target`（去掉 encodeURIComponent + 加注释解释为什么不 encode）

**对 Phase B/C 的连带要求**：
- B2 / C4 在 `chrome.tabs.create` 构造 URL 时，`#src=` / `#paperKey=` 都用 **raw 字符串**（不 encode）。
- C3 `readPaperKey()` 与 `readSrc()` 对称——也不 decode。
- B4 / C6 单测必须显式断言 chrome.tabs.create 收到的 URL 是 raw（不含 `%3A` `%2F`）。

**Verification**：
- [x] playwright + dist build 重放：`#src=https://arxiv.org/pdf/2604.05015` → 200 OK + 进入 Loading paper
- [x] 之前的 `#src=https%3A%2F%2F...` → ERR_FILE_NOT_FOUND（反证）

---

### Checkpoint A 收尾

- [x] A1 + A2 + A3 全绿
- [ ] **回到用户确认：手测重现修好了？同意推进 Phase B？**

---

### Phase B：改新 tab + i18n toast

#### B1：i18n keys 三语

**Description**：新增 `library.jump.needsOriginalUrl` 文案，覆盖现有 toast 硬编码英文。

**Acceptance criteria**：
- [ ] `chrome-extension/reader/i18n/locales/en.ts`（或 .json，依现有结构）新增 `library.jump.needsOriginalUrl: 'Open this paper from its original URL once to enable quick jump.'`
- [ ] `zh-CN`（或 `zh.ts`）：`'请先从论文的原始链接打开一次，才能从 Library 快速跳转。'`
- [ ] 第三语种（`ja` / 其他依现状）跟齐
- [ ] `i18n-completeness` 测试（如有 phase23 级别的 grep）通过

**Verification**：
- [ ] `npm test -- i18n --run` 全绿
- [ ] grep 不再有 `'Open this paper from its original URL once'` 字面量出现在 `.tsx` / `.ts`（除文档/测试）

**Dependencies**：None

**Files likely touched**：
- `chrome-extension/reader/i18n/locales/{en,zh,ja}.{ts,json}`（具体路径依现状探查后确定）

**Estimated scope**：XS（3 文件 1 行 each）

---

#### B2：`handleNavigateToPaper` 改为 `chrome.tabs.create`

**Description**：替换 `window.location.hash + reload` 为 `chrome.tabs.create({ url, active: true })`，先保留单一 src 路径（不引入 fallback），把 navigation 模式先切干净。

**Acceptance criteria**：
- [ ] `target = row.src` 时，构造 `chrome.runtime.getURL('reader/index.html') + '#src=' + encodeURIComponent(row.src)`，调 `chrome.tabs.create({ url, active: true })`
- [ ] `rowKey === currentPaperKey` 时仍 `onClose(); return`（不开重复 tab）
- [ ] `target` 缺失（既没 src 也没 fallback，本阶段还没加）→ 保留 toast，但文案换成 `t('library.jump.needsOriginalUrl')`
- [ ] 当前 reader tab **不变**（不 reload、不 navigate、scroll/chat 不丢）
- [ ] Drawer 自动关闭（`onClose()` 在 tab 创建后调用）

**Verification**：
- [ ] `npm run typecheck`
- [ ] `npm test -- navigate-to-paper --run`（B4 创建后）
- [ ] 手测：build:dev → reload → 抓一个有 `src` 的卡片点击 → 新 tab 弹出 + 当前 reader 完全不动

**Dependencies**：A1, B1

**Files likely touched**：
- `chrome-extension/reader/components/library-drawer.tsx`（`handleNavigateToPaper` 函数，约 15 行）

**Estimated scope**：S

---

#### B3：vitest setup 补齐 `chrome.tabs.create` mock

**Description**：现有测试 mock 链可能没声明 `chrome.tabs.create`，B4 单测需要它。

**Acceptance criteria**：
- [ ] `tests/setup.ts`（或对应 vitest setupFiles）确保 `globalThis.chrome.tabs.create` 可被 spy/mock
- [ ] 如果已经覆盖（grep 已有 4 处用了），则只确认；不重复声明

**Verification**：
- [ ] B4 测试在 vitest 下能成功 spy `chrome.tabs.create`

**Dependencies**：None

**Files likely touched**：
- `chrome-extension/tests/setup.ts` 或等价的 setup 文件（探查后确定）

**Estimated scope**：XS（很可能 0 行改动，只是确认）

---

#### B4：单测 `navigate-to-paper.test.tsx`

**Description**：覆盖 `handleNavigateToPaper` 的 3 个分支（B 阶段，未加 fallback 前）。

**Acceptance criteria**：
- [ ] 测试 1：点击有 src 的 row → `chrome.tabs.create` 被调用，URL 含 `#src=` + 编码后的原 URL，`active: true`
- [ ] 测试 2：点击 `rowKey === currentPaperKey` → `chrome.tabs.create` **不**被调用，`onClose` 被调用
- [ ] 测试 3：点击无 src / 无 fallback 的 row → toast 弹出，文案 = `t('library.jump.needsOriginalUrl')` 解析结果

**Verification**：
- [ ] `npm test -- navigate-to-paper --run` 3 个 case 全绿

**Dependencies**：B2, B3

**Files likely touched**：
- `chrome-extension/tests/library-v2/unit/navigate-to-paper.test.tsx`（新建）

**Estimated scope**：S

---

### Checkpoint B：新 tab + i18n 已就绪（但仅覆盖 row.src 已存在的论文）

- [ ] A + B 全部 task 全绿
- [ ] 手测：build:dev → reload → 任意有 src 的论文卡片 → 新 tab 打开 + 原 tab 不动
- [ ] **回到用户确认 → 是否同意推进 Phase C 的 fallback 链**

---

### Phase C：fallback 链（arxiv id → paperKey 缓存 → toast）

#### C1：`ids.ts` 新增 `reconstructUrlForArxivRow`

**Description**：纯函数，输入 `LibraryRow`，若 `id` 形如 arxiv ID 则返回 `https://arxiv.org/abs/<id>`，否则 null。

**Acceptance criteria**：
- [ ] 函数签名：`reconstructUrlForArxivRow(row: Pick<LibraryRow, 'id'>): string | null`
- [ ] arxiv ID 正则：与 `normalizeArxivId` 接受范围一致（含 `2401.12345` / `2401.12345v2` / 旧式 `cs/0512345` 等所有 arxiv 实际形态）
- [ ] export 出去供 `library-drawer` 复用

**Verification**：
- [ ] `npm test -- ids --run` 新 case 通过

**Dependencies**：None

**Files likely touched**：
- `chrome-extension/reader/lib/ids.ts`（约 5-10 行）

**Estimated scope**：XS

---

#### C2：`storage.ts` 新增 `loadPaperFromCache`

**Description**：从 `paper:<key>:parsed` + `paper:<key>:memory` 重组一个 `LoadedPaper`（不走 fetch / pdfjs）。

**Acceptance criteria**：
- [ ] 签名：`loadPaperFromCache(paperKey: string): Promise<LoadedPaper | null>`
- [ ] 命中 `:parsed` 时，构造 `Paper`：
  - `id`：若 paperKey 形如 arxiv ID（用 C1 同款判断）→ 填，否则 undefined
  - `urlHash`：始终 = paperKey（缓存路径下 paperKey 即 urlHash 或 arxivId，跟现有 `paperKey()` 函数语义一致）
  - 其他字段从 `:parsed` 取
  - `memory`：`getMemory(key) ?? emptyMemory()`
- [ ] 当 `:parsed` 是 PDF 缓存（`outline.every(o => typeof o.page === 'number')`）→ 返回 null（PDF 兜底推到 v1.6）
- [ ] 未命中 → 返回 null
- [ ] `pdfRuntime: null`

**Verification**：
- [ ] `npm test -- load-paper-from-cache --run` 新 case 通过：命中 HTML 缓存、命中 PDF 缓存（返回 null）、未命中（返回 null）

**Dependencies**：None

**Files likely touched**：
- `chrome-extension/reader/lib/storage.ts`（新增函数，约 25 行）或新建 `chrome-extension/reader/lib/load-paper-from-cache.ts`（更内聚，倾向新建）

**Estimated scope**：S

---

#### C3：`main.tsx` 增加 `#paperKey=` 入口

**Description**：在 `loadPaper(src)` 之外增加从 paperKey 直接拉缓存的入口。

**Acceptance criteria**：
- [ ] 新增 `readPaperKey()`：`location.hash.startsWith('#paperKey=')` 时 decode 返回，否则 null
- [ ] effect 内分发逻辑：先试 `readPaperKey()` → 若存在就调 `loadPaperFromCache` → 命中就 `setState({ kind: 'ok', ... })`；未命中就走 `setState({ kind: 'error', message: <i18n: cache miss> })`
- [ ] 若 `readPaperKey()` 为 null → 维持现有 `readSrc() → loadPaper(src)` 路径
- [ ] cancellation guard 仍生效

**Verification**：
- [ ] `npm run typecheck`
- [ ] `npm test -- main-paperkey-entry --run`（C7 创建后）
- [ ] 手测：浏览器地址栏直接打 `chrome-extension://<id>/reader/index.html#paperKey=<existing-key>` → 论文渲染

**Dependencies**：C2

**Files likely touched**：
- `chrome-extension/reader/main.tsx`（约 15 行：新函数 + effect 内分发分支）

**Estimated scope**：S

---

#### C4：`handleNavigateToPaper` 加 4 段 fallback

**Description**：把 B2 的"只支持 src"扩成完整 fallback 链。

**Acceptance criteria**：
- [ ] 优先级（按顺序判断）：
  1. `row.src` → `#src=<encoded>`
  2. `reconstructUrlForArxivRow(row)` 非 null → `#src=<encoded reconstructed URL>`
  3. `await getCachedParsed(paperKey)` 命中 → `#paperKey=<paperKey>`
  4. 都失败 → toast `t('library.jump.needsOriginalUrl')`
- [ ] 命中 1/2/3 任一时调 `chrome.tabs.create({ url, active: true })` + `onClose()`
- [ ] `rowKey === currentPaperKey` 仍优先短路

**Verification**：
- [ ] `npm test -- navigate-to-paper --run` 加新 case 全绿（C6 覆盖）
- [ ] 手测：构造一个 `src=undefined, id="2401.99999"` 的 row → 新 tab 打开 abs URL

**Dependencies**：B2, C1, C2

**Files likely touched**：
- `chrome-extension/reader/components/library-drawer.tsx`（`handleNavigateToPaper` 重写，约 20 行）

**Estimated scope**：S

---

#### C5：单测 `ids.test.ts` + `load-paper-from-cache.test.ts`

**Description**：覆盖 C1 + C2。

**Acceptance criteria**：
- [ ] `reconstructUrlForArxivRow`：5 种输入（new-style / new-style+v2 / old-style cs/0512345 / 非 arxiv id / null id）输出符合预期
- [ ] `loadPaperFromCache`：3 个分支（HTML 缓存命中、PDF 缓存命中返回 null、未命中返回 null）

**Verification**：
- [ ] `npm test -- ids --run` + `npm test -- load-paper-from-cache --run` 全绿

**Dependencies**：C1, C2

**Files likely touched**：
- `chrome-extension/tests/lib/ids.test.ts`（新建或扩展现有）
- `chrome-extension/tests/lib/load-paper-from-cache.test.ts`（新建）

**Estimated scope**：S

---

#### C6：`navigate-to-paper.test.tsx` 扩展 4 段 fallback case

**Description**：在 B4 基础上加 fallback 分支测试。

**Acceptance criteria**：
- [ ] 测试 4：`src=undefined, id="2401.99999"` → tab URL 含 `#src=https%3A%2F%2Farxiv.org%2Fabs%2F2401.99999`
- [ ] 测试 5：`src=undefined, id=undefined`，但 `getCachedParsed(rowKey)` mock 命中 → tab URL 含 `#paperKey=<rowKey>`
- [ ] 测试 6：`src=undefined, id=undefined`，缓存也未命中 → toast 弹出，`chrome.tabs.create` 不被调用
- [ ] 测试 7：`src` 存在但 PDF 缓存（C2 决定不支持）→ 仍走 `#src=` 分支（不影响）

**Verification**：
- [ ] `npm test -- navigate-to-paper --run` 7 个 case 全绿

**Dependencies**：C4

**Files likely touched**：
- `chrome-extension/tests/library-v2/unit/navigate-to-paper.test.tsx`（扩展）

**Estimated scope**：S

---

#### C7：integration test `main-paperkey-entry.test.tsx`

**Description**：覆盖 `#paperKey=` URL 入口在 main.tsx 实际渲染流程中能 hydrate。

**Acceptance criteria**：
- [ ] mock `chrome.storage.local` 预置 `paper:<key>:parsed` + `paper:<key>:memory`
- [ ] 模拟 `location.hash = '#paperKey=<key>'`
- [ ] 渲染 `<App />`（main.tsx 顶层）→ 等待 → DOM 内出现解析后的标题 / outline
- [ ] 错误分支：未命中缓存 → 渲染 error state

**Verification**：
- [ ] `npm test -- main-paperkey-entry --run` 通过

**Dependencies**：C3

**Files likely touched**：
- `chrome-extension/tests/integration/main-paperkey-entry.test.tsx`（新建）

**Estimated scope**：S

---

### Checkpoint C：4 段 fallback 全部覆盖

- [ ] A + B + C 全部全绿
- [ ] 手测全 4 条路径：有 src、有 arxiv id 无 src、有缓存无两者、三者皆失
- [ ] **回到用户确认 → 是否同意推进 Phase D 的 E2E 状态恢复验证**

---

### Phase D：E2E 状态恢复 + 手测 checklist

#### D1：E2E spec `click-jump-hydrate.spec.ts`

**Description**：完整 round-trip：seed 论文 + 全部 paper:* 缓存 → 打开 Drawer → 点卡片 → 在新 tab 中断言 7 项状态恢复。

**Acceptance criteria**：seed 阶段写入：
- [ ] `library`（包含 1 行 with src）
- [ ] `paper:<key>:parsed`, `:memory`, `:notes`, `:highlights`, `:chatSessions`, `:chatSessionMessages:<sid>`, `:activeChatSession`, `:summary:v...:overview:..`, `:overviewMeta`, `:canvas`, `:scroll`, `:workspace:tab`, `:variant-summary:v...`

跳转后断言：
- [ ] 新 tab URL 形如 `chrome-extension://*/reader/index.html#src=...`
- [ ] outline / 段落渲染（从 `:parsed`）
- [ ] Overview tab 显示 `:overview:contributions` 内容（不是 loading 态）
- [ ] highlights 数量 = seed 数量
- [ ] notes 数量 = seed 数量
- [ ] chat session tab 显示 seed 的 active session，消息历史可见
- [ ] canvas 节点位置 = seed 位置
- [ ] `:scroll` 位置已恢复（`window.scrollY === seeded value`）
- [ ] workspace tab = seed 的 tab（如 `chat`）
- [ ] PaperMemory（whyItMatters / role / judgment）渲染

**Verification**：
- [ ] `npm run test:e2e -- click-jump-hydrate.spec.ts` 全绿
- [ ] CI 上跑 1 次，确认稳定（非 flaky）

**Dependencies**：C 阶段全部完成

**Files likely touched**：
- `chrome-extension/tests/library-v2/e2e/click-jump-hydrate.spec.ts`（新建）
- 可能扩展 `chrome-extension/tests/library-v2/e2e/_fixtures.ts` 加 paper:* 全量 seed helper

**Estimated scope**：M

---

#### D2：手测 checklist（按 SPEC §8）

**Description**：D1 跑过后做一轮人工烟测，覆盖自动化难复现的细节（视觉、Drawer 关闭动画、tab 焦点）。

**Acceptance criteria**：完整跑一遍 SPEC §8 的 11 项 checklist，记录在本 plan 的 Checkpoint D 下面。

**Verification**：
- [ ] 11 项全部 ✅

**Dependencies**：D1

**Estimated scope**：S（≈ 15 分钟）

---

### Checkpoint D：完成

- [ ] A + B + C + D 全部全绿
- [ ] SPEC §8 验收 checklist 11 项全部 ✅
- [ ] `git status` 干净，准备 commit
- [ ] **进入 commit + PR 阶段**（走 `agent-skills:git-workflow-and-versioning`）

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `chrome.storage.local` mock 在 vitest 下与 `chrome.tabs.create` mock 协调出问题 | Med | B3 任务先于 B4 验证 setup；如果失败，单独 issue + 阻塞 B 阶段不进 |
| Phase 27 目录已存在但空（`/Users/mayuanchao/Workspace/PaperFlow-Design/.planning/phases/27-library-paper-click-reader-hydration/`），与 GSD `/gsd-discuss-phase 27` 工作流冲突 | Low | 本 plan 走 agent-skills 路径，不动 .planning；commit 时备注 phase 27 GSD 工件后续若需补做（CONTEXT.md 等）从本 spec/plan 反向 import |
| E2E seed 7 项 paper:* 缓存的 helper 不存在，需要新写较多 fixture | Med | D1 任务把 fixture 扩展拆出来作为 prerequisite，先小跑 minimal seed（3 项），再扩到 7 项 |
| arxiv ID 正则不全（漏掉 cs/0512345 等老式 ID） | Med | C1 与 `normalizeArxivId` 共用同一正则源（如已有则复用，否则提取常量） |
| `loadPaperFromCache` 未捕获到 PDF 缓存兜底 → 用户点击非 arxiv PDF 看到 "需要原始 URL" toast 但其实有缓存 | Low | SPEC 已声明 PDF 推到 v1.6；toast 文案明确（"open from original URL once"）；v1.6 单独 plan |
| `chrome.tabs.create` 在某些边缘上下文（无 user activation）失败 | Low | 既有 4 处用法说明 OK；如失败则降级回 `window.open` |

---

## Open Questions（实施时再决定）

1. **i18n 文件路径**：`chrome-extension/reader/i18n/locales/` 实际是 `.ts` 还是 `.json`？B1 任务开工前 `ls` 一次就确认。
2. **`loadPaperFromCache` 落地位置**：放进 `storage.ts` 还是新建 `lib/load-paper-from-cache.ts`？倾向后者（更内聚），但若 `storage.ts` 已有类似 export 风格也可以并入。开工时按现有代码习惯定。
3. **`paperKey` 是否一定 = `urlHash`?** `lib/ids.ts:paperKey()` 函数定义需 reread；若它对 arxiv 返回 arxivId、对其他返回 urlHash，则 C2 中 "urlHash = paperKey" 仅在非 arxiv 时正确。开工时核实 `paperKey()` 实现。
4. **GSD Phase 27 工件**：目录已建但只有 .gitkeep。是否要在 commit 前补 minimal CONTEXT.md / DISCUSSION-LOG.md 以保持 GSD workflow 一致？倾向不补（agent-skills 路径自洽），但需用户拍板。

---

## Parallelization Notes

- **可并行**：A1+A2、B1（i18n keys）、C1（ids.ts）、C2（loadPaperFromCache）独立无依赖，4 件可同时开
- **必须串行**：A1→A2、B2→B4、C2→C3→C7、C1+C2+C4→C6、C 全→D1
- **最短关键路径**：A1 → A2 → B2 → C4 → D1（其余可并行收尾）

---

## Estimated Total Effort

| Phase | Tasks | 累计 effort |
|---|---|---|
| A | 2 (XS+S) | 30-45 min |
| B | 4 (XS×2 + S×2) | 1.5 h |
| C | 7 (XS + S×6) | 3-4 h |
| D | 2 (M + S) | 1.5-2 h |
| **总计** | 15 tasks | **6-8 h** 单 session（可拆 2-3 session） |

---

**下一步**：用户 review 本 Plan → 同意后从 Phase A 开始实施（推荐先单跑 A1 看 fix 实际效果，再批量推进）。
