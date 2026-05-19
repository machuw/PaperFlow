# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

Build a Chrome extension paper reader based on the existing prototype. The prototype (`docs/prototype/PaperFlow Reader.html`) is archived as the historical UI reference — the Chrome extension (`chrome-extension/`) is now the source of truth and has diverged from the prototype. See `docs/specs/2026-04-20-spec-chrome-extension.md` for the full extension spec.

## Directory Structure

```
PaperFlow-Design/
├── chrome-extension/       # The actual product — Vite-built MV3 extension (source of truth)
├── supabase/               # Postgres migrations + Edge Functions (auth, AI proxy, Stripe webhook)
├── docs/
│   ├── specs/              # Feature specs (e.g. 2026-04-20-spec-chrome-extension.md)
│   ├── plans/              # Implementation plans
│   ├── reviews/            # Code/design reviews
│   └── prototype/          # Archived no-bundler React prototype (UI reference, not built/shipped)
│       ├── PaperFlow Reader.html
│       ├── components/     # JSX components loaded via Babel standalone
│       └── styles/tokens.css
├── scripts/                # Build / worktree-init helpers
└── DESIGN.md               # Design decisions and rationale
```

## Document Language

Generated docs under `docs/` (specs, plans, reviews) are written in Chinese. Code, code comments, commit messages, and this file (`CLAUDE.md`) are in English.

## Running the archived prototype

The prototype under `docs/prototype/` is kept as a UI reference. It is **not** built or shipped — for current behaviour, run the extension. To open the prototype:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/docs/prototype/PaperFlow%20Reader.html
```

Do not open the HTML directly via `file://` — the browser will block cross-origin JSX script loads. Note that `docs/prototype/styles/tokens.css` has diverged from `chrome-extension/reader/styles/tokens.css` (the latter is authoritative).

## Chrome Extension build modes (dev vs prod)

Vite mode-loaded env files split which Supabase the bundle points at. **Default to `build:dev` for everything except release validation** — see policy below.

```bash
cd chrome-extension

# Local Supabase (default for dev / test / iteration)
npm run build:dev      # one-shot
npm run dev:local      # watch mode

# Hosted Supabase (only for release validation / pre-ship smoke)
npm run build          # one-shot
npm run dev            # watch mode
```

After every build, `chrome://extensions/` → PaperFlow → 🔄 reload.

### Policy

- **Daily development, unit / integration tests, refactor, debugging** → `build:dev` (local Supabase). Faster, safer, no risk of trashing production data, no quota spend.
- **Release validation only** → `build` (hosted). Use right before merging / shipping to confirm the production wiring still works end-to-end. Don't iterate on `build` — it's a verification gate, not a workflow.
- **Never** push `dist/` or test against hosted while developing core features. Hosted = customer-facing.

### Visible env indicator

Every dev build renders an orange **`DEV`** pill next to the `PaperFlow` logo in the reader top-bar (gated on `import.meta.env.MODE !== 'production'`, dead-code-eliminated in prod). Hover the pill for the full Supabase URL. Console also logs `[paperflow] supabase env: <URL> · <mode>` once at reader load. **If you don't see the DEV pill, your loaded extension is the hosted build** — re-run `npm run build:dev` and reload.

### Env files

| File | Status | Purpose |
|---|---|---|
| `chrome-extension/.env.local` | gitignored | Default config — currently hosted values + shared `PF_EVAL_*` |
| `chrome-extension/.env.development.local` | gitignored | Override for `--mode development`: `VITE_SUPABASE_URL=http://127.0.0.1:54321` + local demo anon key |

Vite load order: `.env` < `.env.local` < `.env.[mode]` < `.env.[mode].local` (later overrides earlier). `vite build` defaults to `mode=production`, `vite build --mode development` (= `npm run build:dev`) layers `.env.development.local` on top of `.env.local`.

### Local Supabase prerequisite

`build:dev` only works with a running local stack:

```bash
supabase start                                       # Postgres + Auth + Realtime
supabase functions serve --env-file ./supabase/.env  # Edge Functions
```

Without these, the extension built with `--mode development` will hang on auth, AI calls, sync — not a bug, just a missing backend.

