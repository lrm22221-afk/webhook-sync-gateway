/**
 * Mock CRM with an OAuth2 authorization server (HubSpot-like shape, simplified; not the real HubSpot API).
 * Fault injection: POST /__control { rateLimitNext: n, failNext: n }; POST /__expire revokes all access tokens.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const MOCK_CLIENT = { id: 'demo-client', secret: 'demo-secret-not-real' };

export function createMockCrm() {
  const codes = new Map<string, { challenge: string; redirect: string }>();
  const access = new Map<string, number>(); // token -> expiry ms
  const refresh = new Set<string>();
  const contacts: { id: string; email: string; lifecycle: string }[] = [];
  const idem = new Map<string, unknown>();
  const ctl = { rateLimitNext: 0, failNext: 0 };
  const stats = { requests: 0, rateLimited: 0, tokenGrants: 0 };
  const tok = () => randomBytes(12).toString('hex');
  const json = (res: ServerResponse, c: number, b: unknown, h: Record<string, string> = {}) => { res.writeHead(c, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(b)); };
  const body = (req: IncomingMessage) => new Promise<string>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/__control') { Object.assign(ctl, JSON.parse(await body(req))); return json(res, 200, ctl); }
    if (url.pathname === '/__expire') { access.clear(); return json(res, 200, { ok: true }); }
    if (url.pathname === '/oauth/authorize') {
      const p = url.searchParams;
      if (p.get('client_id') !== MOCK_CLIENT.id || p.get('code_challenge_method') !== 'S256') return json(res, 400, { error: 'invalid_request' });
      const code = tok(); codes.set(code, { challenge: p.get('code_challenge')!, redirect: p.get('redirect_uri')! });
      res.writeHead(302, { location: `${p.get('redirect_uri')}?code=${code}&state=${p.get('state')}` }); return res.end();
    }
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      const basic = Buffer.from((req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString();
      if (basic !== `${MOCK_CLIENT.id}:${MOCK_CLIENT.secret}`) return json(res, 401, { error: 'invalid_client' });
      const f = new URLSearchParams(await body(req));
      if (f.get('grant_type') === 'authorization_code') {
        const c = codes.get(f.get('code') ?? ''); codes.delete(f.get('code') ?? ''); // one-time use
        if (!c || c.redirect !== f.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant' });
        if (createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'pkce' });
      } else if (f.get('grant_type') === 'refresh_token') {
        if (!refresh.delete(f.get('refresh_token') ?? '')) return json(res, 400, { error: 'invalid_grant' }); // rotation: old refresh token dies
      } else return json(res, 400, { error: 'unsupported_grant_type' });
      const a = tok(), r = tok(); access.set(a, Date.now() + 3600_000); refresh.add(r); stats.tokenGrants++;
      return json(res, 200, { access_token: a, refresh_token: r, token_type: 'bearer', expires_in: 3600 });
    }
    if (url.pathname.startsWith('/v1/')) {
      stats.requests++;
      const t = (req.headers.authorization ?? '').replace('Bearer ', '');
      if (!((access.get(t) ?? 0) > Date.now())) return json(res, 401, { error: 'expired_token' });
      if (ctl.rateLimitNext > 0) { ctl.rateLimitNext--; stats.rateLimited++; return json(res, 429, { error: 'rate_limited' }, { 'retry-after': '0' }); }
      if (ctl.failNext > 0) { ctl.failNext--; return json(res, 503, { error: 'unavailable' }); }
      if (url.pathname === '/v1/contacts' && req.method === 'POST') {
        const key = req.headers['idempotency-key'] as string | undefined;
        if (key && idem.has(key)) return json(res, 200, idem.get(key));
        const { email, lifecycle } = JSON.parse(await body(req));
        let c = contacts.find((x) => x.email === email);
        if (c) c.lifecycle = lifecycle; else { c = { id: `c_${contacts.length + 1}`, email, lifecycle }; contacts.push(c); }
        if (key) idem.set(key, c);
        return json(res, 200, c);
      }
      if (url.pathname === '/v1/contacts' && req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 10);
        const start = url.searchParams.get('after') ? Number(url.searchParams.get('after')) : 0;
        const results = contacts.slice(start, start + limit);
        return json(res, 200, { results, next: start + limit < contacts.length ? String(start + limit) : null });
      }
    }
    json(res, 404, { error: 'not found' });
  });
  return { server, contacts, stats, ctl };
}
