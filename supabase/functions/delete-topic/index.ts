import { getUserFromRequest } from '../_shared/auth.ts'
import { serviceRoleClient } from '../_shared/clients.ts'
import { json, errorResp } from '../_shared/responses.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST')    return errorResp('Method not allowed', 405)
  const session = await getUserFromRequest(req)
  if (!session) return errorResp('Unauthorized', 401)
  const { user } = session

  let body: { id?: string }
  try { body = await req.json() } catch { return errorResp('Invalid JSON', 400) }
  const id = body.id
  if (!id || typeof id !== 'string') return errorResp('id required', 400)

  // Atomic: delete catalog row + array_remove on all this user's papers in one tx.
  // Use service role because the SQL function is security definer.
  const svc = serviceRoleClient()
  const { error } = await svc.rpc('delete_topic_atomic', { p_topic_id: id, p_user_id: user.id })
  if (error) return errorResp(error.message, 500)
  return json({ ok: true })
})
