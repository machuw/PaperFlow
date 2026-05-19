# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). PaperFlow uses semver.

## Unreleased

### Added

- **OpenAI Codex (ChatGPT Subscription) BYOK preset** — ChatGPT Plus / Pro / Team subscribers can drive PaperFlow's AI calls with their existing subscription quota; no per-token API cost. Login via OAuth Device Code Flow (no API key required). Tokens stored exclusively in `chrome.storage.local`; never synced. Coexists with `codex` CLI / Codex Desktop without invalidating either side's session. Available to all PaperFlow tiers.
- Codex preset registers under Options → BYOK with a one-click "Sign in with ChatGPT" flow + an onboarding modal that surfaces ChatGPT's account-side "device code authorization" toggle requirement.
- Codex error UX: 401-after-retry → "session expired, re-login" toast linking to Options; non-401 non-2xx → "Codex API may have changed, switch BYOK provider" toast. 9-locale i18n.
- Documentation: [ADR-0001](docs/adr/0001-codex-byok-via-device-code-flow.md) records the device-code architecture; [Codex BYOK spec §15](docs/specs/2026-05-12-spec-codex-subscription-byok.md) appends Phase 0 spike findings (per-grant session model, 10-day TTL, ChatGPT-side device-code-authorization toggle).

### Security

The Codex preset is **experimental**. It relies on an undocumented `chatgpt.com` backend API, reuses the public OAuth `client_id` of the Codex CLI (PaperFlow does not register its own), and may be considered against OpenAI's TOS. Risk of breakage and account-level enforcement is the user's. Tokens never leave the device; logout clears them. See the [README disclosure](README.md#chatgpt-codex-preset--experimental-use-at-your-own-risk) for details.

---

Older entries are retroactive starting from the v0.2.0 bump; pre-v0.2.0 history lives in `git log`.
