// supabase/functions/_shared/auth.ts
import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!

export async function getUserFromRequest(req: Request):
  Promise<{ user: User; client: SupabaseClient } | null>
{
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const client = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: auth } },
  })
  const { data: { user } } = await client.auth.getUser()
  return user ? { user, client } : null
}
