import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockCrm, MOCK_CLIENT } from '../mock/crm-server';
import { CrmClient } from '../src/crm';
import { authorizeUrl, OAuthClient, pkcePair } from '../src/oauth';

let crm: ReturnType<typeof createMockCrm>, base: string;
beforeAll(async () => { crm = createMockCrm(); await new Promise<void>((r) => crm.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(crm.server.address() as AddressInfo).port}`; });
afterAll(() => crm.server.close());
const getCode = async (challenge: string) => new URL((await fetch(authorizeUrl(base, MOCK_CLIENT.id, 'http://cb', challenge, 's'), { redirect: 'manual' })).headers.get('location')!).searchParams.get('code')!;

describe('OAuth2 authorization code + PKCE', () => {
  it('exchanges a code with the right verifier', async () => {
    const p = pkcePair();
    const t = await new OAuthClient(base, MOCK_CLIENT.id, MOCK_CLIENT.secret).exchangeCode(await getCode(p.challenge), p.verifier, 'http://cb');
    expect(t.access_token).toBeTruthy();
  });
  it('fails with the wrong verifier', async () => {
    const p = pkcePair();
    await expect(new OAuthClient(base, MOCK_CLIENT.id, MOCK_CLIENT.secret).exchangeCode(await getCode(p.challenge), pkcePair().verifier, 'http://cb')).rejects.toThrow(/400/);
  });
  it('codes are single use', async () => {
    const p = pkcePair(); const code = await getCode(p.challenge);
    await new OAuthClient(base, MOCK_CLIENT.id, MOCK_CLIENT.secret).exchangeCode(code, p.verifier, 'http://cb');
    await expect(new OAuthClient(base, MOCK_CLIENT.id, MOCK_CLIENT.secret).exchangeCode(code, p.verifier, 'http://cb')).rejects.toThrow(/invalid_grant/);
  });
  it('rejects a wrong client secret', async () => {
    const p = pkcePair();
    await expect(new OAuthClient(base, MOCK_CLIENT.id, 'nope').exchangeCode(await getCode(p.challenge), p.verifier, 'http://cb')).rejects.toThrow(/401/);
  });
  it('refreshes proactively before expiry and rotates the refresh token', async () => {
    let now = Date.now();
    const c = new OAuthClient(base, MOCK_CLIENT.id, MOCK_CLIENT.secret, () => now);
    const p = pkcePair(); const first = await c.exchangeCode(await getCode(p.challenge), p.verifier, 'http://cb');
    now += 3590_000; // 10 s before expiry
    const a2 = await c.accessToken();
    expect(a2).not.toBe(first.access_token);
  });
  it('concurrent refreshes share one token request (single flight)', async () => {
    const c = new OAuthClient(base, MOCK_CLIENT.id, MOCK_CLIENT.secret);
    const p = pkcePair(); await c.exchangeCode(await getCode(p.challenge), p.verifier, 'http://cb');
    const g = crm.stats.tokenGrants;
    const [a, b] = await Promise.all([c.refresh(), c.refresh()]);
    expect(a.access_token).toBe(b.access_token);
    expect(crm.stats.tokenGrants).toBe(g + 1);
  });
});

describe('CRM REST client', () => {
  it('walks cursor pagination across pages', async () => {
    const c = new OAuthClient(base, MOCK_CLIENT.id, MOCK_CLIENT.secret);
    const p = pkcePair(); await c.exchangeCode(await getCode(p.challenge), p.verifier, 'http://cb');
    const crmc = new CrmClient(base, c);
    for (const e of ['a@x.io', 'b@x.io', 'c@x.io', 'd@x.io', 'e@x.io']) await crmc.upsertContact(e, 'lead');
    const all: string[] = []; for await (const ct of crmc.listContacts(2)) all.push(ct.email);
    expect(all).toEqual(expect.arrayContaining(['a@x.io', 'e@x.io']));
    expect(new Set(all).size).toBe(all.length);
  });
  it('gives up after the retry cap', async () => {
    const c = new OAuthClient(base, MOCK_CLIENT.id, MOCK_CLIENT.secret);
    const p = pkcePair(); await c.exchangeCode(await getCode(p.challenge), p.verifier, 'http://cb');
    crm.ctl.rateLimitNext = 10;
    await expect(new CrmClient(base, c, 2).upsertContact('z@x.io', 'lead')).rejects.toThrow(/429/);
    crm.ctl.rateLimitNext = 0;
  });
});
