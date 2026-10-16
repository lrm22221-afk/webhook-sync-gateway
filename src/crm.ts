import type { OAuthClient } from './oauth';

export interface Contact { id: string; email: string; lifecycle: string }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** REST client for the (mock) CRM: bearer auth, refresh-on-401 once, 429 Retry-After with a retry cap, cursor pagination. */
export class CrmClient {
  constructor(private base: string, private auth: OAuthClient, private maxRetries = 3) {}

  async request<T>(path: string, init: RequestInit = {}, attempt = 0, refreshed = false): Promise<T> {
    const res = await fetch(new URL(path, this.base), { ...init, headers: { 'content-type': 'application/json', ...init.headers, authorization: `Bearer ${await this.auth.accessToken()}` } });
    if (res.status === 401 && !refreshed) { await this.auth.refresh(); return this.request(path, init, attempt, true); }
    if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
      const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 100 * 2 ** attempt;
      await sleep(Math.min(wait, 2000));
      return this.request(path, init, attempt + 1, refreshed);
    }
    if (!res.ok) throw new Error(`CRM ${res.status} ${path}`);
    return (await res.json()) as T;
  }

  async upsertContact(email: string, lifecycle: string): Promise<Contact> {
    return this.request<Contact>('/v1/contacts', { method: 'POST', body: JSON.stringify({ email, lifecycle }), headers: { 'idempotency-key': `contact:${email}:${lifecycle}` } });
  }

  async *listContacts(pageSize = 2): AsyncGenerator<Contact> {
    let cursor: string | null = null;
    do {
      const q: string = `/v1/contacts?limit=${pageSize}${cursor ? `&after=${cursor}` : ''}`;
      const page: { results: Contact[]; next: string | null } = await this.request(q);
      yield* page.results;
      cursor = page.next;
    } while (cursor);
  }
}