## Working in a fresh git worktree

If you are operating inside a `git worktree add`-created worktree (e.g. spawned with `isolation: "worktree"`), `chrome-extension/node_modules/` will be empty — `node_modules` is gitignored and is NOT shared between worktrees. Two ways to bootstrap:

**Manual** — run once per fresh worktree:

```bash
bash scripts/worktree-init.sh   # runs npm ci inside chrome-extension/
```

**Automatic via git hook** — point git at the repo's tracked `.githooks/`:

```bash
git config core.hooksPath .githooks   # one-time per clone
```

Then `git worktree add ...` triggers `.githooks/post-checkout`, which calls `scripts/worktree-init.sh` automatically when it detects an empty `node_modules`. Idempotent — safe to re-run; skipped on normal `git checkout` in an already-bootstrapped tree.

## Releasing the extension (zip + load unpacked)

Release flow for internal / friends-and-family distribution. Recipients install the zip via `chrome://extensions/` → Developer mode → "Load unpacked". **Not shipped to the Chrome Web Store**, and not via self-hosted `.crx` either (under MV3, non-Web-Store `.crx` is disabled by default unless an enterprise policy is configured — not worth it for a small internal team).

```bash
cd chrome-extension
npm run bump patch      # 0.1.0 → 0.1.1 (also accepts minor / major / explicit x.y.z)
npm run release         # → chrome-extension/paperflow-v{version}.zip
git push && git push v{version}
```

### `npm run bump <patch|minor|major|x.y.z>` (`scripts/bump.mjs`)

- Syncs the `version` field in `manifest.json` and `package.json`
- `git commit manifest.json package.json -m "chore: bump version to v{version}"` (pathspec form — **does not** sweep up other uncommitted changes)
- Tags `v{version}`
- Exits if the two files are out of sync, the current version isn't valid semver, or the argument is invalid
- If not inside a git repo, only edits the files; skips commit/tag

### `npm run release` (`scripts/release.sh`)

- Forces `rm -rf dist`, then `npm run build` (production mode, hosted Supabase)
- Exits if `manifest.json` and `package.json` versions disagree
- Exits if `dist/assets/` greps positive for the local Supabase URL `127.0.0.1:54321` (means a `build:dev` artifact slipped through)
- Exits if `dist/manifest.json` or `dist/icons/` is missing
- Zips `dist/` → `paperflow-v{version}.zip` (gitignored — **do not** commit the artifact)

### Install steps (to share with recipients)

1. Unzip `paperflow-v{version}.zip`
2. Open `chrome://extensions/`
3. Toggle "Developer mode" in the top-right
4. Click "Load unpacked", select the unzipped folder

Chrome will show a yellow banner "disable developer mode extensions" on startup — this is the standard non-Web-Store install warning, safe to dismiss.

### Artifact hosting

Zip files do not go into git. Distribute via internal share / GitHub Release / S3 / company drive. After pushing the tag, you can use the GitHub Release UI to attach the zip to the corresponding tag.

## Dual-repo strategy: private development + public mirror

The repo lives on both sides:

| Repo | Purpose | Contents |
|---|---|---|
| **`machuw/PaperFlow-Design`** (private, local origin) | Full-fidelity development | Everything, including `.planning/`, `.superpowers/`, internal runbooks, real Supabase ref |
| **`machuw/PaperFlow`** (public) | Open-source mirror | Tracked code + `docs/` + `scripts/` only, with the real ref scrubbed |

The public repo is a snapshot mirror — one commit per sync, **no history carried over**, no internal planning docs. The private repo continues with PR-per-phase; the public repo only updates when you manually sync.

```bash
# When the private repo has new progress and you want to publish
bash scripts/sync-public.sh                      # code only
bash scripts/sync-public.sh --dry-run            # show diff, don't push
bash scripts/sync-public.sh --release            # code + release (uses manifest current version)
bash scripts/sync-public.sh --release v0.1.3     # code + explicit version (also for back-publishing older versions)
bash scripts/sync-public.sh --dry-run --release  # run all pre-flight, show what would happen, change nothing
```

**Deciding whether to release**: the script does not decide for you. After a plain sync, it will passively warn "manifest = vX, public has no release for it, the zip exists" — you decide whether to re-run with `--release`.

