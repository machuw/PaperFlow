import { serviceRoleClient } from '../_shared/clients.ts'
import Stripe from 'https://esm.sh/stripe@14'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  if (!sig) return new Response('missing sig', { status: 400 })
  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, WEBHOOK_SECRET)
  } catch {
    return new Response('bad sig', { status: 400 })
  }

  const supa = serviceRoleClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session
      const tier = s.metadata?.tier as 'sync' | 'pro'
      const sub = await stripe.subscriptions.retrieve(s.subscription as string)
      await supa.from('subscriptions').upsert({
        user_id: s.client_reference_id,
        tier,
        stripe_customer_id: s.customer,
        stripe_subscription_id: s.subscription,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        cancel_at_period_end: sub.cancel_at_period_end,
      })
      break
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      await supa.from('subscriptions').update({
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        cancel_at_period_end: sub.cancel_at_period_end,
        canceled_at: sub.cancel_at_period_end ? new Date().toISOString() : null,
      }).eq('stripe_subscription_id', sub.id)
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      await supa.from('subscriptions').update({
        tier: 'free',
        stripe_subscription_id: null,
        current_period_end: null,
        cancel_at_period_end: false,
      }).eq('stripe_subscription_id', sub.id)
      break
    }
  }

  return new Response('ok', { status: 200 })
})
