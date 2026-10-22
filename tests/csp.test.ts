import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function directives() {
  vi.resetModules();
  const { default: config } = await import('../next.config');
  if (typeof config.headers !== 'function') throw new Error('missing headers');
  const routes = await config.headers();
  const csp = routes[0].headers.find((header) => header.key === 'Content-Security-Policy')?.value;
  if (!csp) throw new Error('missing CSP');
  return new Map(csp.split('; ').map((directive) => {
    const [name, ...sources] = directive.split(' ');
    return [name, sources];
  }));
}

describe('C13: bounded browser CSP origins', () => {
  it('has no scheme-only or wildcard source in connect-src/frame-src', async () => {
    const policy = await directives();
    for (const name of ['connect-src', 'frame-src']) {
      const sources = policy.get(name);
      expect(sources?.length).toBeGreaterThan(0);
      for (const source of sources ?? []) {
        expect(source).not.toMatch(/^(https?|wss?):$/);
        expect(source).not.toContain('*');
      }
    }
  });

  it('uses exact deployment hosts without leaking URL paths or query credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test-project.supabase.co/auth?token=private');
    vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32));
    const sources = (await directives()).get('connect-src');
    expect(sources).toContain('https://test-project.supabase.co');
    expect(sources).toContain('wss://test-project.supabase.co');
    expect(sources).toContain(`https://${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    expect(sources?.join(' ')).not.toMatch(/private|token=/);
    for (const source of sources ?? []) {
      if (source !== "'self'") expect(new URL(source).pathname).toBe('/');
    }
  });

  it('preserves all directives other than connect-src and frame-src', async () => {
    const policy = await directives();
    policy.delete('connect-src');
    policy.delete('frame-src');
    expect(Object.fromEntries(policy)).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", ...(process.env.NODE_ENV !== 'production' ? ["'unsafe-eval'"] : []), 'https://challenges.cloudflare.com'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'font-src': ["'self'", 'data:'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'child-src': ['https://auth.privy.io', 'https://verify.walletconnect.com', 'https://verify.walletconnect.org'],
      'worker-src': ["'self'", 'blob:'],
    });
  });

  it('rejects configured wildcard hosts', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://*.supabase.co');
    await expect(directives()).rejects.toThrow('explicit host');
  });
});
