import { createHash, randomBytes } from 'node:crypto';

export interface TokenSet { access_token: string; refresh_token: string; expires_at: number }

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizeUrl(base: string, clientId: string, redirectUri: string, challenge: string, state: string) {
  const u = new URL('/oauth/authorize', base);
  Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'contacts.write' })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

/** OAuth2 client for the CRM: code exchange with PKCE, proactive refresh before expiry, single-flight refresh. */
export class OAuthClient {
  private tokens?: TokenSet;
  private refreshing?: Promise<TokenSet>;
  constructor(private base: string, private clientId: string, private clientSecret: string, private now = () => Date.now()) {}

  private async tokenRequest(body: Record<string, string>): Promise<TokenSet> {
    const res = await fetch(new URL('/oauth/token', this.base), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64') },
      body: new URLSearchParams(body),
    });
    if (!res.ok) throw new Error(`token endpoint ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: this.now() + j.expires_in * 1000 };
  }

  async exchangeCode(code: string, verifier: string, redirectUri: string) {
    this.tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
    return this.tokens;
  }

  async refresh(): Promise<TokenSet> {
    if (!this.tokens) throw new Error('not authorized');
    this.refreshing ??= this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token })
      .then((t) => (this.tokens = t))
      .finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  async accessToken(): Promise<string> {
    if (!this.tokens) throw new Error('not authorized');
    if (this.tokens.expires_at - this.now() < 30_000) await this.refresh();
    return this.tokens.access_token;
  }
}
