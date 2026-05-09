/**
 * Dump raw SSE bytes from ai-proxy to verify whether the upstream actually
 * sends content frames or just closes empty (or sends an unrecognized error
 * frame format).
 */
const SUPA_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function getJWT() {
  const email = `raw-${Date.now()}@example.com`;
  const password = 'StressTest1234!';
  const auth = `Bearer ${SERVICE_KEY}`;
  const u = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: auth },
    body: JSON.stringify({ email, password, email_confirm: true }),
  }).then(r => r.json());
  const userId = u.id;
  await fetch(`${SUPA_URL}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: userId, tier: 'pro', stripe_customer_id: 'raw_'+Date.now(), stripe_subscription_id: 'raw_'+Date.now(), current_period_end: new Date(Date.now()+30*864e5).toISOString() }),
  });
  const t = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  }).then(r => r.json());
  return t.access_token;
}

(async () => {
  const jwt = await getJWT();
  const filler = '本文提出了一种新的视觉-语言-动作模型推理时延降低方法。'.repeat(40);
  let sys = '# Beyond Attention Magnitude\n## Abstract\n';
  while (sys.length < 45000) sys += filler;
  sys = sys.slice(0, 45000);

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`\n=== attempt ${attempt} ===`);
    const t0 = performance.now();
    const resp = await fetch(`${SUPA_URL}/functions/v1/ai-proxy`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'chat', stream: true,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: '帮我用 3 句话总结这篇论文。' },
        ],
      }),
      signal: AbortSignal.timeout(40_000),
    });
    console.log(`status=${resp.status}, content-type=${resp.headers.get('content-type')}`);
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let total = '';
    let firstChunkAt = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (firstChunkAt === null) firstChunkAt = performance.now() - t0;
      total += dec.decode(value, { stream: true });
    }
    const totalAt = performance.now() - t0;
    console.log(`first-byte=${firstChunkAt == null ? 'never' : Math.round(firstChunkAt)+'ms'}, total=${Math.round(totalAt)}ms, body-bytes=${total.length}`);
    console.log('--- body (first 800 chars) ---');
    console.log(total.slice(0, 800));
    if (total.length > 800) console.log(`--- (truncated, ${total.length - 800} more chars) ---`);
  }
})();
