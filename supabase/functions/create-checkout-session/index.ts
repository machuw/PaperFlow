import { getUserFromRequest } from '../_shared/auth.ts'
import { json, errorResp } from '../_shared/responses.ts'
import Stripe from 'https://esm.sh/stripe@14'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const PRICE_SYNC = Deno.env.get('STRIPE_PRICE_SYNC')!
const PRICE_PRO = Deno.env.get('STRIPE_PRICE_PRO')!
const SUCCESS_URL = Deno.env.get('STRIPE_SUCCESS_URL')!
const CANCEL_URL = Deno.env.get('STRIPE_CANCEL_URL')!

Deno.serve(async (req) => {
  const session = await getUserFromRequest(req)
  if (!session) return errorResp('Unauthorized', 401)

  const { tier } = await req.json()
  if (tier !== 'sync' && tier !== 'pro') return errorResp('Invalid tier', 400)

  const priceId = tier === 'pro' ? PRICE_PRO : PRICE_SYNC
  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    client_reference_id: session.user.id,
    metadata: { tier },
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
    customer_email: session.user.email,
  })
  return json({ url: checkout.url })
})
