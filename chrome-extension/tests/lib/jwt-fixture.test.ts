// chrome-extension/tests/lib/jwt-fixture.test.ts
//
// E2E-01 unit tests for mintTestUserJWT helper.
// Mocks @supabase/supabase-js admin client + node:fs.
//
// Use Node environment (NOT jsdom) — jose internally builds a Uint8Array
// payload via TextEncoder, and jsdom's instanceof Uint8Array check fails
// against Node's TextEncoder output. The helper is Node-test-only anyway.
//
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @supabase/supabase-js BEFORE importing the helper (vi.mock is hoisted).
const mockAdmin = {
  createUser: vi.fn(),
  deleteUser: vi.fn(),
};
const mockFrom = vi.fn();
const mockClient = {
  auth: { admin: mockAdmin },
  from: mockFrom,
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockClient),
}));

// Mock node:fs to control supabase/.env content per test.
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('node:fs', () => ({
  default: {
    existsSync: (p: string) => mockExistsSync(p),
    readFileSync: (p: string, enc: string) => mockReadFileSync(p, enc),
  },
  existsSync: (p: string) => mockExistsSync(p),
  readFileSync: (p: string, enc: string) => mockReadFileSync(p, enc),
}));

// Default valid env content (32+ char JWT_SECRET).
const VALID_ENV =
  'SUPABASE_SERVICE_ROLE_KEY=eyJtest.service.role\n' +
  'JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long\n';

beforeEach(() => {
  vi.resetModules(); // reload helper to clear cached _adminClient
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(VALID_ENV);
  mockAdmin.createUser.mockResolvedValue({
    data: { user: { id: 'uuid-fake-1', email: 'e2e-abc-pro@e2e.test' } },
    error: null,
  });
  mockAdmin.deleteUser.mockResolvedValue({ data: null, error: null });
  mockFrom.mockReturnValue({
    upsert: vi.fn().mockResolvedValue({ error: null }),
  });
});

describe('mintTestUserJWT', () => {
  it('returns jwt + user_id + email + cleanup', async () => {
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    const out = await mintTestUserJWT('abc', 'pro');
    expect(out.jwt).toMatch(/^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/); // JWT shape
    expect(out.user_id).toBe('uuid-fake-1');
    expect(out.email).toBe('e2e-abc-pro@e2e.test');
    expect(typeof out.cleanup).toBe('function');
  });

  it('jwt payload has aud + sub + email + role + iat + exp', async () => {
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    const { jwt } = await mintTestUserJWT('abc', 'pro');
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.aud).toBe('authenticated');
    expect(payload.sub).toBe('uuid-fake-1');
    expect(payload.email).toBe('e2e-abc-pro@e2e.test');
    expect(payload.role).toBe('authenticated');
    expect(payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it('tier=free skips subscriptions upsert (trigger handles default)', async () => {
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    await mintTestUserJWT('abc', 'free');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('tier=pro upserts subscriptions with onConflict:user_id', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValueOnce({ upsert: upsertMock });
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    await mintTestUserJWT('abc', 'pro');
    expect(mockFrom).toHaveBeenCalledWith('subscriptions');
    expect(upsertMock).toHaveBeenCalledWith(
      { user_id: 'uuid-fake-1', tier: 'pro' },
      { onConflict: 'user_id' },
    );
  });

  it('tier=sync uses upsert path (mirrors pro)', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValueOnce({ upsert: upsertMock });
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    await mintTestUserJWT('abc', 'sync');
    expect(upsertMock).toHaveBeenCalledWith(
      { user_id: 'uuid-fake-1', tier: 'sync' },
      { onConflict: 'user_id' },
    );
  });

  it('cleanup() calls admin.deleteUser exactly once', async () => {
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    const { cleanup } = await mintTestUserJWT('abc', 'pro');
    await cleanup();
    expect(mockAdmin.deleteUser).toHaveBeenCalledTimes(1);
    expect(mockAdmin.deleteUser).toHaveBeenCalledWith('uuid-fake-1');
  });

  it('fail-fast when supabase/.env missing', async () => {
    mockExistsSync.mockReturnValue(false);
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    await expect(mintTestUserJWT('abc', 'pro')).rejects.toThrow(/supabase\/\.env missing/);
  });

  it('fail-fast when JWT_SECRET missing from env content', async () => {
    mockReadFileSync.mockReturnValue('SUPABASE_SERVICE_ROLE_KEY=key-only\n');
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    await expect(mintTestUserJWT('abc', 'pro')).rejects.toThrow(/JWT_SECRET/);
  });

  it('fail-fast when JWT_SECRET length < 32', async () => {
    mockReadFileSync.mockReturnValue(
      'SUPABASE_SERVICE_ROLE_KEY=key\nJWT_SECRET=tooshort\n',
    );
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    await expect(mintTestUserJWT('abc', 'pro')).rejects.toThrow(/length < 32/);
  });

  it('admin.createUser called with email_confirm:true and a password', async () => {
    const { mintTestUserJWT } = await import('../e2e/_jwt-fixture');
    await mintTestUserJWT('abc', 'pro');
    expect(mockAdmin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'e2e-abc-pro@e2e.test',
        email_confirm: true,
        password: expect.any(String),
      }),
    );
  });
});

describe('exported constants', () => {
  it('EXPECTED_STORAGE_KEY === sb-127-auth-token', async () => {
    const { EXPECTED_STORAGE_KEY } = await import('../e2e/_jwt-fixture');
    expect(EXPECTED_STORAGE_KEY).toBe('sb-127-auth-token');
  });

  it('E2E_EMAIL_PATTERN matches e2e emails / rejects others', async () => {
    const { E2E_EMAIL_PATTERN } = await import('../e2e/_jwt-fixture');
    expect(E2E_EMAIL_PATTERN.test('e2e-7c4f-pro@e2e.test')).toBe(true);
    expect(E2E_EMAIL_PATTERN.test('e2e-anything@e2e.test')).toBe(true);
    expect(E2E_EMAIL_PATTERN.test('real@user.com')).toBe(false);
    expect(E2E_EMAIL_PATTERN.test('e2e-test@somewhere.com')).toBe(false);
  });
});
