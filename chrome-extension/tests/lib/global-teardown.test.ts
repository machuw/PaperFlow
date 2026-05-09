// chrome-extension/tests/lib/global-teardown.test.ts
//
// E2E-01 unit tests for Playwright globalTeardown.
// Mocks @supabase/supabase-js admin + node:fs.
//
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAdmin = {
  listUsers: vi.fn(),
  deleteUser: vi.fn(),
};
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { admin: mockAdmin } })),
}));

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

const VALID_ENV = 'SUPABASE_SERVICE_ROLE_KEY=eyJtest.service.role\n';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(VALID_ENV);
});

describe('global teardown', () => {
  it('lists users, filters e2e-*, deletes each', async () => {
    mockAdmin.listUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'uuid-real', email: 'real@user.com' },
          { id: 'uuid-e2e-1', email: 'e2e-abc-pro@e2e.test' },
          { id: 'uuid-e2e-2', email: 'e2e-xyz-free@e2e.test' },
        ],
      },
    });
    mockAdmin.deleteUser.mockResolvedValue({ data: null, error: null });
    const teardown = (await import('../e2e/_global-teardown')).default;
    await teardown({} as never);
    expect(mockAdmin.listUsers).toHaveBeenCalledWith({ perPage: 1000 });
    expect(mockAdmin.deleteUser).toHaveBeenCalledTimes(2);
    expect(mockAdmin.deleteUser).toHaveBeenCalledWith('uuid-e2e-1');
    expect(mockAdmin.deleteUser).toHaveBeenCalledWith('uuid-e2e-2');
    expect(mockAdmin.deleteUser).not.toHaveBeenCalledWith('uuid-real');
  });

  it('does not throw when listUsers errors (D-11 non-blocking)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockAdmin.listUsers.mockRejectedValue(new Error('network down'));
    const teardown = (await import('../e2e/_global-teardown')).default;
    await expect(teardown({} as never)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns early when supabase/.env missing', async () => {
    mockExistsSync.mockReturnValue(false);
    const teardown = (await import('../e2e/_global-teardown')).default;
    await expect(teardown({} as never)).resolves.toBeUndefined();
    expect(mockAdmin.listUsers).not.toHaveBeenCalled();
  });

  it('returns early when SUPABASE_SERVICE_ROLE_KEY missing in env', async () => {
    mockReadFileSync.mockReturnValue('# no key here\n');
    const teardown = (await import('../e2e/_global-teardown')).default;
    await expect(teardown({} as never)).resolves.toBeUndefined();
    expect(mockAdmin.listUsers).not.toHaveBeenCalled();
  });

  it('logs count of cleaned users', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockAdmin.listUsers.mockResolvedValue({
      data: { users: [{ id: 'u1', email: 'e2e-x-pro@e2e.test' }] },
    });
    mockAdmin.deleteUser.mockResolvedValue({ data: null, error: null });
    const teardown = (await import('../e2e/_global-teardown')).default;
    await teardown({} as never);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('cleaned 1 e2e users'));
    logSpy.mockRestore();
  });
});
