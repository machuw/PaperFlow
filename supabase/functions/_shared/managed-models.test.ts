// Phase 15 Plan 15-01 Task 1: registry + helper unit tests.
// Run with: npx deno test supabase/functions/_shared/managed-models.test.ts --no-check

import { assertEquals } from 'https://deno.land/std@0.220.0/assert/mod.ts'
import { MANAGED_MODELS, tierMeetsMin } from './managed-models.ts'

Deno.test('Test 1: MANAGED_MODELS contains exactly 1 entry (claude-haiku-4-5-20251001)', () => {
  assertEquals(MANAGED_MODELS.map((m) => m.id), ['claude-haiku-4-5-20251001'])
})

Deno.test('Test 2: claude-haiku-4-5-20251001 entry has correct shape', () => {
  const m = MANAGED_MODELS.find((x) => x.id === 'claude-haiku-4-5-20251001')!
  assertEquals(m.provider, 'newapi')
  assertEquals(m.upstream_model, 'claude-haiku-4-5-20251001')
  assertEquals(m.min_tier, 'pro')
  assertEquals(m.enabled, true)
  assertEquals(m.display_name, 'claude-4.5-haiku')
})

Deno.test('Test 3: tierMeetsMin truth table', () => {
  // Pro user reaches Pro models
  assertEquals(tierMeetsMin('pro', 'pro'), true)
  // Sync user does NOT reach Pro models
  assertEquals(tierMeetsMin('sync', 'pro'), false)
  // Free user does NOT reach Pro models
  assertEquals(tierMeetsMin('free', 'pro'), false)
  // Pro user trivially exceeds Free
  assertEquals(tierMeetsMin('pro', 'free'), true)
  // Same tier matches
  assertEquals(tierMeetsMin('sync', 'sync'), true)
  assertEquals(tierMeetsMin('free', 'free'), true)
})
