// supabase/functions/_shared/clients.ts
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}
