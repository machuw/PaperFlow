/**
 * Baseline test: send a trivial English prompt to ai-proxy. If content_filter
 * still fires, the model/provider is broken regardless of input. If it works,
 * the previous failures are payload-triggered (Bedrock guardrails on the
 * Chinese paper / filler text).
 */
const SUPA_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function getJWT() {
  const email = `bl-${Date.now()}@example.com`;
  const password = 'Test1234!';
  const auth = `Bearer ${SERVICE_KEY}`;
  const u = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: auth },
    body: JSON.stringify({ email, password, email_confirm: true })
  }).then(r => r.json());
  await fetch(`${SUPA_URL}/rest/v1/subscriptions`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: u.id, tier: 'pro', stripe_customer_id: 'bl_'+Date.now(), stripe_subscription_id: 'bl_'+Date.now(), current_period_end: new Date(Date.now()+30*864e5).toISOString() })
  });
  const t = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON_KEY }, body: JSON.stringify({ email, password })
  }).then(r => r.json());
  return t.access_token;
}

async function probe(jwt, label, messages) {
  const t0 = performance.now();
  const resp = await fetch(`${SUPA_URL}/functions/v1/ai-proxy`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'chat', stream: true, messages }),
    signal: AbortSignal.timeout(40_000)
  });
  let body = '';
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  while (true) { const { value, done } = await reader.read(); if (done) break; body += dec.decode(value, { stream: true }); }
  const total = Math.round(performance.now() - t0);

  // crude: count content frames vs finish_reasons
  const contentMatches = body.match(/"content":"[^"]+"/g) || [];
  const filterHit = /"finish_reason":"content_filter"/.test(body);
  const stopHit  = /"finish_reason":"stop"/.test(body);
  const lengthHit = /"finish_reason":"length"/.test(body);
  console.log(`[${label}] total=${total}ms bytes=${body.length} content_frames=${contentMatches.length} finish=${filterHit?'CONTENT_FILTER':stopHit?'stop':lengthHit?'length':'unknown'}`);
}

(async () => {
  const jwt = await getJWT();

  await probe(jwt, 'A: trivial English', [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Say hi in 5 words.' },
  ]);

  await probe(jwt, 'B: trivial Chinese', [
    { role: 'system', content: '你是一个有用的助手。' },
    { role: 'user', content: '用 5 个字打招呼。' },
  ]);

  await probe(jwt, 'C: long English paper-like', [
    { role: 'system', content: ('This paper proposes a novel attention-based method for vision-language tasks. '.repeat(600)).slice(0, 45000) },
    { role: 'user', content: 'Summarize in 3 sentences.' },
  ]);

  await probe(jwt, 'D: long Chinese paper-like (matches user case)', [
    { role: 'system', content: ('本文提出了一种新的视觉-语言-动作模型推理时延降低方法。'.repeat(40)).repeat(20).slice(0, 45000) },
    { role: 'user', content: '帮我用 3 句话总结。' },
  ]);

  await probe(jwt, 'E: real arxiv-style English title+abstract', [
    { role: 'system', content: 'You are a research assistant grounded in this paper. # Beyond Attention Magnitude: Leveraging Inter-layer Rank Consistency for Efficient Vision-Language-Action Models. Abstract: Vision-Language-Action (VLA) models excel in robotic manipulation but suffer from significant inference latency due to processing dense visual tokens. Existing token reduction methods predominantly rely on attention magnitude as a static selection. We introduce TIES, a dynamic framework guided by inter-layer token ranking consistency.' },
    { role: 'user', content: 'What is TIES?' },
  ]);
})();
