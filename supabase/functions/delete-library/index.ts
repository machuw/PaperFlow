import { getUserFromRequest } from '../_shared/auth.ts'
import { json, errorResp } from '../_shared/responses.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST')    return errorResp('Method not allowed', 405)
  const session = await getUserFromRequest(req)
  if (!session) return errorResp('Unauthorized', 401)
  const { client, user } = session

  let body: { id?: string }
  try { body = await req.json() } catch { return errorResp('Invalid JSON', 400) }
  const id = body.id
  if (!id || typeof id !== 'string') return errorResp('id required', 400)

  // RLS-scoped delete; FK on papers.library_id (on delete set null) handles cascade.
  const { error } = await client.from('libraries').delete().eq('id', id).eq('user_id', user.id)
  if (error) return errorResp(error.message, 500)
  return json({ ok: true })
})
