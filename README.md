<div align="center">

<img src="docs/assets/logo.png" alt="PaperFlow logo" width="120" height="120" />

# PaperFlow

**An AI-assisted Chrome extension for reading arXiv papers and PDFs — bridging the language and time gap of frontier research.**

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

<!-- TODO: drop a real screenshot or short demo gif here
<p align="center">
  <img src="docs/assets/screenshot.png" alt="PaperFlow Reader" width="820" />
</p>
-->

## ✨ Features

- 📖 **Three reading layouts** — *focus* (paper + margin notes), *classic* (paper + side drawer), *canvas* (full-screen mind map)
- 🤖 **Inline AI actions** — select any text, then press `E` (Explain), `S` (Summarize), `T` (Translate), or `H` (Hint)
- 🎯 **Margin notes anchor to paragraphs** — AI responses pin to their source so you never lose context
- 🌍 **Built-in translation** — read the latest research in your native language without context-switching
- 📚 **Library, annotations & chat history** — every paper you open builds a personal knowledge base
- ☁️ **Cross-device sync** — Supabase Postgres + Realtime keeps your library consistent across browsers
- 🔑 **BYOK or managed AI** — bring your own OpenAI-compatible key, or use the managed proxy with usage quotas
- 💬 **ChatGPT subscription via Codex (experimental)** — Plus/Pro/Team subscribers can drive PaperFlow's AI with their existing ChatGPT quota; no per-token API spend. See the disclosure below.
- ⌨️ **Keyboard-first** — `⌘K` command palette · `⌘\` outline · `⌘L` library
- 🎨 **Warm paper aesthetic** — light/dark themes, adjustable typography, page width, grain, and margins

## ⚠️ ChatGPT Codex preset — experimental, use at your own risk

PaperFlow ships a BYOK preset called **OpenAI Codex (ChatGPT Subscription)** that lets ChatGPT Plus / Pro / Team users drive PaperFlow's AI calls with their existing subscription quota. Before you turn it on, understand what you're opting into:

- **TOS gray area.** OpenAI's ChatGPT terms restrict automated programmatic access. Driving PaperFlow with your ChatGPT session may be considered against those terms. Account-level enforcement is at OpenAI's discretion — risk is yours.
- **Unofficial API surface.** The Codex backend (`chatgpt.com/backend-api/codex/responses`) is undocumented and may change or shut off at any time. PaperFlow does not commit to maintaining this preset if OpenAI tightens the surface.
- **Reused Codex CLI client identity.** The preset reuses Codex CLI's public OAuth `client_id`. PaperFlow does not register its own client_id (OpenAI does not currently allow third-party registration for the Codex backend); this is the only path that works today.
- **Tokens are local-only.** Codex `access_token` / `refresh_token` are stored exclusively in `chrome.storage.local`. They are never synced to the PaperFlow cloud and never leave the device they were issued on. Logging out clears them; each device logs in independently.
- **No PaperFlow cost / no gating.** The preset is free for all PaperFlow tiers. Your usage counts against your ChatGPT subscription's quota, not PaperFlow's.

For full background see [ADR-0001](docs/adr/0001-codex-byok-via-device-code-flow.md) and the [Codex BYOK spec](docs/specs/2026-05-12-spec-codex-subscription-byok.md).

## 📦 Installation

> PaperFlow is not yet published to the Chrome Web Store. Install via *Load unpacked*.

### Option 1 — Install from a release zip *(recommended)*

1. Download the latest `paperflow-vX.Y.Z.zip` from [Releases](https://github.com/machuw/PaperFlow/releases)
2. Unzip it somewhere stable on disk
3. Open `chrome://extensions/` and enable **Developer mode** (top-right)
4. Click **Load unpacked** and select the unzipped folder
5. Visit any [`arxiv.org/abs/...`](https://arxiv.org/) page — PaperFlow injects automatically

### Option 2 — Build from source

```bash
git clone https://github.com/machuw/PaperFlow.git
cd PaperFlow/chrome-extension
npm install
npm run build         # production build → dist/
```

Then **Load unpacked** the `chrome-extension/dist/` folder via `chrome://extensions/`.

## 🚀 Quick Start

1. Open any arXiv paper, e.g. <https://arxiv.org/abs/2402.13753>
2. Click the **PaperFlow** button injected on the page (or the extension icon)
3. Select a passage → the floating toolbar appears → press `T` to translate, `E` to explain
4. Press `⌘L` to add the paper to your library and `⌘K` to search across everything

## 🏗️ Architecture

```
┌──────────────────────────────────────────────┐
│  Chrome MV3 Extension (chrome-extension/)    │
│  ├─ Vite + React 18 + TypeScript             │
│  ├─ Reader UI (focus / classic / canvas)     │
│  ├─ pdfjs-dist (PDF rendering)               │
│  └─ Service worker + content script          │
└──────────────────────┬───────────────────────┘
                       │ HTTPS / WSS
┌──────────────────────▼───────────────────────┐
│  Supabase Backend (supabase/)                │
│  ├─ Postgres + RLS                           │
│  │   (papers, library, annotations, chat,    │
│  │    subscriptions, ai_usage_log)           │
│  ├─ Auth (magic link)                        │
│  ├─ Realtime (subscription-tier sync)        │
│  └─ Edge Functions                           │
│      ├─ ai-proxy (managed AI streaming)      │
│      ├─ create-checkout-session (Stripe)     │
│      ├─ stripe-webhook                       │
│      └─ create-portal-session                │
└──────────────────────────────────────────────┘
```

- **Auth & sync** — Supabase Postgres + Realtime
- **Payments** — Stripe (Checkout + Billing Portal + signed webhook)
- **AI** — OpenAI-compatible via [`@ai-sdk/openai-compatible`](https://www.npmjs.com/package/@ai-sdk/openai-compatible)
- **PDF** — [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist)

Three subscription tiers: **Free** (BYOK only) · **Sync** (cloud library) · **Pro** (managed AI quotas).

For deeper architecture notes, see [`CLAUDE.md`](CLAUDE.md).

## 🛠️ Development

PaperFlow uses two build modes — **local Supabase** for everyday work, **hosted Supabase** for release validation only.

```bash
cd chrome-extension

# Daily development (local Supabase) — the default
npm run build:dev      # one-shot
npm run dev:local      # watch mode

# Release validation (hosted Supabase) — pre-ship only
npm run build
```

After every build, reload the extension at `chrome://extensions/`.

A dev build renders an orange **`DEV`** pill next to the PaperFlow logo. If you do not see it, you are running the hosted build — re-run `build:dev`.

### Local backend

```bash
supabase start                                       # Postgres + Auth + Realtime
supabase functions serve --env-file ./supabase/.env  # Edge Functions
```

Without these running, the dev build will hang on login, AI calls, and sync.

### Testing

```bash
npm test               # Vitest — unit + integration
npm run test:e2e       # Playwright — end-to-end (CLI, not MCP)
npm run typecheck      # tsc --noEmit
```

The full contributor guide lives in [`CLAUDE.md`](CLAUDE.md).

## 📦 Packaging for distribution

To hand the extension to non-developers (no local Supabase, no Node toolchain), build a **production-only zip** they can *Load unpacked*. PaperFlow is not on the Chrome Web Store, so this is the standard distribution path.

```bash
cd chrome-extension

# 1. Bump the version (syncs manifest.json + package.json, commits, tags v{version})
npm run bump patch              # or: minor | major | 1.2.3

# 2. Build production bundle and zip it
npm run release                 # → chrome-extension/paperflow-v{version}.zip

# 3. Push the commit and the tag
git push && git push --tags
```

What `npm run release` (`scripts/release.sh`) does:

- Forces a clean `npm run build` (production mode → hosted Supabase). **Never zips a dev build.**
- Refuses to continue if it detects the local Supabase URL `127.0.0.1:54321` inside `dist/assets/` (catches accidental `build:dev` output).
- Refuses to continue if `manifest.json` and `package.json` versions disagree.
- Zips `dist/` → `paperflow-v{version}.zip` at the repo root of `chrome-extension/`.

The zip is gitignored — **don't commit the artifact**. Upload it to a GitHub Release (attach to the `v{version}` tag), internal share, or cloud drive.

### Install instructions to send with the zip

1. Unzip `paperflow-v{version}.zip` to a stable folder on disk
2. Open `chrome://extensions/` and enable **Developer mode** (top right)
3. Click **Load unpacked** and select the unzipped folder
4. Visit any [`arxiv.org/abs/...`](https://arxiv.org/) page

Chrome will show a yellow "disable developer mode extensions" bar on each launch — that's the expected warning for non-Web-Store installs and can be dismissed.

## 📂 Project Structure

```
PaperFlow/
├── chrome-extension/    # MV3 extension — Vite + React + TypeScript (source of truth)
│   ├── reader/          # Reader UI (components, lib, styles)
│   ├── content/         # Content script for arxiv.org injection
│   ├── background/      # Service worker
│   ├── manifest.json
│   └── tests/           # Vitest + Playwright
├── supabase/
│   ├── migrations/      # SQL migrations + RLS policies
│   ├── functions/       # Edge Functions (ai-proxy, stripe-webhook, …)
│   └── config.toml
├── docs/
│   ├── prototype/       # Archived no-bundler React prototype (UI reference)
│   └── assets/          # README assets
├── scripts/             # Build / release helpers
├── CLAUDE.md            # Detailed contributor guide
└── README.md            # ← you are here
```

## 🤝 Contributing

Contributions are very welcome! Please read [`CLAUDE.md`](CLAUDE.md) for the development workflow and coding guidelines.

- 🐛 **Bug reports** — [open an issue](https://github.com/machuw/PaperFlow/issues/new)
- 💡 **Feature ideas** — start a [discussion](https://github.com/machuw/PaperFlow/discussions) first
- 🛠️ **Pull requests** — branch off `main`, write tests, keep changes surgical

> Generated docs (specs / plans / reviews under `docs/`) are written in Chinese; code and inline comments stay in English.

## 📄 License

[MIT](LICENSE) © 2026 [machuw](https://github.com/machuw)

## 🙏 Acknowledgements

PaperFlow is built on the shoulders of giants:

- [React](https://react.dev/) · [Vite](https://vitejs.dev/) · [TypeScript](https://www.typescriptlang.org/)
- [Supabase](https://supabase.com/) — auth, database, realtime, edge functions
- [Stripe](https://stripe.com/) — subscriptions and billing portal
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF rendering
- [Vercel AI SDK](https://sdk.vercel.ai/) — AI streaming
- [@xyflow/react](https://reactflow.dev/) — canvas mind-map view
