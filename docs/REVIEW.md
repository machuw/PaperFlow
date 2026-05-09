# PaperFlow Chrome Extension — 设计评审记录

## 评审结论

经过三轮迭代，架构方向正确，主要决策合理。以下为各轮评审发现的问题及当前状态。

---

## 已解决的问题

| 问题 | 解决方案 |
|------|---------|
| MV3 流式响应方案错误（sendMessage 不支持流式） | 改为 reader page 直接调用 Claude API |
| 使用重型 boilerplate | 改为 Vite 原生多入口配置 |
| content script 缺少 `run_at: document_start` | 已补充 |
| Phase 1 缺少验收标准 | 已补充 |
| Options 页面未出现在架构图 | 已补充 |
| pdf.js 使用 viewer.html 模式（与自定义 UI 冲突） | 改为 pdfjs-dist library 模式 |
| blob URL 跨进程传递方案错误 | 改为 sendMessage 传 ArrayBuffer |
| paper-parser.ts 与 pdf-bridge.ts 职责重叠 | 合并为 pdf-bridge.ts |

---

## 待解决的问题

### P0 — 动手前必须解决

**1. AI 调用方案需要替换**

当前方案 `@anthropic-ai/sdk` 只支持 Anthropic 自己的 API，无法支持用户自定义 baseURL。

需求：用户可配置 `baseURL`、`apiKey`、`model`，支持 OpenAI / DeepSeek / Ollama 等任意兼容服务。

推荐方案：原生 `fetch` + OpenAI 兼容接口（`/v1/chat/completions`），约 30 行代码，支持任意服务商。

```ts
// lib/ai-client.ts 核心结构
async function* streamChat(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[]
) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, messages, stream: true }),
  })
  // SSE 解析 → yield chunk
}
```

Options 页面需增加三个配置项：`baseURL`、`apiKey`、`model`，存入 `chrome.storage.local`。

**2. PDF 跨域加载方案需修正**

**背景**：reader page 是扩展内部页面（`chrome-extension://xxx/reader/index.html`），要加载外部域名的 PDF（如 `https://arxiv.org/pdf/2301.00001`）。浏览器同源策略会阻止这个 fetch。扩展通过 `manifest.json` 的 `host_permissions` 声明可以绕过限制，但该权限只对 SW 和 content script 生效，reader page 的 fetch 仍受 CORS 约束。

**关键事实**：arXiv 的 PDF 服务器本身返回了正确的 `Access-Control-Allow-Origin` 响应头，所以 reader page 直接 fetch arXiv PDF **实际上是可以的**，不需要 SW 中转。

当前方案：SW fetch PDF → sendMessage 传 ArrayBuffer → reader page 创建 blob URL

问题：
- `chrome.runtime.sendMessage` 对消息大小有约 64MB 限制，大型 PDF 会失败
- 对 arXiv 这类支持 CORS 的服务器，SW 中转是多余的

推荐方案：
1. reader page 先直接 fetch PDF URL
2. 仅当 fetch 失败（目标服务器不支持 CORS）时，才回退到 SW 中转

这样既解决了大文件限制，又覆盖了不支持 CORS 的第三方 PDF 链接场景。

**3. arXiv HTML fetch 需在扩展环境执行**

`arxiv.org/html/` 页面有 CSP，在 reader page 里直接 fetch 会被拦截。

正确做法：在 content script 或 SW 里 fetch HTML 内容（扩展环境不受页面 CSP 限制），再把内容传给 reader page。

### P1 — 实现时注意

**4. 数据层表格未区分 HTML/PDF 模式**

4.2 节的数据来源表格中，`outline` 和 `paragraphs` 的来源写的是 pdf.js，但 HTML 模式下来源是 DOM 解析。建议表格区分两种模式。

**5. Phase 1 验收标准不完整**

当前只验收了 PDF 路径（`arxiv.org/pdf/xxxx`），未覆盖 `arxiv.org/abs/` 的按钮注入。两条路径都是 Phase 1 要实现的。

**6. Vite content script 打包格式**

content script 必须打成 IIFE 格式（Chrome 不支持 ES module content script）。多入口混合格式需要在 `vite.config.ts` 中单独配置，是常见坑。（已在文档第 8 节标注，实现时注意。）

---

## 复用方案最终评估

| 方案 | 评估 | 结论 |
|------|------|------|
| pdfjs-dist library 模式 | 正确，自己控制渲染 | 保留 |
| Vite 多入口 + IIFE content script | 正确，轻量可控 | 保留 |
| ~~@anthropic-ai/sdk~~ → 原生 fetch + OpenAI 兼容接口 | 支持任意 baseURL/model，更通用 | **需替换** |
| arXiv HTML 优先 + PDF fallback | 大幅降低 Phase 2 复杂度 | 保留 |
| chrome.storage.local | 5MB 限制对论文库够用，超出时考虑 IndexedDB | 保留，暂不扩展 |

---

## 技术选型建议（最终版）

| 需求 | 方案 |
|------|------|
| PDF 渲染 | `pdfjs-dist` library 模式 |
| 扩展构建 | Vite 原生多入口，content script 打成 IIFE |
| AI 调用 | 原生 `fetch` + OpenAI 兼容接口，支持任意 baseURL/apiKey/model |
| UI 组件 | 直接迁移原型 JSX 组件 |
| 样式 | 现有 `tokens.css` 直接复用 |
| 存储 | `chrome.storage.local` |
