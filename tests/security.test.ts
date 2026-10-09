import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertPublicUrl, FetchTimeoutError, isPrivateIp, parseHttpUrl, safeFetch, UrlSecurityError } from '../server/src/security';
import { startFixture, type Fixture } from './fixtures/site';

describe('isPrivateIp', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip'])('blocks %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111'])('allows %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('parseHttpUrl', () => {
  it.each(['', '   ', 'example.com', 'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com'])('rejects %j', (u) => {
    expect(() => parseHttpUrl(u)).toThrow(UrlSecurityError);
  });
  it('rejects non-strings', () => { expect(() => parseHttpUrl(undefined)).toThrow(UrlSecurityError); });
  it('accepts http/https and strips the fragment', () => {
    expect(parseHttpUrl('https://example.com/a#x').href).toBe('https://example.com/a');
    expect(parseHttpUrl('http://example.com').protocol).toBe('http:');
  });
});

describe('assertPublicUrl', () => {
  const policy = { allowedHosts: [] as string[] };
  it.each(['http://localhost', 'http://127.0.0.1', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://10.0.0.5', 'http://2130706433/', 'http://foo.internal', 'http://printer.local'])('blocks %s', async (u) => {
    await expect(assertPublicUrl(new URL(u), policy)).rejects.toThrow(UrlSecurityError);
  });
  it('allows an explicitly allow-listed host', async () => {
    await expect(assertPublicUrl(new URL('http://127.0.0.1:1234'), { allowedHosts: ['127.0.0.1'] })).resolves.toBeUndefined();
  });
});

describe('safeFetch (local fixture)', () => {
  let fx: Fixture;
  const policy = { allowedHosts: ['127.0.0.1'] };
  beforeAll(async () => { fx = await startFixture(); });
  afterAll(async () => { await fx.close(); });

  it('fetches a page', async () => {
    const r = await safeFetch(`${fx.baseUrl}/`, { timeoutMs: 3000, policy });
    expect(r.status).toBe(200);
    expect(r.body).toContain('Fixture Home');
  });
  it('re-validates redirects: refuses a redirect to a private/metadata address', async () => {
    await expect(safeFetch(`${fx.baseUrl}/redirect-private`, { timeoutMs: 3000, policy })).rejects.toThrow(/blocked|private/i);
    expect(fx.requests.some((r) => r.path.includes('meta-data'))).toBe(false);
  });
  it('stops redirect loops', async () => {
    await expect(safeFetch(`${fx.baseUrl}/redirect-loop`, { timeoutMs: 3000, policy })).rejects.toThrow(/Too many redirects/);
  });
  it('times out slow responses', async () => {
    await expect(safeFetch(`${fx.baseUrl}/slow`, { timeoutMs: 300, policy })).rejects.toThrow(FetchTimeoutError);
  });
  it('refuses the fixture host when it is not allow-listed (default policy)', async () => {
    await expect(safeFetch(`${fx.baseUrl}/`, { timeoutMs: 3000, policy: { allowedHosts: [] } })).rejects.toThrow(UrlSecurityError);
  });
});
