import { getOverviewSection, setOverviewSection } from './storage';
import { callAI, buildMessages, rafBatchedAppender } from './ai';
import { supabase } from './supabase';
import { getConfig } from './storage';
import { getItem } from './storage-schema';
import { isCodexBaseURL } from './byok-presets';
import { surfaceCodexError } from './toast-helpers';
import type { Paper } from '../types';

export type OverviewSectionKind = 'contributions' | 'keywords';

export type OverviewState =
  | { kind: 'idle' }
  | { kind: 'unconfigured' }
  | { kind: 'streaming'; partial: string }
  | { kind: 'ready'; body: string }
  | { kind: 'error'; message: string };

/**
 * True iff at least one of the two AI routes (BYOK or managed) is presently
 * usable. Mirrors the routing rule in `callAI`:
 *   - BYOK requires apiKey + baseURL + model (otherwise streamBYOK throws).
 *   - Managed requires a non-null Supabase session.
 *
 * Used as a pre-flight in `ensureOverview` so the auto-fired summary on the
 * Overview tab doesn't generate a guaranteed-failure 401/403 round-trip when
 * the user has neither path configured.
 */
async function aiAvailable(): Promise<boolean> {
  // Phase 13: read via getConfig() so the new active multi-config row is
  // recognized (Phase 12+13 顶栏 chip / 设置页 writes new keys, not legacy
  // config_apikey + config_prefs). Falls back to v1.1 split keys for users
  // mid-migration.
  const cfg = await getConfig();
  if (cfg && cfg.apiKey && cfg.baseURL && cfg.model) return true;
  // Slice 2 #9: Codex preset uses sentinel baseURL with an empty apiKey —
  // credentials come from codex_auth_tokens (OAuth) instead. Recognize it as
  // configured when both the sentinel and a stored token are present, so the
  // Overview tab fires summarization instead of showing "未配置 AI" after the
  // user logs in via the Codex panel.
  if (cfg && isCodexBaseURL(cfg.baseURL) && cfg.model) {
    const tokens = await getItem('codex_auth_tokens');
    if (tokens) return true;
  }
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

export async function ensureOverview(
  pk: string,
  paper: Paper,
  kind: OverviewSectionKind,
  model: string,
  lang: string,
  onState: (s: OverviewState) => void,
): Promise<void> {
  const cached = await getOverviewSection(pk, kind, model, lang);
  if (cached) { onState({ kind: 'ready', body: cached }); return; }

  if (!(await aiAvailable())) { onState({ kind: 'unconfigured' }); return; }

  onState({ kind: 'streaming', partial: '' });

  const aiKind = kind === 'contributions' ? 'overviewContributions' : 'overviewKeywords';
  const messages = buildMessages(aiKind as any, paper, '', lang);
  const batch = rafBatchedAppender((acc) => onState({ kind: 'streaming', partial: acc }));
  let final = '';

  try {
    await callAI(messages, aiKind, (chunk: string) => {
      batch.append(chunk);
      final += chunk;
    });
    batch.flush();
    await setOverviewSection(pk, kind, model, lang, final);
    onState({ kind: 'ready', body: final });
  } catch (e: any) {
    // Slice 3 #12: Codex-typed errors get surfaced via toast (relogin /
    // switch-provider nudge) instead of a generic error banner that the user
    // can't act on. Toast supersedes; clear streaming state to idle.
    if (surfaceCodexError(e)) {
      onState({ kind: 'idle' });
      return;
    }
    onState({ kind: 'error', message: e?.message ?? 'failed' });
  }
}
