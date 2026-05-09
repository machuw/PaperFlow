import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'tests/**/*.spec.ts'],
    exclude: ['node_modules/**', 'tests/library-v2/e2e/**', 'tests/e2e/**'],
    env: {
      // reader/lib/supabase.ts throws at module load when these are unset.
      // Tests that exercise real Supabase override these via a vi.mock shim
      // or read them from supabase/.env.local-devnote.md directly.
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
