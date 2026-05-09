# E2E Tests — Selection / Chat 流程

Playwright + `launchPersistentContext` 加载 unpacked MV3 扩展。Library v2 的 e2e 在
`tests/library-v2/e2e/`（含专属 `seedLibraryFixture`）；本目录覆盖 selection /
chat / note 流程。

---

## 现状

Bootstrap 完成、5 个 spec 全部到位：

- `@playwright/test` 在 `devDependencies`
- 根级 `playwright.config.ts`：`testDir: './tests'`，`testMatch: '**/e2e/**/*.spec.ts'`，
  自动发现本目录与 `tests/library-v2/e2e/`
- `_fixtures.ts` 暴露 `test` / `expect` / `readerPage` / `extensionId` / `context`
  fixture（reader URL 内嵌 `?e2e=fake-paper`，跳过 arXiv/PDF 加载）
- `?e2e=fake-paper` stub 内嵌 2 段真段落（`sec0-p1` / `sec0-p2`），让 selection
  系列 spec 能触发真实选区 → toolbar → action 流（main.tsx fake-paper bypass）

`_helpers.ts` 暴露：

| Helper | 作用 |
|---|---|
| `seedSelectionFixture` | 写 chat session + 配套 note，共享 `actionId` |
| `seedByokConfig` | 写 BYOK 配置（默认 baseURL 用 `.invalid` host） |
| `mockChatCompletions` | 拦 BYOK `/chat/completions`，返伪造 OpenAI SSE，`delayMs` 控制 in-flight 时长 |
| `selectTextInParagraph` | 在指定 `data-pid` 段落里编程触发选区 + 派发 mouseup |
| `clickToolbarAction` | 等 SelectionToolbar 出现并点对应 action 按钮 |

---

## 如何跑

```bash
cd chrome-extension
bun run build                      # 必须先 build dist/
bunx playwright test tests/e2e     # 仅本目录
bunx playwright test               # 全部 e2e（含 library-v2）
bun run test:e2e:ui                # Playwright UI 模式
```

Chrome 扩展不能跑在 headless 模式，CI 上需要 xvfb 或 macOS GUI runner。

---

## Spec 文件现状

| 文件 | 覆盖 | 触发方式 |
|------|------|---------|
| `selection-explain-flow.spec.ts` | ActionCard 渲染 / [→ Note] 跨面板跳转 / quote line-clamp:3 | storage-seeded |
| `selection-highlight.spec.ts` | 高亮写 storage + 镜像 NoteCard + Custom Highlight API 上色 + reload 持久化 | 真实选区 + toolbar |
| `selection-note.spec.ts` | NoteEditorPopover 打开 → 输入 → save → NoteCard 出现 | 真实选区 + toolbar |
| `selection-translate.spec.ts` | TRANSLATE actionCard + 原文 quote + 流式翻译 | 真实选区 + toolbar + AI mock |
| `chat-composer.spec.ts` | composer 流式态：TypingDots → 完成态文本 | composer + AI mock |
| `chat-session-mgmt.spec.ts` | New chat 创建 tab / soft-delete + undo / rename 写入 storage | 直接点击 + 部分 storage seed |

---

## Spec §17.B.4 与实现的偏差登记

写测试时发现的「描述跟实现脱节」，都没改代码。等后续单独决策：

1. **`selection-highlight` 的 `data-highlight-id`**（spec §17.B.4）
   - spec 写「段落出现 `data-highlight-id`」
   - 实现用 **CSS Custom Highlight API**（`reader/lib/highlight-ranges.ts:174` →
     `CSS.highlights.set('hl-yellow', new Highlight(...allRanges))`），无 DOM 属性
   - 当前 spec 走 storage / NoteCard / Custom Highlight `.size > 0` 三层断言

2. **`selection-explain-flow` 的 ink-streaming 光标**（已退役）
   - spec 写「selection → ink-streaming」
   - 实现：`chatStreamingId='__selection__'` sentinel（main.tsx:367）刻意不匹配
     msg id，selection 流压根不加 ink-streaming class
   - ink-streaming 真存在于 chat composer 路径，迁移到 `chat-composer.spec.ts`

3. **`selection-explain-flow` 的 NoteCard error/Retry**（已退役）
   - spec 写「on AI failure → Retry button」
   - 实现：`hasError` / `isStreaming` 是 NoteCard 的 prop（note-card.tsx:19-20），
     但没有任何 caller 传它们 — dead branch

4. **History drawer rename 局部 staleness（真 UX bug）**
   - 现象：drawer 里点 Rename + Enter，title 写入 storage 成功；但 drawer 自己
     一直显示旧 title，必须 close + reopen 才能看到新值
   - 原因：`chat-panel.tsx:50-57` 的 `historySessions` 本地 state 在打开 drawer
     时一次性 fetch，`onRename` 后 main.tsx 只更新 `sessions` prop 没回灌 drawer
     的 historySessions
   - 当前 spec 走 storage 校验 + close/reopen 二段断言，记录此现象

5. **History drawer aria-label 是 'CONVERSATIONS'**
   - chat-session-history.tsx:23 `aria-label={t('chat.history.title') || 'Chat history'}`，
     但 i18n.ts:153 默认英文返回 'CONVERSATIONS'（全大写），fallback `'Chat history'`
     永远不会被命中
   - 全大写做 a11y 名不太合适（屏幕阅读器可能逐字母读）；可改 'Chat history' 或
     新增专门的 a11y 翻译键

---

## 待办

- CI 集成 — 项目仍未配置 GitHub Actions / 其他 CI 平台
- 上面 4 项偏差里 4 / 5 是值得修的，等单独 PR 收

## 参考

- Spec §17.B.4 — E2E 目录要求
- Spec §18.1 — 验收标准
- Playwright [Chrome extensions 文档](https://playwright.dev/docs/chrome-extensions)
