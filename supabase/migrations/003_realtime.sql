alter publication supabase_realtime add table
  papers, highlights, margin_notes, memory, chat, canvas, subscriptions, byok_prefs;
-- Do not add ai_usage, ai_usage_log, rate_limits (clients don't need realtime on these)
-- byok_prefs is included so baseURL/model changes on device A reflect on device B (§5.3 addendum)
