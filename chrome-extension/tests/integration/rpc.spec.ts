import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const devnote = readFileSync(
  resolve(__dirname, '..', '..', '..', 'supabase', '.env.local-devnote.md'),
  'utf8',
)
function extract(pattern: RegExp): string {
  const m = devnote.match(pattern)
  if (!m) throw new Error(`Could not find ${pattern} in devnote`)
  return m[1].trim()
}
const SB_URL = extract(/SB_URL=(.+)/)
const SB_ANON = extract(/SB_ANON=(.+)/)
const SB_SERVICE = extract(/SB_SERVICE=(.+)/)

// persistSession:false prevents this service_role client from picking up the
// anon JWT that the test's signInWithPassword writes into shared storage.
const admin = createClient(SB_URL, SB_SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function signupAndLogin(email: string) {
  await admin.auth.admin.createUser({ email, password: 'pw123456', email_confirm: true })
  const client = createClient(SB_URL, SB_ANON)
  const { data } = await client.auth.signInWithPassword({ email, password: 'pw123456' })
  return { client, userId: data.user!.id }
}

describe('increment_ai_usage', () => {
  it('2 concurrent calls at used=299/300 Pro → exactly one wins', async () => {
    const uid = Date.now() + Math.floor(Math.random() * 1000)
    const { client, userId } = await signupAndLogin(`rpc-concur-${uid}@test.com`)
    // Upsert subscription to Pro
    await admin.from('subscriptions').upsert({ user_id: userId, tier: 'pro' })
    // Seed ai_usage for current month at 299
    const period = new Date().toISOString().slice(0, 7)
    await admin.from('ai_usage').insert({ user_id: userId, period, used: 299 })

    const [r1, r2] = await Promise.all([
      client.rpc('increment_ai_usage'),
      client.rpc('increment_ai_usage'),
    ])
    const results = [r1.data, r2.data].sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(results).toEqual([-1, 300])
  })

  it('free tier uses lifetime-trial period with limit 20', async () => {
    const uid = Date.now() + Math.floor(Math.random() * 1000)
    const { client } = await signupAndLogin(`rpc-free-${uid}@test.com`)
    // User auto-created with tier='free' per trigger
    for (let i = 1; i <= 20; i++) {
      const { data } = await client.rpc('increment_ai_usage')
      expect(data).toBe(i)
    }
    // 21st call returns -1
    const { data } = await client.rpc('increment_ai_usage')
    expect(data).toBe(-1)
  })

  it('sync tier raises "sync tier has no managed ai" error', async () => {
    const uid = Date.now() + Math.floor(Math.random() * 1000)
    const { client, userId } = await signupAndLogin(`rpc-sync-${uid}@test.com`)
    await admin.from('subscriptions').upsert({ user_id: userId, tier: 'sync' })
    const { error } = await client.rpc('increment_ai_usage')
    expect(error?.message).toMatch(/sync tier/)
  })
})

describe('rate_limit_check', () => {
  it('11th call in same 5-minute window returns false', async () => {
    const uid = Date.now() + Math.floor(Math.random() * 1000)
    const { client } = await signupAndLogin(`rate-${uid}@test.com`)
    // 10 calls should all return true
    for (let i = 0; i < 10; i++) {
      const { data } = await client.rpc('rate_limit_check', { p_max_count: 10, p_window_sec: 300 })
      expect(data).toBe(true)
    }
    // 11th returns false
    const { data } = await client.rpc('rate_limit_check', { p_max_count: 10, p_window_sec: 300 })
    expect(data).toBe(false)
  })
})
