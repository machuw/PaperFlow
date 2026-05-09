// supabase/functions/_shared/responses.ts
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export const errorResp = (reason: string, status = 500): Response =>
  json({ error: reason }, status)
