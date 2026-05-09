import { getUserFromRequest } from '../_shared/auth.ts'
import { json, errorResp } from '../_shared/responses.ts'
import Stripe from 'https://esm.sh/stripe@14'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })

Deno.serve(async (req) => {
  const session = await getUserFromRequest(req)
  if (!session) return errorResp('Unauthorized', 401)

  const { data: sub } = await session.client.from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', session.user.id)
    .single()
  if (!sub?.stripe_customer_id) return errorResp('no-customer', 400)

  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: Deno.env.get('STRIPE_PORTAL_RETURN_URL')!,
  })
  return json({ url: portal.url })
})
