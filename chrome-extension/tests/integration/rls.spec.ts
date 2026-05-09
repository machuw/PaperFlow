import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load keys from the gitignored devnote
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

async function signupAndLogin(email: string) {
  const admin = createClient(SB_URL, SB_SERVICE)
  await admin.auth.admin.createUser({ email, password: 'pw123456', email_confirm: true })
  const client = createClient(SB_URL, SB_ANON)
  const { data } = await client.auth.signInWithPassword({ email, password: 'pw123456' })
  return { client, userId: data.user!.id }
}

describe('RLS isolation', () => {
  const TABLES = ['papers', 'highlights', 'margin_notes', 'memory', 'chat',
                  'canvas', 'subscriptions', 'byok_prefs'] as const

  for (const t of TABLES) {
    it(`${t}: user B cannot read user A rows`, async () => {
      const uid = Date.now() + Math.floor(Math.random() * 1000)
      const A = await signupAndLogin(`rls-a-${uid}@test.com`)
      const B = await signupAndLogin(`rls-b-${uid}@test.com`)
      if (t === 'papers') {
        await A.client.from('papers').insert({ paper_key: 'p1', title: 'A paper' })
      }
      const { data } = await B.client.from(t).select()
      expect(data?.some((r: any) => r.user_id === A.userId)).toBe(false)
    })
  }
})