**The 4 pre-flight checks under `--release`** (any failure aborts before touching the mirror):

1. `chrome-extension/paperflow-v{X}.zip` exists
2. The zip is a production build (grep for `127.0.0.1:54321` returns no hits)
3. The zip's internal `manifest.json` `version` field matches the filename
4. The public repo has no release for `v{X}`

Release notes use a hardcoded install template baked into the script (English/Chinese README links + issue link), identical every time. To automate the changelog later, add `CHANGELOG.md` to the repo root and update the script to read its top section.

`scripts/sync-public.sh` filtering (tracked files only — `.env*` / `dist.pem` / `node_modules` / `paperflow-v*.zip` / `AGENTS.md` / `.agents/` and other gitignored content are auto-excluded):

- Excluded directories: `.planning/`, `.superpowers/`
- Text replacement: real Supabase project ref → `<ref>` placeholder
- Safety net: pre-commit grep for known leak patterns; aborts on hit

The mirror checkout lives at `.public-mirror/` (gitignored, deletable at any time — the next sync will re-clone).

If you ever add new sensitive patterns (a new project ref, a new Stripe price ID, etc.), update `SUPABASE_REF` / `LEAK_PATTERNS` at the top of `scripts/sync-public.sh`.

## Architecture (archived prototype, `docs/prototype/`)

The prototype is a **no-bundler React prototype** using Babel standalone for in-browser JSX transpilation. All components are loaded as `<script type="text/babel">` tags in `docs/prototype/PaperFlow Reader.html`. It is kept for UI reference only — the Chrome extension under `chrome-extension/` has diverged and is the source of truth.

**Component load order matters** — each file exposes its component on `window.*` and the next file may depend on it. The order in the HTML is the dependency order.

### Three layout variants (controlled by `variant` state in `viewer-app.jsx`)

- **focus** — paper + margin notes column; AI results anchor to their source paragraph
- **classic** — paper + right-side `WorkspacePanel` drawer
- **canvas** — full-screen `CanvasView`, replaces the reader entirely

### Data flow

`window.PAPER` (set in `paper-data.jsx`) is the single source of truth — a static mock paper object passed as props throughout. There is no real backend; AI responses are hardcoded in `generateBody()` in `viewer-app.jsx`.

### Design tokens

All colors, typography, spacing, and shadows live in `docs/prototype/styles/tokens.css` as CSS custom properties (the extension has its own copy at `chrome-extension/reader/styles/tokens.css`, which is authoritative and has diverged). Light/dark theme is toggled via `data-theme` attribute on `<html>`. The warm paper aesthetic uses `--paper`, `--ink`, `--walnut`, `--foxglove`, `--forest`, `--sky` as the accent palette.

### Key interaction patterns

- Text selection → `SelectionToolbar` floats → action (E/S/T/H keys or click) → `runAction()` in `viewer-app.jsx`
- In **focus** variant, results render as `MarginNote` components anchored to source paragraph via `data-pid` DOM lookup
- In **classic** variant, results render inside `WorkspacePanel`
- `⌘K` opens command palette (`CmdK` overlay), `⌘\` toggles outline, `⌘L` opens library drawer
- Tweaks (font, page width, grain, margins) persist to `localStorage` under `pf-tweaks`

## Coding Guidelines

### Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If something is unclear, stop and ask.

### Simplicity First
- Minimum code that solves the problem. Nothing speculative.
- No abstractions for single-use code, no unrequested flexibility.
- If you write 200 lines and it could be 50, rewrite it.

### Surgical Changes
- Touch only what you must. Don't improve adjacent code.
- Match existing style. Mention unrelated dead code — don't delete it.
- Every changed line should trace directly to the user's request.

### Goal-Driven Execution
- Define verifiable success criteria before implementing.
- For multi-step tasks, state a brief plan with a verify step for each.

## Documentation

All generated docs go under `docs/`, organized by type:

| Type | Directory | Naming |
|------|-----------|--------|
| Specs | `docs/specs/` | `{YYYY-MM-DD}-spec-{feature-slug}.md` |
| Plans | `docs/plans/` | `{YYYY-MM-DD}-plan-{feature-slug}.md` |
| Reviews | `docs/reviews/` | `{YYYY-MM-DD}-review-{feature-slug}.md` |

## Testing

E2E tests use the **Playwright CLI** (`npx playwright test`) — do not use the Playwright MCP tools (`mcp__...__playwright__*`). The CLI produces persistent specs that live in the repo, run in CI, diff cleanly, and replay reproducibly. MCP is only a one-shot, in-session browser action — it leaves no artifact and burns conversation context on every re-run.

New E2E cases go in `chrome-extension/tests/e2e/`. Only reach for MCP when you need a single manual exploration (capture a screenshot, confirm a specific page state) and clearly don't want a persistent test for it.

### SPEC §8 / acceptance / manual-test checklist — automate by default

End-of-phase acceptance / smoke checklists (typical examples: SPEC §8 acceptance items, Phase D manual-test lists) **default to running automatically via the `playwright-cli` skill** — don't bundle them up as "user homework" and toss them over the wall. A complete loop (chrome.storage seed → trigger UI → assert result) only takes a few minutes.

Standard playbook (validated in Phase 27 D2):

```bash
# 1) Clean dev build (incremental often skips reader when tsx mtime is older than dist)
cd chrome-extension && rm -rf dist node_modules/.vite && npm run build:dev

