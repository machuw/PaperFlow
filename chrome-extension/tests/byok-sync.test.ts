// Phase 17 D-B4: byok-sync.ts retired its v1.1 cloud-sync logic. The 3 public
// exports remain as no-op stubs so callers in reader/main.tsx + options/main.tsx
// could be cleaned up incrementally. Plan 17-01 deleted both call sites; this
// test now verifies the stubs are pure no-ops (no Supabase interaction, no
// chrome.storage.local writes) so accidental restoration of cloud sync would
// surface as a regression.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { onLogin_syncByokPrefs, pushByokPrefs, subscribeByokPrefs } from '../reader/lib/byok-sync'

const storageMock: Record<string, unknown> = {}
beforeEach(() => {
  for (const k of Object.keys(storageMock)) delete storageMock[k]
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: string | string[] | null) => {
          if (k === null || k === undefined) return Promise.resolve({ ...storageMock })
          if (Array.isArray(k)) {
            const out: Record<string, unknown> = {}
            for (const key of k) if (key in storageMock) out[key] = storageMock[key]
            return Promise.resolve(out)
          }
          return Promise.resolve(k in storageMock ? { [k]: storageMock[k] } : {})
        },
        set: (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); return Promise.resolve() },
        remove: (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k]
          for (const key of keys) delete storageMock[key]
          return Promise.resolve()
        },
        clear: () => { for (const key of Object.keys(storageMock)) delete storageMock[key]; return Promise.resolve() },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
})

describe('byok-sync (Phase 17 retired no-op stubs)', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear()
    vi.restoreAllMocks()
  })

  it('onLogin_syncByokPrefs: no-op — never touches chrome.storage.local', async () => {
    const setSpy = vi.spyOn(chrome.storage.local, 'set')
    await onLogin_syncByokPrefs()
    expect(setSpy).not.toHaveBeenCalled()
    // No keys written.
    expect(Object.keys(storageMock)).toHaveLength(0)
  })

  it('pushByokPrefs: no-op — accepts arguments but never writes', async () => {
    const setSpy = vi.spyOn(chrome.storage.local, 'set')
    await pushByokPrefs('https://api.openai.com/v1', 'gpt-4o-mini')
    expect(setSpy).not.toHaveBeenCalled()
    expect(Object.keys(storageMock)).toHaveLength(0)
  })

  it('subscribeByokPrefs: no-op — returns an unsubscribe function that does nothing', async () => {
    const unsub = subscribeByokPrefs()
    expect(typeof unsub).toBe('function')
    // Calling unsub must not throw.
    expect(() => unsub()).not.toThrow()
  })
})
