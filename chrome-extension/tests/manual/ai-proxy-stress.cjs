/**
 * Stress-test ai-proxy with realistic payloads to reproduce the chat timeout
 * the user sees. Hits LOCAL supabase ai-proxy, which forwards to the same
 * NewAPI gateway + claude-haiku-4-5-20251001 that hosted uses.
 *
 * Telemetry from the user's browser:
 *   first chat:  est_input_tokens=13089, ttft_ms=4672, total_stream_ms=6246, status=ok
 *   second chat: inactivity timeout (30000ms) — upstream sent no chunk for 30s
 *
 * What this script does:
 *   1) Mint a service-role admin client.
 *   2) Create a throwaway test user; upsert subscriptions tier=pro so quota
 *      doesn't gate the call.
 *   3) Sign in to get a regular user JWT.
 *   4) Build a realistic 13k-token payload (paper context + history).
 *   5) Loop N times: POST to /ai-proxy, time TTFT (first SSE delta) + total.
 *   6) Report per-call ttft / total / status / error and a summary.
 *
 * Run:  cd chrome-extension && node tests/manual/ai-proxy-stress.cjs [N]
 */
const SUPA_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const N = parseInt(process.argv[2] || '5', 10);
const TIMEOUT_MS = 60_000;       // we want to SEE the timeout, not abort early
const TARGET_INPUT_TOKENS = 13_000;

function buildSystem(charsTarget) {
  // Mimic buildPaperContext shape: title + by + abstract + paragraphs.
  // We just need char-volume in the right ballpark.
  const filler = '本文提出了一种新的视觉-语言-动作模型推理时延降低方法。'
    .repeat(40);  // ~2000 chars per loop iteration
  let out = '# Beyond Attention Magnitude\nBy Peiju Liu, Jinming Liu.\n## Abstract\n';
  while (out.length < charsTarget) out += filler;
  return out.slice(0, charsTarget);
}

async function ensureUser() {
  const email = `stress-${Date.now()}@example.com`;
  const password = 'StressTest1234!';
  const auth = `Bearer ${SERVICE_KEY}`;

  // Create + auto-confirm
  const createResp = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: auth },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!createResp.ok) throw new Error('admin create user failed: ' + await createResp.text());
  const userJSON = await createResp.json();
  const userId = userJSON.id || userJSON.user?.id;

  // Upsert subscriptions tier=pro to bypass free-tier 20-call lifetime cap.
  const subResp = await fetch(`${SUPA_URL}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: auth,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      user_id: userId,
      tier: 'pro',
      stripe_customer_id: 'cus_stress_' + Date.now(),
      stripe_subscription_id: 'sub_stress_' + Date.now(),
      current_period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    }),
  });
  if (!subResp.ok) throw new Error('subscriptions upsert failed: ' + await subResp.text());

  // Sign in to get a user-level JWT
  const tokenResp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!tokenResp.ok) throw new Error('signin failed: ' + await tokenResp.text());
  const { access_token } = await tokenResp.json();
  return { userId, email, access_token };
}

async function callOnce(jwt, history, label) {
  const messages = [
    { role: 'system', content: buildSystem(45_000) },  // matches user's system_chars=45054
    ...history,
    { role: 'user', content: '帮我用 3 句话总结这篇论文的核心方法。' },
  ];
  const t0 = performance.now();
  let ttft_ms = null;
  let output_chars = 0;
  let chunks = 0;
  let status = 'ok';
  let err;

  let resp;
  try {
    resp = await fetch(`${SUPA_URL}/functions/v1/ai-proxy`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind: 'chat', messages, stream: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { label, status: 'fetch-error', err: e.message, ttft_ms: null, total_stream_ms: performance.now() - t0 };
  }

  if (!resp.ok) {
    return { label, status: 'http-' + resp.status, err: (await resp.text()).slice(0, 200), ttft_ms: null, total_stream_ms: performance.now() - t0 };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let frameEnd;
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const dataLine = frame.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;
        const payload = dataLine.slice(6).trim();
        if (payload === '[DONE]') { chunks = chunks; break; }
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            if (ttft_ms === null) ttft_ms = performance.now() - t0;
            output_chars += delta.length;
            chunks++;
          }
        } catch {}
      }
    }
  } catch (e) {
    status = 'stream-error';
    err = e.message;
  }
  const total_stream_ms = performance.now() - t0;
  // Capture history for next round (cumulative — like real chat)
  return { label, status, ttft_ms, total_stream_ms, output_chars, chunks, err, lastAssistant: null };
}

(async () => {
  console.log(`[stress] N=${N}, target_input_tokens≈${TARGET_INPUT_TOKENS}, timeout=${TIMEOUT_MS}ms`);
  const { email, access_token } = await ensureUser();
  console.log('[stress] test user:', email);
  console.log();

  const history = [];
  const results = [];
  for (let i = 1; i <= N; i++) {
    const label = `chat#${i}`;
    process.stdout.write(`[stress] ${label} firing… `);
    const r = await callOnce(access_token, history, label);
    results.push(r);
    console.log(JSON.stringify({
      status: r.status,
      ttft_ms: r.ttft_ms == null ? null : Math.round(r.ttft_ms),
      total_stream_ms: Math.round(r.total_stream_ms),
      output_chars: r.output_chars,
      chunks: r.chunks,
      err: r.err && r.err.slice(0, 120),
    }));
    // append a fake assistant turn so history grows like real chat
    history.push({ role: 'user', content: '帮我用 3 句话总结这篇论文的核心方法。' });
    history.push({ role: 'assistant', content: '本文通过观察跨层 token 排名一致性提出 TIES。'.repeat(20) });
  }

  console.log('\n=== summary ===');
  const ok = results.filter(r => r.status === 'ok' && r.ttft_ms != null);
  const failed = results.filter(r => r.status !== 'ok' || r.ttft_ms == null);
  console.log(`ok: ${ok.length}/${N}, failed: ${failed.length}`);
  if (ok.length) {
    const ttfts = ok.map(r => r.ttft_ms).sort((a, b) => a - b);
    const totals = ok.map(r => r.total_stream_ms).sort((a, b) => a - b);
    const fmt = arr => `min=${Math.round(arr[0])} p50=${Math.round(arr[Math.floor(arr.length/2)])} max=${Math.round(arr[arr.length-1])}`;
    console.log('ttft_ms:        ', fmt(ttfts));
    console.log('total_stream_ms:', fmt(totals));
  }
  if (failed.length) {
    console.log('\nfailed calls:');
    for (const f of failed) console.log(' -', f.label, f.status, f.err && f.err.slice(0, 120));
  }
})().catch(e => { console.error('FATAL', e); process.exit(2); });
