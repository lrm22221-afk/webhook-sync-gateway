import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStack } from '../src/main';
import { orderBody, payEvent, postOrder, postPay } from './helpers';
import { signStripeStyle } from '../src/signatures';

process.env.QUIET = '1';
let s: Awaited<ReturnType<typeof startStack>>;
beforeAll(async () => { s = await startStack(); });
afterAll(() => s.close());
const ctl = (b: object) => fetch(`${s.crmBase}/__control`, { method: 'POST', body: JSON.stringify(b) });

describe('order webhook', () => {
  it('stores a signed order and normalises it', async () => {
    expect((await postOrder(s.base, orderBody('o_a'))).status).toBe(200);
    const o = await (await fetch(`${s.base}/orders/o_a`)).json();
    expect(o).toMatchObject({ id: 'o_a', totalCents: 4250, status: 'pending' });
    expect(o.email).toBe(o.email.toLowerCase());
  });
  it('rejects a bad signature with 401', async () => {
    expect((await postOrder(s.base, orderBody(), undefined, 'wrong')).status).toBe(401);
  });
  it('rejects a payload that breaks the contract with 422 and does not burn the event id', async () => {
    const bad = orderBody('o_bad', { total_price: 42.5 });
    expect((await postOrder(s.base, bad, 'e_fixed')).status).toBe(422);
    expect((await postOrder(s.base, orderBody('o_fixed'), 'e_fixed')).status).toBe(200);
  });
  it('is idempotent on redelivery', async () => {
    const raw = orderBody('o_dup');
    await postOrder(s.base, raw, 'e_dup');
    expect(await (await postOrder(s.base, raw, 'e_dup')).json()).toEqual({ duplicate: true });
  });
  it('returns 400 on invalid JSON', async () => {
    expect((await postOrder(s.base, '{nope')).status).toBe(400);
  });
});

describe('payment webhook → CRM sync', () => {
  it('marks paid and creates a CRM contact', async () => {
    await postOrder(s.base, orderBody('o_pay'));
    const r = await postPay(s.base, payEvent('o_pay'));
    expect(await r.json()).toEqual({ ok: true, status: 'paid' });
    const o = await (await fetch(`${s.base}/orders/o_pay`)).json();
    expect(o.crmContactId).toMatch(/^c_/);
    expect(s.crm.contacts.find((c) => c.id === o.crmContactId)?.lifecycle).toBe('customer');
  });
  it('rejects stale signatures (replay)', async () => {
    const raw = payEvent('o_pay');
    expect((await postPay(s.base, raw, signStripeStyle(raw, 'whsec_demo', 1000))).status).toBe(401);
  });
  it('processes a duplicate event once', async () => {
    await postOrder(s.base, orderBody('o_once'));
    const raw = payEvent('o_once', 'payment_intent.succeeded', 'evt_once');
    await postPay(s.base, raw);
    const before = s.crm.stats.requests;
    expect(await (await postPay(s.base, raw)).json()).toEqual({ duplicate: true });
    expect(s.crm.stats.requests).toBe(before);
  });
  it('returns 409 for an unknown order so the provider retries later (out-of-order delivery)', async () => {
    const raw = payEvent('o_late', 'payment_intent.succeeded', 'evt_late');
    expect((await postPay(s.base, raw)).status).toBe(409);
    await postOrder(s.base, orderBody('o_late'));
    expect((await postPay(s.base, raw)).status).toBe(200);
  });
  it('retries through 429 rate limits', async () => {
    await postOrder(s.base, orderBody('o_rl'));
    const rl = s.crm.stats.rateLimited;
    await ctl({ rateLimitNext: 2 });
    expect((await postPay(s.base, payEvent('o_rl'))).status).toBe(200);
    expect(s.crm.stats.rateLimited - rl).toBe(2);
  });
  it('refreshes the token on 401 and retries once', async () => {
    await postOrder(s.base, orderBody('o_exp'));
    const grants = s.crm.stats.tokenGrants;
    await fetch(`${s.crmBase}/__expire`, { method: 'POST' });
    expect((await postPay(s.base, payEvent('o_exp'))).status).toBe(200);
    expect(s.crm.stats.tokenGrants).toBe(grants + 1);
  });
  it('returns 502 and allows redelivery when the CRM keeps failing', async () => {
    await postOrder(s.base, orderBody('o_down'));
    const raw = payEvent('o_down', 'payment_intent.succeeded', 'evt_down');
    await ctl({ failNext: 4 });
    expect((await postPay(s.base, raw)).status).toBe(502);
    expect((await postPay(s.base, raw)).status).toBe(200);
  });
  it('handles refunds', async () => {
    await postOrder(s.base, orderBody('o_ref'));
    expect(await (await postPay(s.base, payEvent('o_ref', 'charge.refunded'))).json()).toMatchObject({ status: 'refunded' });
  });
});

describe('GraphQL', () => {
  const q = async (query: string, variables?: object) => (await fetch(`${s.base}/graphql`, { method: 'POST', body: JSON.stringify({ query, variables }) })).json();
  it('queries an order by id', async () => {
    expect((await q('query($id:ID!){order(id:$id){id status totalCents}}', { id: 'o_pay' })).data.order).toEqual({ id: 'o_pay', status: 'paid', totalCents: 4250 });
  });
  it('filters by status', async () => {
    const r = await q('{orders(status: refunded){id}}');
    expect(r.data.orders.map((o: { id: string }) => o.id)).toContain('o_ref');
  });
  it('rejects fields not in the schema', async () => {
    expect((await q('{orders{id password}}')).errors[0].message).toMatch(/password/);
  });
});
