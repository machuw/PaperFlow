<div align="center">

<img src="docs/assets/logo.png" alt="PaperFlow logo" width="120" height="120" />

# PaperFlow

**一个 AI 辅助的 Chrome 扩展，用来读 arXiv 论文和 PDF —— 让世界上所有人都能读得懂最新的文献，让知识不再有语言和时间的信息差。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/machuw/PaperFlow/pulls)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

<!-- TODO: 替换成真实截图或演示 gif
<p align="center">
  <img src="docs/assets/screenshot.png" alt="PaperFlow Reader" width="820" />
</p>
-->

## ✨ 功能特性

- 📖 **三种阅读布局** —— *focus*（论文 + 边栏笔记）、*classic*（论文 + 右侧抽屉）、*canvas*（全屏脑图）
- 🤖 **划词即用 AI** —— 选中任意文本，按 `E`（解释）、`S`（总结）、`T`（翻译）、`H`（提示）
- 🎯 **边栏笔记锚定段落** —— AI 回答始终钉在它对应的源段落旁边，不会丢失上下文
- 🌍 **内置翻译** —— 不用切窗口，直接用母语读最新论文
- 📚 **论文库 + 标注 + 聊天记录** —— 你读过的每一篇论文都在累积成一个个人知识库
- ☁️ **跨设备同步** —— Supabase Postgres + Realtime 保持库在所有浏览器一致
- 🔑 **BYOK 或托管 AI** —— 自带 OpenAI 兼容 key，或者用平台托管代理（带用量配额）
- 💬 **ChatGPT 订阅走 Codex（实验性）** —— Plus / Pro / Team 用户可以直接用自己的 ChatGPT 配额驱动 PaperFlow 的 AI，零 per-token API 费用。请先看下方风险披露。
- ⌨️ **键盘优先** —— `⌘K` 命令面板 · `⌘\` 大纲 · `⌘L` 论文库
- 🎨 **暖纸张美学** —— 浅色/深色主题，可调字体、页宽、纸面颗粒、页边距

## ⚠️ ChatGPT Codex preset —— 实验性，风险自担

PaperFlow 提供一个名为 **OpenAI Codex（ChatGPT 订阅）** 的 BYOK preset，让 ChatGPT Plus / Pro / Team 用户可以直接用自己已有的订阅配额驱动 PaperFlow 的 AI 调用。开启之前请清楚自己在选什么：

- **TOS 灰色地带**：OpenAI 的 ChatGPT 服务条款限制对服务的自动化访问。把 PaperFlow 接到你的 ChatGPT 会话上，可能被认定为违规。账号侧执法节奏由 OpenAI 决定，**风险由你承担**。
- **非公开 API**：Codex 后端（`chatgpt.com/backend-api/codex/responses`）没有公开文档，OpenAI 随时可能改 / 停。PaperFlow **不承诺**长期维护此 preset；OpenAI 一旦收紧此通道，preset 可能直接停摆。
- **沿用 Codex CLI 的客户端身份**：preset 复用了 Codex CLI 的公开 OAuth `client_id`。PaperFlow 没有注册自己的 client_id（也无法注册），这是目前唯一可行的路径。
- **凭据**只**存本机**：Codex 的 `access_token` / `refresh_token` 全量存在 `chrome.storage.local`，**永不**同步到 PaperFlow 云端、**永不**离开签发它的设备。登出会清除；多设备需要各自单独登录。
- **PaperFlow 不收费、无档位 gating**：所有 PaperFlow 用户都可以用此 preset。消耗的是你 ChatGPT 订阅的配额，不是 PaperFlow 的额度。

完整背景：[ADR-0001](docs/adr/0001-codex-byok-via-device-code-flow.md)、[Codex BYOK spec](docs/specs/2026-05-12-spec-codex-subscription-byok.md)。

## 📦 安装

> PaperFlow 暂未上架 Chrome Web Store。当前通过 *Load unpacked* 安装。

### 方式一 —— 从 release zip 安装（推荐）

1. 从 [Releases](https://github.com/machuw/PaperFlow/releases) 下载最新的 `paperflow-vX.Y.Z.zip`
2. 解压到一个稳定的目录
3. 打开 `chrome://extensions/`，右上角打开 **开发者模式**
4. 点击 **加载已解压的扩展程序 / Load unpacked**，选择解压后的文件夹
5. 访问任意 [`arxiv.org/abs/...`](https://arxiv.org/) 页面 —— PaperFlow 会自动注入

> Chrome 启动时会有一条黄色警告 "Disable developer mode extensions" —— 这是非 Web Store 安装的正常提示，关掉即可。

### 方式二 —— 从源码构建

```bash
git clone https://github.com/machuw/PaperFlow.git
cd PaperFlow/chrome-extension
npm install
npm run build         # 生产构建 → dist/
```

然后通过 `chrome://extensions/` **加载已解压的扩展程序**，选择 `chrome-extension/dist/` 目录。

## 🚀 快速开始

1. 打开任意 arXiv 论文，例如 <https://arxiv.org/abs/2402.13753>
2. 点击页面上注入的 **PaperFlow** 按钮（或扩展图标）
3. 划选段落 → 浮动工具栏出现 → 按 `T` 翻译，按 `E` 解释
4. 按 `⌘L` 把当前论文加进库，按 `⌘K` 跨论文搜索

## 🏗️ 架构

```
┌──────────────────────────────────────────────┐
│  Chrome MV3 Extension (chrome-extension/)    │
│  ├─ Vite + React 18 + TypeScript             │
│  ├─ Reader UI（focus / classic / canvas）    │
│  ├─ pdfjs-dist（PDF 渲染）                   │
│  └─ Service worker + content script          │
└──────────────────────┬───────────────────────┘
                       │ HTTPS / WSS
┌──────────────────────▼───────────────────────┐
│  Supabase 后端 (supabase/)                   │
│  ├─ Postgres + RLS                           │
│  │   (papers, library, annotations, chat,   │
│  │    subscriptions, ai_usage_log)          │
│  ├─ Auth（magic link）                       │
│  ├─ Realtime（订阅 tier 同步）              │
│  └─ Edge Functions                          │
│      ├─ ai-proxy（托管 AI 流式代理）        │
│      ├─ create-checkout-session（Stripe）   │
│      ├─ stripe-webhook                      │
│      └─ create-portal-session               │
└──────────────────────────────────────────────┘
```

- **认证 & 同步** —— Supabase Postgres + Realtime
- **支付** —— Stripe（Checkout + Billing Portal + 签名 webhook）
- **AI** —— OpenAI 兼容协议，通过 [`@ai-sdk/openai-compatible`](https://www.npmjs.com/package/@ai-sdk/openai-compatible)
- **PDF** —— [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist)

三档订阅：**Free**（仅 BYOK）· **Sync**（云端库）· **Pro**（托管 AI 配额）。

更深入的架构说明见 [`CLAUDE.md`](CLAUDE.md)。

## 🛠️ 开发

PaperFlow 有两种构建模式 —— **本地 Supabase** 用于日常开发，**线上 Supabase** 仅用于发版前验证。

```bash
cd chrome-extension

# 日常开发（本地 Supabase）—— 默认
npm run build:dev      # 一次性构建
npm run dev:local      # watch 模式

# 发版验证（线上 Supabase）—— 仅在 ship 前
npm run build
```

每次构建后到 `chrome://extensions/` 点 PaperFlow 的 🔄 重新加载。

dev 构建会在 reader 顶栏 PaperFlow logo 旁显示一个橙色 **`DEV`** 徽章。**如果没看到，说明你装的是线上版** —— 重新跑 `npm run build:dev`。

### 本地后端

```bash
supabase start                                       # Postgres + Auth + Realtime
supabase functions serve --env-file ./supabase/.env  # Edge Functions
```

如果不起，dev 构建会在登录、AI 调用、同步等环节挂起。

### 测试

```bash
npm test               # Vitest —— 单测 + 集成
npm run test:e2e       # Playwright —— E2E（用 CLI，不要用 MCP）
npm run typecheck      # tsc --noEmit
```

完整的开发指南见 [`CLAUDE.md`](CLAUDE.md)。

## 📦 打包发版（给非开发者使用）

要把扩展发给非开发者（对方没有本地 Supabase、没有 Node 环境），打一个**纯生产版 zip**，让他们用 *Load unpacked* 安装。PaperFlow 没上 Chrome Web Store，这是当前的标准分发方式。

```bash
cd chrome-extension

# 1. 升版本号（同步 manifest.json + package.json，提交并打 tag v{version}）
npm run bump patch              # 或：minor | major | 1.2.3

# 2. 构建生产 bundle 并打包
npm run release                 # → chrome-extension/paperflow-v{version}.zip

# 3. 推送 commit 和 tag
git push && git push --tags
```

`npm run release`（`scripts/release.sh`）做的事：

- 强制 `rm -rf dist` + `npm run build`（生产模式 → 线上 Supabase）。**绝不会把 dev 构建打包出去。**
- 如果在 `dist/assets/` 里发现本地 Supabase URL `127.0.0.1:54321`，直接退出（防止误把 `build:dev` 的产物打进去）。
- `manifest.json` 与 `package.json` 版本号不一致 → 退出。
- 把 `dist/` 打成 `paperflow-v{version}.zip`，放在 `chrome-extension/` 根目录。

zip 已经 gitignored，**不要把 artifact 提交进 git**。挂到 GitHub Release（绑到 `v{version}` tag 上）、内网共享、或公司云盘都可以。

### 发给同事的安装步骤

1. 解压 `paperflow-v{version}.zip` 到一个稳定目录
2. 打开 `chrome://extensions/`，右上角打开 **开发者模式**
3. 点击 **加载已解压的扩展程序 / Load unpacked**，选择解压后的文件夹
4. 访问任意 [`arxiv.org/abs/...`](https://arxiv.org/) 页面

Chrome 启动时会有一条黄色 "disable developer mode extensions" 警告 —— 这是非 Web Store 安装的正常提示，关掉即可。

## 📂 项目结构

```
PaperFlow/
├── chrome-extension/    # MV3 扩展 —— Vite + React + TypeScript（source of truth）
│   ├── reader/          # Reader UI（components / lib / styles）
│   ├── content/         # 注入到 arxiv.org 的 content script
│   ├── background/      # Service worker
│   ├── manifest.json
│   └── tests/           # Vitest + Playwright
├── supabase/
│   ├── migrations/      # SQL 迁移 + RLS 策略
│   ├── functions/       # Edge Functions（ai-proxy / stripe-webhook / ...）
│   └── config.toml
├── docs/
│   ├── prototype/       # 已归档的 no-bundler React 原型（UI 参考）
│   └── assets/          # README 资源
├── scripts/             # 构建 / 发版脚本
├── CLAUDE.md            # 详细贡献者指南
└── README.md            # ← 你正在看这个
```

## 🤝 贡献

非常欢迎贡献！请先看 [`CLAUDE.md`](CLAUDE.md) 了解开发流程和编码规范。

- 🐛 **Bug 报告** —— [开 issue](https://github.com/machuw/PaperFlow/issues/new)
- 💡 **新功能想法** —— 先开 [discussion](https://github.com/machuw/PaperFlow/discussions) 讨论
- 🛠️ **Pull Request** —— 从 `main` 切分支，写测试，改动保持外科手术式精准

> `docs/` 下生成的文档（specs / plans / reviews）用中文，代码和行内注释保持英文。

## 📄 License

[MIT](LICENSE) © 2026 [machuw](https://github.com/machuw)

## 🙏 致谢

PaperFlow 站在巨人的肩膀上：

- [React](https://react.dev/) · [Vite](https://vitejs.dev/) · [TypeScript](https://www.typescriptlang.org/)
- [Supabase](https://supabase.com/) —— auth、数据库、realtime、edge functions
- [Stripe](https://stripe.com/) —— 订阅 + Billing Portal
- [pdf.js](https://mozilla.github.io/pdf.js/) —— PDF 渲染
- [Vercel AI SDK](https://sdk.vercel.ai/) —— AI 流式
- [@xyflow/react](https://reactflow.dev/) —— canvas 脑图视图