# 2) Launch extension-loaded chromium (CDP 9333 + persistent profile + auto-load extension)
nohup node scripts/pf-launch.cjs > /tmp/pf-launch.log 2>&1 &

# 3) Attach playwright-cli + open the reader
npx --no-install playwright-cli attach --cdp=http://localhost:9333
npx --no-install playwright-cli goto "chrome-extension://<id>/reader/index.html?e2e=fake-paper"

# 4) Seed state + run the scenario
npx --no-install playwright-cli eval "(async () => { await chrome.storage.local.set({...}); })()"
npx --no-install playwright-cli press "Meta+l"
npx --no-install playwright-cli click eXX
npx --no-install playwright-cli tab-list   # verify multi-tab behavior
npx --no-install playwright-cli --raw eval "document.querySelector(...)"  # assert hydration
```

Gotchas:

- **Confirm build mode before every test session**: `playwright-cli console | grep "supabase env"` should show `http://127.0.0.1:54321 · development`. Seeing `production` means dist wasn't rebuilt correctly — go back to step 1.
- **After editing reader source you MUST `rm -rf dist node_modules/.vite` to force a rebuild**, then kill + relaunch chromium. Vite incremental often fakes a rebuild ("1 modules transformed" only compiled `inject.js`, the reader bundle didn't move).
- **Toast / async UI is timing-sensitive**: toasts auto-dismiss at 2.6s by default and the drawer overlay can occlude. Read toast text within < 1s of the click; press `Escape` to close the drawer first if needed.
- **Reuse `chrome-extension/scripts/pf-launch.cjs`** (the debug helper introduced in Phase 27); don't hand-roll a launch script every time.
- **Don't skip automation just because "it needs real network / a real paper"** — the vast majority of acceptance items can be fully covered via `chrome.storage.local` seed + cache-fallback paths (`#paperKey=<key>` entry uses pure cache rendering with zero network).

If you find a bug along the way, just patch + commit a fix in the same pass (Phase 27 D2 incidentally caught + fixed the long-latent `action!` false-report bug in `toast.tsx`).

## Auth + Sync (Supabase + Stripe)

User login, cross-device sync, 3-tier subscriptions (Free/Sync/Pro), managed AI proxy, and BYOK live behind a Supabase backend. Full spec: `docs/specs/2026-04-24-spec-user-login.md`. Implementation plan: `docs/plans/2026-04-24-plan-user-login.md`.

### Local dev stack

```bash
# Boot Postgres + Auth + Realtime + Edge runtime locally
supabase start
# Status, dashboard URLs, test keys
supabase status
```

Supabase Studio → `http://127.0.0.1:54323` · Mailpit (magic-link inbox) → `http://127.0.0.1:54324`.

### Env var loading

- `chrome-extension/.env.local` — copy from `chrome-extension/.env.local.example`. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only. Build-time inlined by Vite.
- `supabase/.env` — copy from `supabase/.env.example`. Edge Function secrets: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `UPGRADE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_SYNC`, `STRIPE_PRICE_PRO`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_RETURN_URL`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`.
- Integration tests (`chrome-extension/tests/integration/`) read local Supabase URLs from `supabase/.env.local-devnote.md` via `readFileSync`.
- `stripe-webhook` is explicitly `verify_jwt = false` in `supabase/config.toml` — Stripe signature is verified in the function body.

### Edge Functions

```
supabase/functions/
├── _shared/           # auth.ts / responses.ts / clients.ts — imported by every function
├── ai-proxy/          # managed AI streaming (rate-limit → quota → OpenAI SSE passthrough)
├── create-checkout-session/   # Stripe Checkout session (tier = sync|pro)
├── stripe-webhook/    # HMAC-verified 3-event handler (checkout.session.completed, subscription.updated/deleted)
└── create-portal-session/     # Stripe Billing Portal session
```

Serve one locally + tail logs:

```bash
supabase functions serve ai-proxy --env-file ./supabase/.env
# or all at once
supabase functions serve --env-file ./supabase/.env
```

Deploy to hosted Supabase:

```bash
supabase functions deploy ai-proxy
supabase functions deploy stripe-webhook --no-verify-jwt   # webhook must skip gateway auth
```

### Stripe webhook local testing

```bash
# Forward hosted webhooks to local edge runtime
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
# In another shell, trigger a test event
stripe trigger checkout.session.completed
```

The webhook upserts `subscriptions` on checkout.completed and `cancel_at_period_end` + `canceled_at` on subscription.updated/deleted.

### Database migrations + RPCs

- Tables + RLS + realtime + triggers + RPCs live in `supabase/migrations/00{1..5}_*.sql`.
- Never write `subscriptions.tier` directly from the client — all tier transitions flow through Stripe → webhook → service-role write.
- `increment_ai_usage()` and `rate_limit_check(p_max_count, p_window_sec)` are `security definer` RPCs; client calls them with its own JWT.

### Client architecture (Phase A-F)

- `chrome-extension/reader/lib/supabase.ts` — shared Supabase client with `chrome.storage.local` session adapter (MV3-safe).
- `chrome-extension/reader/lib/storage-schema.ts` — typed keys for session, BYOK config, sync queue, migration state, modal dismiss flags.
- `chrome-extension/reader/lib/ai.ts` — `callAI(messages, kind, onChunk)` routes BYOK (has `config_apikey`) vs managed proxy. Throws `ProxyError` with codes `quota-exhausted | sync-no-managed-ai | rate-limited | unauthenticated | server-error | unknown`.
- `chrome-extension/reader/lib/migration.ts` — one-time login migration (push local → cloud) with conflict detection + 3-choice merge (merge | local | cloud).
- `chrome-extension/reader/lib/sync-queue.ts` — offline-write queue, drains on online / SW startup.
- `chrome-extension/reader/lib/byok-sync.ts` — cloud-sync `baseURL + model` (apiKey stays local-only).
- `chrome-extension/reader/lib/subscriptions-sync.ts` — realtime listener for tier changes (AccountMenu auto-refresh).

### Logout semantics

`doLogout` in `components/top-bar.tsx` clears: `config_apikey`, `config_apikeys` (Phase 12 D-A2), `config_active_byok_config_id` (Phase 12 D-D2), `migrationState:byok-configs-v12` (Phase 12 D-A3), `byokHealthCache` (Phase 12 D-C1 — MED-5 cross-AI review), `config_prefs`, `sync:queue`, `migrationState`, `paperIdMap`, `churnModalSeen`, `libraryCapBannerDismissed`, and all `paper:*` keys except `:parsed` and `:summary:*` (regenerable, safe to keep).

## Agent skills

### Issue tracker

Issues live as GitHub issues; use the `gh` CLI (it infers the repo from `git remote -v`, so the same commands work in both the private dev clone and the public mirror). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five-label vocabulary (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`); `wontfix` and `ready-for-agent` already exist, the rest are created on first use. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by `/grill-with-docs`). See `docs/agents/domain.md`.
